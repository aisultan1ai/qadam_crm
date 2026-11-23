"""Реестр договоров: /api/contracts.

- список с фильтрами, карточка (с записью в журнал просмотров), создание/изменение/удаление;
- смена статуса по правилам переходов (см. STATUS_TRANSITIONS);
- EPC: этапы, банковские гарантии, удержания, штрафные санкции — CRUD внутри договора;
- файлы договора — документы с contract_id;
- prefill из сделки, список сотрудников для выбора ответственного и юриста.

Права: contracts.view / create / update / delete; владелец компании — без ограничений.
"""
from __future__ import annotations

import hashlib
import os
import re
import secrets
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..core.legal_entities import resolve_legal_entity_id
from ..core.tenant_refs import ensure_member, ensure_owned
from ..database import get_db
from ..models import (
    Company, Contract, ContractGuarantee, ContractPenalty, ContractRetention, ContractStage,
    Deal, Document, DocumentVersion, Project, Role, TenantMembership, User,
)
from ..models.contract import CONTRACT_STATUSES, CONTRACT_TYPES, GUARANTEE_KINDS, VAT_MODES
from ..models.role import user_roles
from ..schemas.common import Message
from ..schemas.legal_entity import LegalEntityBrief
from .deps import TenantContext, log_action, require

router = APIRouter(prefix="/api/contracts", tags=["contracts"])

LAWYER_ROLE = "Юрист"
FINAL_STATUSES = {"completed", "terminated"}

# Куда можно перевести договор из текущего статуса.
# Исполнен/Расторгнут — конечные: вернуть в «Действует» может только владелец компании.
STATUS_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"approval", "signing", "active"},
    "approval": {"draft", "signing", "active"},
    "signing": {"draft", "approval", "active"},
    "active": {"completed", "terminated"},
    "completed": set(),
    "terminated": set(),
}
OWNER_REOPEN_TO = "active"

MAX_FILE_BYTES = 50 * 1024 * 1024


# =============================================================================
# Схемы
# =============================================================================

