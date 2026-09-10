"""Связи между задачами (blocks / blocked_by / relates / duplicates) и подзадачи."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, ConfigDict, field_validator

from ..database import get_db
from ..models import Task, TaskLink, LINK_KINDS
from ..schemas.common import Message
from .deps import TenantContext, get_current_context, log_action


router = APIRouter(prefix="/api/tasks", tags=["task-links"])


REVERSE = {"blocks": "blocked_by", "blocked_by": "blocks", "relates": "relates", "duplicates": "duplicates"}


class TaskBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    status: Optional[str] = None


class LinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: str
    from_task_id: int
    to_task_id: int
    created_at: datetime


class LinkCreate(BaseModel):
    to_task_id: int
    kind: str

    @field_validator("kind")
    @classmethod
    def _valid(cls, v: str) -> str:
        if v not in LINK_KINDS:
            raise ValueError(f"kind must be one of {LINK_KINDS}")
        return v


def _assert_task_in_tenant(db: Session, tenant_id: int, task_id: int) -> Task:
    t = db.get(Task, task_id)
    if not t or t.tenant_id != tenant_id:
        raise HTTPException(404, f"Задача {task_id} не найдена")
    return t


@router.get("/{task_id}/links", response_model=list[LinkOut])
def list_links(task_id: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    _assert_task_in_tenant(db, ctx.tenant.id, task_id)
    # Показываем все связи, где задача — from или to.
    from sqlalchemy import or_
    rows = (
        db.query(TaskLink)
        .filter(TaskLink.tenant_id == ctx.tenant.id, or_(TaskLink.from_task_id == task_id, TaskLink.to_task_id == task_id))
        .all()
    )
    return rows


@router.post("/{task_id}/links", response_model=LinkOut, status_code=201)
def create_link(
    task_id: int,
    payload: LinkCreate,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    if task_id == payload.to_task_id:
        raise HTTPException(400, "Задача не может быть связана сама с собой")
    src = _assert_task_in_tenant(db, ctx.tenant.id, task_id)
    dst = _assert_task_in_tenant(db, ctx.tenant.id, payload.to_task_id)

    # Проверяем что такой связи ещё нет
    existing = (
        db.query(TaskLink)
        .filter(
            TaskLink.tenant_id == ctx.tenant.id,
            TaskLink.from_task_id == task_id,
            TaskLink.to_task_id == payload.to_task_id,
            TaskLink.kind == payload.kind,
        )
        .first()
    )
    if existing:
        return existing

    link = TaskLink(
        tenant_id=ctx.tenant.id,
        from_task_id=task_id,
        to_task_id=payload.to_task_id,
        kind=payload.kind,
        created_by=ctx.user.id,
    )
    db.add(link)

    # Обратная связь автоматически (кроме duplicates которая симметрична)
    reverse_kind = REVERSE[payload.kind]
    if reverse_kind != payload.kind:
        reverse = (
            db.query(TaskLink)
            .filter(
                TaskLink.tenant_id == ctx.tenant.id,
                TaskLink.from_task_id == payload.to_task_id,
                TaskLink.to_task_id == task_id,
                TaskLink.kind == reverse_kind,
            )
            .first()
        )
        if not reverse:
            db.add(TaskLink(
                tenant_id=ctx.tenant.id,
                from_task_id=payload.to_task_id,
                to_task_id=task_id,
                kind=reverse_kind,
                created_by=ctx.user.id,
            ))

    db.flush()
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="link", entity="task", entity_id=task_id, detail=f"{payload.kind} #{payload.to_task_id}")
    db.commit()
    db.refresh(link)
    return link


@router.delete("/{task_id}/links/{link_id}", response_model=Message)
def delete_link(
    task_id: int,
    link_id: int,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    link = db.get(TaskLink, link_id)
    if not link or link.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Связь не найдена")

    # Удаляем и обратную
    reverse = (
        db.query(TaskLink)
        .filter(
            TaskLink.tenant_id == ctx.tenant.id,
            TaskLink.from_task_id == link.to_task_id,
            TaskLink.to_task_id == link.from_task_id,
            TaskLink.kind == REVERSE.get(link.kind, link.kind),
        )
        .first()
    )
    db.delete(link)
    if reverse and reverse.id != link.id:
        db.delete(reverse)
    db.commit()
    return Message(message="Связь удалена")


@router.get("/{task_id}/subtasks", response_model=list[TaskBrief])
def list_subtasks(task_id: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    _assert_task_in_tenant(db, ctx.tenant.id, task_id)
    rows = (
        db.query(Task)
        .filter(Task.tenant_id == ctx.tenant.id, Task.parent_task_id == task_id)
        .order_by(Task.order_index.asc(), Task.id.asc())
        .all()
    )
    return [TaskBrief(id=t.id, title=t.title, status=t.status.value if t.status else None) for t in rows]
