"""ИИ: Этап 2 — разбор договоров, обязательства и сроки, сравнение версий документов.

Claude вызывается только через core.ai.run() (лимиты, журнал, защитные правила, изоляция компаний).
Эндпоинты принимают id записей и сами загружают файлы с проверкой компании и прав — так же,
как обычные API договоров (api/contracts.py) и документов (api/p4.py `_get_doc`).
ИИ ничего не сохраняет сам: возвращает предложения, пользователь подтверждает их в интерфейсе,
а сохранение идёт обычным PATCH договора или CRUD обязательств ниже.

Маршруты:
- POST /api/ai/contracts/{cid}/extract                 — предложения для полей договора из его файла
- POST /api/ai/contracts/{cid}/obligations/extract     — предложения обязательств из файла договора
- POST /api/ai/documents/{did}/versions/compare        — что изменилось между двумя версиями документа
- GET/POST/PATCH/DELETE /api/contracts/{cid}/obligations[/{oid}], POST …/obligations/bulk — обязательства
"""
from __future__ import annotations

import re
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core import ai as core_ai
from ..database import get_db
from ..models import Company, Contract, Document, DocumentVersion
from ..models.contract import CONTRACT_TYPES, VAT_MODES
from ..models.obligation import OBLIGATION_PARTIES, OBLIGATION_STATUSES, ContractObligation
from ..schemas.common import Message
from ..services import ai_text
from .contracts import _get as _get_contract
from .deps import TenantContext, get_current_context, log_action, require
from .p4 import _get_doc

# Без prefix: часть маршрутов — /api/ai/…, обязательства — рядом с договором, /api/contracts/…
router = APIRouter(tags=["ai"])


# =============================================================================
# Общие помощники
# =============================================================================

class DocumentRef(BaseModel):
    document_id: int


def _contract_file(db: Session, ctx: TenantContext, cid: int, document_id: int) -> tuple[Contract, Document]:
    """Договор этой компании и файл, приложенный именно к нему. Проверки — до обращения к ИИ."""
    contract = _get_contract(db, ctx, cid)
    doc = _get_doc(db, ctx, document_id)
    if doc.contract_id != contract.id:
        raise HTTPException(400, "Этот файл не приложен к договору")
    return contract, doc


def _nullable(schema: dict) -> dict:
    return {"anyOf": [schema, {"type": "null"}]}


def _parse_date(v: Any) -> Optional[date]:
    if not isinstance(v, str):
        return None
    try:
        d = date.fromisoformat(v.strip()[:10])
    except ValueError:
        return None
    return d if 1900 <= d.year <= 2200 else None


def _parse_decimal(v: Any, max_value: Decimal) -> Optional[Decimal]:
    if v is None or isinstance(v, bool):
        return None
    s = re.sub(r"[\s ]", "", str(v)).replace(",", ".")
    try:
        d = Decimal(s)
    except InvalidOperation:
        return None
    if not d.is_finite() or d < 0 or d > max_value:
        return None
    return d.quantize(Decimal("0.01"))


def _clip(v: Any, n: int) -> Optional[str]:
    if not isinstance(v, str):
        return None
    v = v.strip()
    return v[:n] if v else None


def _fmt_date(d: Optional[date]) -> str:
    return d.strftime("%d.%m.%Y") if d else "—"


def _fmt_money(v: Optional[Decimal]) -> str:
    if v is None:
        return "—"
    s = f"{Decimal(v):,.2f}".replace(",", " ").replace(".", ",")
    return s[:-3] if s.endswith(",00") else s


# =============================================================================
# 1. Разбор договора: предложения для полей
# =============================================================================

# (поле договора, подпись, тип значения, подсказка для модели)
EXTRACT_FIELDS: list[tuple[str, str, str, str]] = [
    ("number", "Номер договора", "string", "номер договора как в тексте, без знака №"),
    ("date_signed", "Дата подписания", "date", "дата заключения/подписания договора"),
    ("contract_type", "Тип договора", "type", "тип: " + ", ".join(f"{k} — {v}" for k, v in CONTRACT_TYPES.items())),
    ("subject", "Предмет договора", "text", "предмет договора одним-двумя предложениями близко к тексту"),
    ("amount", "Сумма", "decimal", "общая сумма (цена) договора числом без пробелов, точка — разделитель дробной части"),
    ("currency", "Валюта", "currency", "валюта суммы — код ISO 4217 из трёх латинских букв (KZT, USD, EUR, RUB, CNY…)"),
    ("vat_mode", "НДС", "vat", "none — без НДС, on_top — НДС начисляется сверху суммы, included — сумма уже включает НДС"),
    ("vat_rate", "Ставка НДС, %", "percent", "ставка НДС в процентах числом"),
    ("valid_from", "Действует с", "date", "дата начала действия договора"),
    ("valid_until", "Действует до", "date", "дата окончания срока действия договора"),
    ("auto_renewal", "Автопролонгация", "bool", "true — договор продлевается автоматически, если стороны не заявили об обратном; false — прямо сказано, что не продлевается"),
]

