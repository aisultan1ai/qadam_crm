from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, case
from datetime import datetime, timedelta, timezone

from ..database import get_db
from ..models import Task, User, ActivityLog, TenantMembership
from ..models.task import TaskStatus
from ..core.cache import make_key, get_or_set_json
from .deps import TenantContext, require, get_current_context

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

CACHE_TTL_SECONDS = 300


@router.get("/dashboard")
def dashboard(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    tenant_id = ctx.tenant.id
    key = make_key(tenant_id, "dashboard")

    def _compute():
        now = datetime.now(timezone.utc)
        total = db.query(func.count(Task.id)).filter(Task.tenant_id == tenant_id).scalar() or 0
        in_progress = (
            db.query(func.count(Task.id))
            .filter(Task.tenant_id == tenant_id, Task.status == TaskStatus.in_progress)
            .scalar() or 0
        )
        done = (
            db.query(func.count(Task.id))
            .filter(Task.tenant_id == tenant_id, Task.status == TaskStatus.done)
            .scalar() or 0
        )
        overdue = (
            db.query(func.count(Task.id))
            .filter(
                Task.tenant_id == tenant_id,
                Task.deadline.is_not(None),
                Task.deadline < now,
                Task.status.notin_([TaskStatus.done, TaskStatus.cancelled]),
            )
            .scalar() or 0
        )

        by_status_rows = (
            db.query(Task.status, func.count(Task.id))
            .filter(Task.tenant_id == tenant_id)
            .group_by(Task.status)
            .all()
        )
        by_status = {s.value: c for s, c in by_status_rows}

        recent = (
            db.query(ActivityLog)
            .filter(ActivityLog.tenant_id == tenant_id)
            .order_by(ActivityLog.created_at.desc())
            .limit(15)
            .all()
        )
        recent_out = [
            {
                "id": a.id,
                "action": a.action,
                "entity": a.entity,
                "entity_id": a.entity_id,
                "detail": a.detail,
                "task_id": a.task_id,
                "created_at": a.created_at.isoformat() if a.created_at else None,
                "user": {"id": a.user.id, "name": a.user.name, "email": a.user.email} if a.user else None,
            }
            for a in recent
        ]
        return {
            "total": total,
            "in_progress": in_progress,
            "done": done,
            "overdue": overdue,
            "by_status": by_status,
            "recent": recent_out,
        }

    return get_or_set_json(key, CACHE_TTL_SECONDS, _compute)


@router.get("/employees")
def employees(ctx: TenantContext = Depends(require("analytics.employees")), db: Session = Depends(get_db)):
    tenant_id = ctx.tenant.id
    key = make_key(tenant_id, "employees")

    def _compute():
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=30)
        rows = (
            db.query(
                User.id,
                User.name,
                User.email,
                func.count(Task.id).label("total"),
                func.sum(case((Task.status == TaskStatus.done, 1), else_=0)).label("done"),
                func.sum(case((
                    (Task.deadline.is_not(None)) & (Task.deadline < now) & (Task.status.notin_([TaskStatus.done, TaskStatus.cancelled])), 1), else_=0)).label("overdue"),
            )
            .join(TenantMembership, TenantMembership.user_id == User.id)
            .outerjoin(
                Task,
                (Task.assignee_id == User.id) & (Task.tenant_id == tenant_id),
            )
            .filter(TenantMembership.tenant_id == tenant_id)
            .group_by(User.id)
            .all()
        )

        result = []
        for r in rows:
            total = r.total or 0
            done = r.done or 0
            overdue = r.overdue or 0
            efficiency = round((done / total) * 100) if total else 0
            result.append({
                "user_id": r.id,
                "name": r.name,
                "email": r.email,
                "total": total,
                "done": done,
                "overdue": overdue,
                "efficiency": efficiency,
            })
        return {"since": since.isoformat(), "employees": result}

    return get_or_set_json(key, CACHE_TTL_SECONDS, _compute)
