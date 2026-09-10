"""Настраиваемые напоминания. Celery Beat каждую минуту → Notification."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime, timezone
from pydantic import BaseModel, ConfigDict

from ..database import get_db
from ..models import Reminder
from ..schemas.common import Message
from .deps import TenantContext, get_current_context


router = APIRouter(prefix="/api/reminders", tags=["reminders"])


class ReminderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    target_type: Optional[str] = None
    target_id: Optional[int] = None
    message: str
    next_at: datetime
    recurrence_rule: Optional[str] = None
    is_active: bool
    fired_count: int
    last_fired_at: Optional[datetime] = None
    created_at: datetime


class ReminderCreate(BaseModel):
    message: str
    next_at: datetime
    target_type: Optional[str] = None
    target_id: Optional[int] = None
    recurrence_rule: Optional[str] = None


class ReminderUpdate(BaseModel):
    message: Optional[str] = None
    next_at: Optional[datetime] = None
    recurrence_rule: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("", response_model=list[ReminderOut])
def list_reminders(
    target_type: Optional[str] = None,
    target_id: Optional[int] = None,
    active_only: bool = True,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    q = db.query(Reminder).filter(Reminder.tenant_id == ctx.tenant.id, Reminder.user_id == ctx.user.id)
    if target_type:
        q = q.filter(Reminder.target_type == target_type)
    if target_id is not None:
        q = q.filter(Reminder.target_id == target_id)
    if active_only:
        q = q.filter(Reminder.is_active == True)  # noqa: E712
    q = q.order_by(Reminder.next_at.asc())
    return q.limit(200).all()


@router.post("", response_model=ReminderOut, status_code=201)
def create_reminder(
    payload: ReminderCreate,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    row = Reminder(
        tenant_id=ctx.tenant.id,
        user_id=ctx.user.id,
        target_type=payload.target_type,
        target_id=payload.target_id,
        message=payload.message,
        next_at=payload.next_at,
        recurrence_rule=payload.recurrence_rule,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{rid}", response_model=ReminderOut)
def update_reminder(
    rid: int,
    payload: ReminderUpdate,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    row = db.get(Reminder, rid)
    if not row or row.tenant_id != ctx.tenant.id or row.user_id != ctx.user.id:
        raise HTTPException(404, "Напоминание не найдено")
    for f in ("message", "next_at", "recurrence_rule", "is_active"):
        v = getattr(payload, f)
        if v is not None:
            setattr(row, f, v)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{rid}", response_model=Message)
def delete_reminder(rid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(Reminder, rid)
    if not row or row.tenant_id != ctx.tenant.id or row.user_id != ctx.user.id:
        raise HTTPException(404, "Напоминание не найдено")
    db.delete(row)
    db.commit()
    return Message(message="Удалено")
