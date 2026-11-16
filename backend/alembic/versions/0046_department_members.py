"""Сотрудник может состоять в нескольких отделах (department_members)

tenant_members.department_id остаётся «основным отделом» (оргструктура, подписи).
Полный список отделов человека — в department_members; видимость «задачи моего отдела»
считается по всем его отделам.

Revision ID: 0046_department_members
Revises: 0045_member_position
Create Date: 2026-11-18
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0046_department_members"
down_revision: Union[str, None] = "0045_member_position"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "department_members",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("department_id", "user_id", name="uq_department_members_dep_user"),
    )
    op.create_index("ix_department_members_tenant_user", "department_members", ["tenant_id", "user_id"])
    op.create_index("ix_department_members_department_id", "department_members", ["department_id"])
    # Текущий (единственный) отдел каждого сотрудника становится первой записью.
    op.execute(
        """
        INSERT INTO department_members (tenant_id, department_id, user_id)
        SELECT m.tenant_id, m.department_id, m.user_id
        FROM tenant_members m
        JOIN departments d ON d.id = m.department_id AND d.tenant_id = m.tenant_id
        WHERE m.department_id IS NOT NULL
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_index("ix_department_members_department_id", table_name="department_members")
    op.drop_index("ix_department_members_tenant_user", table_name="department_members")
    op.drop_table("department_members")
