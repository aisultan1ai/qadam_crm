"""2FA по сотруднику, IP в журнале действий, журнал просмотров записей

Revision ID: 0053_security_audit
Revises: 0052_counterparties
Create Date: 2026-11-19
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0053_security_audit"
down_revision: Union[str, None] = "0052_counterparties"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tenant_members",
        sa.Column("require_2fa", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.add_column("activity_logs", sa.Column("ip", sa.String(64), nullable=True))
    op.add_column("activity_logs", sa.Column("user_agent", sa.String(300), nullable=True))

    op.create_table(
        "record_views",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("entity_type", sa.String(50), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("ip", sa.String(64), nullable=True),
        sa.Column("user_agent", sa.String(300), nullable=True),
        sa.Column("viewed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_record_views_entity", "record_views", ["tenant_id", "entity_type", "entity_id", "viewed_at"],
    )
    op.create_index(
        "ix_record_views_user_entity", "record_views", ["user_id", "entity_type", "entity_id", "viewed_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_record_views_user_entity", table_name="record_views")
    op.drop_index("ix_record_views_entity", table_name="record_views")
    op.drop_table("record_views")
    op.drop_column("activity_logs", "user_agent")
    op.drop_column("activity_logs", "ip")
    op.drop_column("tenant_members", "require_2fa")
