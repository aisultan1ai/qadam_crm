"""Обязательства и сроки по договору (миграция 0060).

ContractObligation — что и к какому сроку должна сделать сторона договора: мы, контрагент или обе.
Заводятся вручную или из предложений ИИ (после подтверждения пользователем).
Напоминания о приближении срока — Celery-задача contracts.obligation_reminders
(отметки об отправке — в contract_reminder_marks с kind="obligation", без повторов).
"""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base

OBLIGATION_PARTIES = {"us": "Мы", "counterparty": "Контрагент", "both": "Обе стороны"}
OBLIGATION_STATUSES = {"open": "Открыто", "done": "Выполнено"}


class ContractObligation(Base):
    __tablename__ = "contract_obligations"
    __table_args__ = (
        Index("ix_contract_obligations_tenant_due", "tenant_id", "status", "due_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    contract_id: Mapped[int] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    party: Mapped[str] = mapped_column(String(20), default="us", server_default="us")
    status: Mapped[str] = mapped_column(String(10), default="open", server_default="open")
    source_quote: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    done_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