_VALUE_SCHEMA = {
    "string": {"type": "string"},
    "text": {"type": "string"},
    "date": {"type": "string", "description": "YYYY-MM-DD"},
    "decimal": {"type": "string"},
    "percent": {"type": "string"},
    "currency": {"type": "string"},
    "type": {"type": "string", "enum": list(CONTRACT_TYPES)},
    "vat": {"type": "string", "enum": list(VAT_MODES)},
    "bool": {"type": "boolean"},
}


def _field_schema(kind: str, hint: str) -> dict:
    return {
        "type": "object",
        "description": hint,
        "properties": {
            "value": _nullable(_VALUE_SCHEMA[kind]),
            "quote": _nullable({"type": "string", "description": "дословная цитата из документа, на которой основано значение"}),
        },
        "required": ["value", "quote"],
        "additionalProperties": False,
    }


EXTRACT_SCHEMA = {
    "type": "object",
    "properties": {
        **{f: _field_schema(kind, hint) for f, _l, kind, hint in EXTRACT_FIELDS},
        "counterparty_name": _field_schema("string", "наименование контрагента (вторая сторона, не наше юрлицо)"),
        "counterparty_tax_id": _field_schema("string", "БИН/ИИН/ИНН контрагента, только цифры"),
    },
    "required": [*(f for f, *_ in EXTRACT_FIELDS), "counterparty_name", "counterparty_tax_id"],
    "additionalProperties": False,
}

EXTRACT_TASK = """Из файла договора извлеки значения полей карточки договора в CRM.
Правила:
- Бери значения только из текста документа. Если значения нет, оно неоднозначно или ты не уверен — value: null и quote: null. Не угадывай и не дополняй.
- Для каждого найденного значения укажи quote — короткую дословную цитату (до 300 символов) из документа, где это значение указано.
- Даты — в формате YYYY-MM-DD. Если указан только месяц/год или срок в виде «в течение N дней» — null.
- Сумма — общая цена договора. Если суммы несколько и общей нет — null.
- «Наше юрлицо» и «контрагент» указаны в данных о договоре; контрагент — другая сторона."""


def _norm(row: Contract, field: str, kind: str) -> Any:
    v = getattr(row, field)
    if kind in ("decimal", "percent") and v is not None:
        return Decimal(v).quantize(Decimal("0.01"))
    if kind == "bool":
        return bool(v)
    if isinstance(v, str):
        return v.strip() or None
    return v


def _clean_value(kind: str, v: Any) -> Any:
    if v is None:
        return None
    if kind == "date":
        return _parse_date(v)
    if kind == "decimal":
        return _parse_decimal(v, Decimal("9999999999999999"))
    if kind == "percent":
        return _parse_decimal(v, Decimal("100"))
    if kind == "currency":
        s = str(v).strip().upper()
        return s if re.fullmatch(r"[A-Z]{3}", s) else None
    if kind == "type":
        return v if v in CONTRACT_TYPES else None
    if kind == "vat":
        return v if v in VAT_MODES else None
    if kind == "bool":
        return v if isinstance(v, bool) else None
    if kind == "string":
        return _clip(v, 100)
    return _clip(v, 5000)


def _display(kind: str, v: Any) -> str:
    if v is None:
        return "—"
    if kind == "date":
        return _fmt_date(v)
    if kind == "decimal":
        return _fmt_money(v)
    if kind == "percent":
        return f"{_fmt_money(v)}%"
    if kind == "type":
        return CONTRACT_TYPES.get(v, v)
    if kind == "vat":
        return VAT_MODES.get(v, v)
    if kind == "bool":
        return "Включена" if v else "Нет"
    return str(v)


