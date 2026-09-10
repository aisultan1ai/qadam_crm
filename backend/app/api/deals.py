from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from datetime import datetime, date, timezone
from pydantic import BaseModel, ConfigDict

from ..database import get_db
from ..models import Deal, DealStage, DealStatus
from ..models.deal import STAGE_PROBABILITY
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


class DealCreate(BaseModel):
    title: str
    amount_cents: int = 0
    currency: str = "KZT"
    stage: DealStage = DealStage.new
    probability: Optional[int] = None
    close_date: Optional[date] = None
    contact_id: Optional[int] = None
    company_id: Optional[int] = None
    owner_id: Optional[int] = None
    note: Optional[str] = None


class DealUpdate(BaseModel):
    title: Optional[str] = None
    amount_cents: Optional[int] = None
    currency: Optional[str] = None
    stage: Optional[DealStage] = None
    probability: Optional[int] = None
    close_date: Optional[date] = None
    contact_id: Optional[int] = None
    company_id: Optional[int] = None
    owner_id: Optional[int] = None
    note: Optional[str] = None
    order_index: Optional[int] = None


class ForecastOut(BaseModel):
    currency: str
    total_amount_cents: int
    weighted_amount_cents: int
    won_amount_cents: int
    open_count: int
    won_count: int
    lost_count: int
    by_stage: dict[str, dict]  # {stage: {count, amount_cents, weighted_amount_cents}}


@router.get("", response_model=Page[DealOut])
def list_deals(
    stage: Optional[DealStage] = None,
    owner_id: Optional[int] = None,
    status: Optional[DealStatus] = None,
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

    row = Deal(
        tenant_id=ctx.tenant.id,
        title=payload.title,
        amount_cents=payload.amount_cents,
        currency=payload.currency,
        stage=payload.stage.value,
        status=status_v,
        probability=prob,
        close_date=payload.close_date,
        contact_id=payload.contact_id,
        company_id=payload.company_id,
        owner_id=payload.owner_id or ctx.user.id,
        note=payload.note,
    )
    db.add(row)
    db.flush()
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="create", entity="deal", entity_id=row.id, detail=row.title)
    db.commit()
    db.refresh(row)
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

    for f in ("title", "amount_cents", "currency", "close_date", "contact_id", "company_id", "owner_id", "note", "order_index"):
        v = getattr(payload, f)
        if v is not None:
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
