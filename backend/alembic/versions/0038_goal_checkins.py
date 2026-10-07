"""Ежедневные цели: goals.kind + таблица отметок goal_checkins

Revision ID: 0038_goal_checkins
Revises: 0037_drop_project_deadline
Create Date: 2026-10-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0038_goal_checkins"
down_revision: Union[str, None] = "0037_drop_project_deadline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE goals ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'numeric'")
    op.create_table(
        "goal_checkins",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("goal_id", sa.Integer(), sa.ForeignKey("goals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("goal_id", "day", name="uq_goal_checkins_goal_day"),
    )
    op.create_index("ix_goal_checkins_goal_id", "goal_checkins", ["goal_id"])


def downgrade() -> None:
    op.drop_index("ix_goal_checkins_goal_id", table_name="goal_checkins")
    op.drop_table("goal_checkins")
    op.execute("ALTER TABLE goals DROP COLUMN IF EXISTS kind")
