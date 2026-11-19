"""Данные: основной исполнитель задачи (tasks.assignee_id) всегда среди task_assignees

Часть путей (PATCH/bulk, автоматизации, импорт, повторяющиеся задачи) писала
только assignee_id — список задач показывал исполнителя, а карточка «Не назначено».
Код теперь держит инвариант сам; эта миграция чинит уже накопленные строки.
Схема не меняется.

Revision ID: 0054_task_assignees_sync
Revises: 0053_security_audit
Create Date: 2026-11-19
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0054_task_assignees_sync"
down_revision: Union[str, None] = "0053_security_audit"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO task_assignees (task_id, user_id)
        SELECT t.id, t.assignee_id
        FROM tasks t
        WHERE t.assignee_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM task_assignees ta
              WHERE ta.task_id = t.id AND ta.user_id = t.assignee_id
          )
        """
    )


def downgrade() -> None:
    # Данные не откатываем: добавленные строки корректны.
    pass
