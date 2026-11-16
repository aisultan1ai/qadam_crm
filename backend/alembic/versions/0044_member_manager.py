"""Руководитель сотрудника — свой в каждой компании (tenant_members.manager_id)

Как и отдел (0043): users.manager_id был одним полем на все компании человека.

Revision ID: 0044_member_manager
Revises: 0043_member_department
Create Date: 2026-11-16
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0044_member_manager"
down_revision: Union[str, None] = "0043_member_department"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tenant_members",
        sa.Column("manager_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_tenant_members_tenant_manager", "tenant_members", ["tenant_id", "manager_id"])
    # Переносим, только если руководитель состоит в той же компании.
    op.execute(
        """
        UPDATE tenant_members m
        SET manager_id = u.manager_id
        FROM users u, tenant_members mm
        WHERE u.id = m.user_id AND u.manager_id IS NOT NULL
          AND mm.user_id = u.manager_id AND mm.tenant_id = m.tenant_id
        """
    )


def downgrade() -> None:
    op.drop_index("ix_tenant_members_tenant_manager", table_name="tenant_members")
    op.drop_column("tenant_members", "manager_id")
