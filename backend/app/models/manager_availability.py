"""Рабочие часы и доступность менеджера для распределения лидов.

Одна запись на пару (tenant_id, user_id). Владелец компании может редактировать
чужие записи; менеджер — только свою.

working_hours формат:
    {
        "monday": [9, 18],       # с 9:00 до 18:00
        "tuesday": [9, 18],
        ...
        "sunday": null           # выходной
    }
Ключи — английские названия дней в нижнем регистре.

Часовой пояс IANA (например Asia/Almaty). Проверка «на смене» делает конверсию
серверного UTC в локальное время менеджера.

weekly_quota — макс кол-во активных лидов на менеджера. Проверка учитывает
`TenantLead.status in ('new','contacted','qualified')`. `0` = без ограничений.
"""
from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import (
    Boolean, Date, DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


DEFAULT_WORKING_HOURS: dict[str, list[int] | None] = {
    "monday": [9, 18],
    "tuesday": [9, 18],
    "wednesday": [9, 18],
    "thursday": [9, 18],
    "friday": [9, 18],
    "saturday": None,
    "sunday": None,
}


class ManagerAvailability(Base):
    __tablename__ = "manager_availability"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", name="uq_manager_availability_tenant_user"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Almaty", server_default="Asia/Almaty")
    working_hours: Mapped[Any] = mapped_column(JSON, default=lambda: DEFAULT_WORKING_HOURS)
    weekly_quota: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    is_available: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    vacation_from: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    vacation_until: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship("User", lazy="joined")  # type: ignore  # noqa: F821
