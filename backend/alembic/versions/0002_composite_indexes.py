"""composite indexes for hot queries

Revision ID: 0002_composite_indexes
Revises: 0001_baseline
Create Date: 2026-07-16
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0002_composite_indexes"
down_revision: Union[str, None] = "0001_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


INDEXES = [
    ("ix_tasks_project_status", "tasks", ["project_id", "status"]),
    ("ix_tasks_assignee_status", "tasks", ["assignee_id", "status"]),
    ("ix_tasks_project_order", "tasks", ["project_id", "order_index"]),
    ("ix_tasks_deadline", "tasks", ["deadline"]),
    ("ix_comments_task_created", "comments", ["task_id", "created_at"]),
    ("ix_notifications_user_read_created", "notifications", ["user_id", "is_read", "created_at"]),
    ("ix_activity_task_created", "activity_logs", ["task_id", "created_at"]),
    ("ix_activity_user_created", "activity_logs", ["user_id", "created_at"]),
]


def upgrade() -> None:
    for name, table, cols in INDEXES:
        op.create_index(name, table, cols, if_not_exists=True)


def downgrade() -> None:
    for name, table, _cols in INDEXES:
        op.drop_index(name, table_name=table, if_exists=True)
