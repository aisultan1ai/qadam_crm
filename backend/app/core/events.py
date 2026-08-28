"""Event bus для системы автоматизаций.

События генерируются в API-хендлерах после commit и передаются в Celery для
асинхронной обработки — чтобы HTTP-запрос не блокировался пока автоматизация
исполняется. Поэтому fire_event ничего не делает синхронно, только шлёт
Celery-задачу `automation.dispatch`, которая уже подхватит все активные
Automation с matching trigger_event.

События:
- task.created, task.updated, task.status_changed, task.completed, task.deadline_near
- lead.created, lead.status_changed
- comment.added
- project.created
- form.submitted (публичная форма лида)

Payload — dict с сериализованными данными (id + ключевые поля). Полные объекты
не передаём, чтобы избежать проблем с сериализацией и утечек данных.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

log = logging.getLogger("qadam.events")


# Список известных событий. Только они разрешены для fire_event — чтобы
# опечатки в event_type не проваливались молча.
KNOWN_EVENTS: set[str] = {
    "task.created",
    "task.updated",
    "task.status_changed",
    "task.completed",
    "task.deadline_near",
    "lead.created",
    "lead.status_changed",
    "comment.added",
    "project.created",
    "form.submitted",
    "messenger.message_received",
    "messenger.message_sent",
    "mail.message_received",
    "mail.message_sent",
    "calendar.event_created",
    "calendar.event_updated",
    "calendar.event_starting_soon",
}


def fire_event(event_type: str, tenant_id: int, payload: dict[str, Any]) -> None:
    """Публикует событие в очередь автоматизаций.

    Вызывать ТОЛЬКО после `db.commit()` — иначе автоматизация может прочитать
    ещё несуществующую запись, если Celery-worker подхватит задачу быстрее чем
    транзакция закроется.

    Молча свернётся если Celery недоступен (например в тестах) — событие
    просто не будет доставлено, HTTP-обработчик не упадёт.
    """
    if event_type not in KNOWN_EVENTS:
        log.warning("fire_event: unknown event_type=%r (пропущено)", event_type)
        return
    try:
        # Локальный импорт: Celery-app подтягивает БД/Redis, а events.py импортируется
        # из моделей — чтобы не устраивать циклы.
        from .celery_app import celery_app
        celery_app.send_task(
            "automation.dispatch",
            kwargs={
                "event_type": event_type,
                "tenant_id": tenant_id,
                "payload": payload,
            },
        )
    except Exception:
        log.exception("fire_event failed: event=%s tenant=%d", event_type, tenant_id)


def serialize_task(task) -> dict[str, Any]:
    """Компактный snapshot задачи для payload события."""
    return {
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "status": task.status.value if hasattr(task.status, "value") else task.status,
        "priority": task.priority.value if hasattr(task.priority, "value") else task.priority,
        "project_id": task.project_id,
        "assignee_id": task.assignee_id,
        "author_id": task.author_id,
        "deadline": task.deadline.isoformat() if task.deadline else None,
    }


def serialize_lead(lead) -> dict[str, Any]:
    return {
        "id": lead.id,
        "name": lead.name,
        "company": lead.company,
        "contact": lead.contact,
        "status": lead.status,
        "source": lead.source,
        "note": lead.note,
    }


def serialize_tenant_lead(lead) -> dict[str, Any]:
    """Для TenantLead (из формы захвата), поля отличаются от Lead."""
    return {
        "id": lead.id,
        "name": lead.name,
        "email": getattr(lead, "email", None),
        "phone": getattr(lead, "phone", None),
        "status": lead.status,
        "source": getattr(lead, "source", None),
        "form_id": getattr(lead, "form_id", None),
        "assignee_id": getattr(lead, "assignee_id", None),
        "fields": getattr(lead, "fields", None),
    }


def serialize_comment(comment) -> dict[str, Any]:
    return {
        "id": comment.id,
        "task_id": comment.task_id,
        "author_id": comment.author_id,
        "body": comment.body,
    }


def serialize_project(project) -> dict[str, Any]:
    return {
        "id": project.id,
        "name": project.name,
        "description": getattr(project, "description", None),
        "color": getattr(project, "color", None),
    }


def build_change_payload(
    entity: dict[str, Any],
    changes: Optional[dict[str, tuple[Any, Any]]] = None,
) -> dict[str, Any]:
    """Формат для *.updated и *.status_changed событий: {entity, changes}.

    changes = {"field": [old, new], ...}
    """
    return {
        "entity": entity,
        "changes": {k: {"old": v[0], "new": v[1]} for k, v in (changes or {}).items()},
    }
