"""P2 modules: whiteboards + calls + custom_objects + ai_usage

Revision ID: 0027_p2_modules
Revises: 0026_p1_modules
Create Date: 2026-09-10
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0027_p2_modules"
down_revision: Union[str, None] = "0026_p1_modules"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- whiteboards ---
    op.create_table(
        "whiteboards",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False, server_default="Новая доска"),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_whiteboards_tenant_id", "whiteboards", ["tenant_id"])
    op.create_index("ix_whiteboards_tenant", "whiteboards", ["tenant_id"])

    # --- calls ---
    op.create_table(
        "calls",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(length=30), nullable=False, server_default="manual"),
        sa.Column("external_id", sa.String(length=200), nullable=True),
        sa.Column("direction", sa.String(length=10), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="completed"),
        sa.Column("from_number", sa.String(length=50), nullable=True),
        sa.Column("to_number", sa.String(length=50), nullable=True),
        sa.Column("duration_sec", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("recording_url", sa.String(length=500), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("contact_id", sa.Integer(), sa.ForeignKey("contacts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("deal_id", sa.Integer(), sa.ForeignKey("deals.id", ondelete="SET NULL"), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("raw", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.create_index("ix_calls_tenant_id", "calls", ["tenant_id"])
    op.create_index("ix_calls_external_id", "calls", ["external_id"])
    op.create_index("ix_calls_tenant_started", "calls", ["tenant_id", "started_at"])
    op.create_index("ix_calls_user", "calls", ["user_id"])
    op.create_index("ix_calls_contact", "calls", ["contact_id"])

    # --- custom object schemas ---
    op.create_table(
        "custom_object_schemas",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("icon", sa.String(length=30), nullable=True),
        sa.Column("fields", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "code", name="uq_custom_schema_code"),
    )
    op.create_index("ix_custom_object_schemas_tenant_id", "custom_object_schemas", ["tenant_id"])

    op.create_table(
        "custom_object_records",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("schema_id", sa.Integer(), sa.ForeignKey("custom_object_schemas.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=True),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_custom_object_records_tenant_id", "custom_object_records", ["tenant_id"])
    op.create_index("ix_custom_records_schema", "custom_object_records", ["schema_id"])
    op.create_index("ix_custom_records_tenant_schema", "custom_object_records", ["tenant_id", "schema_id"])


def downgrade() -> None:
    op.drop_index("ix_custom_records_tenant_schema", table_name="custom_object_records")
    op.drop_index("ix_custom_records_schema", table_name="custom_object_records")
    op.drop_index("ix_custom_object_records_tenant_id", table_name="custom_object_records")
    op.drop_table("custom_object_records")

    op.drop_index("ix_custom_object_schemas_tenant_id", table_name="custom_object_schemas")
    op.drop_table("custom_object_schemas")

    op.drop_index("ix_calls_contact", table_name="calls")
    op.drop_index("ix_calls_user", table_name="calls")
    op.drop_index("ix_calls_tenant_started", table_name="calls")
    op.drop_index("ix_calls_external_id", table_name="calls")
    op.drop_index("ix_calls_tenant_id", table_name="calls")
    op.drop_table("calls")

    op.drop_index("ix_whiteboards_tenant", table_name="whiteboards")
    op.drop_index("ix_whiteboards_tenant_id", table_name="whiteboards")
    op.drop_table("whiteboards")
