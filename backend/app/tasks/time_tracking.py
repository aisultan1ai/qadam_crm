"""Celery-задачи тайм-трекинга: автопауза покинутых таймеров."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from ..core.celery_app import celery_app
from ..core.ws_hub import publish_to_user
from ..database import SessionLocal
from ..models import TimeEntry, Timer

log = logging.getLogger("qadam.time_tracking.tasks")

IDLE_TIMEOUT_MINUTES = 5


@celery_app.task(name="time_tracking.auto_stop_idle")
def auto_stop_idle_timers() -> dict:
    """Найти таймеры без heartbeat >5 мин, закрыть → создать TimeEntry."""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=IDLE_TIMEOUT_MINUTES)
    stopped = 0

    with SessionLocal() as db:
        idle = db.query(Timer).filter(Timer.last_heartbeat_at < cutoff).all()
        for t in idle:
            # Секунды считаем от started_at до last_heartbeat (не до now — юзер уже неактивен)
            seconds = max(0, int((t.last_heartbeat_at - t.started_at).total_seconds()))
            if seconds > 0:
                db.add(TimeEntry(
                    tenant_id=t.tenant_id,
                    user_id=t.user_id,
                    task_id=t.task_id,
                    description=t.description,
                    started_at=t.started_at,
                    ended_at=t.last_heartbeat_at,
                    seconds=seconds,
                ))
            db.delete(t)
            publish_to_user(t.tenant_id, t.user_id, "timer.auto_stopped", {
                "task_id": t.task_id, "seconds": seconds,
            })
            stopped += 1
        db.commit()

    log.info("time_tracking.auto_stop_idle: stopped=%d", stopped)
    return {"stopped": stopped}
