"""Избранное пользователя (проекты, задачи, статьи wiki) для сайдбара

Revision ID: 0034_user_favorites
Revises: 0033_task_roles_reminders
Create Date: 2026-09-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0034_user_favorites"
down_revision: Union[str, None] = "0033_task_roles_reminders"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_favorites",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entity", sa.String(20), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "user_id", "entity", "entity_id", name="uq_user_favorite"),
    )
    op.create_index("ix_user_favorites_owner", "user_favorites", ["tenant_id", "user_id", "order_index"])


def downgrade() -> None:
    op.drop_index("ix_user_favorites_owner", table_name="user_favorites")
    op.drop_table("user_favorites")
