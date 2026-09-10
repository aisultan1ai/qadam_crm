from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from datetime import datetime, date, timezone
from typing import Optional
from pydantic import BaseModel, ConfigDict

from ..database import get_db
from ..models import TimeOff, TimeOffKind, TimeOffStatus
from ..core.permissions import user_has
from ..schemas.common import Message, Page, PageParams, page_params, paginate
from .deps import TenantContext, get_current_context, log_action


router = APIRouter(prefix="/api/timeoff", tags=["time-off"])


class UserBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    avatar_url: Optional[str] = None


class TimeOffOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    kind: TimeOffKind
    status: TimeOffStatus
    start_date: date
    end_date: date
    note: Optional[str] = None
    approver_id: Optional[int] = None
    approved_at: Optional[datetime] = None
    created_at: datetime
    user: Optional[UserBrief] = None
    approver: Optional[UserBrief] = None


class TimeOffCreate(BaseModel):
    kind: TimeOffKind = TimeOffKind.vacation
    start_date: date
    end_date: date
    note: Optional[str] = None
    user_id: Optional[int] = None  # только для admin/HR — за другого сотрудника


class TimeOffUpdate(BaseModel):
    kind: Optional[TimeOffKind] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    note: Optional[str] = None


@router.get("", response_model=Page[TimeOffOut])
def list_timeoff(
    user_id: Optional[int] = None,
    status: Optional[TimeOffStatus] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    pagination: PageParams = Depends(page_params),
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    q = db.query(TimeOff).filter(TimeOff.tenant_id == ctx.tenant.id)
    if user_id is not None:
        q = q.filter(TimeOff.user_id == user_id)
    if status is not None:
        q = q.filter(TimeOff.status == status.value)
    if from_date is not None:
        q = q.filter(TimeOff.end_date >= from_date)
    if to_date is not None:
        q = q.filter(TimeOff.start_date <= to_date)
    q = q.order_by(TimeOff.start_date.desc())
    return paginate(q, pagination)


@router.post("", response_model=TimeOffOut, status_code=201)
def create_timeoff(
    payload: TimeOffCreate,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    if payload.end_date < payload.start_date:
        raise HTTPException(400, "Конец не может быть раньше начала")

    # За другого сотрудника — только HR/admin
    target_user_id = payload.user_id or ctx.user.id
    if target_user_id != ctx.user.id and not user_has(ctx.user, ["hr.manage_goals", "users.view"]):
        raise HTTPException(403, "Нельзя оформить отпуск за другого сотрудника")

    row = TimeOff(
        tenant_id=ctx.tenant.id,
        user_id=target_user_id,
        kind=payload.kind.value,
        status=TimeOffStatus.pending.value,
        start_date=payload.start_date,
        end_date=payload.end_date,
        note=payload.note,
    )
    db.add(row)
    db.flush()
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="create", entity="timeoff", entity_id=row.id, detail=f"{payload.kind.value} {payload.start_date}..{payload.end_date}")
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{tid}", response_model=TimeOffOut)
def update_timeoff(
    tid: int,
    payload: TimeOffUpdate,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    row = db.get(TimeOff, tid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Заявка не найдена")
    if row.user_id != ctx.user.id and not user_has(ctx.user, ["hr.manage_goals"]):
        raise HTTPException(403, "Нельзя редактировать чужую заявку")
    if row.status != TimeOffStatus.pending.value:
        raise HTTPException(400, "Одобренную/отклонённую заявку менять нельзя")

    for f in ("start_date", "end_date", "note"):
        v = getattr(payload, f)
        if v is not None:
            setattr(row, f, v)
    if payload.kind is not None:
        row.kind = payload.kind.value
    if row.end_date < row.start_date:
        raise HTTPException(400, "Конец не может быть раньше начала")
    db.commit()
    db.refresh(row)
    return row


@router.post("/{tid}/approve", response_model=TimeOffOut)
def approve_timeoff(tid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    if not user_has(ctx.user, ["hr.manage_goals", "users.view"]):
        raise HTTPException(403, "Нет права одобрять отпуска")
    row = db.get(TimeOff, tid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Заявка не найдена")
    row.status = TimeOffStatus.approved.value
    row.approver_id = ctx.user.id
    row.approved_at = datetime.now(timezone.utc)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="timeoff", entity_id=row.id, detail="approved")
    db.commit()
    db.refresh(row)
    return row


@router.post("/{tid}/reject", response_model=TimeOffOut)
def reject_timeoff(tid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    if not user_has(ctx.user, ["hr.manage_goals", "users.view"]):
        raise HTTPException(403, "Нет права одобрять отпуска")
    row = db.get(TimeOff, tid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Заявка не найдена")
    row.status = TimeOffStatus.rejected.value
    row.approver_id = ctx.user.id
    row.approved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{tid}", response_model=Message)
def delete_timeoff(tid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(TimeOff, tid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Заявка не найдена")
    if row.user_id != ctx.user.id and not user_has(ctx.user, ["hr.manage_goals"]):
        raise HTTPException(403, "Нельзя удалить чужую заявку")
    db.delete(row)
    db.commit()
    return Message(message="Заявка удалена")
