"""pg_trgm GIN индексы для быстрого ILIKE-поиска в messages и tenant_leads

Revision ID: 0012_trigram
Revises: 0011_attach_null
Create Date: 2026-08-24
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0012_trigram"
down_revision: Union[str, None] = "0011_attach_null"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # pg_trgm — стандартное расширение PostgreSQL для похожести/подстрочного поиска.
    # После создания индекса LIKE '%foo%' по body/name будет O(log N) вместо full scan.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_messages_body_trgm "
        "ON messages USING gin (lower(body) gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_tenant_leads_name_trgm "
        "ON tenant_leads USING gin (lower(name) gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_tenant_leads_contact_trgm "
        "ON tenant_leads USING gin (lower(contact) gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_tenant_leads_contact_trgm")
    op.execute("DROP INDEX IF EXISTS ix_tenant_leads_name_trgm")
    op.execute("DROP INDEX IF EXISTS ix_messages_body_trgm")
    # Не роняем EXTENSION — может использоваться в других местах.