def _json_value(v: Any) -> Any:
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, date):
        return v.isoformat()
    return v


def _contract_context(c: Contract) -> str:
    """Что уже известно о договоре (данные компании пользователя)."""
    ours = c.legal_entity.short_name if c.legal_entity is not None and getattr(c.legal_entity, "short_name", None) else None
    parts = [
        f"Номер в CRM: {c.number}",
        f"Наше юрлицо: {ours or 'не указано'}",
        f"Контрагент в CRM: {c.company.name if c.company else 'не указан'}",
        f"Дата подписания в CRM: {c.date_signed.isoformat() if c.date_signed else 'не указана'}",
        f"Действует с: {c.valid_from.isoformat() if c.valid_from else 'не указано'}",
    ]
    return core_ai.wrap_data("contract", "\n".join(parts))


def _match_company(db: Session, tid: int, name: Optional[str], tax_id: Optional[str]) -> Optional[Company]:
    """Контрагент из справочника компании: сначала по БИН/ИИН, затем по точному названию."""
    if tax_id:
        digits = re.sub(r"\D", "", tax_id)
        if digits:
            rows = (
                db.query(Company)
                .filter(Company.tenant_id == tid, Company.tax_id.is_not(None),
                        func.regexp_replace(Company.tax_id, r"\D", "", "g") == digits)
                .limit(2).all()
            )
            if len(rows) == 1:
                return rows[0]
    if name:
        rows = (
            db.query(Company)
            .filter(Company.tenant_id == tid, func.lower(func.trim(Company.name)) == name.strip().lower())
            .limit(2).all()
        )
        if len(rows) == 1:
            return rows[0]
    return None


@router.post("/api/ai/contracts/{cid}/extract")
def extract_contract(
    cid: int, payload: DocumentRef,
    ctx: TenantContext = Depends(require("contracts.update")),
    db: Session = Depends(get_db),
):
    """Предложения для полей договора по его файлу. Ничего не сохраняет — применяется обычным PATCH."""
    contract, doc = _contract_file(db, ctx, cid, payload.document_id)
    f = ai_text.load(doc.file_path, doc.name, doc.mime)
    content = [{"role": "user", "content": [
        {"type": "text", "text": _contract_context(contract)},
        *ai_text.blocks(f, "contract_file"),
        {"type": "text", "text": "Извлеки поля договора из этого файла по правилам задачи."},
    ]}]
    res = core_ai.run(db, ctx, "contract_extract", EXTRACT_TASK, content, schema=EXTRACT_SCHEMA,
                      max_tokens=6000, effort="medium")
    data = res.data if isinstance(res.data, dict) else {}

    fields = []
    for name, label, kind, _hint in EXTRACT_FIELDS:
        item = data.get(name) if isinstance(data.get(name), dict) else {}
        value = _clean_value(kind, item.get("value"))
        if value is None:
            continue
        current = _norm(contract, name, kind)
        fields.append({
            "field": name, "label": label,
            "current": _json_value(current), "current_display": _display(kind, current),
            "value": _json_value(value), "display": _display(kind, value),
            "quote": _clip(item.get("quote"), 500),
            "same": current == value,
        })

    cp_name_item = data.get("counterparty_name") if isinstance(data.get("counterparty_name"), dict) else {}
    cp_tax_item = data.get("counterparty_tax_id") if isinstance(data.get("counterparty_tax_id"), dict) else {}
    cp_name = _clip(cp_name_item.get("value"), 300)
    cp_tax = _clip(cp_tax_item.get("value"), 50)
    counterparty = None
    if cp_name or cp_tax:
        match = _match_company(db, ctx.tenant.id, cp_name, cp_tax)
        counterparty = {
            "name": cp_name, "tax_id": cp_tax,
            "quote": _clip(cp_name_item.get("quote") or cp_tax_item.get("quote"), 500),
            "match": {"id": match.id, "name": match.name} if match else None,
        }
        if match:
            fields.append({
                "field": "company_id", "label": "Контрагент",
                "current": contract.company_id, "current_display": contract.company.name if contract.company else "—",
                "value": match.id, "display": match.name,
                "quote": counterparty["quote"], "same": contract.company_id == match.id,
            })
    return {"document": {"id": doc.id, "name": doc.name}, "fields": fields, "counterparty": counterparty}


# =============================================================================
# 2. Обязательства и сроки
# =============================================================================

