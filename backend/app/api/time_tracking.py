"""API тайм-трекинга: таймеры, записи, табели.

- Timer: активный таймер (один на юзера). Start/stop/heartbeat.
- TimeEntry: закрытые записи + ручной ввод + редактирование.
- TimesheetApproval: сводка за период на утверждение руководителем.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, desc, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.ws_hub import publish_to_user
from ..database import get_db
from ..models import (
    ApprovalStatus, Project, Task, TimeEntry, Timer, TimesheetApproval, User,
)
from ..schemas.common import Message
from .deps import TenantContext, log_action, require

log = logging.getLogger("qadam.time_tracking.api")

router = APIRouter(prefix="/api/time-tracking", tags=["time-tracking"])


# =============================================================================
# Schemas
# =============================================================================


class TimerStart(BaseModel):
    task_id: Optional[int] = None
    description: Optional[str] = Field(default=None, max_length=500)


class TimerHeartbeat(BaseModel):
    pass  # без payload — сам запрос обновит last_heartbeat_at


class EntryCreate(BaseModel):
    task_id: Optional[int] = None
    started_at: datetime
    ended_at: Optional[datetime] = None
    seconds: Optional[int] = Field(default=None, ge=0, le=24 * 60 * 60)
    description: Optional[str] = Field(default=None, max_length=1000)
    is_billable: bool = False
    hourly_rate_cents: Optional[int] = Field(default=None, ge=0)
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3)


class EntryPatch(BaseModel):
    task_id: Optional[int] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    seconds: Optional[int] = Field(default=None, ge=0, le=24 * 60 * 60)
    description: Optional[str] = Field(default=None, max_length=1000)
    is_billable: Optional[bool] = None
    hourly_rate_cents: Optional[int] = Field(default=None, ge=0)
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3)


class TimesheetSubmit(BaseModel):
    period_start: datetime
    period_end: datetime
    comment: Optional[str] = Field(default=None, max_length=1000)


class TimesheetDecision(BaseModel):
    action: str = Field(pattern=r"^(approve|reject)$")
    comment: Optional[str] = Field(default=None, max_length=1000)


# =============================================================================
# Serialization
# =============================================================================


def _timer_out(t: Timer) -> dict:
    return {
        "id": t.id,
        "task_id": t.task_id,
        "task_title": (t.task.title if t.task else None),
        "description": t.description,
        "started_at": t.started_at.isoformat() if t.started_at else None,
        "last_heartbeat_at": t.last_heartbeat_at.isoformat() if t.last_heartbeat_at else None,
        "elapsed_seconds": int((datetime.now(timezone.utc) - t.started_at).total_seconds()) if t.started_at else 0,
    }


def _entry_out(e: TimeEntry) -> dict:
    return {
        "id": e.id,
        "task_id": e.task_id,
        "task_title": (e.task.title if e.task else None),
        "user_id": e.user_id,
        "user_name": (e.user.name if e.user else None),
        "started_at": e.started_at.isoformat() if e.started_at else None,
        "ended_at": e.ended_at.isoformat() if e.ended_at else None,
        "seconds": e.seconds,
        "description": e.description,
        "is_billable": e.is_billable,
        "hourly_rate_cents": e.hourly_rate_cents,
        "currency": e.currency,
        "approval_status": e.approval_status.value if hasattr(e.approval_status, "value") else e.approval_status,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


def _ts_out(ts: TimesheetApproval) -> dict:
    return {
        "id": ts.id,
        "user_id": ts.user_id,
        "period_start": ts.period_start.isoformat(),
        "period_end": ts.period_end.isoformat(),
        "total_seconds": ts.total_seconds,
        "status": ts.status.value if hasattr(ts.status, "value") else ts.status,
        "submitted_at": ts.submitted_at.isoformat() if ts.submitted_at else None,
        "approver_id": ts.approver_id,
        "approved_at": ts.approved_at.isoformat() if ts.approved_at else None,
        "comment": ts.comment,
    }


def _check_task_scope(db: Session, ctx: TenantContext, task_id: Optional[int]) -> None:
    if task_id is None:
        return
    t = db.get(Task, task_id)
    if not t or t.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Задача не найдена")


# =============================================================================
# Timer
# =============================================================================


@router.get("/timer")
def get_timer(
    ctx: TenantContext = Depends(require("time.use")),
    db: Session = Depends(get_db),
):
    t = db.query(Timer).filter(Timer.user_id == ctx.user.id).first()
    if not t:
        return None
    return _timer_out(t)


@router.post("/timer/start", status_code=201)
def start_timer(
    payload: TimerStart,
    ctx: TenantContext = Depends(require("time.use")),
    db: Session = Depends(get_db),
):
    _check_task_scope(db, ctx, payload.task_id)

    # Автоматом останавливаем предыдущий (если был)
    prev = db.query(Timer).filter(Timer.user_id == ctx.user.id).first()
    if prev:
        _stop_and_persist(db, prev)

    t = Timer(
        tenant_id=ctx.tenant.id,
        user_id=ctx.user.id,
        task_id=payload.task_id,
        description=payload.description,
    )
    try:
        db.add(t)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Таймер уже запущен")
    db.refresh(t)
    publish_to_user(ctx.tenant.id, ctx.user.id, "timer.started", {
        "task_id": t.task_id, "started_at": t.started_at.isoformat(),
    })
    return _timer_out(t)


@router.post("/timer/heartbeat")
def timer_heartbeat(
    ctx: TenantContext = Depends(require("time.use")),
    db: Session = Depends(get_db),
):
    t = db.query(Timer).filter(Timer.user_id == ctx.user.id).first()
    if not t:
        raise HTTPException(404, "Таймер не запущен")
    t.last_heartbeat_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "last_heartbeat_at": t.last_heartbeat_at.isoformat()}


@router.post("/timer/stop")
def stop_timer(
    ctx: TenantContext = Depends(require("time.use")),
    db: Session = Depends(get_db),
):
    t = db.query(Timer).filter(Timer.user_id == ctx.user.id).first()
    if not t:
        raise HTTPException(404, "Таймер не запущен")
    entry = _stop_and_persist(db, t)
    db.commit()
    publish_to_user(ctx.tenant.id, ctx.user.id, "timer.stopped", {
        "entry_id": entry.id if entry else None,
        "seconds": entry.seconds if entry else 0,
    })
    return {"ok": True, "entry": (_entry_out(entry) if entry else None)}


def _stop_and_persist(db: Session, timer: Timer) -> Optional[TimeEntry]:
    """Остановка таймера → создание TimeEntry (если >0 сек). Не коммитит."""
    now = datetime.now(timezone.utc)
    seconds = max(0, int((now - timer.started_at).total_seconds()))
    entry = None
    if seconds > 0:
        entry = TimeEntry(
            tenant_id=timer.tenant_id,
            user_id=timer.user_id,
            task_id=timer.task_id,
            description=timer.description,
            started_at=timer.started_at,
            ended_at=now,
            seconds=seconds,
        )
        db.add(entry)
        db.flush()
    db.delete(timer)
    return entry


# =============================================================================
# Entries
# =============================================================================


@router.get("/entries")
def list_entries(
    task_id: Optional[int] = None,
    project_id: Optional[int] = None,
    user_id: Optional[int] = None,
    from_dt: Optional[datetime] = Query(default=None, alias="from"),
    to_dt: Optional[datetime] = Query(default=None, alias="to"),
    limit: int = Query(default=200, ge=1, le=1000),
    ctx: TenantContext = Depends(require("time.use")),
    db: Session = Depends(get_db),
):
    q = db.query(TimeEntry).filter(TimeEntry.tenant_id == ctx.tenant.id)
    if task_id:
        q = q.filter(TimeEntry.task_id == task_id)
    if project_id:
        q = q.join(Task, Task.id == TimeEntry.task_id).filter(Task.project_id == project_id)
    # Не-approver'ы видят только свои
    can_view_all = any(p.code == "time.approve" for r in ctx.user.roles for p in r.permissions) or ctx.user.is_superuser
    if user_id:
        if user_id != ctx.user.id and not can_view_all:
            raise HTTPException(403, "Только свои записи")
        q = q.filter(TimeEntry.user_id == user_id)
    elif not can_view_all:
        q = q.filter(TimeEntry.user_id == ctx.user.id)
    if from_dt:
        q = q.filter(TimeEntry.started_at >= from_dt)
    if to_dt:
        q = q.filter(TimeEntry.started_at <= to_dt)
    rows = q.order_by(desc(TimeEntry.started_at)).limit(limit).all()
    return [_entry_out(e) for e in rows]


@router.post("/entries", status_code=201)
def create_entry(
    payload: EntryCreate,
    ctx: TenantContext = Depends(require("time.use")),
    db: Session = Depends(get_db),
):
    _check_task_scope(db, ctx, payload.task_id)

    started = _to_utc(payload.started_at)
    ended = _to_utc(payload.ended_at) if payload.ended_at else None
    seconds = payload.seconds
    if seconds is None:
        if not ended:
            raise HTTPException(400, "Укажите ended_at или seconds")
        seconds = max(0, int((ended - started).total_seconds()))
    if seconds <= 0:
        raise HTTPException(400, "Длительность должна быть > 0")
    if not ended:
        ended = started + timedelta(seconds=seconds)

    # Дефолтная ставка из проекта, если не задана
    rate = payload.hourly_rate_cents
    currency = payload.currency
    if payload.task_id and (rate is None or currency is None):
        task = db.get(Task, payload.task_id)
        if task and task.project_id:
            prj = db.get(Project, task.project_id)
            if prj:
                if rate is None:
                    rate = prj.default_hourly_rate_cents
                if currency is None:
                    currency = prj.default_currency

    e = TimeEntry(
        tenant_id=ctx.tenant.id,
        user_id=ctx.user.id,
        task_id=payload.task_id,
        started_at=started,
        ended_at=ended,
        seconds=seconds,
        description=payload.description,
        is_billable=payload.is_billable,
        hourly_rate_cents=rate,
        currency=currency,
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    return _entry_out(e)


@router.patch("/entries/{entry_id}")
def patch_entry(
    entry_id: int,
    payload: EntryPatch,
    ctx: TenantContext = Depends(require("time.use")),
    db: Session = Depends(get_db),
):
    e = db.get(TimeEntry, entry_id)
    if not e or e.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Запись не найдена")
    if e.user_id != ctx.user.id and not ctx.user.is_superuser:
        raise HTTPException(403, "Только свои записи")
    if e.approval_status == ApprovalStatus.approved:
        raise HTTPException(409, "Утверждённые записи не редактируются")

    data = payload.model_dump(exclude_unset=True)
    if "task_id" in data:
        _check_task_scope(db, ctx, data["task_id"])
    for k, v in data.items():
        if k in ("started_at", "ended_at") and v is not None:
            v = _to_utc(v)
        setattr(e, k, v)

    # Пересчитать seconds если изменились started/ended, но не seconds
    if ("started_at" in data or "ended_at" in data) and "seconds" not in data and e.ended_at:
        e.seconds = max(0, int((e.ended_at - e.started_at).total_seconds()))
    db.commit()
    db.refresh(e)
    return _entry_out(e)


@router.delete("/entries/{entry_id}", response_model=Message)
def delete_entry(
    entry_id: int,
    ctx: TenantContext = Depends(require("time.use")),
    db: Session = Depends(get_db),
):
    e = db.get(TimeEntry, entry_id)
    if not e or e.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Запись не найдена")
    if e.user_id != ctx.user.id and not ctx.user.is_superuser:
        raise HTTPException(403, "Только свои записи")
    if e.approval_status == ApprovalStatus.approved:
        raise HTTPException(409, "Утверждённые записи не удаляются")
    db.delete(e)
    db.commit()
    return Message(message="Удалено")


# =============================================================================
# Reports
# =============================================================================


@router.get("/reports/summary")
def report_summary(
    from_dt: datetime = Query(..., alias="from"),
    to_dt: datetime = Query(..., alias="to"),
    group_by: str = Query(default="user", pattern=r"^(user|project|task)$"),
    ctx: TenantContext = Depends(require("time.use")),
    db: Session = Depends(get_db),
):
    """Суммарные часы за период с группировкой."""
    can_view_all = any(p.code == "time.approve" for r in ctx.user.roles for p in r.permissions) or ctx.user.is_superuser

    q = db.query(TimeEntry).filter(
        TimeEntry.tenant_id == ctx.tenant.id,
        TimeEntry.started_at >= from_dt,
        TimeEntry.started_at <= to_dt,
    )
    if not can_view_all:
        q = q.filter(TimeEntry.user_id == ctx.user.id)

    entries = q.all()
    buckets: dict[str, dict] = {}
    for e in entries:
        if group_by == "user":
            key = str(e.user_id)
            label = e.user.name if e.user else f"User #{e.user_id}"
        elif group_by == "project":
            pid = e.task.project_id if e.task else None
            key = str(pid) if pid else "0"
            if pid and e.task and e.task.project:
                label = e.task.project.name
            else:
                label = "Без проекта"
        else:
            key = str(e.task_id) if e.task_id else "0"
            label = e.task.title if e.task else "Без задачи"

        b = buckets.setdefault(key, {"key": key, "label": label, "seconds": 0, "billable_cents": 0})
        b["seconds"] += e.seconds
        if e.is_billable and e.hourly_rate_cents:
            b["billable_cents"] += int(e.seconds * e.hourly_rate_cents / 3600)

    return {
        "group_by": group_by,
        "from": from_dt.isoformat(),
        "to": to_dt.isoformat(),
        "total_seconds": sum(b["seconds"] for b in buckets.values()),
        "buckets": sorted(buckets.values(), key=lambda x: -x["seconds"]),
    }


# =============================================================================
# Timesheets
# =============================================================================


@router.get("/timesheets")
def list_timesheets(
    only_mine: bool = True,
    status_filter: Optional[str] = Query(default=None, alias="status", pattern=r"^(pending|approved|rejected)$"),
    limit: int = Query(default=50, ge=1, le=200),
    ctx: TenantContext = Depends(require("time.use")),
    db: Session = Depends(get_db),
):
    q = db.query(TimesheetApproval).filter(TimesheetApproval.tenant_id == ctx.tenant.id)
    can_approve = any(p.code == "time.approve" for r in ctx.user.roles for p in r.permissions) or ctx.user.is_superuser
    if only_mine or not can_approve:
        q = q.filter(TimesheetApproval.user_id == ctx.user.id)
    if status_filter:
        q = q.filter(TimesheetApproval.status == ApprovalStatus(status_filter))
    rows = q.order_by(desc(TimesheetApproval.period_start)).limit(limit).all()
    return [_ts_out(t) for t in rows]


@router.post("/timesheets/submit", status_code=201)
def submit_timesheet(
    payload: TimesheetSubmit,
    ctx: TenantContext = Depends(require("time.use")),
    db: Session = Depends(get_db),
):
    period_start = _to_utc(payload.period_start)
    period_end = _to_utc(payload.period_end)
    if period_end <= period_start:
        raise HTTPException(400, "period_end должен быть больше period_start")

    total_seconds = db.query(func.coalesce(func.sum(TimeEntry.seconds), 0)).filter(
        TimeEntry.tenant_id == ctx.tenant.id,
        TimeEntry.user_id == ctx.user.id,
        TimeEntry.started_at >= period_start,
        TimeEntry.started_at < period_end,
    ).scalar() or 0

    existing = db.query(TimesheetApproval).filter(
        TimesheetApproval.user_id == ctx.user.id,
        TimesheetApproval.period_start == period_start,
    ).first()
    if existing:
        if existing.status == ApprovalStatus.approved:
            raise HTTPException(409, "Табель за этот период уже утверждён")
        existing.period_end = period_end
        existing.total_seconds = int(total_seconds)
        existing.status = ApprovalStatus.pending
        existing.submitted_at = datetime.now(timezone.utc)
        existing.comment = payload.comment
        existing.approver_id = None
        existing.approved_at = None
        db.commit()
        db.refresh(existing)
        return _ts_out(existing)

    ts = TimesheetApproval(
        tenant_id=ctx.tenant.id,
        user_id=ctx.user.id,
        period_start=period_start,
        period_end=period_end,
        total_seconds=int(total_seconds),
        comment=payload.comment,
    )
    db.add(ts)
    db.commit()
    db.refresh(ts)
    return _ts_out(ts)


@router.post("/timesheets/{ts_id}/decide")
def decide_timesheet(
    ts_id: int,
    payload: TimesheetDecision,
    ctx: TenantContext = Depends(require("time.approve")),
    db: Session = Depends(get_db),
):
    ts = db.get(TimesheetApproval, ts_id)
    if not ts or ts.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Табель не найден")
    if ts.status != ApprovalStatus.pending:
        raise HTTPException(409, "Табель уже обработан")
    ts.status = ApprovalStatus.approved if payload.action == "approve" else ApprovalStatus.rejected
    ts.approver_id = ctx.user.id
    ts.approved_at = datetime.now(timezone.utc)
    if payload.comment:
        ts.comment = payload.comment

    # При approve — помечаем все связанные записи как approved
    if ts.status == ApprovalStatus.approved:
        db.query(TimeEntry).filter(
            TimeEntry.tenant_id == ts.tenant_id,
            TimeEntry.user_id == ts.user_id,
            TimeEntry.started_at >= ts.period_start,
            TimeEntry.started_at < ts.period_end,
            TimeEntry.approval_status == ApprovalStatus.pending,
        ).update({
            "approval_status": ApprovalStatus.approved,
            "approver_id": ctx.user.id,
            "approved_at": datetime.now(timezone.utc),
        }, synchronize_session=False)

    db.commit()
    publish_to_user(ts.tenant_id, ts.user_id, "timesheet.decided", {
        "timesheet_id": ts.id, "status": ts.status.value,
    })
    return _ts_out(ts)


# =============================================================================
# Helpers
# =============================================================================


def _to_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)
