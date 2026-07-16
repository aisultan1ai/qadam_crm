"""Плановые задания (workflow rules).

Запускается вместе с приложением. Хранит блокировку в Redis, чтобы при
нескольких воркерах uvicorn задача выполнялась ровно один раз.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import and_

from ..database import SessionLocal
from ..models import Task, Notification
from ..models.task import TaskStatus
from .redis_client import get_redis
from .ws_hub import publish_to_user

log = logging.getLogger("qadam.scheduler")

LOCK_PREFIX = "job:lock:"

scheduler = BackgroundScheduler(timezone="UTC")


def _acquire_lock(key: str, ttl_seconds: int) -> bool:
    try:
        return bool(get_redis().set(LOCK_PREFIX + key, "1", ex=ttl_seconds, nx=True))
    except Exception:
        # если Redis недоступен — считаем что мы единственный worker, даём выполниться
        log.warning("Redis lock unavailable for %s, running anyway", key)
        return True


def _now() -> datetime:
    return datetime.now(timezone.utc)


REMINDER_KIND = "deadline"


def check_deadlines() -> None:
    """Раз в час: находит задачи с дедлайном <=24ч (не done/cancelled) и создаёт напоминание.

    Не спамит: если уже есть непрочитанное напоминание того же типа для той же задачи,
    новое не создаётся.
    """
    if not _acquire_lock("check_deadlines", ttl_seconds=55 * 60):
        return

    now = _now()
    horizon = now + timedelta(hours=24)

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

        created = 0
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
                user_id=t.assignee_id,
                kind=REMINDER_KIND,
                title=f"Дедлайн приближается: {t.title}",
                body=body,
                task_id=t.id,
            ))
            created += 1

        if created:
            db.commit()
            # разошлём push для всех получателей
            for t in tasks:
                if t.assignee_id:
                    publish_to_user(t.assignee_id, "notification.new", {"task_id": t.id, "kind": REMINDER_KIND})
            log.info("deadline reminders created: %d", created)


def start_scheduler() -> None:
    if scheduler.running:
        return
    scheduler.add_job(check_deadlines, "interval", minutes=15, id="check_deadlines", replace_existing=True, max_instances=1)
    scheduler.start()
    log.info("scheduler started")


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
