"""Приглашение с ФИО и руководителем (массовый импорт сотрудников из Excel)

Revision ID: 0048_invitation_name_manager
Revises: 0047_quick_wins
Create Date: 2026-11-17
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0048_invitation_name_manager"
down_revision: Union[str, None] = "0047_quick_wins"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("invitations", sa.Column("full_name", sa.String(200), nullable=True))
    # Email руководителя: он может ещё не принять своё приглашение — свяжем, когда оба будут в компании.
    op.add_column("invitations", sa.Column("manager_email", sa.String(255), nullable=True))
    # Уже работающему сотруднику назначили руководителем того, кто ещё не принял приглашение.
    op.add_column("tenant_members", sa.Column("pending_manager_email", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("tenant_members", "pending_manager_email")
    op.drop_column("invitations", "manager_email")
    op.drop_column("invitations", "full_name")
