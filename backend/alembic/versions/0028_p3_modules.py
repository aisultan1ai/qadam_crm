"""P3 modules: task_links, reminders, task_status_defs, entity_templates,
custom_field_defs, saved_reports+groups, mail_rules+templates,
+ new columns on tasks/projects/contacts/companies/deals.

Revision ID: 0028_p3_modules
Revises: 0027_p2_modules
Create Date: 2026-09-10
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0028_p3_modules"
down_revision: Union[str, None] = "0027_p2_modules"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ============================================================
    # New tables
    # ============================================================

    # --- task_status_defs ---
    op.create_table(
        "task_status_defs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("color", sa.String(length=20), nullable=False, server_default="#6B7280"),
        sa.Column("category", sa.String(length=20), nullable=False, server_default="new"),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_terminal", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("allowed_next", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "code", name="uq_status_code"),
    )
    op.create_index("ix_task_status_defs_tenant_id", "task_status_defs", ["tenant_id"])
    op.create_index("ix_status_tenant_order", "task_status_defs", ["tenant_id", "order_index"])

    # --- task_links ---
    op.create_table(
        "task_links",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_task_id", sa.Integer(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("to_task_id", sa.Integer(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("from_task_id", "to_task_id", "kind", name="uq_task_link"),
    )
    op.create_index("ix_task_links_tenant_id", "task_links", ["tenant_id"])
    op.create_index("ix_task_links_from", "task_links", ["from_task_id"])
    op.create_index("ix_task_links_to", "task_links", ["to_task_id"])

    # --- reminders ---
    op.create_table(
        "reminders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_type", sa.String(length=30), nullable=True),
        sa.Column("target_id", sa.Integer(), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("next_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("recurrence_rule", sa.String(length=200), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("fired_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_fired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_reminders_tenant_id", "reminders", ["tenant_id"])
    op.create_index("ix_reminders_user_id", "reminders", ["user_id"])
    op.create_index("ix_reminders_tenant_next", "reminders", ["tenant_id", "next_at"])
    op.create_index("ix_reminders_user_next", "reminders", ["user_id", "next_at"])

    # --- entity_templates ---
    op.create_table(
        "entity_templates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entity_type", sa.String(length=30), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_entity_templates_tenant_id", "entity_templates", ["tenant_id"])
    op.create_index("ix_templates_tenant_type", "entity_templates", ["tenant_id", "entity_type"])

    # --- custom_field_defs ---
    op.create_table(
        "custom_field_defs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entity_type", sa.String(length=30), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("field_type", sa.String(length=30), nullable=False),
        sa.Column("options", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "entity_type", "code", name="uq_custom_field_code"),
    )
    op.create_index("ix_custom_field_defs_tenant_id", "custom_field_defs", ["tenant_id"])
    op.create_index("ix_custom_field_entity", "custom_field_defs", ["tenant_id", "entity_type", "order_index"])

    # --- report_groups ---
    op.create_table(
        "report_groups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_report_groups_tenant_id", "report_groups", ["tenant_id"])

    # --- saved_reports ---
    op.create_table(
        "saved_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("report_groups.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("schedule_cron", sa.String(length=50), nullable=True),
        sa.Column("email_to", sa.String(length=255), nullable=True),
        sa.Column("is_shared", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_saved_reports_tenant_id", "saved_reports", ["tenant_id"])
    op.create_index("ix_saved_reports_tenant_owner", "saved_reports", ["tenant_id", "owner_id"])

    # --- mail_rules ---
    op.create_table(
        "mail_rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mailbox_id", sa.Integer(), sa.ForeignKey("mailboxes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("stop_on_match", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("conditions", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("actions", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_mail_rules_tenant_id", "mail_rules", ["tenant_id"])
    op.create_index("ix_mail_rules_mailbox_id", "mail_rules", ["mailbox_id"])
    op.create_index("ix_mail_rules_mailbox_order", "mail_rules", ["mailbox_id", "order_index"])

    # --- mail_templates ---
    op.create_table(
        "mail_templates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("subject", sa.String(length=500), nullable=False),
        sa.Column("body", sa.Text(), nullable=False, server_default=""),
        sa.Column("variables", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_mail_templates_tenant_id", "mail_templates", ["tenant_id"])

    # ============================================================
    # New columns on existing tables
    # ============================================================

    # tasks
    op.add_column("tasks", sa.Column("parent_task_id", sa.Integer(), sa.ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True))
    op.create_index("ix_tasks_parent_task_id", "tasks", ["parent_task_id"])
    op.add_column("tasks", sa.Column("custom_status_id", sa.Integer(), sa.ForeignKey("task_status_defs.id", ondelete="SET NULL"), nullable=True))
    op.create_index("ix_tasks_custom_status_id", "tasks", ["custom_status_id"])
    op.add_column("tasks", sa.Column("recurrence_rule", sa.String(length=300), nullable=True))
    op.add_column("tasks", sa.Column("recurrence_parent_id", sa.Integer(), sa.ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True))
    op.create_index("ix_tasks_recurrence_parent_id", "tasks", ["recurrence_parent_id"])
    op.add_column("tasks", sa.Column("recurrence_next_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_tasks_recurrence_next_at", "tasks", ["recurrence_next_at"])
    op.add_column("tasks", sa.Column("inbox_token", sa.String(length=32), nullable=True))
    op.create_index("ix_tasks_inbox_token", "tasks", ["inbox_token"], unique=True)
    op.add_column("tasks", sa.Column("custom_data", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False))

    # projects
    op.add_column("projects", sa.Column("inbox_token", sa.String(length=32), nullable=True))
    op.create_index("ix_projects_inbox_token", "projects", ["inbox_token"], unique=True)
    op.add_column("projects", sa.Column("custom_data", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False))

    # contacts
    op.add_column("contacts", sa.Column("custom_data", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False))

    # companies
    op.add_column("companies", sa.Column("custom_data", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False))

    # deals
    op.add_column("deals", sa.Column("custom_data", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False))


def downgrade() -> None:
    op.drop_column("deals", "custom_data")
    op.drop_column("companies", "custom_data")
    op.drop_column("contacts", "custom_data")
    op.drop_index("ix_projects_inbox_token", table_name="projects")
    op.drop_column("projects", "custom_data")
    op.drop_column("projects", "inbox_token")

    op.drop_column("tasks", "custom_data")
    op.drop_index("ix_tasks_inbox_token", table_name="tasks")
    op.drop_column("tasks", "inbox_token")
    op.drop_index("ix_tasks_recurrence_next_at", table_name="tasks")
    op.drop_column("tasks", "recurrence_next_at")
    op.drop_index("ix_tasks_recurrence_parent_id", table_name="tasks")
    op.drop_column("tasks", "recurrence_parent_id")
    op.drop_column("tasks", "recurrence_rule")
    op.drop_index("ix_tasks_custom_status_id", table_name="tasks")
    op.drop_column("tasks", "custom_status_id")
    op.drop_index("ix_tasks_parent_task_id", table_name="tasks")
    op.drop_column("tasks", "parent_task_id")

    for tbl in ("mail_templates", "mail_rules", "saved_reports", "report_groups",
                "custom_field_defs", "entity_templates", "reminders", "task_links",
                "task_status_defs"):
        op.drop_table(tbl)
