"""Индексы на внешние ключи, по которым идут фильтры и каскадные удаления

Без них удаление пользователя/задачи и фильтры вроде «задачи, где я постановщик» читают таблицу целиком.

Revision ID: 0041_fk_indexes
Revises: 0040_deadline_requests
Create Date: 2026-10-08
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0041_fk_indexes"
down_revision: Union[str, None] = "0040_deadline_requests"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEXES = [
    ("tasks", "author_id"),
    ("comments", "author_id"),
    ("messages", "author_id"),
    ("notifications", "task_id"),
    ("projects", "owner_id"),
    ("users", "department_id"),
    ("timers", "task_id"),
    ("tenant_members", "role_id"),
    ("user_sessions", "tenant_id"),
    ("wiki_articles", "author_id"),
    ("attachments", "uploaded_by"),
    ("calendar_events", "creator_id"),
    ("tenant_leads", "converted_task_id"),
    ("bookings", "calendar_event_id"),
]


def upgrade() -> None:
    for table, col in INDEXES:
        op.execute(f"CREATE INDEX IF NOT EXISTS ix_{table}_{col} ON {table} ({col})")


def downgrade() -> None:
    for table, col in INDEXES:
        op.execute(f"DROP INDEX IF EXISTS ix_{table}_{col}")
