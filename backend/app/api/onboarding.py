"""Мастер первого запуска (для владельца новой компании) и импорт контрагентов.

Шаги мастера: отрасль → структура отделов → сотрудники (импорт/приглашения) → контрагенты → готовые реестры.
Каждый шаг можно пропустить; мастер больше не показывается после «Завершить» или «Пропустить».
"""
from __future__ import annotations

import csv
import io
import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core.industry_templates import INDUSTRIES, INDUSTRY_BY_KEY, SCHEMAS, ordered_schema_codes
from ..core.kz import is_valid_bin, normalize_bin
from ..database import get_db
from ..models import Company, CustomObjectSchema, Department, Invitation, TenantMembership
from .custom_objects import SchemaField, _check_fields
from .deps import TenantContext, get_current_context, log_action, require

router = APIRouter(tags=["onboarding"])


def _owner(ctx: TenantContext = Depends(get_current_context)) -> TenantContext:
    if not ctx.membership.is_owner:
        raise HTTPException(403, "Мастер настройки доступен владельцу компании")
    return ctx


class OnboardingState(BaseModel):
    pending: bool
    industry: Optional[str] = None
    industries: list[dict]
    departments: list[str]
    members: int
    invitations: int
    companies: int
    installed_schemas: list[str]


@router.get("/api/onboarding", response_model=OnboardingState)
def state(ctx: TenantContext = Depends(_owner), db: Session = Depends(get_db)):
    tid = ctx.tenant.id
    installed = [c for (c,) in db.query(CustomObjectSchema.code).filter(CustomObjectSchema.tenant_id == tid)]
    return OnboardingState(
        pending=ctx.tenant.onboarding_completed_at is None,
        industry=ctx.tenant.industry,
        industries=[
            {**i, "schemas": [{"code": c, "label": SCHEMAS[c]["label"]} for c in i["schemas"]]}
            for i in INDUSTRIES
        ],
        departments=[d for (d,) in db.query(Department.name).filter(Department.tenant_id == tid).order_by(Department.name)],
        members=db.query(func.count(TenantMembership.id)).filter(TenantMembership.tenant_id == tid).scalar() or 0,
        invitations=db.query(func.count(Invitation.id)).filter(
            Invitation.tenant_id == tid, Invitation.accepted_at.is_(None)).scalar() or 0,
        companies=db.query(func.count(Company.id)).filter(Company.tenant_id == tid).scalar() or 0,
        installed_schemas=installed,
    )


class IndustryIn(BaseModel):
    industry: str


@router.post("/api/onboarding/industry")
def set_industry(payload: IndustryIn, ctx: TenantContext = Depends(_owner), db: Session = Depends(get_db)):
    if payload.industry not in INDUSTRY_BY_KEY:
        raise HTTPException(400, "Выберите отрасль из списка")
    ctx.tenant.industry = payload.industry
    db.commit()
    return {"industry": payload.industry}


class DepartmentsIn(BaseModel):
    names: list[str] = Field(max_length=100)


@router.post("/api/onboarding/departments")
def create_departments(payload: DepartmentsIn, ctx: TenantContext = Depends(_owner), db: Session = Depends(get_db)):
    """Создаёт отделы, которых ещё нет (без дублей с разным регистром)."""
    tid = ctx.tenant.id
    have = {d.lower() for (d,) in db.query(Department.name).filter(Department.tenant_id == tid)}
    created = []
    for raw in payload.names:
        name = re.sub(r"\s+", " ", raw or "").strip()[:150]
        if name and name.lower() not in have:
            db.add(Department(tenant_id=tid, name=name))
            have.add(name.lower())
            created.append(name)
    if created:
        log_action(db, tenant_id=tid, user_id=ctx.user.id, action="create", entity="department", detail=", ".join(created)[:500])
    db.commit()
    return {"created": created}


class TemplatesIn(BaseModel):
    codes: list[str]


