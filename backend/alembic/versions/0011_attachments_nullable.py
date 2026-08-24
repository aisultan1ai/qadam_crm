"""Attachments.task_id nullable — для вложений в мессенджер

Revision ID: 0011_attach_null
Revises: 0010_messenger
Create Date: 2026-08-24
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0011_attach_null"
down_revision: Union[str, None] = "0010_messenger"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("attachments", "task_id", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    op.alter_column("attachments", "task_id", existing_type=sa.Integer(), nullable=False)
