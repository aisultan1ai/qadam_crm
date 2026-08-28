"""Celery-задачи для мессенджеров."""
from __future__ import annotations

import logging

from ..core.celery_app import celery_app
from ..services.messenger_service import ingest_payload

log = logging.getLogger("qadam.messenger.tasks")


@celery_app.task(name="messenger.ingest", bind=True, max_retries=3, default_retry_delay=15)
def ingest(self, *, channel_id: int, payload: dict) -> dict:
    try:
        return ingest_payload(channel_id, payload)
    except Exception as exc:
        log.exception("messenger.ingest failed: channel=%s", channel_id)
        raise self.retry(exc=exc)
