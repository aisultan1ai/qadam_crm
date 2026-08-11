"""multi-tenant: enforce NOT NULL on tenant_id for business tables

Отдельная ревизия — идёт после 0004 (там был backfill).
Разделено чтобы упростить откат и убедиться что все строки заполнены до NOT NULL.

Revision ID: 0005_tenant_id_not_null
Revises: 0004_multi_tenant
Create Date: 2026-08-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0005_tenant_id_not_null"
down_revision: Union[str, None] = "0004_multi_tenant"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


BUSINESS_TABLES = [
    "projects", "tasks", "comments", "attachments",
    "notifications", "departments",
]


def upgrade() -> None:
    conn = op.get_bind()

    for table in BUSINESS_TABLES:
        missing = conn.execute(
            sa.text(f"SELECT COUNT(*) FROM {table} WHERE tenant_id IS NULL")
        ).scalar()
        if missing:
            raise RuntimeError(
                f"Cannot enforce NOT NULL on {table}.tenant_id: {missing} rows still NULL. "
                "Backfill (revision 0004) must complete first."
            )
        op.alter_column(table, "tenant_id", existing_type=sa.Integer(), nullable=False)


def downgrade() -> None:
    for table in BUSINESS_TABLES:
        op.alter_column(table, "tenant_id", existing_type=sa.Integer(), nullable=True)
