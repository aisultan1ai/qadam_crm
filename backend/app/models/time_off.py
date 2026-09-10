import enum
from datetime import datetime, date
from typing import Optional

from sqlalchemy import String, Integer, ForeignKey, DateTime, Date, Text, Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class TimeOffKind(str, enum.Enum):
    vacation = "vacation"
    sick = "sick"
    personal = "personal"
    remote = "remote"


class TimeOffStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


# Enum'ы хранятся как строки (см. миграцию 0026) — SQLAlchemy сериализует через
# _kind_setter/_kind_getter ниже. Так избегаем PostgreSQL CREATE TYPE и его гонок.


class TimeOff(Base):
    __tablename__ = "time_off"
    __table_args__ = (
        Index("ix_timeoff_tenant_user", "tenant_id", "user_id"),
        Index("ix_timeoff_tenant_dates", "tenant_id", "start_date", "end_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    kind: Mapped[str] = mapped_column(String(20), default=TimeOffKind.vacation.value, server_default="vacation")
    status: Mapped[str] = mapped_column(String(20), default=TimeOffStatus.pending.value, server_default="pending", index=True)

    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    approver_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id], lazy="joined")  # type: ignore  # noqa: F821
    approver: Mapped[Optional["User"]] = relationship("User", foreign_keys=[approver_id], lazy="joined")  # type: ignore  # noqa: F821
