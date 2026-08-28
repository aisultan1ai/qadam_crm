"""Букинг: Calendly-style публичные страницы для бронирования встреч.

BookingPage — публичная страница-приглашение (per-user или per-team).
Booking — записанная встреча (создаётся публично, авто-создаёт CalendarEvent).
BookingTeam — группа менеджеров, между которыми распределяются встречи.

working_hours JSON:
    {"monday": [[9, 13], [14, 18]], "tuesday": [[9, 18]], ...}
Каждый день — список сегментов [start_hour, end_hour]. Пусто/отсутствует = выходной.

questions JSON:
    [{"key": "topic", "label": "Тема встречи", "type": "text", "required": true}, ...]
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


class BookingStatus(str, Enum):
    pending = "pending"
    confirmed = "confirmed"
    canceled = "canceled"


class TeamStrategy(str, Enum):
    round_robin = "round_robin"
    least_busy = "least_busy"


class MeetingProvider(str, Enum):
    none = "none"
    manual = "manual"
    zoom = "zoom"
    google_meet = "google_meet"


class BookingTeam(Base):
    __tablename__ = "booking_teams"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    member_user_ids: Mapped[Any] = mapped_column(JSON, default=list, server_default="[]")
    strategy: Mapped[TeamStrategy] = mapped_column(
        SAEnum(TeamStrategy, name="booking_team_strategy"),
        default=TeamStrategy.round_robin,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BookingPage(Base):
    __tablename__ = "booking_pages"
    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_booking_pages_tenant_slug"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)

    # Либо owner_user_id (индивидуальная), либо team_id (групповая round-robin)
    owner_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True,
    )
    team_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("booking_teams.id", ondelete="SET NULL"), nullable=True,
    )

    slug: Mapped[str] = mapped_column(String(100))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    color: Mapped[str] = mapped_column(String(20), default="#7C5CFF", server_default="#7C5CFF")

    duration_min: Mapped[int] = mapped_column(Integer, default=30, server_default="30")
    buffer_before_min: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    buffer_after_min: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    working_hours: Mapped[Any] = mapped_column(JSON, default=dict, server_default="{}")
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Almaty", server_default="Asia/Almaty")

    min_notice_hours: Mapped[int] = mapped_column(Integer, default=2, server_default="2")
    max_days_ahead: Mapped[int] = mapped_column(Integer, default=30, server_default="30")

    questions: Mapped[Any] = mapped_column(JSON, default=list, server_default="[]")

    calendar_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("calendars.id", ondelete="SET NULL"), nullable=True,
    )
    meeting_provider: Mapped[MeetingProvider] = mapped_column(
        SAEnum(MeetingProvider, name="booking_meeting_provider"),
        default=MeetingProvider.none,
    )
    meeting_url_template: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    require_confirmation: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    bookings: Mapped[List["Booking"]] = relationship(
        "Booking", back_populates="page", cascade="all, delete-orphan", lazy="selectin",
    )
    team: Mapped[Optional["BookingTeam"]] = relationship("BookingTeam", lazy="joined")


class Booking(Base):
    __tablename__ = "bookings"
    __table_args__ = (
        Index("ix_bookings_page_start", "page_id", "start_at"),
        Index("ix_bookings_assignee_start", "assignee_user_id", "start_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    page_id: Mapped[int] = mapped_column(ForeignKey("booking_pages.id", ondelete="CASCADE"), index=True)

    # Кто из команды взял встречу (для round-robin/least-busy). Для personal-страниц = owner_user_id.
    assignee_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True,
    )

    # Данные клиента
    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(320), index=True)
    phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    status: Mapped[BookingStatus] = mapped_column(
        SAEnum(BookingStatus, name="booking_status"),
        default=BookingStatus.confirmed,
    )
    answers: Mapped[Any] = mapped_column(JSON, default=dict, server_default="{}")

    meeting_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # ID созданного CalendarEvent (nullable, если calendar не задан у page)
    calendar_event_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("calendar_events.id", ondelete="SET NULL"), nullable=True,
    )

    # Токен для публичной отмены без auth
    cancel_token: Mapped[str] = mapped_column(String(80), unique=True, index=True)

    ip_address: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    page: Mapped[BookingPage] = relationship("BookingPage", back_populates="bookings", lazy="joined")
