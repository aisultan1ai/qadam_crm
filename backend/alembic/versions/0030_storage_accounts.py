"""storage_accounts + tenant dropbox oauth config (P5.4-P5.5)

Единая таблица токенов для облачных хранилищ: Google Drive / Dropbox.
Разделено с google_calendar_accounts, потому что scope у Drive и Calendar
разный, и переиспользовать один токен для двух API нельзя без явного
incremental consent.

Revision ID: 0030_storage_accounts
Revises: 0029_p4_modules
Create Date: 2026-09-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0030_storage_accounts"
down_revision: Union[str, None] = "0029_p4_modules"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tenants", sa.Column("dropbox_app_key", sa.String(length=200), nullable=True))
    op.add_column("tenants", sa.Column("dropbox_app_secret_enc", sa.String(length=500), nullable=True))
    op.add_column("tenants", sa.Column("dropbox_redirect_uri", sa.String(length=500), nullable=True))

    op.create_table(
        "storage_accounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(length=30), nullable=False),
        sa.Column("account_email", sa.String(length=255), nullable=True),
        sa.Column("account_name", sa.String(length=255), nullable=True),
        sa.Column("access_token_enc", sa.Text(), nullable=True),
        sa.Column("refresh_token_enc", sa.Text(), nullable=True),
        sa.Column("access_token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("tenant_id", "user_id", "provider", name="uq_storage_tenant_user_provider"),
    )
    op.create_index("ix_storage_accounts_tenant_id", "storage_accounts", ["tenant_id"])
    op.create_index("ix_storage_accounts_user_id", "storage_accounts", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_storage_accounts_user_id", table_name="storage_accounts")
    op.drop_index("ix_storage_accounts_tenant_id", table_name="storage_accounts")
    op.drop_table("storage_accounts")

    op.drop_column("tenants", "dropbox_redirect_uri")
    op.drop_column("tenants", "dropbox_app_secret_enc")
    op.drop_column("tenants", "dropbox_app_key")
