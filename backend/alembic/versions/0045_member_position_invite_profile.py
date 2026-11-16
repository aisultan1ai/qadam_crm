"""Должность — своя в каждой компании; приглашение сразу с отделом и должностью

Как отдел (0043) и руководитель (0044): users.position был одним полем на все компании
человека. Переносим в членство. Должность и отдел задаёт компания, а не сам сотрудник.

Revision ID: 0045_member_position_invite_profile
Revises: 0044_member_manager
Create Date: 2026-11-18
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0045_member_position_invite_profile"
down_revision: Union[str, None] = "0044_member_manager"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tenant_members", sa.Column("position", sa.String(150), nullable=True))
    op.execute(
        """
        UPDATE tenant_members m
        SET position = u.position
        FROM users u
        WHERE u.id = m.user_id AND u.position IS NOT NULL
        """
    )
    op.add_column(
        "invitations",
        sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column("invitations", sa.Column("position", sa.String(150), nullable=True))


def downgrade() -> None:
    op.drop_column("invitations", "position")
    op.drop_column("invitations", "department_id")
    op.drop_column("tenant_members", "position")
