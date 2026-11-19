from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from datetime import datetime, date, timezone
from pydantic import BaseModel, ConfigDict, Field

from ..database import get_db
from ..models import Company, Contact, Deal, DealStage, DealStatus
from ..models.deal import STAGE_PROBABILITY
from ..core.tenant_refs import ensure_member, ensure_owned
from ..core.legal_entities import resolve_legal_entity_id
from ..schemas.legal_entity import LegalEntityBrief
from ..schemas.common import Message, Page, PageParams, page_params, paginate
from .deps import TenantContext, require, log_action


router = APIRouter(prefix="/api/deals", tags=["deals"])


class UserBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    avatar_url: Optional[str] = None


class RelBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None


class DealCompanyBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class DealOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    amount_cents: int
    currency: str
    stage: DealStage
    status: DealStatus
    probability: int
    close_date: Optional[date] = None
    note: Optional[str] = None
    order_index: int
    created_at: datetime
    owner: Optional[UserBrief] = None
    contact_id: Optional[int] = None
    company_id: Optional[int] = None
    company: Optional["DealCompanyBrief"] = None
    legal_entity_id: Optional[int] = None
    legal_entity: Optional[LegalEntityBrief] = None


class DealCreate(BaseModel):
    title: str
    amount_cents: int = Field(default=0, ge=0, le=10**17)  # до 1 трлн ₸ в тиынах
    currency: str = "KZT"
    stage: DealStage = DealStage.new
    probability: Optional[int] = None
    close_date: Optional[date] = None
    contact_id: Optional[int] = None
    company_id: Optional[int] = None
    owner_id: Optional[int] = None
    note: Optional[str] = None
    legal_entity_id: Optional[int] = None  # пусто — юрлицо по умолчанию


class DealUpdate(BaseModel):
    title: Optional[str] = None
    amount_cents: Optional[int] = Field(default=None, ge=0, le=10**17)
    currency: Optional[str] = None
    stage: Optional[DealStage] = None
    probability: Optional[int] = None
    close_date: Optional[date] = None
    contact_id: Optional[int] = None
    company_id: Optional[int] = None
    owner_id: Optional[int] = None
    note: Optional[str] = None
    order_index: Optional[int] = None
    legal_entity_id: Optional[int] = None


class ForecastOut(BaseModel):
    currency: str
    total_amount_cents: int
    weighted_amount_cents: int
    won_amount_cents: int
    lost_amount_cents: int = 0
    open_count: int
    won_count: int
    lost_count: int
    by_stage: dict[str, dict]  # {stage: {count, amount_cents, weighted_amount_cents}}


@router.get("", response_model=Page[DealOut])
def list_deals(
    stage: Optional[DealStage] = None,
    owner_id: Optional[int] = None,
    status: Optional[DealStatus] = None,
    company_id: Optional[int] = None,
    legal_entity_id: Optional[int] = None,
    pagination: PageParams = Depends(page_params),
    ctx: TenantContext = Depends(require("deals.view")),
    db: Session = Depends(get_db),
):
    q = db.query(Deal).filter(Deal.tenant_id == ctx.tenant.id)
    if stage is not None:
        q = q.filter(Deal.stage == stage.value)
    if owner_id is not None:
        q = q.filter(Deal.owner_id == owner_id)
    if status is not None:
        q = q.filter(Deal.status == status.value)
    if company_id is not None:
        q = q.filter(Deal.company_id == company_id)
    if legal_entity_id is not None:
        q = q.filter(Deal.legal_entity_id == legal_entity_id)
    q = q.order_by(Deal.order_index.asc(), Deal.created_at.desc())
    return paginate(q, pagination)


@router.get("/forecast", response_model=ForecastOut)
def forecast(
    currency: str = "KZT",
    ctx: TenantContext = Depends(require("deals.view")),
    db: Session = Depends(get_db),
):
    q = db.query(Deal).filter(Deal.tenant_id == ctx.tenant.id, Deal.currency == currency)
    rows = q.all()
    total = sum(d.amount_cents for d in rows if d.status == DealStatus.open.value)
    weighted = sum(int(d.amount_cents * d.probability / 100) for d in rows if d.status == DealStatus.open.value)
    won = sum(d.amount_cents for d in rows if d.status == DealStatus.won.value)
    lost = sum(d.amount_cents for d in rows if d.status == DealStatus.lost.value)

    by_stage: dict[str, dict] = {}
    for d in rows:
        s = d.stage  # уже строка
        if s not in by_stage:
            by_stage[s] = {"count": 0, "amount_cents": 0, "weighted_amount_cents": 0}
        by_stage[s]["count"] += 1
        by_stage[s]["amount_cents"] += d.amount_cents
        by_stage[s]["weighted_amount_cents"] += int(d.amount_cents * d.probability / 100)

    return ForecastOut(
        currency=currency,
        total_amount_cents=total,
        weighted_amount_cents=weighted,
        won_amount_cents=won,
        lost_amount_cents=lost,
        open_count=sum(1 for d in rows if d.status == DealStatus.open.value),
        won_count=sum(1 for d in rows if d.status == DealStatus.won.value),
        lost_count=sum(1 for d in rows if d.status == DealStatus.lost.value),
        by_stage=by_stage,
    )


