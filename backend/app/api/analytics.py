from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, case
from datetime import datetime, timedelta, timezone

from ..database import get_db
from ..models import Task, User, ActivityLog, TenantMembership, TenantLead
from ..models.task import TaskStatus
from ..core.cache import make_key, get_or_set_json
from ..core.permissions import user_has
from .deps import TenantContext, require, get_current_context

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

CACHE_TTL_SECONDS = 300


@router.get("/dashboard")
def dashboard(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    tenant_id = ctx.tenant.id
    # Scope: юзер с tasks.view_own видит только свою статистику. Иначе агрегаты
    # раскрывают чужую производительность даже без прямого доступа к задачам.
    view_all = user_has(ctx.user, ["tasks.view_all"])
    scope_uid = None if view_all else ctx.user.id
    key = make_key(tenant_id, "dashboard", "all" if view_all else f"u{scope_uid}")

    def _base_task_query():
        q = db.query(func.count(Task.id)).filter(Task.tenant_id == tenant_id)
        if scope_uid is not None:
            q = q.filter(Task.assignee_id == scope_uid)
        return q

    def _compute():
        now = datetime.now(timezone.utc)
        total = _base_task_query().scalar() or 0
        in_progress = (
            _base_task_query().filter(Task.status == TaskStatus.in_progress).scalar() or 0
        )
        done = _base_task_query().filter(Task.status == TaskStatus.done).scalar() or 0
        overdue = (
            _base_task_query()
            .filter(
                Task.deadline.is_not(None),
                Task.deadline < now,
                Task.status.notin_([TaskStatus.done, TaskStatus.cancelled]),
            )
            .scalar()
            or 0
        )

        by_status_q = (
            db.query(Task.status, func.count(Task.id))
            .filter(Task.tenant_id == tenant_id)
            .group_by(Task.status)
        )
        if scope_uid is not None:
            by_status_q = by_status_q.filter(Task.assignee_id == scope_uid)
        by_status_rows = by_status_q.all()
        by_status = {s.value: c for s, c in by_status_rows}

        recent_q = db.query(ActivityLog).filter(ActivityLog.tenant_id == tenant_id)
        if scope_uid is not None:
            recent_q = recent_q.filter(ActivityLog.user_id == scope_uid)
        recent = recent_q.order_by(ActivityLog.created_at.desc()).limit(15).all()
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
    # Scope: если у юзера нет tasks.view_all — показываем только его собственную
    # статистику. Иначе аналитика могла бы утечь чужую производительность.
    view_all = user_has(ctx.user, ["tasks.view_all"])
    scope_uid = None if view_all else ctx.user.id
    key = make_key(tenant_id, "employees", "all" if view_all else f"u{scope_uid}")

    def _compute():
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=30)
        q = (
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
        )
        if scope_uid is not None:
            q = q.filter(User.id == scope_uid)
        rows = q.all()

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


@router.get("/leads")
def leads_by_manager(ctx: TenantContext = Depends(require("analytics.reports")), db: Session = Depends(get_db)):
    """Метрики по лидам в разрезе менеджеров за последние 30 дней.

    Для каждого сотрудника tenant'а показываем сколько лидов на нём висит и
    сколько по каким статусам. Конверсия = converted / total.

    Лиды без assignee_id учитываются отдельной «виртуальной» записью
    user_id=None, name='Не назначен' — чтобы owner видел объём неразобранного.
    """
    tenant_id = ctx.tenant.id
    view_all = user_has(ctx.user, ["tasks.view_all"])
    scope_uid = None if view_all else ctx.user.id
    key = make_key(tenant_id, "leads_by_manager", "all" if view_all else f"u{scope_uid}")

    def _compute():
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=30)

        base = db.query(TenantLead).filter(
            TenantLead.tenant_id == tenant_id,
            TenantLead.created_at >= since,
        )
        if scope_uid is not None:
            base = base.filter(TenantLead.assignee_id == scope_uid)

        # Все члены tenant'а — чтобы вывести даже тех, у кого 0 лидов.
        members = (
            db.query(User.id, User.name, User.email)
            .join(TenantMembership, TenantMembership.user_id == User.id)
            .filter(TenantMembership.tenant_id == tenant_id)
        )
        if scope_uid is not None:
            members = members.filter(User.id == scope_uid)
        members_rows = members.all()

        # Aggregate: assignee_id → {status → count}
        rows = (
            base.with_entities(
                TenantLead.assignee_id,
                TenantLead.status,
                func.count(TenantLead.id).label("cnt"),
            )
            .group_by(TenantLead.assignee_id, TenantLead.status)
            .all()
        )
        by_user: dict[int | None, dict[str, int]] = {}
        for assignee_id, status_, cnt in rows:
            bucket = by_user.setdefault(assignee_id, {})
            bucket[status_] = int(cnt)

        def _pack(user_id, name, email):
            b = by_user.get(user_id, {})
            new_ = int(b.get("new", 0))
            contacted = int(b.get("contacted", 0))
            qualified = int(b.get("qualified", 0))
            converted = int(b.get("converted", 0))
            rejected = int(b.get("rejected", 0))
            total = new_ + contacted + qualified + converted + rejected
            # «Работали с»: любой шаг после new — уже касание.
            worked = contacted + qualified + converted + rejected
            conversion = round((converted / total) * 100) if total else 0
            return {
                "user_id": user_id,
                "name": name,
                "email": email,
                "total": total,
                "new": new_,
                "contacted": contacted,
                "qualified": qualified,
                "converted": converted,
                "rejected": rejected,
                "worked": worked,
                "conversion": conversion,
            }

        result = [_pack(u.id, u.name, u.email) for u in members_rows]

        # «Неразобранные» лиды (assignee_id is null) — только для view_all,
        # т.к. в scope=own их всё равно не будет.
        if scope_uid is None and by_user.get(None):
            result.append(_pack(None, "Не назначен", None))

        # Общий summary для карточек-KPI сверху.
        totals = {
            "total": sum(r["total"] for r in result),
            "new": sum(r["new"] for r in result),
            "contacted": sum(r["contacted"] for r in result),
            "qualified": sum(r["qualified"] for r in result),
            "converted": sum(r["converted"] for r in result),
            "rejected": sum(r["rejected"] for r in result),
        }
        totals["conversion"] = (
            round((totals["converted"] / totals["total"]) * 100) if totals["total"] else 0
        )
        return {"since": since.isoformat(), "totals": totals, "managers": result}

    return get_or_set_json(key, CACHE_TTL_SECONDS, _compute)
