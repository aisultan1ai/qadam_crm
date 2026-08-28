"""Тайм-трекинг: TimeEntry (запись времени), Timer (активный таймер), TimesheetApproval (утверждение периода).

TimeEntry — интервал работы над задачей (started_at → ended_at + seconds).
Timer — активный таймер юзера, максимум один на User (UNIQUE user_id).
    При Stop → создаётся TimeEntry и Timer удаляется.
TimesheetApproval — недельная сводка на утверждение руководителем.
"""
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import (
    Boolean, DateTime, Enum as SAEnum, ForeignKey, Index, Integer, String, Text,
    UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class ApprovalStatus(str, Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class TimeEntry(Base):
    __tablename__ = "time_entries"
    __table_args__ = (
        Index("ix_time_entries_tenant_started", "tenant_id", "started_at"),
        Index("ix_time_entries_user_started", "user_id", "started_at"),
        Index("ix_time_entries_task", "task_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)

    task_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True,
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    seconds: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    is_billable: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    hourly_rate_cents: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    currency: Mapped[Optional[str]] = mapped_column(String(3), nullable=True)

    approval_status: Mapped[ApprovalStatus] = mapped_column(
        SAEnum(ApprovalStatus, name="time_entry_approval_status"),
        default=ApprovalStatus.pending,
        server_default="pending",
    )
    approver_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )

    task: Mapped[Optional["Task"]] = relationship("Task", lazy="joined")  # type: ignore  # noqa: F821
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id], lazy="joined")  # type: ignore  # noqa: F821


class Timer(Base):
    """Активный таймер пользователя. Один активный timer на юзера."""
    __tablename__ = "timers"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_timers_user"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))

    task_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True,
    )
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_heartbeat_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )

    task: Mapped[Optional["Task"]] = relationship("Task", lazy="joined")  # type: ignore  # noqa: F821


class TimesheetApproval(Base):
    """Недельная сводка на утверждение руководителем."""
    __tablename__ = "timesheet_approvals"
    __table_args__ = (
        UniqueConstraint("user_id", "period_start", name="uq_timesheets_user_period"),
        Index("ix_timesheets_tenant_period", "tenant_id", "period_start"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    total_seconds: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    status: Mapped[ApprovalStatus] = mapped_column(
        SAEnum(ApprovalStatus, name="timesheet_approval_status"),
        default=ApprovalStatus.pending,
        server_default="pending",
    )
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    approver_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