@router.post("", response_model=DealOut, status_code=201)
def create_deal(
    payload: DealCreate,
    ctx: TenantContext = Depends(require("deals.create")),
    db: Session = Depends(get_db),
):
    prob = payload.probability if payload.probability is not None else STAGE_PROBABILITY.get(payload.stage, 10)
    status_v = DealStatus.open.value
    if payload.stage == DealStage.won:
        status_v = DealStatus.won.value
    elif payload.stage == DealStage.lost:
        status_v = DealStatus.lost.value

    ensure_owned(db, Contact, payload.contact_id, ctx.tenant.id, "Контакт")
    ensure_owned(db, Company, payload.company_id, ctx.tenant.id, "Компания")
    ensure_member(db, ctx.tenant.id, payload.owner_id, "Ответственный")
    row = Deal(
        tenant_id=ctx.tenant.id,
        title=payload.title,
        amount_cents=payload.amount_cents,
        currency=payload.currency,
        stage=payload.stage.value,
        status=status_v,
        probability=prob,
        close_date=payload.close_date,
        contact_id=payload.contact_id or None,
        company_id=payload.company_id or None,
        owner_id=payload.owner_id or ctx.user.id,
        note=payload.note,
        legal_entity_id=resolve_legal_entity_id(db, ctx.tenant.id, payload.legal_entity_id),
    )
    db.add(row)
    db.flush()
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="create", entity="deal", entity_id=row.id, detail=row.title)
    db.commit()
    db.refresh(row)
    return row


@router.get("/{did}", response_model=DealOut)
def get_deal(did: int, ctx: TenantContext = Depends(require("deals.view")), db: Session = Depends(get_db)):
    row = db.get(Deal, did)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Сделка не найдена")
    return row


@router.patch("/{did}", response_model=DealOut)
def update_deal(
    did: int,
    payload: DealUpdate,
    ctx: TenantContext = Depends(require("deals.update")),
    db: Session = Depends(get_db),
):
    row = db.get(Deal, did)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Сделка не найдена")

    changed_stage = payload.stage is not None and payload.stage.value != row.stage
    ensure_owned(db, Contact, payload.contact_id, ctx.tenant.id, "Контакт")
    ensure_owned(db, Company, payload.company_id, ctx.tenant.id, "Компания")
    ensure_member(db, ctx.tenant.id, payload.owner_id, "Ответственный")

    if payload.legal_entity_id is not None:
        row.legal_entity_id = resolve_legal_entity_id(db, ctx.tenant.id, payload.legal_entity_id, current_id=row.legal_entity_id)

    for f in ("title", "amount_cents", "currency", "close_date", "contact_id", "company_id", "owner_id", "note", "order_index"):
        v = getattr(payload, f)
        if v is not None:
            if f in ("contact_id", "company_id") and v == 0:
                v = None  # 0 — снять связь
            setattr(row, f, v)

    if changed_stage:
        row.stage = payload.stage.value
        # авто-статус и авто-вероятность (если явно не указана)
        if payload.probability is None:
            row.probability = STAGE_PROBABILITY.get(payload.stage, row.probability)
        if payload.stage == DealStage.won:
            row.status = DealStatus.won.value
        elif payload.stage == DealStage.lost:
            row.status = DealStatus.lost.value
        else:
            row.status = DealStatus.open.value

    if payload.probability is not None:
        row.probability = max(0, min(100, payload.probability))

    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="deal", entity_id=row.id)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{did}", response_model=Message)
def delete_deal(did: int, ctx: TenantContext = Depends(require("deals.delete")), db: Session = Depends(get_db)):
    row = db.get(Deal, did)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Сделка не найдена")
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="delete", entity="deal", entity_id=row.id, detail=row.title)
    db.delete(row)
    db.commit()
    return Message(message="Сделка удалена")
