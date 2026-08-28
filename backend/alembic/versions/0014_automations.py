"""Automations: rule engine + история запусков

Revision ID: 0014_automations
Revises: 0013_plans
Create Date: 2026-08-27
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0014_automations"
down_revision: Union[str, None] = "0013_plans"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "automations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("trigger_event", sa.String(length=80), nullable=False),
        sa.Column("trigger_config", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("graph", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_automations_tenant_id", "automations", ["tenant_id"])
    op.create_index("ix_automations_tenant_active", "automations", ["tenant_id", "is_active"])
    op.create_index("ix_automations_tenant_trigger", "automations", ["tenant_id", "trigger_event"])
    op.create_index("ix_automations_trigger_event", "automations", ["trigger_event"])

    op.create_table(
        "automation_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("automation_id", sa.Integer(), sa.ForeignKey("automations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("triggered_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "status",
            sa.Enum("running", "succeeded", "failed", "partial", name="automation_run_status"),
            nullable=False,
            server_default="running",
        ),
        sa.Column("trigger_payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("is_dry_run", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index("ix_automation_runs_automation_id", "automation_runs", ["automation_id"])
    op.create_index("ix_automation_runs_tenant_id", "automation_runs", ["tenant_id"])
    op.create_index("ix_automation_runs_triggered_at", "automation_runs", ["triggered_at"])
    op.create_index(
        "ix_automation_runs_tenant_created", "automation_runs", ["tenant_id", "triggered_at"]
    )
    op.create_index(
        "ix_automation_runs_automation_created", "automation_runs", ["automation_id", "triggered_at"]
    )

    op.create_table(
        "automation_actions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("automation_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("node_id", sa.String(length=64), nullable=False),
        sa.Column("action_type", sa.String(length=40), nullable=False),
        sa.Column("node_config", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column(
            "status",
            sa.Enum(
                "pending", "scheduled", "running", "succeeded", "failed", "skipped",
                name="automation_action_status",
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=True),
        sa.Column("executed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("result", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("celery_task_id", sa.String(length=80), nullable=True),
    )
    op.create_index("ix_automation_actions_run_id", "automation_actions", ["run_id"])
    op.create_index("ix_automation_actions_tenant_id", "automation_actions", ["tenant_id"])
    op.create_index(
        "ix_automation_actions_scheduled", "automation_actions", ["status", "scheduled_for"]
    )


def downgrade() -> None:
    op.drop_index("ix_automation_actions_scheduled", table_name="automation_actions")
    op.drop_index("ix_automation_actions_tenant_id", table_name="automation_actions")
    op.drop_index("ix_automation_actions_run_id", table_name="automation_actions")
    op.drop_table("automation_actions")
    sa.Enum(name="automation_action_status").drop(op.get_bind(), checkfirst=True)

    op.drop_index("ix_automation_runs_automation_created", table_name="automation_runs")
    op.drop_index("ix_automation_runs_tenant_created", table_name="automation_runs")
    op.drop_index("ix_automation_runs_triggered_at", table_name="automation_runs")
    op.drop_index("ix_automation_runs_tenant_id", table_name="automation_runs")
    op.drop_index("ix_automation_runs_automation_id", table_name="automation_runs")
    op.drop_table("automation_runs")
    sa.Enum(name="automation_run_status").drop(op.get_bind(), checkfirst=True)

    op.drop_index("ix_automations_trigger_event", table_name="automations")
    op.drop_index("ix_automations_tenant_trigger", table_name="automations")
    op.drop_index("ix_automations_tenant_active", table_name="automations")
    op.drop_index("ix_automations_tenant_id", table_name="automations")
    op.drop_table("automations")
