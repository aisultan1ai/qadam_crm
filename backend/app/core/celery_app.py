"""Celery application для фоновых задач.

Брокер и result backend — общий Redis (DB 1, чтобы не смешивать с rate-limit/blacklist в DB 0).
Воркер запускается отдельным контейнером `celery_worker` из docker-compose.
"""
from celery import Celery

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
    include=["app.tasks.email", "app.tasks.reports", "app.tasks.imports"],
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

# Делаем этот app дефолтным, чтобы shared_task резолвился на него
# и .delay() из web-процесса не пытался стучаться в RabbitMQ.
celery_app.set_default()