OBLIGATIONS_SCHEMA = {
    "type": "object",
    "properties": {
        "obligations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "что нужно сделать, коротко (до 200 символов)"},
                    "description": _nullable({"type": "string", "description": "подробности: условия, порядок, срок словами, если он относительный"}),
                    "due_date": _nullable({"type": "string", "description": "YYYY-MM-DD, только если срок — конкретная дата"}),
                    "party": {"type": "string", "enum": list(OBLIGATION_PARTIES)},
                    "quote": {"type": "string", "description": "дословная цитата из документа (до 300 символов)"},
                },
                "required": ["title", "description", "due_date", "party", "quote"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["obligations"],
    "additionalProperties": False,
}

OBLIGATIONS_TASK = """Найди в файле договора обязательства сторон, у которых есть срок или которые нужно отслеживать: оплаты, поставки, выполнение работ, предоставление документов и гарантий, уведомления, отчёты, продление.
Правила:
- Только то, что прямо написано в документе. Не придумывай обязательства и сроки.
- party: us — обязанность нашего юрлица, counterparty — контрагента, both — обеих сторон. Какое юрлицо наше — указано в данных о договоре; если стороны названы ролями (Заказчик/Исполнитель и т.п.), сопоставь по наименованиям.
- due_date — только если в тексте конкретная дата. Если срок относительный («в течение 10 дней с даты подписания») — due_date: null, а срок словами — в description.
- quote — дословная цитата пункта, на котором основано обязательство.
- Не больше 40 самых важных обязательств, без повторов."""


class ObligationIn(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    description: Optional[str] = Field(default=None, max_length=5000)
    due_date: Optional[date] = None
    party: str = "us"
    source_quote: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("party")
    @classmethod
    def _party(cls, v):
        if v not in OBLIGATION_PARTIES:
            raise ValueError("Выберите сторону из списка")
        return v

    @field_validator("title")
    @classmethod
    def _title(cls, v):
        v = (v or "").strip()
        if not v:
            raise ValueError("Укажите, что нужно сделать")
        return v


class ObligationPatch(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=500)
    description: Optional[str] = Field(default=None, max_length=5000)
    due_date: Optional[date] = None
    party: Optional[str] = None
    status: Optional[str] = None

    @field_validator("party")
    @classmethod
    def _party(cls, v):
        if v is not None and v not in OBLIGATION_PARTIES:
            raise ValueError("Выберите сторону из списка")
        return v

    @field_validator("status")
    @classmethod
    def _status(cls, v):
        if v is not None and v not in OBLIGATION_STATUSES:
            raise ValueError("Неизвестный статус обязательства")
        return v


class ObligationBulkIn(BaseModel):
    items: list[ObligationIn] = Field(min_length=1, max_length=50)


class ObligationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    contract_id: int
    title: str
    description: Optional[str] = None
    due_date: Optional[date] = None
    party: str
    status: str
    source_quote: Optional[str] = None
    created_by: Optional[int] = None
    created_at: datetime
    done_at: Optional[datetime] = None


def _get_obligation(db: Session, ctx: TenantContext, contract: Contract, oid: int) -> ContractObligation:
    row = db.get(ContractObligation, oid)
    if not row or row.tenant_id != ctx.tenant.id or row.contract_id != contract.id:
        raise HTTPException(404, "Обязательство не найдено")
    return row


def _new_obligation(ctx: TenantContext, contract: Contract, data: ObligationIn) -> ContractObligation:
    return ContractObligation(
        tenant_id=ctx.tenant.id, contract_id=contract.id, title=data.title,
        description=(data.description or "").strip() or None, due_date=data.due_date, party=data.party,
        status="open", source_quote=(data.source_quote or "").strip() or None, created_by=ctx.user.id,
    )


@router.post("/api/ai/contracts/{cid}/obligations/extract")
def extract_obligations(
    cid: int, payload: DocumentRef,
    ctx: TenantContext = Depends(require("contracts.update")),
    db: Session = Depends(get_db),
):
    """Предложения обязательств из файла договора. Сохраняются только выбранные — через POST …/obligations/bulk."""
    contract, doc = _contract_file(db, ctx, cid, payload.document_id)
    f = ai_text.load(doc.file_path, doc.name, doc.mime)
    content = [{"role": "user", "content": [
        {"type": "text", "text": _contract_context(contract)},
        *ai_text.blocks(f, "contract_file"),
        {"type": "text", "text": "Найди обязательства сторон в этом файле по правилам задачи."},
    ]}]
    res = core_ai.run(db, ctx, "obligations", OBLIGATIONS_TASK, content, schema=OBLIGATIONS_SCHEMA,
                      max_tokens=12000, effort="medium")
    items = (res.data or {}).get("obligations") if isinstance(res.data, dict) else None
    existing = {
        (t or "").strip().lower()
        for (t,) in db.query(ContractObligation.title).filter(
            ContractObligation.tenant_id == ctx.tenant.id, ContractObligation.contract_id == contract.id)
    }
    out, seen = [], set()
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict):
            continue
        title = _clip(it.get("title"), 500)
        if not title or title.lower() in seen:
            continue
        seen.add(title.lower())
        party = it.get("party") if it.get("party") in OBLIGATION_PARTIES else "us"
        out.append({
            "title": title,
            "description": _clip(it.get("description"), 5000),
            "due_date": _json_value(_parse_date(it.get("due_date"))),
            "party": party,
            "source_quote": _clip(it.get("quote"), 2000),
            "exists": title.lower() in existing,
        })
        if len(out) >= 50:
            break
    return {"document": {"id": doc.id, "name": doc.name}, "items": out}


@router.get("/api/contracts/{cid}/obligations", response_model=list[ObligationOut])
def list_obligations(cid: int, ctx: TenantContext = Depends(require("contracts.view")), db: Session = Depends(get_db)):
    contract = _get_contract(db, ctx, cid)
    return (
        db.query(ContractObligation)
        .filter(ContractObligation.tenant_id == ctx.tenant.id, ContractObligation.contract_id == contract.id)
        .order_by((ContractObligation.status == "done"), ContractObligation.due_date.asc().nullslast(), ContractObligation.id)
        .all()
    )


@router.post("/api/contracts/{cid}/obligations", response_model=ObligationOut, status_code=201)
def create_obligation(cid: int, payload: ObligationIn, ctx: TenantContext = Depends(require("contracts.update")), db: Session = Depends(get_db)):
    contract = _get_contract(db, ctx, cid)
    row = _new_obligation(ctx, contract, payload)
    db.add(row)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="contract",
               entity_id=contract.id, detail=f"№ {contract.number}: добавлено обязательство «{row.title[:100]}»")
    db.commit()
    db.refresh(row)
    return row