class UserMini(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    avatar_url: Optional[str] = None


class CompanyMini(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class RefMini(BaseModel):
    id: int
    name: str


class ContractOut(BaseModel):
    id: int
    number: str
    date_signed: Optional[date] = None
    legal_entity_id: Optional[int] = None
    legal_entity: Optional[LegalEntityBrief] = None
    company_id: Optional[int] = None
    company: Optional[CompanyMini] = None
    contract_type: str
    subject: Optional[str] = None
    amount: Optional[Decimal] = None
    currency: str
    vat_mode: str
    vat_rate: Decimal
    vat_amount: Optional[Decimal] = None
    total_with_vat: Optional[Decimal] = None
    valid_from: Optional[date] = None
    valid_until: Optional[date] = None
    days_left: Optional[int] = None
    auto_renewal: bool
    responsible_user_id: Optional[int] = None
    responsible: Optional[UserMini] = None
    lawyer_user_id: Optional[int] = None
    lawyer: Optional[UserMini] = None
    deal_id: Optional[int] = None
    deal: Optional[RefMini] = None
    project_id: Optional[int] = None
    project: Optional[RefMini] = None
    status: str
    allowed_statuses: list[str] = []
    note: Optional[str] = None
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    files_count: int = 0


class ContractIn(BaseModel):
    number: Optional[str] = Field(default=None, max_length=100)
    date_signed: Optional[date] = None
    legal_entity_id: Optional[int] = None
    company_id: Optional[int] = None
    contract_type: Optional[str] = None
    subject: Optional[str] = Field(default=None, max_length=5000)
    amount: Optional[Decimal] = Field(default=None, ge=0, le=Decimal("9999999999999999"))
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3)
    vat_mode: Optional[str] = None
    vat_rate: Optional[Decimal] = Field(default=None, ge=0, le=100)
    valid_from: Optional[date] = None
    valid_until: Optional[date] = None
    auto_renewal: Optional[bool] = None
    responsible_user_id: Optional[int] = None
    lawyer_user_id: Optional[int] = None
    deal_id: Optional[int] = None
    project_id: Optional[int] = None
    status: Optional[str] = None
    note: Optional[str] = Field(default=None, max_length=10000)

    @field_validator("contract_type")
    @classmethod
    def _type(cls, v):
        if v is not None and v not in CONTRACT_TYPES:
            raise ValueError("Выберите тип договора из списка")
        return v

    @field_validator("vat_mode")
    @classmethod
    def _vat(cls, v):
        if v is not None and v not in VAT_MODES:
            raise ValueError("Выберите вариант НДС из списка")
        return v

    @field_validator("status")
    @classmethod
    def _status(cls, v):
        if v is not None and v not in CONTRACT_STATUSES:
            raise ValueError("Неизвестный статус договора")
        return v

    @field_validator("currency")
    @classmethod
    def _cur(cls, v):
        return v.upper() if v else v


class StatusIn(BaseModel):
    status: str


# ---- EPC ----

class StageIn(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    planned_start: Optional[date] = None
    planned_end: Optional[date] = None
    amount: Optional[Decimal] = Field(default=None, ge=0)
    percent_complete: int = Field(default=0, ge=0, le=100)


class StageOut(StageIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    order_index: int = 0


class GuaranteeIn(BaseModel):
    kind: str = "other"
    bank_name: Optional[str] = Field(default=None, max_length=300)
    amount: Optional[Decimal] = Field(default=None, ge=0)
    currency: str = Field(default="KZT", min_length=3, max_length=3)
    valid_until: Optional[date] = None

    @field_validator("kind")
    @classmethod
    def _kind(cls, v):
        if v not in GUARANTEE_KINDS:
            raise ValueError("Выберите вид гарантии из списка")
        return v


class GuaranteeOut(GuaranteeIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class RetentionIn(BaseModel):
    description: str = Field(min_length=1, max_length=2000)
    percent: Optional[Decimal] = Field(default=None, ge=0, le=100)
    amount: Optional[Decimal] = Field(default=None, ge=0)
    release_condition: Optional[str] = Field(default=None, max_length=2000)
    release_date: Optional[date] = None


class RetentionOut(RetentionIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class PenaltyIn(BaseModel):
    description: str = Field(min_length=1, max_length=2000)
    rate_percent: Optional[Decimal] = Field(default=None, ge=0, le=100)
    amount: Optional[Decimal] = Field(default=None, ge=0)
    basis: Optional[str] = Field(default=None, max_length=2000)


class PenaltyOut(PenaltyIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class FileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    mime: Optional[str] = None
    size: int
    created_by: Optional[int] = None
    created_at: datetime


class PersonOut(BaseModel):
    id: int
    name: str
    avatar_url: Optional[str] = None
    position: Optional[str] = None
    is_lawyer: bool = False


class PrefillOut(BaseModel):
    deal_id: Optional[int] = None
    deal_title: Optional[str] = None
    company_id: Optional[int] = None
    company_name: Optional[str] = None
    legal_entity_id: Optional[int] = None
    amount: Optional[Decimal] = None
    currency: Optional[str] = None
    subject: Optional[str] = None
    contract_type: Optional[str] = None
    project_id: Optional[int] = None


# =============================================================================
# Помощники
# =============================================================================

def _q2(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def vat_figures(c: Contract) -> tuple[Optional[Decimal], Optional[Decimal]]:
    """(сумма НДС, итого с НДС)."""
    if c.amount is None:
        return None, None
    amount = Decimal(c.amount)
    rate = Decimal(c.vat_rate or 0)
    if c.vat_mode == "on_top":
        vat = _q2(amount * rate / 100)
        return vat, amount + vat
    if c.vat_mode == "included":
        vat = _q2(amount * rate / (100 + rate)) if rate else Decimal("0")
        return vat, amount
    return Decimal("0"), amount


def _is_owner(ctx: TenantContext) -> bool:
    return bool(ctx.membership.is_owner)


def allowed_next(ctx: TenantContext, current: str) -> list[str]:
    out = set(STATUS_TRANSITIONS.get(current, set()))
    if current in FINAL_STATUSES and _is_owner(ctx):
        out.add(OWNER_REOPEN_TO)
    return [s for s in CONTRACT_STATUSES if s in out]


def _out(db: Session, ctx: TenantContext, c: Contract, files_count: Optional[int] = None) -> ContractOut:
    vat, total = vat_figures(c)
    days_left = (c.valid_until - date.today()).days if c.valid_until else None
    if files_count is None:
        files_count = db.query(Document.id).filter(Document.tenant_id == c.tenant_id, Document.contract_id == c.id).count()
    return ContractOut(
        id=c.id, number=c.number, date_signed=c.date_signed,
        legal_entity_id=c.legal_entity_id,
        legal_entity=LegalEntityBrief.model_validate(c.legal_entity) if c.legal_entity else None,
        company_id=c.company_id,
        company=CompanyMini.model_validate(c.company) if c.company else None,
        contract_type=c.contract_type, subject=c.subject,
        amount=c.amount, currency=c.currency, vat_mode=c.vat_mode, vat_rate=c.vat_rate,
        vat_amount=vat, total_with_vat=total,
        valid_from=c.valid_from, valid_until=c.valid_until, days_left=days_left,
        auto_renewal=bool(c.auto_renewal),
        responsible_user_id=c.responsible_user_id,
        responsible=UserMini.model_validate(c.responsible) if c.responsible else None,
        lawyer_user_id=c.lawyer_user_id,
        lawyer=UserMini.model_validate(c.lawyer) if c.lawyer else None,
        deal_id=c.deal_id,
        deal=RefMini(id=c.deal.id, name=c.deal.title) if c.deal_id and c.deal else None,
        project_id=c.project_id,
        project=RefMini(id=c.project.id, name=c.project.name) if c.project_id and c.project else None,
        status=c.status, allowed_statuses=allowed_next(ctx, c.status),
        note=c.note, created_by=c.created_by, created_at=c.created_at, updated_at=c.updated_at,
        files_count=files_count,
    )


def _get(db: Session, ctx: TenantContext, cid: int) -> Contract:
    row = db.get(Contract, cid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Договор не найден")
    return row


def _apply(db: Session, ctx: TenantContext, row: Contract, data: dict[str, Any]) -> None:
    tid = ctx.tenant.id
    if "number" in data:
        num = (data["number"] or "").strip()
        if not num:
            raise HTTPException(400, "Укажите номер договора")
        row.number = num
    if "company_id" in data:
        if not data["company_id"]:
            raise HTTPException(400, "Выберите контрагента")
        ensure_owned(db, Company, data["company_id"], tid, "Контрагент")
        row.company_id = data["company_id"]
    if "legal_entity_id" in data or row.legal_entity_id is None:
        row.legal_entity_id = resolve_legal_entity_id(
            db, tid, data.get("legal_entity_id"), current_id=row.legal_entity_id,
        )
    for f in ("date_signed", "valid_from", "valid_until", "auto_renewal", "amount", "vat_rate"):
        if f in data:
            v = data[f]
            if f == "auto_renewal":
                v = bool(v)
            if f == "vat_rate" and v is None:
                v = Decimal("12")
            setattr(row, f, v)
    for f in ("contract_type", "vat_mode", "currency"):
        if f in data and data[f]:
            setattr(row, f, data[f])
    for f in ("subject", "note"):
        if f in data:
            v = (data[f] or "").strip()
            setattr(row, f, v or None)
    if "responsible_user_id" in data:
        ensure_member(db, tid, data["responsible_user_id"], "Ответственный")
        row.responsible_user_id = data["responsible_user_id"] or None
    if "lawyer_user_id" in data:
        ensure_member(db, tid, data["lawyer_user_id"], "Юрист")
        row.lawyer_user_id = data["lawyer_user_id"] or None
    if "deal_id" in data:
        ensure_owned(db, Deal, data["deal_id"], tid, "Сделка")
        row.deal_id = data["deal_id"] or None
    if "project_id" in data:
        ensure_owned(db, Project, data["project_id"], tid, "Проект")
        row.project_id = data["project_id"] or None
    if row.valid_from and row.valid_until and row.valid_until < row.valid_from:
        raise HTTPException(400, "Дата окончания раньше даты начала действия")


# =============================================================================
# Список / карточка / CRUD
# =============================================================================

@router.get("", response_model=list[ContractOut])
def list_contracts(
    q: Optional[str] = Query(default=None, max_length=200),
    legal_entity_id: Optional[int] = None,
    company_id: Optional[int] = None,
    deal_id: Optional[int] = None,
    project_id: Optional[int] = None,
    contract_type: Optional[str] = Query(default=None, alias="type"),
    status: Optional[str] = None,
    responsible_user_id: Optional[int] = Query(default=None, alias="responsible"),
    lawyer_user_id: Optional[int] = Query(default=None, alias="lawyer"),
    expiring_days: Optional[int] = Query(default=None, ge=0, le=3650, alias="expiring"),
    ctx: TenantContext = Depends(require("contracts.view")),
    db: Session = Depends(get_db),
):
    query = db.query(Contract).filter(Contract.tenant_id == ctx.tenant.id)
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.outerjoin(Company, Company.id == Contract.company_id).filter(
            or_(Contract.number.ilike(like), Contract.subject.ilike(like), Company.name.ilike(like),
                Company.tax_id.ilike(like))
        )
    if legal_entity_id:
        query = query.filter(Contract.legal_entity_id == legal_entity_id)
    if company_id:
        query = query.filter(Contract.company_id == company_id)
    if deal_id:
        query = query.filter(Contract.deal_id == deal_id)
    if project_id:
        query = query.filter(Contract.project_id == project_id)
    if contract_type:
        query = query.filter(Contract.contract_type == contract_type)
    if status:
        query = query.filter(Contract.status.in_([s for s in status.split(",") if s]))
    if responsible_user_id:
        query = query.filter(Contract.responsible_user_id == responsible_user_id)
    if lawyer_user_id:
        query = query.filter(Contract.lawyer_user_id == lawyer_user_id)
    if expiring_days is not None:
        today = date.today()
        query = query.filter(
            Contract.valid_until.is_not(None),
            Contract.valid_until >= today,
            Contract.valid_until <= today + timedelta(days=expiring_days),
            Contract.status.notin_(list(FINAL_STATUSES)),
        )
    rows = query.order_by(Contract.date_signed.desc().nullslast(), Contract.id.desc()).limit(1000).all()
    counts: dict[int, int] = {}
    if rows:
        counts = dict(
            db.query(Document.contract_id, func.count(Document.id))
            .filter(Document.tenant_id == ctx.tenant.id, Document.contract_id.in_([r.id for r in rows]))
            .group_by(Document.contract_id)
            .all()
        )
    return [_out(db, ctx, r, counts.get(r.id, 0)) for r in rows]


@router.get("/meta")
def contracts_meta(ctx: TenantContext = Depends(require("contracts.view"))):
    """Справочники для форм: типы, статусы, варианты НДС, виды гарантий."""
    return {
        "types": CONTRACT_TYPES,
        "statuses": CONTRACT_STATUSES,
        "vat_modes": VAT_MODES,
        "guarantee_kinds": GUARANTEE_KINDS,
        "transitions": {k: sorted(v) for k, v in STATUS_TRANSITIONS.items()},
    }


@router.get("/people", response_model=list[PersonOut])
def contract_people(ctx: TenantContext = Depends(require("contracts.view")), db: Session = Depends(get_db)):
    """Сотрудники компании для выбора ответственного и юриста (юристы — с отметкой)."""
    tid = ctx.tenant.id
    rows = (
        db.query(User, TenantMembership.position)
        .join(TenantMembership, TenantMembership.user_id == User.id)
        .filter(TenantMembership.tenant_id == tid, User.is_active.is_(True))
        .order_by(User.name)
        .all()
    )
    lawyers = {
        uid for (uid,) in db.query(user_roles.c.user_id)
        .join(Role, Role.id == user_roles.c.role_id)
        .filter(Role.tenant_id == tid, Role.name == LAWYER_ROLE)
    }
    return [
        PersonOut(id=u.id, name=u.name, avatar_url=u.avatar_url, position=pos, is_lawyer=u.id in lawyers)
        for u, pos in rows
    ]


def _deal_is_offtake(deal: Deal) -> bool:
    """Воронка «Оффтейк» добавляется отдельно — читаем её осторожно, не завися от модели."""
    for attr in ("pipeline", "pipeline_code", "pipeline_key", "kind", "deal_type"):
        v = getattr(deal, attr, None)
        if v is None:
            continue
        if isinstance(v, str):
            if v.lower() == "offtake":
                return True
            continue
        code = getattr(v, "code", None) or getattr(v, "key", None) or getattr(v, "slug", None)
        if isinstance(code, str) and code.lower() == "offtake":
            return True
    return False


@router.get("/prefill", response_model=PrefillOut)
def prefill(
    deal_id: Optional[int] = None,
    company_id: Optional[int] = None,
    ctx: TenantContext = Depends(require("contracts.create")),
    db: Session = Depends(get_db),
):
    """Поля нового договора из сделки (или только контрагент — из карточки компании)."""
    out = PrefillOut()
    if deal_id:
        deal = db.get(Deal, deal_id)
        if not deal or deal.tenant_id != ctx.tenant.id:
            raise HTTPException(404, "Сделка не найдена")
        out.deal_id = deal.id
        out.deal_title = deal.title
        out.company_id = deal.company_id
        out.legal_entity_id = getattr(deal, "legal_entity_id", None)
        cents = getattr(deal, "amount_cents", None)
        out.amount = (Decimal(cents) / 100) if cents else None
        out.currency = getattr(deal, "currency", None) or "KZT"
        out.subject = deal.title
        if _deal_is_offtake(deal):
            out.contract_type = "offtake"
        pid = getattr(deal, "project_id", None)
        if isinstance(pid, int):
            out.project_id = pid
    elif company_id:
        out.company_id = company_id
    if out.company_id:
        comp = db.get(Company, out.company_id)
        if comp and comp.tenant_id == ctx.tenant.id:
            out.company_name = comp.name
        else:
            out.company_id = None
    return out


@router.get("/{cid}", response_model=ContractOut)
def get_contract(cid: int, ctx: TenantContext = Depends(require("contracts.view")), db: Session = Depends(get_db)):
    row = _get(db, ctx, cid)
    from ..core.view_log import log_view
    log_view(db, ctx, "contract", row.id)
    row = _get(db, ctx, cid)
    return _out(db, ctx, row)


@router.post("", response_model=ContractOut, status_code=201)
def create_contract(payload: ContractIn, ctx: TenantContext = Depends(require("contracts.create")), db: Session = Depends(get_db)):
    data = payload.model_dump(exclude_unset=True)
    if not (data.get("number") or "").strip():
        raise HTTPException(400, "Укажите номер договора")
    if not data.get("company_id"):
        raise HTTPException(400, "Выберите контрагента")
    status = data.pop("status", None) or "draft"
    row = Contract(
        tenant_id=ctx.tenant.id, number="", contract_type="other", currency="KZT", vat_mode="none",
        vat_rate=Decimal("12"), auto_renewal=False, status=status, created_by=ctx.user.id,
    )
    if "responsible_user_id" not in data:
        data["responsible_user_id"] = ctx.user.id
    _apply(db, ctx, row, data)
    db.add(row)
    db.flush()
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="create", entity="contract",
               entity_id=row.id, detail=f"№ {row.number}")
    db.commit()
    db.refresh(row)
    return _out(db, ctx, row, 0)


@router.patch("/{cid}", response_model=ContractOut)
def update_contract(cid: int, payload: ContractIn, ctx: TenantContext = Depends(require("contracts.update")), db: Session = Depends(get_db)):
    row = _get(db, ctx, cid)
    data = payload.model_dump(exclude_unset=True)
    new_status = data.pop("status", None)
    _apply(db, ctx, row, data)
    if new_status and new_status != row.status:
        _change_status(ctx, row, new_status)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="contract",
               entity_id=row.id, detail=f"№ {row.number}")
    db.commit()
    db.refresh(row)
    return _out(db, ctx, row)


def _change_status(ctx: TenantContext, row: Contract, new_status: str) -> None:
    if new_status not in CONTRACT_STATUSES:
        raise HTTPException(400, "Неизвестный статус договора")
    if new_status not in allowed_next(ctx, row.status):
        cur = CONTRACT_STATUSES.get(row.status, row.status)
        nxt = CONTRACT_STATUSES[new_status]
        if row.status in FINAL_STATUSES:
            raise HTTPException(400, f"Договор в статусе «{cur}» закрыт. Вернуть его в работу может владелец компании")
        raise HTTPException(400, f"Из статуса «{cur}» нельзя перейти в «{nxt}»")
    row.status = new_status


@router.post("/{cid}/status", response_model=ContractOut)
def set_status(cid: int, payload: StatusIn, ctx: TenantContext = Depends(require("contracts.update")), db: Session = Depends(get_db)):
    row = _get(db, ctx, cid)
    old = row.status
    _change_status(ctx, row, payload.status)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="contract",
               entity_id=row.id,
               detail=f"№ {row.number}: статус «{CONTRACT_STATUSES.get(old, old)}» → «{CONTRACT_STATUSES[row.status]}»")
    db.commit()
    db.refresh(row)
    return _out(db, ctx, row)


@router.delete("/{cid}", response_model=Message)
def delete_contract(cid: int, ctx: TenantContext = Depends(require("contracts.delete")), db: Session = Depends(get_db)):
    row = _get(db, ctx, cid)
    number = row.number
    # Файлы договора остаются в «Документах» (без привязки к договору) — их не теряем.
    db.query(Document).filter(Document.tenant_id == ctx.tenant.id, Document.contract_id == row.id).update(
        {Document.contract_id: None}, synchronize_session=False,
    )
    db.delete(row)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="delete", entity="contract",
               entity_id=cid, detail=f"№ {number}")
    db.commit()
    return Message(message="Договор удалён")


# =============================================================================
# Файлы договора
# =============================================================================

@router.get("/{cid}/files", response_model=list[FileOut])
def list_files(cid: int, ctx: TenantContext = Depends(require("contracts.view")), db: Session = Depends(get_db)):
    row = _get(db, ctx, cid)
    return (
        db.query(Document)
        .filter(Document.tenant_id == ctx.tenant.id, Document.contract_id == row.id)
        .order_by(Document.created_at.desc())
        .all()
    )


@router.post("/{cid}/files", response_model=FileOut, status_code=201)
async def upload_file(
    cid: int,
    file: UploadFile = File(...),
    ctx: TenantContext = Depends(require("contracts.view")),
    db: Session = Depends(get_db),
):
    from ..config import settings
    from ..core.permissions import user_has
    if not (_is_owner(ctx) or (
        user_has(ctx.user, ["files.upload"], tenant_id=ctx.tenant.id)
        and user_has(ctx.user, ["contracts.update", "contracts.create"], tenant_id=ctx.tenant.id)
    )):
        raise HTTPException(403, "Нет права прикладывать файлы к договорам")
    row = _get(db, ctx, cid)
    content = await file.read(MAX_FILE_BYTES + 1)
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(400, "Файл больше 50 МБ")
    upload_dir = os.path.join(settings.UPLOAD_DIR, f"tenant_{ctx.tenant.id}", "documents")
    os.makedirs(upload_dir, exist_ok=True)
    safe_name = re.sub(r"[^\w.\-]", "_", file.filename or "file")
    path = os.path.join(upload_dir, f"{secrets.token_hex(8)}_{safe_name}")
    with open(path, "wb") as f:
        f.write(content)
    doc = Document(
        tenant_id=ctx.tenant.id, folder_id=None, name=file.filename or "file", mime=file.content_type,
        size=len(content), file_path=path, version_count=1, created_by=ctx.user.id,
        legal_entity_id=row.legal_entity_id, company_id=row.company_id, contract_id=row.id,
    )
    db.add(doc)
    db.flush()
    db.add(DocumentVersion(document_id=doc.id, version_no=1, file_path=path, size=len(content), uploaded_by=ctx.user.id,
                           filename=doc.name, mime=doc.mime, sha256=hashlib.sha256(content).hexdigest()))
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="contract",
               entity_id=row.id, detail=f"№ {row.number}: файл «{doc.name}»")
    db.commit()
    db.refresh(doc)
    return doc


@router.delete("/{cid}/files/{doc_id}", response_model=Message)
def delete_file(cid: int, doc_id: int, ctx: TenantContext = Depends(require("contracts.update")), db: Session = Depends(get_db)):
    row = _get(db, ctx, cid)
    doc = db.get(Document, doc_id)
    if not doc or doc.tenant_id != ctx.tenant.id or doc.contract_id != row.id:
        raise HTTPException(404, "Файл не найден")
    from ..core.permissions import user_has
    if not (_is_owner(ctx) or doc.created_by == ctx.user.id
            or user_has(ctx.user, ["files.delete"], tenant_id=ctx.tenant.id)):
        raise HTTPException(403, "Удалить файл может тот, кто его загрузил, или администратор")
    name = doc.name
    db.delete(doc)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="contract",
               entity_id=row.id, detail=f"№ {row.number}: удалён файл «{name}»")
    db.commit()
    return Message(message="Файл удалён")


# =============================================================================
# EPC: этапы, гарантии, удержания, штрафы
# =============================================================================

_CHILDREN: dict[str, tuple[type, type, type, str]] = {
    "stages": (ContractStage, StageIn, StageOut, "добавлен этап"),
    "guarantees": (ContractGuarantee, GuaranteeIn, GuaranteeOut, "добавлена банковская гарантия"),
    "retentions": (ContractRetention, RetentionIn, RetentionOut, "добавлено удержание"),
    "penalties": (ContractPenalty, PenaltyIn, PenaltyOut, "добавлена штрафная санкция"),
}


def _validate(schema: type, data: dict[str, Any]) -> dict[str, Any]:
    try:
        return schema.model_validate(data).model_dump()
    except ValidationError as e:
        err = e.errors()[0] if e.errors() else {}
        msg = str(err.get("msg") or "Проверьте заполнение полей")
        msg = msg.removeprefix("Value error, ")
        raise HTTPException(400, msg)


def _child_kind(kind: str):
    spec = _CHILDREN.get(kind)
    if not spec:
        raise HTTPException(404, "Раздел не найден")
    return spec


@router.get("/{cid}/epc")
def get_epc(cid: int, ctx: TenantContext = Depends(require("contracts.view")), db: Session = Depends(get_db)):
    row = _get(db, ctx, cid)
    out: dict[str, list] = {}
    for kind, (model, _in, out_schema, _label) in _CHILDREN.items():
        q = db.query(model).filter(model.tenant_id == ctx.tenant.id, model.contract_id == row.id)
        q = q.order_by(model.order_index, model.id) if model is ContractStage else q.order_by(model.id)
        out[kind] = [out_schema.model_validate(r).model_dump(mode="json") for r in q.all()]
    return out


@router.post("/{cid}/epc/{kind}", status_code=201)
def create_child(cid: int, kind: str, payload: dict[str, Any], ctx: TenantContext = Depends(require("contracts.update")), db: Session = Depends(get_db)):
    model, in_schema, out_schema, label = _child_kind(kind)
    row = _get(db, ctx, cid)
    data = _validate(in_schema, payload)
    if "currency" in data and data["currency"]:
        data["currency"] = data["currency"].upper()
    _check_child(data)
    child = model(tenant_id=ctx.tenant.id, contract_id=row.id, **data)
    if model is ContractStage:
        last = db.query(ContractStage.order_index).filter(ContractStage.contract_id == row.id).order_by(
            ContractStage.order_index.desc()).first()
        child.order_index = (last[0] + 1) if last else 0
    db.add(child)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="contract",
               entity_id=row.id, detail=f"№ {row.number}: {label}")
    db.commit()
    db.refresh(child)
    return out_schema.model_validate(child).model_dump(mode="json")


@router.patch("/{cid}/epc/{kind}/{item_id}")
def update_child(cid: int, kind: str, item_id: int, payload: dict[str, Any], ctx: TenantContext = Depends(require("contracts.update")), db: Session = Depends(get_db)):
    model, in_schema, out_schema, _label = _child_kind(kind)
    row = _get(db, ctx, cid)
    child = db.get(model, item_id)
    if not child or child.tenant_id != ctx.tenant.id or child.contract_id != row.id:
        raise HTTPException(404, "Запись не найдена")
    current = in_schema.model_validate(child, from_attributes=True).model_dump()
    merged = {**current, **{k: v for k, v in payload.items() if k in in_schema.model_fields}}
    data = _validate(in_schema, merged)
    if "currency" in data and data["currency"]:
        data["currency"] = data["currency"].upper()
    _check_child(data)
    for k, v in data.items():
        setattr(child, k, v)
    db.commit()
    db.refresh(child)
    return out_schema.model_validate(child).model_dump(mode="json")


@router.delete("/{cid}/epc/{kind}/{item_id}", response_model=Message)
def delete_child(cid: int, kind: str, item_id: int, ctx: TenantContext = Depends(require("contracts.update")), db: Session = Depends(get_db)):
    model, _in, _out_schema, _label = _child_kind(kind)
    row = _get(db, ctx, cid)
    child = db.get(model, item_id)
    if not child or child.tenant_id != ctx.tenant.id or child.contract_id != row.id:
        raise HTTPException(404, "Запись не найдена")
    db.delete(child)
    db.commit()
    return Message(message="Удалено")


def _check_child(data: dict[str, Any]) -> None:
    ps, pe = data.get("planned_start"), data.get("planned_end")
    if ps and pe and pe < ps:
        raise HTTPException(400, "Плановое окончание этапа раньше начала")
    for k in ("name", "description", "bank_name", "basis", "release_condition"):
        if isinstance(data.get(k), str):
            data[k] = data[k].strip() or None
    if "name" in data and not data["name"]:
        raise HTTPException(400, "Укажите название этапа")
    if "description" in data and not data["description"]:
        raise HTTPException(400, "Заполните описание")

