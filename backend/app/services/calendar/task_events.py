"""Виртуальные события из tasks.deadline — отдаются в /events без записи в БД.

Клик по такому событию на UI ведёт на /tasks/{id}, а не на event view.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Iterable

from sqlalchemy.orm import Session

from ...models import Task, User
from ...models.task import TaskStatus


def task_events_in_range(
    db: Session,
    tenant_id: int,
    range_start: datetime,
    range_end: datetime,
    user_ids: Iterable[int] | None = None,
) -> list[dict]:
    """Возвращает список dict-событий из задач с deadline в диапазоне."""
    q = (
        db.query(Task)
        .filter(
            Task.tenant_id == tenant_id,
            Task.deadline.is_not(None),
            Task.deadline >= range_start,
            Task.deadline < range_end,
            Task.status.notin_([TaskStatus.done, TaskStatus.cancelled]),
        )
    )
    if user_ids is not None:
        q = q.filter(Task.assignee_id.in_(list(user_ids)))
    rows = q.all()
    result = []
    for t in rows:
        # События рассматриваем как 30-минутные (deadline - 30мин ... deadline)
        end = t.deadline
        start = end - timedelta(minutes=30)
        result.append({
            "id": f"task-{t.id}",
            "kind": "task_deadline",
            "title": f"⏰ {t.title}",
            "start": start.isoformat(),
            "end": end.isoformat(),
            "all_day": False,
            "task_id": t.id,
            "task_status": t.status.value if hasattr(t.status, "value") else t.status,
            "assignee_id": t.assignee_id,
            "color": "#F59E0B",
            "url": f"/tasks/{t.id}",
        })
    return result