@router.post("/api/onboarding/templates")
def install_templates(payload: TemplatesIn, ctx: TenantContext = Depends(_owner), db: Session = Depends(get_db)):
    """Ставит готовые реестры (сущности Объектов). Уже существующие по коду — пропускает."""
    tid = ctx.tenant.id
    codes = [c for c in dict.fromkeys(payload.codes) if c in SCHEMAS]
    # Реестр, на который ссылаются выбранные (акты → договоры), ставим тоже.
    for c in list(codes):
        for f in SCHEMAS[c]["fields"]:
            t = str(f.get("target") or "")
            if t.startswith("object:") and t[7:] in SCHEMAS and t[7:] not in codes:
                codes.append(t[7:])
    installed, skipped = [], []
    for code in ordered_schema_codes(codes):
        if db.query(CustomObjectSchema.id).filter(CustomObjectSchema.tenant_id == tid, CustomObjectSchema.code == code).first():
            skipped.append(code)
            continue
        spec = SCHEMAS[code]
        fields = _check_fields(db, tid, [SchemaField(**f) for f in spec["fields"]], code)
        db.add(CustomObjectSchema(tenant_id=tid, code=code, label=spec["label"], fields=fields, created_by=ctx.user.id))
        db.flush()
        installed.append(spec["label"])
    if installed:
        log_action(db, tenant_id=tid, user_id=ctx.user.id, action="create", entity="object_schema", detail="Шаблоны: " + ", ".join(installed))
    db.commit()
    return {"installed": installed, "skipped": skipped}


@router.post("/api/onboarding/complete")
def complete(ctx: TenantContext = Depends(_owner), db: Session = Depends(get_db)):
    if ctx.tenant.onboarding_completed_at is None:
        ctx.tenant.onboarding_completed_at = datetime.now(timezone.utc)
        db.commit()
    return {"ok": True}


# =============================================================================
# Импорт контрагентов (компаний) из Excel/CSV
# =============================================================================

COMPANY_HEADERS = {
    "name": ("название", "наименование", "компания", "контрагент", "организация", "name", "company"),
    "tax_id": ("бин", "иин", "бин/иин", "иин/бин", "bin", "tax id", "инн"),
    "phone": ("телефон", "тел.", "phone"),
    "email": ("email", "e-mail", "почта", "эл. почта"),
    "address": ("адрес", "юридический адрес", "address"),
    "website": ("сайт", "website", "web"),
    "industry": ("отрасль", "сфера", "industry"),
}


def _cell(v) -> str:
    return re.sub(r"\s+", " ", str(v if v is not None else "")).strip()


def _table(content: bytes, filename: str) -> list[list]:
    name = (filename or "").lower()
    if name.endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook
        try:
            wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        except Exception:
            raise HTTPException(400, "Не удалось открыть файл Excel — сохраните его как .xlsx")
        return [list(r) for _, r in zip(range(5020), wb.worksheets[0].iter_rows(values_only=True))]
    if name.endswith(".csv"):
        for enc in ("utf-8-sig", "cp1251"):
            try:
                text = content.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        else:
            raise HTTPException(400, "Не удалось прочитать CSV — сохраните в UTF-8")
        dialect = csv.Sniffer().sniff(text[:2000], delimiters=",;\t") if text.strip() else csv.excel
        return [r for r in csv.reader(io.StringIO(text), dialect)][:5020]
    raise HTTPException(400, "Поддерживаются файлы .xlsx и .csv")


