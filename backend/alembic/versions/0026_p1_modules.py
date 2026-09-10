"""P1 modules: time_off + deals + user_sessions/prefs/linked_accounts

Revision ID: 0026_p1_modules
Revises: 0025_contacts
Create Date: 2026-09-10
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0026_p1_modules"
down_revision: Union[str, None] = "0025_contacts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enum'ы храним как строки — без CREATE TYPE. Валидация значений на уровне
    # SQLAlchemy/Pydantic-моделей. Избегаем гонок с alembic visit_enum.

    # --- time_off ---
    op.create_table(
        "time_off",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False, server_default="vacation"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("approver_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_time_off_tenant_id", "time_off", ["tenant_id"])
    op.create_index("ix_time_off_user_id", "time_off", ["user_id"])
    op.create_index("ix_time_off_status", "time_off", ["status"])
    op.create_index("ix_timeoff_tenant_user", "time_off", ["tenant_id", "user_id"])
    op.create_index("ix_timeoff_tenant_dates", "time_off", ["tenant_id", "start_date", "end_date"])

    # --- deals ---
    op.create_table(
        "deals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("amount_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="KZT"),
        sa.Column("stage", sa.String(length=20), nullable=False, server_default="new"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
        sa.Column("probability", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("contact_id", sa.Integer(), sa.ForeignKey("contacts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id", ondelete="SET NULL"), nullable=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("close_date", sa.Date(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_deals_tenant_id", "deals", ["tenant_id"])
    op.create_index("ix_deals_stage", "deals", ["stage"])
    op.create_index("ix_deals_status", "deals", ["status"])
    op.create_index("ix_deals_contact_id", "deals", ["contact_id"])
    op.create_index("ix_deals_company_id", "deals", ["company_id"])
    op.create_index("ix_deals_owner_id", "deals", ["owner_id"])
    op.create_index("ix_deals_tenant_stage", "deals", ["tenant_id", "stage"])
    op.create_index("ix_deals_tenant_owner", "deals", ["tenant_id", "owner_id"])
    op.create_index("ix_deals_close_date", "deals", ["close_date"])

    # --- user_sessions ---
    op.create_table(
        "user_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("user_agent", sa.String(length=500), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_user_sessions_user_id", "user_sessions", ["user_id"])
    op.create_index("ix_user_sessions_token_hash", "user_sessions", ["token_hash"])
    op.create_index("ix_user_sessions_user_active", "user_sessions", ["user_id", "revoked_at"])

    # --- user_notification_prefs ---
    op.create_table(
        "user_notification_prefs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True),
        sa.Column("kind", sa.String(length=50), nullable=False),
        sa.Column("inapp", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("email", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("push", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "tenant_id", "kind", name="uq_user_pref_kind"),
    )
    op.create_index("ix_user_notification_prefs_user_id", "user_notification_prefs", ["user_id"])

    # --- linked_accounts ---
    op.create_table(
        "linked_accounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("external_id", sa.String(length=200), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "provider", "external_id", name="uq_linked_provider"),
    )
    op.create_index("ix_linked_accounts_user_id", "linked_accounts", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_linked_accounts_user_id", table_name="linked_accounts")
    op.drop_table("linked_accounts")

    op.drop_index("ix_user_notification_prefs_user_id", table_name="user_notification_prefs")
    op.drop_table("user_notification_prefs")

    op.drop_index("ix_user_sessions_user_active", table_name="user_sessions")
    op.drop_index("ix_user_sessions_token_hash", table_name="user_sessions")
    op.drop_index("ix_user_sessions_user_id", table_name="user_sessions")
    op.drop_table("user_sessions")

    op.drop_index("ix_deals_close_date", table_name="deals")
    op.drop_index("ix_deals_tenant_owner", table_name="deals")
    op.drop_index("ix_deals_tenant_stage", table_name="deals")
    op.drop_index("ix_deals_owner_id", table_name="deals")
    op.drop_index("ix_deals_company_id", table_name="deals")
    op.drop_index("ix_deals_contact_id", table_name="deals")
    op.drop_index("ix_deals_status", table_name="deals")
    op.drop_index("ix_deals_stage", table_name="deals")
    op.drop_index("ix_deals_tenant_id", table_name="deals")
    op.drop_table("deals")

    op.drop_index("ix_timeoff_tenant_dates", table_name="time_off")
    op.drop_index("ix_timeoff_tenant_user", table_name="time_off")
    op.drop_index("ix_time_off_status", table_name="time_off")
    op.drop_index("ix_time_off_user_id", table_name="time_off")
    op.drop_index("ix_time_off_tenant_id", table_name="time_off")
    op.drop_table("time_off")
