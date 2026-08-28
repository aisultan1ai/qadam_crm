"""Manager availability + lead form assignee strategy

Revision ID: 0015_manager_availability
Revises: 0014_automations
Create Date: 2026-08-27
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0015_manager_availability"
down_revision: Union[str, None] = "0014_automations"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "lead_forms",
        sa.Column(
            "assignee_strategy",
            sa.String(length=20),
            nullable=False,
            server_default="manual",
        ),
    )
    op.add_column(
        "lead_forms",
        sa.Column(
            "default_assignee_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    op.create_table(
        "manager_availability",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "tenant_id", sa.Integer(),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "user_id", sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("timezone", sa.String(length=64), nullable=False, server_default="Asia/Almaty"),
        sa.Column("working_hours", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("weekly_quota", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_available", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("vacation_from", sa.Date(), nullable=True),
        sa.Column("vacation_until", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "user_id", name="uq_manager_availability_tenant_user"),
    )
    op.create_index("ix_manager_availability_tenant_id", "manager_availability", ["tenant_id"])
    op.create_index("ix_manager_availability_user_id", "manager_availability", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_manager_availability_user_id", table_name="manager_availability")
    op.drop_index("ix_manager_availability_tenant_id", table_name="manager_availability")
    op.drop_table("manager_availability")
    op.drop_column("lead_forms", "default_assignee_id")
    op.drop_column("lead_forms", "assignee_strategy")
