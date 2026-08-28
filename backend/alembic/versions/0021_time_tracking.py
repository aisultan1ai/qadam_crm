"""Time tracking: TimeEntry + Timer + TimesheetApproval + Project.default_hourly_rate_cents

Revision ID: 0021_time_tracking
Revises: 0020_booking
Create Date: 2026-08-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0021_time_tracking"
down_revision: Union[str, None] = "0020_booking"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    time_entry_status = sa.Enum(
        "pending", "approved", "rejected", name="time_entry_approval_status"
    )
    timesheet_status = sa.Enum(
        "pending", "approved", "rejected", name="timesheet_approval_status"
    )

    op.create_table(
        "time_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_billable", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("hourly_rate_cents", sa.Integer(), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=True),
        sa.Column("approval_status", time_entry_status, nullable=False, server_default="pending"),
        sa.Column("approver_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_time_entries_tenant_id", "time_entries", ["tenant_id"])
    op.create_index("ix_time_entries_user_id", "time_entries", ["user_id"])
    op.create_index("ix_time_entries_tenant_started", "time_entries", ["tenant_id", "started_at"])
    op.create_index("ix_time_entries_user_started", "time_entries", ["user_id", "started_at"])
    op.create_index("ix_time_entries_task", "time_entries", ["task_id"])

    op.create_table(
        "timers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", name="uq_timers_user"),
    )
    op.create_index("ix_timers_tenant_id", "timers", ["tenant_id"])

    op.create_table(
        "timesheet_approvals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("total_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", timesheet_status, nullable=False, server_default="pending"),
        sa.Column("submitted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("approver_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.UniqueConstraint("user_id", "period_start", name="uq_timesheets_user_period"),
    )
    op.create_index("ix_timesheets_tenant_id", "timesheet_approvals", ["tenant_id"])
    op.create_index("ix_timesheets_user_id", "timesheet_approvals", ["user_id"])
    op.create_index("ix_timesheets_tenant_period", "timesheet_approvals", ["tenant_id", "period_start"])

    op.add_column(
        "projects",
        sa.Column("default_hourly_rate_cents", sa.Integer(), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("default_currency", sa.String(length=3), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("projects", "default_currency")
    op.drop_column("projects", "default_hourly_rate_cents")

    for tbl in ("timesheet_approvals", "timers", "time_entries"):
        op.drop_table(tbl)

    for enum_name in ("timesheet_approval_status", "time_entry_approval_status"):
        sa.Enum(name=enum_name).drop(op.get_bind(), checkfirst=True)