@router.post("/api/companies/import")
async def import_companies(
    file: UploadFile = File(...),
    ctx: TenantContext = Depends(require("contacts.create")),
    db: Session = Depends(get_db),
):
    """Контрагенты из Excel (в т.ч. выгрузка из 1С): Наименование, БИН/ИИН, телефон, email, адрес.
    Повтор по БИН (или по названию без БИН) — дополняем пустые поля, а не создаём дубль."""
    content = await file.read(5 * 1024 * 1024 + 1)
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(400, "Файл больше 5 МБ")
    table = _table(content, file.filename or "")
    header_idx, mapping = None, {}
    for i, r in enumerate(table[:15]):
        m: dict[int, str] = {}
        for j, c in enumerate(r):
            k = _cell(c).lower().rstrip(":*")
            for f, names in COMPANY_HEADERS.items():
                if k in names and f not in m.values():
                    m[j] = f
        if "name" in m.values():
            header_idx, mapping = i, m
            break
    if header_idx is None:
        raise HTTPException(400, "Не нашли колонку «Наименование» (или «Название», «Контрагент»)")

    tid = ctx.tenant.id
    by_bin = {normalize_bin(c.tax_id): c for c in db.query(Company).filter(Company.tenant_id == tid, Company.tax_id.isnot(None)) if normalize_bin(c.tax_id)}
    by_name = {c.name.lower(): c for c in db.query(Company).filter(Company.tenant_id == tid)}
    created = updated = 0
    skipped: list[dict] = []
    seen_in_file: set[str] = set()
    for n, r in enumerate(table[header_idx + 1:], start=header_idx + 2):
        vals = {f: _cell(r[i]) if i < len(r) else "" for i, f in mapping.items()}
        if not any(vals.values()):
            continue
        name = vals.get("name", "")[:200]
        if not name:
            skipped.append({"row": n, "reason": "Нет наименования"})
            continue
        bin_raw = vals.get("tax_id", "")
        bin_ = normalize_bin(bin_raw)
        if bin_raw and not is_valid_bin(bin_):
            skipped.append({"row": n, "reason": f"Неверный БИН/ИИН «{bin_raw}» (12 цифр, контрольная сумма)"})
            continue
        key = bin_ or name.lower()
        if key in seen_in_file:
            skipped.append({"row": n, "reason": "Повтор в файле"})
            continue
        seen_in_file.add(key)
        existing = by_bin.get(bin_) if bin_ else by_name.get(name.lower())
        if existing:
            for f in ("phone", "email", "address", "website", "industry"):
                if vals.get(f) and not getattr(existing, f):
                    setattr(existing, f, vals[f][:255] if f != "address" else vals[f])
            if bin_ and not existing.tax_id:
                existing.tax_id = bin_
            updated += 1
            continue
        c = Company(
            tenant_id=tid, name=name, tax_id=bin_ or None, owner_id=ctx.user.id,
            phone=vals.get("phone", "")[:50] or None, email=vals.get("email", "")[:255] or None,
            address=vals.get("address") or None, website=vals.get("website", "")[:255] or None,
            industry=vals.get("industry", "")[:100] or None,
        )
        db.add(c)
        by_name[name.lower()] = c
        if bin_:
            by_bin[bin_] = c
        created += 1
        if created > 5000:
            raise HTTPException(400, "Слишком много строк — не больше 5000 за раз")
    log_action(db, tenant_id=tid, user_id=ctx.user.id, action="import", entity="company",
               detail=f"Импорт контрагентов: новых {created}, дополнено {updated}, пропущено {len(skipped)}")
    db.commit()
    return {"created": created, "updated": updated, "skipped": skipped[:200], "skipped_total": len(skipped)}


@router.get("/api/companies/import/template")
def companies_template(ctx: TenantContext = Depends(require("contacts.create"))):
    from fastapi.responses import StreamingResponse
    from openpyxl import Workbook
    from openpyxl.comments import Comment
    from openpyxl.styles import Font, PatternFill
    wb = Workbook()
    ws = wb.active
    ws.title = "Контрагенты"
    ws.append(["Наименование", "БИН/ИИН", "Телефон", "Email", "Адрес", "Сайт", "Отрасль"])
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="2563EB")
    hints = [
        "Наименование контрагента, как в документах. Обязательно.",
        "БИН или ИИН — 12 цифр. Проверяется по контрольной сумме.",
        "Номер телефона.",
        "Email для связи.",
        "Юридический или фактический адрес.",
        "Адрес сайта.",
        "Отрасль или сфера деятельности.",
    ]
    for cell, hint in zip(ws[1], hints):
        cell.comment = Comment(hint, "Qadam")
    for col, w in zip("ABCDEFG", (36, 16, 18, 26, 36, 22, 20)):
        ws.column_dimensions[col].width = w
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=qadam-counterparties-template.xlsx"},
    )
