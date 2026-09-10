import enum
from datetime import datetime, date
from typing import Any, Optional

from sqlalchemy import String, Integer, ForeignKey, DateTime, Date, Text, Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB

from ..database import Base


class DealStage(str, enum.Enum):
    new = "new"
    qualified = "qualified"
    proposal = "proposal"
    negotiation = "negotiation"
    won = "won"
    lost = "lost"


class DealStatus(str, enum.Enum):
    open = "open"
    won = "won"
    lost = "lost"


# Дефолтная вероятность (0..100) по каждой стадии — используется в forecast.
STAGE_PROBABILITY: dict[DealStage, int] = {
    DealStage.new: 10,
    DealStage.qualified: 25,
    DealStage.proposal: 50,
    DealStage.negotiation: 75,
    DealStage.won: 100,
    DealStage.lost: 0,
}


class Deal(Base):
    __tablename__ = "deals"
    __table_args__ = (
        Index("ix_deals_tenant_stage", "tenant_id", "stage"),
        Index("ix_deals_tenant_owner", "tenant_id", "owner_id"),
        Index("ix_deals_close_date", "close_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)

    title: Mapped[str] = mapped_column(String(200))
    amount_cents: Mapped[int] = mapped_column(Integer, default=0)  # хранение в центах/тиынах
    currency: Mapped[str] = mapped_column(String(3), default="KZT")

    stage: Mapped[str] = mapped_column(String(20), default=DealStage.new.value, server_default="new", index=True)
    status: Mapped[str] = mapped_column(String(20), default=DealStatus.open.value, server_default="open", index=True)
    probability: Mapped[int] = mapped_column(Integer, default=10)  # 0..100, override дефолта

    contact_id: Mapped[Optional[int]] = mapped_column(ForeignKey("contacts.id", ondelete="SET NULL"), nullable=True, index=True)
    company_id: Mapped[Optional[int]] = mapped_column(ForeignKey("companies.id", ondelete="SET NULL"), nullable=True, index=True)

    owner_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    close_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    owner: Mapped[Optional["User"]] = relationship("User", foreign_keys=[owner_id], lazy="joined")  # type: ignore  # noqa: F821
    contact: Mapped[Optional["Contact"]] = relationship("Contact", foreign_keys=[contact_id], lazy="joined")  # type: ignore  # noqa: F821
    company: Mapped[Optional["Company"]] = relationship("Company", foreign_keys=[company_id], lazy="joined")  # type: ignore  # noqa: F821

    custom_data: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
