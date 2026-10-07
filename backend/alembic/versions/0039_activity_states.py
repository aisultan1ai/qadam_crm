"""Лента событий: личные отметки «прочитано» и «лайк»

Revision ID: 0039_activity_states
Revises: 0038_goal_checkins
Create Date: 2026-10-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0039_activity_states"
down_revision: Union[str, None] = "0038_goal_checkins"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "activity_states",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("activity_id", sa.Integer(), sa.ForeignKey("activity_logs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("liked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("activity_id", "user_id", name="uq_activity_states_activity_user"),
    )
    op.create_index("ix_activity_states_activity_id", "activity_states", ["activity_id"])
    op.create_index("ix_activity_states_user", "activity_states", ["user_id", "is_read"])


def downgrade() -> None:
    op.drop_index("ix_activity_states_user", table_name="activity_states")
    op.drop_index("ix_activity_states_activity_id", table_name="activity_states")
    op.drop_table("activity_states")
