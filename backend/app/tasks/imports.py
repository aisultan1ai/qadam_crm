"""Задача импорта задач из CSV.

Формат CSV (заголовки — обязательны): title, description, status, priority, project_id, assignee_email, deadline
Обязательные поля: title.
Прогресс пишем в Redis (`import:{job_id}:progress` = "processed/total").
Ошибки — в meta задачи.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Optional

from ..database import SessionLocal
from ..models import Task, User, Project, TenantMembership
from ..models.task import TaskStatus, TaskPriority
from ..core.celery_app import celery_app
from ..core.redis_client import get_redis


VALID_STATUSES = {s.value for s in TaskStatus}
VALID_PRIORITIES = {p.value for p in TaskPriority}


def _parse_deadline(raw: str) -> Optional[datetime]:
    raw = (raw or "").strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


@celery_app.task(name="imports.import_tasks_csv", bind=True)
def import_tasks_csv(self, tenant_id: int, csv_text: str, user_id: int) -> dict:
    reader = csv.DictReader(io.StringIO(csv_text))
    rows = list(reader)
    total = len(rows)

    redis = get_redis()
    progress_key = f"import:{self.request.id}:progress"

    def set_progress(processed: int) -> None:
        try:
            redis.set(progress_key, f"{processed}/{total}", ex=3600)
        except Exception:
            pass

    set_progress(0)

    created = 0
    errors: list[dict] = []

    with SessionLocal() as db:
        member_emails = {
            u.email.lower(): u.id
            for u in db.query(User)
            .join(TenantMembership, TenantMembership.user_id == User.id)
            .filter(TenantMembership.tenant_id == tenant_id)
            .all()
        }
        tenant_project_ids = {
            p_id for (p_id,) in db.query(Project.id).filter(Project.tenant_id == tenant_id).all()
        }

        for i, row in enumerate(rows, start=1):
            try:
                title = (row.get("title") or "").strip()
                if not title:
                    raise ValueError("title обязателен")

                status_raw = (row.get("status") or "new").strip()
                if status_raw not in VALID_STATUSES:
                    raise ValueError(f"недопустимый status: {status_raw}")

                priority_raw = (row.get("priority") or "medium").strip()
                if priority_raw not in VALID_PRIORITIES:
                    raise ValueError(f"недопустимый priority: {priority_raw}")

                project_id_raw = (row.get("project_id") or "").strip()
                project_id = None
                if project_id_raw:
                    try:
                        project_id = int(project_id_raw)
                    except ValueError:
                        raise ValueError(f"project_id не число: {project_id_raw}")
                    if project_id not in tenant_project_ids:
                        raise ValueError(f"проект {project_id} не найден в компании")

                assignee_email = (row.get("assignee_email") or "").strip().lower()
                assignee_id = None
                if assignee_email:
                    assignee_id = member_emails.get(assignee_email)
                    if not assignee_id:
                        raise ValueError(f"пользователь {assignee_email} не в компании")

                task = Task(
                    tenant_id=tenant_id,
                    title=title,
                    description=(row.get("description") or "").strip() or None,
                    status=TaskStatus(status_raw),
                    priority=TaskPriority(priority_raw),
                    project_id=project_id,
                    assignee_id=assignee_id,
                    author_id=user_id,
                    deadline=_parse_deadline(row.get("deadline", "")),
                )
                db.add(task)
                created += 1
            except Exception as exc:
                errors.append({"row": i, "title": row.get("title", ""), "error": str(exc)})

            if i % 25 == 0:
                db.commit()
                set_progress(i)

        db.commit()
        set_progress(total)

    return {
        "tenant_id": tenant_id,
        "total": total,
        "created": created,
        "errors": errors[:200],
        "error_count": len(errors),
    }
