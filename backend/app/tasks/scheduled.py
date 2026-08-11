"""Периодические задачи (Celery Beat).

Заменяют старый APScheduler. Каждая задача идемпотентна:
рассчитывать так, чтобы повторный запуск не создавал дубликатов.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_

from ..core.celery_app import celery_app
from ..core.ws_hub import publish_to_user
from ..database import SessionLocal
from ..models import Notification, Subscription, SubscriptionStatus, Task, Tenant
from ..models.task import TaskStatus

log = logging.getLogger("qadam.scheduled")

REMINDER_KIND = "deadline"


def _now() -> datetime:
    return datetime.now(timezone.utc)


@celery_app.task(name="scheduled.check_deadlines")
def check_deadlines() -> dict:
    """Создать напоминание для задач с дедлайном ≤24ч без активного напоминания."""
    now = _now()
    horizon = now + timedelta(hours=24)
    created = 0

    with SessionLocal() as db:
        tasks = db.query(Task).filter(
            and_(
                Task.deadline.is_not(None),
                Task.deadline > now,
                Task.deadline <= horizon,
                Task.status.notin_([TaskStatus.done, TaskStatus.cancelled]),
                Task.assignee_id.is_not(None),
            )
        ).all()

        for t in tasks:
            existing = db.query(Notification).filter(
                Notification.user_id == t.assignee_id,
                Notification.task_id == t.id,
                Notification.kind == REMINDER_KIND,
                Notification.is_read == False,  # noqa: E712
            ).first()
            if existing:
                continue

            hours_left = int((t.deadline - now).total_seconds() // 3600)
            body = f"Дедлайн через {hours_left} ч" if hours_left > 0 else "Дедлайн скоро"
            db.add(Notification(
                tenant_id=t.tenant_id,
                user_id=t.assignee_id,
                kind=REMINDER_KIND,
                title=f"Дедлайн приближается: {t.title}",
                body=body,
                task_id=t.id,
            ))
            created += 1

        if created:
            db.commit()
            for t in tasks:
                if t.assignee_id:
                    publish_to_user(t.tenant_id, t.assignee_id, "notification.new", {"task_id": t.id, "kind": REMINDER_KIND})

    log.info("check_deadlines: created=%d", created)
    return {"created": created}


@celery_app.task(name="scheduled.cleanup_old_notifications")
def cleanup_old_notifications(days: int = 30) -> dict:
    """Удаляет прочитанные уведомления старше `days` дней (per-tenant, все сразу)."""
    cutoff = _now() - timedelta(days=days)
    with SessionLocal() as db:
        deleted = (
            db.query(Notification)
            .filter(Notification.is_read == True, Notification.created_at < cutoff)  # noqa: E712
            .delete(synchronize_session=False)
        )
        db.commit()
    log.info("cleanup_old_notifications: deleted=%d", deleted)
    return {"deleted": deleted}


@celery_app.task(name="scheduled.check_expired_subscriptions")
def check_expired_subscriptions() -> dict:
    """Downgrade tenant.plan=free при истечении активной подписки."""
    now = _now()
    processed = 0
    with SessionLocal() as db:
        expired = (
            db.query(Subscription)
            .filter(
                Subscription.status == SubscriptionStatus.active,
                Subscription.current_period_end.is_not(None),
                Subscription.current_period_end < now,
            )
            .all()
        )
        for sub in expired:
            sub.status = SubscriptionStatus.past_due
            # Downgrade tenant.plan сразу — избегаем «висячих» pro-фич.
            tenant = db.get(Tenant, sub.tenant_id)
            if tenant and tenant.plan != "free":
                tenant.plan = "free"
                sub.plan = "free"
            processed += 1
        if processed:
            db.commit()
    log.info("check_expired_subscriptions: processed=%d", processed)
    return {"processed": processed}
