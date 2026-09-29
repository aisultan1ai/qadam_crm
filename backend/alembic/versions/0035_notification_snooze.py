"""Отложенные уведомления («Входящие» → Отложить)

Revision ID: 0035_notification_snooze
Revises: 0034_user_favorites
Create Date: 2026-09-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0035_notification_snooze"
down_revision: Union[str, None] = "0034_user_favorites"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("notifications", sa.Column("snoozed_until", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("notifications", "snoozed_until")
