from datetime import datetime
from typing import Optional, Any

from sqlalchemy import String, Integer, ForeignKey, DateTime, Text, Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB

from ..database import Base


class Call(Base):
    __tablename__ = "calls"
    __table_args__ = (
        Index("ix_calls_tenant_started", "tenant_id", "started_at"),
        Index("ix_calls_user", "user_id"),
        Index("ix_calls_contact", "contact_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)

    provider: Mapped[str] = mapped_column(String(30), default="manual")  # manual, twilio, voximplant
    external_id: Mapped[Optional[str]] = mapped_column(String(200), nullable=True, index=True)

    direction: Mapped[str] = mapped_column(String(10))  # inbound / outbound
    status: Mapped[str] = mapped_column(String(20), default="completed")  # ringing/in_progress/completed/missed/failed

    from_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    to_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    duration_sec: Mapped[int] = mapped_column(Integer, default=0)

    recording_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    contact_id: Mapped[Optional[int]] = mapped_column(ForeignKey("contacts.id", ondelete="SET NULL"), nullable=True)
    deal_id: Mapped[Optional[int]] = mapped_column(ForeignKey("deals.id", ondelete="SET NULL"), nullable=True)

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    raw: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)  # webhook payload

    user: Mapped[Optional["User"]] = relationship("User", foreign_keys=[user_id], lazy="joined")  # type: ignore  # noqa: F821
    contact: Mapped[Optional["Contact"]] = relationship("Contact", foreign_keys=[contact_id], lazy="joined")  # type: ignore  # noqa: F821
