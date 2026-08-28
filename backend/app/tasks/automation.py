"""Celery-задачи для системы автоматизаций.

- automation.dispatch: получает событие → находит подходящие Automation → запускает
- automation.execute_scheduled_action: срабатывает по ETA для delay-nodes,
  продолжает обход графа с этой точки
"""
from __future__ import annotations

import logging

from ..core.celery_app import celery_app
from ..services.automation_engine import continue_after_delay, dispatch_event

log = logging.getLogger("qadam.automation.tasks")


@celery_app.task(name="automation.dispatch", bind=True, max_retries=2, default_retry_delay=10)
def dispatch(self, *, event_type: str, tenant_id: int, payload: dict) -> dict:
    try:
        return dispatch_event(event_type, tenant_id, payload)
    except Exception as exc:
        log.exception("automation.dispatch failed: event=%s tenant=%s", event_type, tenant_id)
        raise self.retry(exc=exc)


@celery_app.task(name="automation.execute_scheduled_action", bind=True, max_retries=2, default_retry_delay=30)
def execute_scheduled_action(self, *, action_id: int) -> dict:
    try:
        continue_after_delay(action_id)
        return {"action_id": action_id, "ok": True}
    except Exception as exc:
        log.exception("automation.execute_scheduled_action failed: action=%s", action_id)
        raise self.retry(exc=exc)
