"""Сумма сделки — BIGINT: в INTEGER (тиыны) помещалось только до 21,4 млн ₸, крупные сделки падали

Revision ID: 0049_deal_amount_bigint
Revises: 0048_invitation_name_manager
Create Date: 2026-11-17
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0049_deal_amount_bigint"
down_revision: Union[str, None] = "0048_invitation_name_manager"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("deals", "amount_cents", type_=sa.BigInteger(), existing_type=sa.Integer(), existing_nullable=True)


def downgrade() -> None:
    op.alter_column("deals", "amount_cents", type_=sa.Integer(), existing_type=sa.BigInteger(), existing_nullable=True)
