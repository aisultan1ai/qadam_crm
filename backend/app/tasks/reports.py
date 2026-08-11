"""Задачи генерации отчётов и экспортов (Excel).

Каждый экспорт сохраняется в EXPORT_DIR/{tenant_id}/{uuid}.xlsx.
Статус задачи и путь к файлу отдаются через Celery AsyncResult.
"""
from __future__ import annotations

import uuid
from pathlib import Path
from typing import Optional

from openpyxl import Workbook
from sqlalchemy import select

from ..config import settings
from ..database import SessionLocal
from ..models import Task, User
from ..models.task import TaskStatus, TaskPriority
from ..core.celery_app import celery_app


STATUS_RU = {
    TaskStatus.new: "Новая",
    TaskStatus.in_progress: "В работе",
    TaskStatus.review: "На проверке",
    TaskStatus.done: "Выполнена",
    TaskStatus.cancelled: "Отменена",
}
PRIORITY_RU = {
    TaskPriority.low: "Низкий",
    TaskPriority.medium: "Средний",
    TaskPriority.high: "Высокий",
    TaskPriority.critical: "Критический",
}


def _tenant_dir(tenant_id: int) -> Path:
    root = Path(settings.EXPORT_DIR) / str(tenant_id)
    root.mkdir(parents=True, exist_ok=True)
    return root


@celery_app.task(name="reports.export_tasks_excel", bind=True)
def export_tasks_excel(
    self,
    tenant_id: int,
    status: Optional[str] = None,
    project_id: Optional[int] = None,
    assignee_id: Optional[int] = None,
) -> dict:
    with SessionLocal() as db:
        q = select(Task).where(Task.tenant_id == tenant_id)
        if status:
            q = q.where(Task.status == TaskStatus(status))
        if project_id:
            q = q.where(Task.project_id == project_id)
        if assignee_id:
            q = q.where(Task.assignee_id == assignee_id)
        q = q.order_by(Task.created_at.desc())

        tasks = list(db.execute(q).scalars())
        users = {u.id: u for u in db.query(User).all()}

    wb = Workbook()
    ws = wb.active
    ws.title = "Задачи"
    ws.append([
        "ID", "Название", "Статус", "Приоритет", "Проект",
        "Исполнитель", "Автор", "Дедлайн", "Создана", "Обновлена",
    ])
    for t in tasks:
        assignee = users.get(t.assignee_id).name if t.assignee_id and users.get(t.assignee_id) else ""
        author = users.get(t.author_id).name if t.author_id and users.get(t.author_id) else ""
        ws.append([
            t.id,
            t.title,
            STATUS_RU.get(t.status, str(t.status)),
            PRIORITY_RU.get(t.priority, str(t.priority)),
            t.project_id or "",
            assignee,
            author,
            t.deadline.isoformat() if t.deadline else "",
            t.created_at.isoformat() if t.created_at else "",
            t.updated_at.isoformat() if t.updated_at else "",
        ])

    for col_letter, width in [("A", 6), ("B", 40), ("C", 14), ("D", 14), ("E", 8),
                              ("F", 20), ("G", 20), ("H", 20), ("I", 20), ("J", 20)]:
        ws.column_dimensions[col_letter].width = width

    file_id = uuid.uuid4().hex
    filename = f"tasks_{file_id}.xlsx"
    path = _tenant_dir(tenant_id) / filename
    wb.save(str(path))

    return {
        "tenant_id": tenant_id,
        "filename": filename,
        "path": str(path),
        "rows": len(tasks),
    }
