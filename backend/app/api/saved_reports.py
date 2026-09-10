"""Сохранённые отчёты + группы + расписание."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, Any
from datetime import datetime
from pydantic import BaseModel, ConfigDict

from ..database import get_db
from ..models import SavedReport, ReportGroup
from ..schemas.common import Message
from .deps import TenantContext, get_current_context


router = APIRouter(prefix="/api/reports", tags=["saved-reports"])


# --- Groups ---

class GroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    order_index: int


class GroupCreate(BaseModel):
    name: str
    order_index: int = 0


@router.get("/groups", response_model=list[GroupOut])
def list_groups(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    return (
        db.query(ReportGroup)
        .filter(ReportGroup.tenant_id == ctx.tenant.id)
        .order_by(ReportGroup.order_index, ReportGroup.name)
        .all()
    )


@router.post("/groups", response_model=GroupOut, status_code=201)
def create_group(payload: GroupCreate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = ReportGroup(tenant_id=ctx.tenant.id, name=payload.name, order_index=payload.order_index)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/groups/{gid}", response_model=Message)
def delete_group(gid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(ReportGroup, gid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Группа не найдена")
    db.delete(row)
    db.commit()
    return Message(message="Удалено")


# --- Saved reports ---

class SavedOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    config: dict[str, Any]
    group_id: Optional[int] = None
    schedule_cron: Optional[str] = None
    email_to: Optional[str] = None
    is_shared: bool
    last_run_at: Optional[datetime] = None
    created_at: datetime


class SavedCreate(BaseModel):
    name: str
    config: dict[str, Any]
    group_id: Optional[int] = None
    schedule_cron: Optional[str] = None
    email_to: Optional[str] = None
    is_shared: bool = False


class SavedUpdate(BaseModel):
    name: Optional[str] = None
    config: Optional[dict[str, Any]] = None
    group_id: Optional[int] = None
    schedule_cron: Optional[str] = None
    email_to: Optional[str] = None
    is_shared: Optional[bool] = None


@router.get("/saved", response_model=list[SavedOut])
def list_saved(
    group_id: Optional[int] = None,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    from sqlalchemy import or_
    q = db.query(SavedReport).filter(
        SavedReport.tenant_id == ctx.tenant.id,
        or_(SavedReport.owner_id == ctx.user.id, SavedReport.is_shared == True),  # noqa: E712
    )
    if group_id is not None:
        q = q.filter(SavedReport.group_id == group_id)
    return q.order_by(SavedReport.name).all()


@router.post("/saved", response_model=SavedOut, status_code=201)
def create_saved(payload: SavedCreate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = SavedReport(
        tenant_id=ctx.tenant.id,
        owner_id=ctx.user.id,
        name=payload.name,
        config=payload.config,
        group_id=payload.group_id,
        schedule_cron=payload.schedule_cron,
        email_to=payload.email_to,
        is_shared=payload.is_shared,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/saved/{sid}", response_model=SavedOut)
def update_saved(sid: int, payload: SavedUpdate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(SavedReport, sid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Отчёт не найден")
    if row.owner_id != ctx.user.id:
        raise HTTPException(403, "Только владелец может редактировать")
    for f in ("name", "config", "group_id", "schedule_cron", "email_to", "is_shared"):
        v = getattr(payload, f)
        if v is not None:
            setattr(row, f, v)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/saved/{sid}", response_model=Message)
def delete_saved(sid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(SavedReport, sid)
    if not row or row.tenant_id != ctx.tenant.id or row.owner_id != ctx.user.id:
        raise HTTPException(404, "Отчёт не найден")
    db.delete(row)
    db.commit()
    return Message(message="Удалено")