@router.post("/api/contracts/{cid}/obligations/bulk", response_model=list[ObligationOut], status_code=201)
def create_obligations_bulk(cid: int, payload: ObligationBulkIn, ctx: TenantContext = Depends(require("contracts.update")), db: Session = Depends(get_db)):
    """Несколько обязательств разом — например, выбранные из предложений ИИ."""
    contract = _get_contract(db, ctx, cid)
    rows = [_new_obligation(ctx, contract, it) for it in payload.items]
    db.add_all(rows)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="contract",
               entity_id=contract.id, detail=f"№ {contract.number}: добавлено обязательств — {len(rows)}")
    db.commit()
    for r in rows:
        db.refresh(r)
    return rows


@router.patch("/api/contracts/{cid}/obligations/{oid}", response_model=ObligationOut)
def update_obligation(cid: int, oid: int, payload: ObligationPatch, ctx: TenantContext = Depends(require("contracts.update")), db: Session = Depends(get_db)):
    contract = _get_contract(db, ctx, cid)
    row = _get_obligation(db, ctx, contract, oid)
    data = payload.model_dump(exclude_unset=True)
    if "title" in data:
        t = (data["title"] or "").strip()
        if not t:
            raise HTTPException(400, "Укажите, что нужно сделать")
        row.title = t
    if "description" in data:
        row.description = (data["description"] or "").strip() or None
    if "due_date" in data:
        row.due_date = data["due_date"]
    if data.get("party"):
        row.party = data["party"]
    if data.get("status") and data["status"] != row.status:
        row.status = data["status"]
        row.done_at = datetime.now(timezone.utc) if row.status == "done" else None
        log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="contract",
                   entity_id=contract.id,
                   detail=f"№ {contract.number}: обязательство «{row.title[:100]}» — {OBLIGATION_STATUSES[row.status].lower()}")
    db.commit()
    db.refresh(row)
    return row


