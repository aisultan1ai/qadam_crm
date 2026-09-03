"""Celery application для фоновых задач.

Брокер и result backend — общий Redis (DB 1, чтобы не смешивать с rate-limit/blacklist в DB 0).
Воркер запускается отдельным контейнером `celery_worker` из docker-compose.
Периодические задачи планирует контейнер `celery_beat` (см. `beat_schedule`).
"""
from celery import Celery
from celery.schedules import crontab

from ..config import settings


def _broker_url() -> str:
    """Redis URL с отдельной БД для Celery (перебиваем /0 → /1)."""
    base = settings.REDIS_URL.rstrip("/")
    if base.endswith("/0"):
        return base[:-2] + "/1"
    return base + "/1"


celery_app = Celery(
    "qadam",
    broker=_broker_url(),
    backend=_broker_url(),
    include=[
        "app.tasks.email",
        "app.tasks.reports",
        "app.tasks.imports",
        "app.tasks.leads_import",
        "app.tasks.scheduled",
        "app.tasks.automation",
        "app.tasks.messenger",
        "app.tasks.mail",
        "app.tasks.calendar",
        "app.tasks.time_tracking",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=600,
    task_soft_time_limit=540,
    worker_max_tasks_per_child=200,
    broker_connection_retry_on_startup=True,
)

celery_app.conf.beat_schedule = {
    "check-deadlines-every-15min": {
        "task": "scheduled.check_deadlines",
        "schedule": crontab(minute="*/15"),
    },
    "cleanup-old-notifications-daily": {
        "task": "scheduled.cleanup_old_notifications",
        "schedule": crontab(hour=3, minute=0),
        "kwargs": {"days": 30},
    },
    "check-expired-subscriptions-hourly": {
        "task": "scheduled.check_expired_subscriptions",
        "schedule": crontab(minute=0),
    },
    "messenger-offline-digest-every-5min": {
        "task": "scheduled.messenger_offline_digest",
        "schedule": crontab(minute="*/5"),
    },
    "mail-sync-all-every-2min": {
        "task": "mail.sync_all",
        "schedule": crontab(minute="*/2"),
    },
    "calendar-check-reminders-every-1min": {
        "task": "calendar.check_reminders",
        "schedule": crontab(minute="*"),
    },
    "calendar-sync-google-every-15min": {
        "task": "calendar.sync_google_all",
        "schedule": crontab(minute="*/15"),
    },
    "time-tracking-auto-stop-idle-every-1min": {
        "task": "time_tracking.auto_stop_idle",
        "schedule": crontab(minute="*"),
    },
}

# Делаем этот app дефолтным, чтобы shared_task резолвился на него
# и .delay() из web-процесса не пытался стучаться в RabbitMQ.
celery_app.set_default()
