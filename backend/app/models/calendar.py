"""Единый календарь: календари, события, участники, повторяемость, напоминания.

Recurrence:
- rrule хранится в CalendarEvent.rrule как строка iCalendar RRULE, например:
    "FREQ=DAILY;COUNT=5" / "FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T235959Z"
- Одиночное отклонение occurrence: EventException с exdate (date-time) и опц. override_data
- Хранится один "master" CalendarEvent — расширение до конкретных дат делается on-the-fly
  через python-dateutil.rrule при list_events(start, end).

Timezone: start_at/end_at в UTC, timezone (IANA) отдельно — для правильного expand.
"""
from datetime import datetime
from enum import Enum
from typing import Any, List, Optional

from sqlalchemy import (
    Boolean, DateTime, Enum as SAEnum, ForeignKey, Index, Integer, JSON, String, Text,
    UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class EventKind(str, Enum):
    event = "event"
    meeting = "meeting"


class ParticipantStatus(str, Enum):
    pending = "pending"
    accepted = "accepted"
    declined = "declined"
    tentative = "tentative"


class ReminderKind(str, Enum):
    notification = "notification"
    email = "email"


class Calendar(Base):
    __tablename__ = "calendars"
    __table_args__ = (
        Index("ix_calendars_tenant_owner", "tenant_id", "owner_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    name: Mapped[str] = mapped_column(String(200))
    color: Mapped[str] = mapped_column(String(20), default="#7C5CFF", server_default="#7C5CFF")
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    is_shared: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # UUID для публичной ICS-подписки — при переиздании ссылки токен меняется.
    ics_token: Mapped[Optional[str]] = mapped_column(String(80), nullable=True, unique=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    events: Mapped[List["CalendarEvent"]] = relationship(
        "CalendarEvent", back_populates="calendar", cascade="all, delete-orphan", lazy="selectin",
    )


class CalendarEvent(Base):
    __tablename__ = "calendar_events"
    __table_args__ = (
        Index("ix_calendar_events_tenant_start", "tenant_id", "start_at"),
        Index("ix_calendar_events_calendar_start", "calendar_id", "start_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    calendar_id: Mapped[int] = mapped_column(ForeignKey("calendars.id", ondelete="CASCADE"), index=True)

    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    location: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    kind: Mapped[EventKind] = mapped_column(
        SAEnum(EventKind, name="calendar_event_kind"), default=EventKind.event,
    )
    color: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    all_day: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    timezone: Mapped[str] = mapped_column(String(64), default="UTC", server_default="UTC")

    # iCalendar RRULE как строка. NULL = единичное событие
    rrule: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    creator_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    calendar: Mapped[Calendar] = relationship("Calendar", back_populates="events", lazy="joined")
    participants: Mapped[List["EventParticipant"]] = relationship(
        "EventParticipant", back_populates="event", cascade="all, delete-orphan", lazy="selectin",
    )
    reminders: Mapped[List["EventReminder"]] = relationship(
        "EventReminder", back_populates="event", cascade="all, delete-orphan", lazy="selectin",
    )
    exceptions: Mapped[List["EventException"]] = relationship(
        "EventException", back_populates="event", cascade="all, delete-orphan", lazy="selectin",
    )


class EventParticipant(Base):
    __tablename__ = "calendar_event_participants"
    __table_args__ = (
        UniqueConstraint("event_id", "user_id", name="uq_event_participants_event_user"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("calendar_events.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    status: Mapped[ParticipantStatus] = mapped_column(
        SAEnum(ParticipantStatus, name="event_participant_status"),
        default=ParticipantStatus.pending,
    )
    is_organizer: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    responded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    event: Mapped[CalendarEvent] = relationship("CalendarEvent", back_populates="participants")


class EventReminder(Base):
    __tablename__ = "calendar_event_reminders"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("calendar_events.id", ondelete="CASCADE"), index=True)

    offset_minutes: Mapped[int] = mapped_column(Integer, default=10, server_default="10")
    kind: Mapped[ReminderKind] = mapped_column(
        SAEnum(ReminderKind, name="event_reminder_kind"),
        default=ReminderKind.notification,
    )

    # Для recurring: last_fired_at инкрементим по мере срабатываний
    last_fired_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    event: Mapped[CalendarEvent] = relationship("CalendarEvent", back_populates="reminders")


class EventException(Base):
    """Исключения recurrence: конкретный occurrence удалён или переопределён.

    exdate — исходная дата occurrence (в UTC). override_start/override_end — новые время
    (NULL если это просто удаление). override_title/override_description — override полей.
    """
    __tablename__ = "calendar_event_exceptions"
    __table_args__ = (
        UniqueConstraint("event_id", "exdate", name="uq_event_exceptions_event_exdate"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("calendar_events.id", ondelete="CASCADE"), index=True)

    exdate: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    is_cancelled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    override_start: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    override_end: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    override_title: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    override_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    event: Mapped[CalendarEvent] = relationship("CalendarEvent", back_populates="exceptions")
