"""Planfix-style роли и напоминания в задачах

Добавляем множественных исполнителей, аудиторов и участников (many-to-many),
напоминания с offsets и дату начала. Legacy `assignee_id` в Task оставляем
как "primary assignee" для обратной совместимости.

- task_assignees:      исполнители (много). Могут менять статус.
- task_auditors:       аудиторы (read-only + получают уведомления, но не комментируют).
- task_participants:   участники (могут комментировать, получают уведомления о комментариях).
- task_reminders:      напоминания. offset_minutes от start/deadline.
- tasks.start_date:    дата начала задачи (для отображения периода).

Revision ID: 0033_task_roles_reminders
Revises: 0032_backup_codes
Create Date: 2026-09-23
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0033_task_roles_reminders"
down_revision: Union[str, None] = "0032_backup_codes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ---- tasks.start_date ---------------------------------------------------
    op.add_column(
        "tasks",
        sa.Column("start_date", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_tasks_start_date", "tasks", ["start_date"])

    # ---- task_assignees -----------------------------------------------------
    op.create_table(
        "task_assignees",
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("added_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_task_assignees_user", "task_assignees", ["user_id"])

    # Backfill: перенести legacy tasks.assignee_id в task_assignees.
    op.execute(
        """
        INSERT INTO task_assignees (task_id, user_id, added_at)
        SELECT id, assignee_id, COALESCE(created_at, now())
        FROM tasks
        WHERE assignee_id IS NOT NULL
        ON CONFLICT DO NOTHING
        """
    )

    # ---- task_auditors ------------------------------------------------------
    op.create_table(
        "task_auditors",
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("added_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_task_auditors_user", "task_auditors", ["user_id"])

    # ---- task_participants --------------------------------------------------
    op.create_table(
        "task_participants",
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("added_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_task_participants_user", "task_participants", ["user_id"])

    # ---- task_reminders -----------------------------------------------------
    # kind:
    #   before_deadline — offset_minutes до deadline
    #   before_start    — offset_minutes до start_date
    op.create_table(
        "task_reminders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("kind", sa.String(length=32), nullable=False, server_default="before_deadline"),
        sa.Column("offset_minutes", sa.Integer(), nullable=False),
        sa.Column("fired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_task_reminders_task", "task_reminders", ["task_id"])
    op.create_index(
        "ix_task_reminders_task_kind_offset",
        "task_reminders",
        ["task_id", "kind", "offset_minutes"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_task_reminders_task_kind_offset", table_name="task_reminders")
    op.drop_index("ix_task_reminders_task", table_name="task_reminders")
    op.drop_table("task_reminders")

    op.drop_index("ix_task_participants_user", table_name="task_participants")
    op.drop_table("task_participants")

    op.drop_index("ix_task_auditors_user", table_name="task_auditors")
    op.drop_table("task_auditors")

    op.drop_index("ix_task_assignees_user", table_name="task_assignees")
    op.drop_table("task_assignees")

    op.drop_index("ix_tasks_start_date", table_name="tasks")
    op.drop_column("tasks", "start_date")
