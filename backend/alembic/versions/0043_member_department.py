"""Отдел сотрудника — свой в каждой компании (tenant_members.department_id)

Раньше отдел хранился в users.department_id — одно поле на все компании человека:
вторая компания перезаписывала отдел в первой и видела чужое название отдела.
Переносим в членство; users.department_id больше не используется.

Revision ID: 0043_member_department
Revises: 0042_invitation_make_owner
Create Date: 2026-11-16
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0043_member_department"
down_revision: Union[str, None] = "0042_invitation_make_owner"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tenant_members",
        sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_tenant_members_tenant_department", "tenant_members", ["tenant_id", "department_id"])
    # Переносим только отдел той же компании (отдел чужой компании — не переносим).
    op.execute(
        """
        UPDATE tenant_members m
        SET department_id = u.department_id
        FROM users u, departments d
        WHERE u.id = m.user_id AND d.id = u.department_id AND d.tenant_id = m.tenant_id
        """
    )


def downgrade() -> None:
    op.drop_index("ix_tenant_members_tenant_department", table_name="tenant_members")
    op.drop_column("tenant_members", "department_id")
