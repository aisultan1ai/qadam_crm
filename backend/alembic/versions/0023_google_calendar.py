"""google calendar accounts + external fields

Revision ID: 0023_google_calendar
Revises: 0022_hr_profiles
Create Date: 2026-09-03
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0023_google_calendar"
down_revision: Union[str, None] = "0022_hr_profiles"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "google_calendar_accounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("google_email", sa.String(length=255), nullable=False),
        sa.Column("access_token_enc", sa.Text(), nullable=True),
        sa.Column("refresh_token_enc", sa.Text(), nullable=True),
        sa.Column("access_token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("primary_calendar_id", sa.String(length=200), nullable=True),
        sa.Column("sync_token", sa.Text(), nullable=True),
        sa.Column("sync_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("tenant_id", "user_id", name="uq_google_accounts_tenant_user"),
    )
    op.create_index("ix_google_calendar_accounts_tenant_id", "google_calendar_accounts", ["tenant_id"])
    op.create_index("ix_google_accounts_user", "google_calendar_accounts", ["user_id"])

    op.add_column("calendar_events", sa.Column("external_source", sa.String(length=20), nullable=True))
    op.add_column("calendar_events", sa.Column("external_id", sa.String(length=200), nullable=True))
    op.add_column("calendar_events", sa.Column("external_calendar_id", sa.String(length=200), nullable=True))
    op.add_column("calendar_events", sa.Column("external_etag", sa.String(length=200), nullable=True))
    op.create_index("ix_calendar_events_external_id", "calendar_events", ["external_id"])


def downgrade() -> None:
    op.drop_index("ix_calendar_events_external_id", table_name="calendar_events")
    op.drop_column("calendar_events", "external_etag")
    op.drop_column("calendar_events", "external_calendar_id")
    op.drop_column("calendar_events", "external_id")
    op.drop_column("calendar_events", "external_source")

    op.drop_index("ix_google_accounts_user", table_name="google_calendar_accounts")
    op.drop_index("ix_google_calendar_accounts_tenant_id", table_name="google_calendar_accounts")
    op.drop_table("google_calendar_accounts")