@router.delete("/api/contracts/{cid}/obligations/{oid}", response_model=Message)
def delete_obligation(cid: int, oid: int, ctx: TenantContext = Depends(require("contracts.update")), db: Session = Depends(get_db)):
    contract = _get_contract(db, ctx, cid)
    row = _get_obligation(db, ctx, contract, oid)
    title = row.title
    db.delete(row)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="contract",
               entity_id=contract.id, detail=f"№ {contract.number}: удалено обязательство «{title[:100]}»")
    db.commit()
    return Message(message="Обязательство удалено")


# =============================================================================
# 3. Сравнение версий документа
# =============================================================================

class CompareIn(BaseModel):
    from_version_id: int
    to_version_id: int


DIFF_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "главное, что изменилось, 1–4 предложения"},
        "changes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "section": {"type": "string", "description": "пункт или раздел документа"},
                    "before": _nullable({"type": "string", "description": "как было (цитата или пересказ), null — пункт добавлен"}),
                    "after": _nullable({"type": "string", "description": "как стало, null — пункт удалён"}),
                    "significance": {"type": "string", "enum": ["high", "medium", "low"]},
                },
                "required": ["section", "before", "after", "significance"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "changes"],
    "additionalProperties": False,
}

DIFF_TASK = """Сравни две версии одного документа компании: прежнюю (old_version) и новую (new_version).
Правила:
- Перечисли содержательные изменения: суммы, сроки, стороны, обязанности, ответственность, порядок оплаты, условия расторжения, добавленные и удалённые пункты. Опечатки и форматирование — только если меняют смысл.
- significance: high — меняет деньги, сроки, ответственность или права сторон; medium — заметное изменение условий; low — уточнения формулировок.
- before/after — короткие дословные фрагменты (до 300 символов). Ничего не додумывай: если изменений нет — пустой список и так и напиши в summary.
- Не больше 40 изменений, самые важные — первыми."""

_SIG = {"high": 0, "medium": 1, "low": 2}


@router.post("/api/ai/documents/{did}/versions/compare")
def compare_versions(did: int, payload: CompareIn, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = _get_doc(db, ctx, did)
    if payload.from_version_id == payload.to_version_id:
        raise HTTPException(400, "Выберите две разные версии")
    vs = {
        v.id: v for v in db.query(DocumentVersion).filter(
            DocumentVersion.document_id == row.id,
            DocumentVersion.id.in_([payload.from_version_id, payload.to_version_id]),
        )
    }
    if len(vs) != 2:
        raise HTTPException(404, "Версия не найдена")
    old, new = sorted(vs.values(), key=lambda v: v.version_no)
    meta = {
        "document": {"id": row.id, "name": row.name},
        "from_version": {"id": old.id, "version_no": old.version_no},
        "to_version": {"id": new.id, "version_no": new.version_no},
    }
    for v in (old, new):
        if not ai_text.detect_kind(v.filename or row.name, v.mime or row.mime):
            raise HTTPException(400, ai_text.UNSUPPORTED)
    if old.file_path == new.file_path or (old.sha256 and old.sha256 == new.sha256):
        return {**meta, "identical": True, "summary": "Файлы версий совпадают — изменений нет.", "changes": []}

    files = [
        ai_text.load(v.file_path, v.filename or row.name, v.mime or row.mime) for v in (old, new)
    ]
    ai_text.check_total(files)
    content = [{"role": "user", "content": [
        *ai_text.blocks(files[0], "old_version"),
        *ai_text.blocks(files[1], "new_version"),
        {"type": "text", "text": f"Сравни версию {old.version_no} (old_version) и версию {new.version_no} (new_version) по правилам задачи."},
    ]}]
    res = core_ai.run(db, ctx, "version_diff", DIFF_TASK, content, schema=DIFF_SCHEMA, max_tokens=12000, effort="medium")
    data = res.data if isinstance(res.data, dict) else {}
    changes = []
    for ch in data.get("changes") or []:
        if not isinstance(ch, dict):
            continue
        sig = ch.get("significance") if ch.get("significance") in _SIG else "medium"
        before, after = _clip(ch.get("before"), 2000), _clip(ch.get("after"), 2000)
        if not before and not after:
            continue
        changes.append({"section": _clip(ch.get("section"), 300) or "—", "before": before, "after": after, "significance": sig})
    changes.sort(key=lambda c: _SIG[c["significance"]])
    return {**meta, "identical": False, "summary": _clip(data.get("summary"), 3000) or "", "changes": changes[:60]}
