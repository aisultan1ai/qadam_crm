"""Приглашение владельца компании (компанию создаёт платформенный админ)

Revision ID: 0042_invitation_make_owner
Revises: 0041_fk_indexes
Create Date: 2026-11-16
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0042_invitation_make_owner"
down_revision: Union[str, None] = "0041_fk_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "invitations",
        sa.Column("make_owner", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("invitations", "make_owner")
