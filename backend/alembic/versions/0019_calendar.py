"""Calendar: calendars + events + participants + reminders + exceptions

Revision ID: 0019_calendar
Revises: 0018_wiki
Create Date: 2026-08-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0019_calendar"
down_revision: Union[str, None] = "0018_wiki"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    event_kind = sa.Enum("event", "meeting", name="calendar_event_kind")
    participant_status = sa.Enum("pending", "accepted", "declined", "tentative", name="event_participant_status")
    reminder_kind = sa.Enum("notification", "email", name="event_reminder_kind")

    op.create_table(
        "calendars",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("color", sa.String(length=20), nullable=False, server_default="#7C5CFF"),
        sa.Column("is_visible", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_shared", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("ics_token", sa.String(length=80), nullable=True, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_calendars_tenant_id", "calendars", ["tenant_id"])
    op.create_index("ix_calendars_owner_id", "calendars", ["owner_id"])
    op.create_index("ix_calendars_tenant_owner", "calendars", ["tenant_id", "owner_id"])

    op.create_table(
        "calendar_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("calendar_id", sa.Integer(), sa.ForeignKey("calendars.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("location", sa.String(length=300), nullable=True),
        sa.Column("url", sa.String(length=500), nullable=True),
        sa.Column("kind", event_kind, nullable=False, server_default="event"),
        sa.Column("color", sa.String(length=20), nullable=True),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("all_day", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("timezone", sa.String(length=64), nullable=False, server_default="UTC"),
        sa.Column("rrule", sa.String(length=500), nullable=True),
        sa.Column("creator_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_calendar_events_tenant_id", "calendar_events", ["tenant_id"])
    op.create_index("ix_calendar_events_calendar_id", "calendar_events", ["calendar_id"])
    op.create_index("ix_calendar_events_tenant_start", "calendar_events", ["tenant_id", "start_at"])
    op.create_index("ix_calendar_events_calendar_start", "calendar_events", ["calendar_id", "start_at"])

    op.create_table(
        "calendar_event_participants",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("calendar_events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", participant_status, nullable=False, server_default="pending"),
        sa.Column("is_organizer", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("event_id", "user_id", name="uq_event_participants_event_user"),
    )
    op.create_index("ix_calendar_event_participants_tenant_id", "calendar_event_participants", ["tenant_id"])
    op.create_index("ix_calendar_event_participants_event_id", "calendar_event_participants", ["event_id"])
    op.create_index("ix_calendar_event_participants_user_id", "calendar_event_participants", ["user_id"])

    op.create_table(
        "calendar_event_reminders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("calendar_events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("offset_minutes", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("kind", reminder_kind, nullable=False, server_default="notification"),
        sa.Column("last_fired_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_calendar_event_reminders_tenant_id", "calendar_event_reminders", ["tenant_id"])
    op.create_index("ix_calendar_event_reminders_event_id", "calendar_event_reminders", ["event_id"])

    op.create_table(
        "calendar_event_exceptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("calendar_events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("exdate", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_cancelled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("override_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("override_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("override_title", sa.String(length=300), nullable=True),
        sa.Column("override_description", sa.Text(), nullable=True),
        sa.UniqueConstraint("event_id", "exdate", name="uq_event_exceptions_event_exdate"),
    )
    op.create_index("ix_calendar_event_exceptions_tenant_id", "calendar_event_exceptions", ["tenant_id"])
    op.create_index("ix_calendar_event_exceptions_event_id", "calendar_event_exceptions", ["event_id"])


def downgrade() -> None:
    for tbl in (
        "calendar_event_exceptions",
        "calendar_event_reminders",
        "calendar_event_participants",
        "calendar_events",
        "calendars",
    ):
        op.drop_table(tbl)
    for enum_name in ("event_reminder_kind", "event_participant_status", "calendar_event_kind"):
        sa.Enum(name=enum_name).drop(op.get_bind(), checkfirst=True)
