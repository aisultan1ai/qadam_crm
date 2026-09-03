"""Per-tenant Google OAuth credentials

Revision ID: 0024_tenant_google_oauth
Revises: 0023_google_calendar
Create Date: 2026-09-03
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0024_tenant_google_oauth"
down_revision: Union[str, None] = "0023_google_calendar"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tenants", sa.Column("google_client_id", sa.String(length=200), nullable=True))
    op.add_column("tenants", sa.Column("google_client_secret_enc", sa.String(length=500), nullable=True))
    op.add_column("tenants", sa.Column("google_redirect_uri", sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column("tenants", "google_redirect_uri")
    op.drop_column("tenants", "google_client_secret_enc")
    op.drop_column("tenants", "google_client_id")
