"""CRUD автоматизаций + история запусков + dry-run.

Право доступа: `automations.manage` (по умолчанию у owner и admin роли).
Все действия per-tenant — Automation.tenant_id == ctx.tenant.id.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from ..core.events import KNOWN_EVENTS
from ..database import get_db
from ..models import Automation, AutomationAction, AutomationRun
from ..schemas.common import Message
from ..services.automation_engine import execute_automation
from .deps import TenantContext, log_action, require

router = APIRouter(prefix="/api/automations", tags=["automations"])


# Список action-типов доступных пользователю в UI. Держим в одном месте
# чтобы фронт мог рисовать палитру без дублирования.
ACTION_TYPES = [
    "create_task",
    "send_email",
    "send_notification",
    "add_to_channel",
    "change_status",
    "assign_user",
    "add_comment",
    "webhook",
]


class AutomationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    trigger_event: str = Field(min_length=1, max_length=80)
    trigger_config: dict = Field(default_factory=dict)
    graph: dict = Field(default_factory=dict)
    is_active: bool = True


class AutomationPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    trigger_event: Optional[str] = Field(default=None, min_length=1, max_length=80)
    trigger_config: Optional[dict] = None
    graph: Optional[dict] = None
    is_active: Optional[bool] = None


class TestRunRequest(BaseModel):
    payload: dict = Field(default_factory=dict)


def _serialize(a: Automation, runs_last_7d: Optional[int] = None, last_run: Optional[datetime] = None) -> dict:
    return {
        "id": a.id,
        "name": a.name,
        "description": a.description,
        "trigger_event": a.trigger_event,
        "trigger_config": a.trigger_config or {},
        "graph": a.graph or {},
        "is_active": a.is_active,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
        "runs_last_7d": runs_last_7d,
        "last_run_at": last_run.isoformat() if last_run else None,
    }


def _serialize_run(r: AutomationRun) -> dict:
    return {
        "id": r.id,
        "automation_id": r.automation_id,
        "status": r.status.value if hasattr(r.status, "value") else r.status,
        "triggered_at": r.triggered_at.isoformat() if r.triggered_at else None,
        "finished_at": r.finished_at.isoformat() if r.finished_at else None,
        "trigger_payload": r.trigger_payload or {},
        "error": r.error,
        "is_dry_run": r.is_dry_run,
        "actions": [
            {
                "id": a.id,
                "node_id": a.node_id,
                "action_type": a.action_type,
                "status": a.status.value if hasattr(a.status, "value") else a.status,
                "scheduled_for": a.scheduled_for.isoformat() if a.scheduled_for else None,
                "executed_at": a.executed_at.isoformat() if a.executed_at else None,
                "result": a.result or {},
                "error": a.error,
            }
            for a in (r.actions or [])
        ],
    }


@router.get("/events")
def list_events(_ctx: TenantContext = Depends(require("automations.manage"))):
    """Справочник доступных событий и действий для конструктора."""
    return {
        "events": sorted(KNOWN_EVENTS),
        "action_types": ACTION_TYPES,
    }


@router.get("")
def list_automations(
    ctx: TenantContext = Depends(require("automations.manage")),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Automation)
        .filter(Automation.tenant_id == ctx.tenant.id)
        .order_by(Automation.created_at.desc())
        .all()
    )
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=7)

    ids = [a.id for a in rows]
    counts: dict[int, int] = {}
    last: dict[int, datetime] = {}
    if ids:
        for aid, cnt in (
            db.query(AutomationRun.automation_id, func.count(AutomationRun.id))
            .filter(AutomationRun.automation_id.in_(ids), AutomationRun.triggered_at >= since)
            .group_by(AutomationRun.automation_id)
            .all()
        ):
            counts[aid] = cnt
        for aid, mx in (
            db.query(AutomationRun.automation_id, func.max(AutomationRun.triggered_at))
            .filter(AutomationRun.automation_id.in_(ids))
            .group_by(AutomationRun.automation_id)
            .all()
        ):
            last[aid] = mx

    return [_serialize(a, counts.get(a.id, 0), last.get(a.id)) for a in rows]


def _load(db: Session, tenant_id: int, automation_id: int) -> Automation:
    a = db.get(Automation, automation_id)
    if not a or a.tenant_id != tenant_id:
        raise HTTPException(404, "Автоматизация не найдена")
    return a


@router.get("/{automation_id}")
def get_automation(
    automation_id: int,
    ctx: TenantContext = Depends(require("automations.manage")),
    db: Session = Depends(get_db),
):
    a = _load(db, ctx.tenant.id, automation_id)
    return _serialize(a)


@router.post("", status_code=201)
def create_automation(
    payload: AutomationCreate,
    ctx: TenantContext = Depends(require("automations.manage")),
    db: Session = Depends(get_db),
):
    if payload.trigger_event not in KNOWN_EVENTS:
        raise HTTPException(400, f"Неизвестное событие: {payload.trigger_event}")
    a = Automation(
        tenant_id=ctx.tenant.id,
        name=payload.name.strip(),
        description=(payload.description or "").strip() or None,
        trigger_event=payload.trigger_event,
        trigger_config=payload.trigger_config or {},
        graph=payload.graph or {"nodes": [], "edges": []},
        is_active=payload.is_active,
        created_by=ctx.user.id,
    )
    db.add(a)
    db.flush()
    log_action(
        db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
        action="create", entity="automation", entity_id=a.id, detail=a.name,
    )
    db.commit()
    db.refresh(a)
    return _serialize(a)


@router.patch("/{automation_id}")
def patch_automation(
    automation_id: int,
    payload: AutomationPatch,
    ctx: TenantContext = Depends(require("automations.manage")),
    db: Session = Depends(get_db),
):
    a = _load(db, ctx.tenant.id, automation_id)
    changes: list[str] = []

    if payload.name is not None and payload.name.strip() != a.name:
        a.name = payload.name.strip()
        changes.append("name")
    if payload.description is not None:
        new_v = payload.description.strip() or None
        if new_v != a.description:
            a.description = new_v
            changes.append("description")
    if payload.trigger_event is not None and payload.trigger_event != a.trigger_event:
        if payload.trigger_event not in KNOWN_EVENTS:
            raise HTTPException(400, f"Неизвестное событие: {payload.trigger_event}")
        a.trigger_event = payload.trigger_event
        changes.append("trigger_event")
    if payload.trigger_config is not None:
        a.trigger_config = payload.trigger_config
        changes.append("trigger_config")
    if payload.graph is not None:
        a.graph = payload.graph
        changes.append("graph")
    if payload.is_active is not None and payload.is_active != a.is_active:
        a.is_active = payload.is_active
        changes.append(f"is_active={payload.is_active}")

    if changes:
        log_action(
            db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
            action="update", entity="automation", entity_id=a.id, detail=", ".join(changes),
        )
    db.commit()
    db.refresh(a)
    return _serialize(a)


@router.delete("/{automation_id}", response_model=Message)
def delete_automation(
    automation_id: int,
    ctx: TenantContext = Depends(require("automations.manage")),
    db: Session = Depends(get_db),
):
    a = _load(db, ctx.tenant.id, automation_id)
    name = a.name
    log_action(
        db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
        action="delete", entity="automation", entity_id=a.id, detail=name,
    )
    db.delete(a)
    db.commit()
    return Message(message=f"Автоматизация «{name}» удалена")


@router.get("/{automation_id}/runs")
def list_runs(
    automation_id: int,
    limit: int = Query(default=50, ge=1, le=200),
    ctx: TenantContext = Depends(require("automations.manage")),
    db: Session = Depends(get_db),
):
    _load(db, ctx.tenant.id, automation_id)
    rows = (
        db.query(AutomationRun)
        .filter(
            AutomationRun.automation_id == automation_id,
            AutomationRun.tenant_id == ctx.tenant.id,
        )
        .order_by(desc(AutomationRun.triggered_at))
        .limit(limit)
        .all()
    )
    return [_serialize_run(r) for r in rows]


@router.get("/{automation_id}/runs/{run_id}")
def get_run(
    automation_id: int,
    run_id: int,
    ctx: TenantContext = Depends(require("automations.manage")),
    db: Session = Depends(get_db),
):
    _load(db, ctx.tenant.id, automation_id)
    r = db.get(AutomationRun, run_id)
    if not r or r.tenant_id != ctx.tenant.id or r.automation_id != automation_id:
        raise HTTPException(404, "Запуск не найден")
    return _serialize_run(r)


@router.post("/{automation_id}/test", status_code=201)
def test_run(
    automation_id: int,
    payload: TestRunRequest,
    ctx: TenantContext = Depends(require("automations.manage")),
    db: Session = Depends(get_db),
):
    """Dry-run автоматизации: обход графа, но actions не исполняются реально."""
    a = _load(db, ctx.tenant.id, automation_id)
    run = execute_automation(
        db, a, a.trigger_event, payload.payload or {}, dry_run=True,
    )
    db.refresh(run)
    return _serialize_run(run)
