"""Пользовательские статусы задач + простой workflow."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime
import re
from pydantic import BaseModel, ConfigDict, field_validator

from ..database import get_db
from ..models import TaskStatusDef, STATUS_CATEGORIES
from ..schemas.common import Message
from .deps import TenantContext, get_current_context, log_action


router = APIRouter(prefix="/api/task-statuses", tags=["task-statuses"])

CODE_RE = re.compile(r"^[a-z][a-z0-9_]{1,39}$")


class StatusOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    label: str
    color: str
    category: str
    order_index: int
    is_default: bool
    is_terminal: bool
    allowed_next: list[str] = []
    created_at: datetime


class StatusCreate(BaseModel):
    code: str
    label: str
    color: str = "#6B7280"
    category: str = "new"
    order_index: int = 0
    is_default: bool = False
    is_terminal: bool = False
    allowed_next: list[str] = []

    @field_validator("code")
    @classmethod
    def _valid_code(cls, v: str) -> str:
        if not CODE_RE.match(v):
            raise ValueError("code must be snake_case: [a-z][a-z0-9_]+")
        return v

    @field_validator("category")
    @classmethod
    def _valid_category(cls, v: str) -> str:
        if v not in STATUS_CATEGORIES:
            raise ValueError(f"category must be one of {STATUS_CATEGORIES}")
        return v


class StatusUpdate(BaseModel):
    label: Optional[str] = None
    color: Optional[str] = None
    category: Optional[str] = None
    order_index: Optional[int] = None
    is_default: Optional[bool] = None
    is_terminal: Optional[bool] = None
    allowed_next: Optional[list[str]] = None


@router.get("", response_model=list[StatusOut])
def list_statuses(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    return (
        db.query(TaskStatusDef)
        .filter(TaskStatusDef.tenant_id == ctx.tenant.id)
        .order_by(TaskStatusDef.order_index.asc(), TaskStatusDef.id.asc())
        .all()
    )


@router.post("", response_model=StatusOut, status_code=201)
def create_status(payload: StatusCreate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    exists = db.query(TaskStatusDef).filter(TaskStatusDef.tenant_id == ctx.tenant.id, TaskStatusDef.code == payload.code).first()
    if exists:
        raise HTTPException(409, f"Статус с code={payload.code} уже существует")
    if payload.is_default:
        # снимаем default с других
        for r in db.query(TaskStatusDef).filter(TaskStatusDef.tenant_id == ctx.tenant.id, TaskStatusDef.is_default == True).all():  # noqa
            r.is_default = False
    row = TaskStatusDef(tenant_id=ctx.tenant.id, **payload.model_dump())
    db.add(row)
    db.flush()
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="create", entity="task_status", entity_id=row.id, detail=payload.code)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{sid}", response_model=StatusOut)
def update_status(sid: int, payload: StatusUpdate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(TaskStatusDef, sid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Статус не найден")
    if payload.is_default:
        for r in db.query(TaskStatusDef).filter(TaskStatusDef.tenant_id == ctx.tenant.id, TaskStatusDef.is_default == True).all():  # noqa
            r.is_default = False
    for f in ("label", "color", "category", "order_index", "is_default", "is_terminal", "allowed_next"):
        v = getattr(payload, f)
        if v is not None:
            setattr(row, f, v)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{sid}", response_model=Message)
def delete_status(sid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(TaskStatusDef, sid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Статус не найден")
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="delete", entity="task_status", entity_id=row.id, detail=row.code)
    db.delete(row)
    db.commit()
    return Message(message="Статус удалён")
