"""Журналы для владельца и администратора компании:

- GET /api/audit-log      — журнал действий с IP и браузером (полный, по всей компании);
- GET /api/record-views   — кто открывал запись (документ, позже договор).

IP-адреса и браузеры сотрудников — чувствительные данные, поэтому только владельцу
или сотруднику с правом settings.system (как настройки безопасности).
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ActivityLog, RecordView
from ..schemas.common import Page, PageParams, page_params, paginate
from .deps import TenantContext, get_current_context

router = APIRouter(tags=["security-audit"])


def _require_audit_viewer(ctx: TenantContext) -> None:
    from ..core.permissions import user_has
    if ctx.membership.is_owner or ctx.user.is_platform_admin:
        return
    if not user_has(ctx.user, ["settings.system"], tenant_id=ctx.tenant.id):
        raise HTTPException(403, "Журнал доступен владельцу компании и администратору")


class AuditActor(BaseModel):
    id: int
    name: str
    email: Optional[str] = None


class AuditItemOut(BaseModel):
    id: int
    action: str
    entity: Optional[str] = None
    entity_id: Optional[int] = None
    task_id: Optional[int] = None
    detail: Optional[str] = None
    ip: Optional[str] = None
    user_agent: Optional[str] = None
    created_at: datetime
    user: Optional[AuditActor] = None


def _actor(u) -> Optional[AuditActor]:
    return AuditActor(id=u.id, name=u.name, email=u.email) if u else None


@router.get("/api/audit-log", response_model=Page[AuditItemOut])
def audit_log(
    user_id: Optional[int] = None,
    action: Optional[str] = None,
    entity: Optional[str] = None,
    ip: Optional[str] = Query(default=None, max_length=64),
    pagination: PageParams = Depends(page_params),
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    _require_audit_viewer(ctx)
    q = db.query(ActivityLog).filter(ActivityLog.tenant_id == ctx.tenant.id)
    if user_id is not None:
        q = q.filter(ActivityLog.user_id == user_id)
    if action:
        q = q.filter(ActivityLog.action == action)
    if entity:
        q = q.filter(ActivityLog.entity == entity)
    if ip:
        q = q.filter(ActivityLog.ip == ip.strip())
    q = q.order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc())
    page = paginate(q, pagination)
    page.items = [
        AuditItemOut(
            id=a.id, action=a.action, entity=a.entity, entity_id=a.entity_id, task_id=a.task_id,
            detail=a.detail, ip=a.ip, user_agent=a.user_agent, created_at=a.created_at, user=_actor(a.user),
        )
        for a in page.items
    ]
    return page


class RecordViewOut(BaseModel):
    id: int
    entity_type: str
    entity_id: int
    user: Optional[AuditActor] = None  # None — открыли по публичной ссылке
    ip: Optional[str] = None
    user_agent: Optional[str] = None
    viewed_at: datetime


@router.get("/api/record-views", response_model=list[RecordViewOut])
def list_record_views(
    entity_type: str = Query(..., min_length=1, max_length=50),
    entity_id: int = Query(...),
    limit: int = Query(default=200, ge=1, le=1000),
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    _require_audit_viewer(ctx)
    rows = (
        db.query(RecordView)
        .filter(
            RecordView.tenant_id == ctx.tenant.id,
            RecordView.entity_type == entity_type,
            RecordView.entity_id == entity_id,
        )
        .order_by(RecordView.viewed_at.desc(), RecordView.id.desc())
        .limit(limit)
        .all()
    )
    return [
        RecordViewOut(
            id=r.id, entity_type=r.entity_type, entity_id=r.entity_id, user=_actor(r.user),
            ip=r.ip, user_agent=r.user_agent, viewed_at=r.viewed_at,
        )
        for r in rows
    ]
