"""LeadForm + TenantLead tables

Revision ID: 0009_lead_forms
Revises: 0008_email_verification
Create Date: 2026-08-24
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0009_lead_forms"
down_revision: Union[str, None] = "0008_email_verification"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "lead_forms",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False, server_default="Оставьте заявку"),
        sa.Column("subtitle", sa.String(length=300), nullable=True),
        sa.Column("submit_label", sa.String(length=80), nullable=False, server_default="Отправить"),
        sa.Column("success_message", sa.Text(), nullable=False, server_default="Спасибо! Мы свяжемся с вами."),
        sa.Column("brand_color", sa.String(length=20), nullable=False, server_default="#0f67fd"),
        sa.Column("fields_config", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "slug", name="uq_lead_forms_tenant_slug"),
    )
    op.create_index("ix_lead_forms_tenant_id", "lead_forms", ["tenant_id"])
    op.create_index("ix_lead_forms_slug", "lead_forms", ["slug"])

    op.create_table(
        "tenant_leads",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("form_id", sa.Integer(), sa.ForeignKey("lead_forms.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("contact", sa.String(length=255), nullable=False),
        sa.Column("custom_fields", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="new"),
        sa.Column("source", sa.String(length=50), nullable=False, server_default="form"),
        sa.Column("assignee_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("converted_task_id", sa.Integer(), sa.ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=500), nullable=True),
        sa.Column("referer", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_tenant_leads_tenant_id", "tenant_leads", ["tenant_id"])
    op.create_index("ix_tenant_leads_form_id", "tenant_leads", ["form_id"])
    op.create_index("ix_tenant_leads_contact", "tenant_leads", ["contact"])
    op.create_index("ix_tenant_leads_status", "tenant_leads", ["status"])
    op.create_index("ix_tenant_leads_assignee_id", "tenant_leads", ["assignee_id"])


def downgrade() -> None:
    op.drop_index("ix_tenant_leads_assignee_id", table_name="tenant_leads")
    op.drop_index("ix_tenant_leads_status", table_name="tenant_leads")
    op.drop_index("ix_tenant_leads_contact", table_name="tenant_leads")
    op.drop_index("ix_tenant_leads_form_id", table_name="tenant_leads")
    op.drop_index("ix_tenant_leads_tenant_id", table_name="tenant_leads")
    op.drop_table("tenant_leads")

    op.drop_index("ix_lead_forms_slug", table_name="lead_forms")
    op.drop_index("ix_lead_forms_tenant_id", table_name="lead_forms")
    op.drop_table("lead_forms")
