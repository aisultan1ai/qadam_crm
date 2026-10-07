"""У проекта нет дедлайна — срок бывает только у задач

Revision ID: 0037_drop_project_deadline
Revises: 0036_system_roles_no_grants
Create Date: 2026-10-08
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0037_drop_project_deadline"
down_revision: Union[str, None] = "0036_system_roles_no_grants"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS deadline")


def downgrade() -> None:
    op.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS deadline DATE")
