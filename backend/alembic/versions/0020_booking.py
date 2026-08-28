"""Booking: pages + teams + bookings (Calendly-style)

Revision ID: 0020_booking
Revises: 0019_calendar
Create Date: 2026-08-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0020_booking"
down_revision: Union[str, None] = "0019_calendar"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    booking_status = sa.Enum("pending", "confirmed", "canceled", name="booking_status")
    team_strategy = sa.Enum("round_robin", "least_busy", name="booking_team_strategy")
    meeting_provider = sa.Enum("none", "manual", "zoom", "google_meet", name="booking_meeting_provider")

    op.create_table(
        "booking_teams",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("member_user_ids", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("strategy", team_strategy, nullable=False, server_default="round_robin"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_booking_teams_tenant_id", "booking_teams", ["tenant_id"])

    op.create_table(
        "booking_pages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("team_id", sa.Integer(), sa.ForeignKey("booking_teams.id", ondelete="SET NULL"), nullable=True),
        sa.Column("slug", sa.String(length=100), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("color", sa.String(length=20), nullable=False, server_default="#7C5CFF"),
        sa.Column("duration_min", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("buffer_before_min", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("buffer_after_min", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("working_hours", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("timezone", sa.String(length=64), nullable=False, server_default="Asia/Almaty"),
        sa.Column("min_notice_hours", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("max_days_ahead", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("questions", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("calendar_id", sa.Integer(), sa.ForeignKey("calendars.id", ondelete="SET NULL"), nullable=True),
        sa.Column("meeting_provider", meeting_provider, nullable=False, server_default="none"),
        sa.Column("meeting_url_template", sa.String(length=500), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("require_confirmation", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "slug", name="uq_booking_pages_tenant_slug"),
    )
    op.create_index("ix_booking_pages_tenant_id", "booking_pages", ["tenant_id"])
    op.create_index("ix_booking_pages_owner_user_id", "booking_pages", ["owner_user_id"])

    op.create_table(
        "bookings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("page_id", sa.Integer(), sa.ForeignKey("booking_pages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("assignee_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", booking_status, nullable=False, server_default="confirmed"),
        sa.Column("answers", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("meeting_url", sa.String(length=500), nullable=True),
        sa.Column("calendar_event_id", sa.Integer(), sa.ForeignKey("calendar_events.id", ondelete="SET NULL"), nullable=True),
        sa.Column("cancel_token", sa.String(length=80), nullable=False, unique=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_bookings_tenant_id", "bookings", ["tenant_id"])
    op.create_index("ix_bookings_page_id", "bookings", ["page_id"])
    op.create_index("ix_bookings_assignee_user_id", "bookings", ["assignee_user_id"])
    op.create_index("ix_bookings_email", "bookings", ["email"])
    op.create_index("ix_bookings_cancel_token", "bookings", ["cancel_token"], unique=True)
    op.create_index("ix_bookings_page_start", "bookings", ["page_id", "start_at"])
    op.create_index("ix_bookings_assignee_start", "bookings", ["assignee_user_id", "start_at"])


def downgrade() -> None:
    for tbl in ("bookings", "booking_pages", "booking_teams"):
        op.drop_table(tbl)
    for enum_name in ("booking_meeting_provider", "booking_team_strategy", "booking_status"):
        sa.Enum(name=enum_name).drop(op.get_bind(), checkfirst=True)
