"""Запросы на перенос срока задачи

Revision ID: 0040_deadline_requests
Revises: 0039_activity_states
Create Date: 2026-10-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0040_deadline_requests"
down_revision: Union[str, None] = "0039_activity_states"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "deadline_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("requested_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("old_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("new_deadline", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.String(500), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("decided_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_note", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_deadline_requests_tenant_id", "deadline_requests", ["tenant_id"])
    op.create_index("ix_deadline_requests_requested_by_id", "deadline_requests", ["requested_by_id"])
    op.create_index("ix_deadline_requests_task_status", "deadline_requests", ["task_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_deadline_requests_task_status", table_name="deadline_requests")
    op.drop_index("ix_deadline_requests_requested_by_id", table_name="deadline_requests")
    op.drop_index("ix_deadline_requests_tenant_id", table_name="deadline_requests")
    op.drop_table("deadline_requests")
