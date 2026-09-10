from datetime import datetime
from typing import Optional

from sqlalchemy import String, Integer, ForeignKey, DateTime, Text, Boolean, Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class Reminder(Base):
    """Напоминание на конкретное время (или повторяющееся).

    target_type + target_id — привязка к задаче/контакту/сделке (nullable — можно и free-form).
    recurrence_rule — iCal RRULE, например "FREQ=WEEKLY;BYDAY=MO,TH".
    """
    __tablename__ = "reminders"
    __table_args__ = (
        Index("ix_reminders_tenant_next", "tenant_id", "next_at"),
        Index("ix_reminders_user_next", "user_id", "next_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    target_type: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)  # task, contact, deal, project, free
    target_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    message: Mapped[str] = mapped_column(Text)
    next_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    recurrence_rule: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    fired_count: Mapped[int] = mapped_column(Integer, default=0)
    last_fired_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
