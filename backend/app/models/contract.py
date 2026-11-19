"""Реестр договоров (миграция 0056).

Contract — договор с контрагентом от имени одного из юрлиц компании.
Для EPC-договоров — этапы, банковские гарантии, удержания и штрафные санкции (отдельные таблицы).
ContractReminderMark — отметки об уже отправленных напоминаниях об истечении сроков (без повторов).
Файлы договора — обычные документы (documents.contract_id).
"""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


CONTRACT_TYPES = {
    "offtake": "Оффтейк",
    "epc": "EPC",
    "supply": "Поставка",
    "services": "Услуги",
    "lease": "Аренда",
    "other": "Прочее",
}

CONTRACT_STATUSES = {
    "draft": "Черновик",
    "approval": "На согласовании",
    "signing": "На подписании",
    "active": "Действует",
    "completed": "Исполнен",
    "terminated": "Расторгнут",
}

# НДС: без НДС / сверху суммы / в том числе (сумма уже с НДС)
VAT_MODES = {"none": "Без НДС", "on_top": "НДС сверху", "included": "В т.ч. НДС"}

GUARANTEE_KINDS = {
    "advance": "Авансовая",
    "performance": "Исполнения обязательств",
    "warranty": "Гарантийная",
    "other": "Другая",
}


class Contract(Base):
    __tablename__ = "contracts"
    __table_args__ = (
        Index("ix_contracts_tenant_status", "tenant_id", "status"),
        Index("ix_contracts_tenant_valid_until", "tenant_id", "valid_until"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)

    number: Mapped[str] = mapped_column(String(100))
    date_signed: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    legal_entity_id: Mapped[Optional[int]] = mapped_column(ForeignKey("legal_entities.id", ondelete="SET NULL"), nullable=True, index=True)
    company_id: Mapped[Optional[int]] = mapped_column(ForeignKey("companies.id", ondelete="SET NULL"), nullable=True, index=True)
    contract_type: Mapped[str] = mapped_column(String(20), default="other", server_default="other")
    subject: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 2), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="KZT", server_default="KZT")
    vat_mode: Mapped[str] = mapped_column(String(10), default="none", server_default="none")
    vat_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("12"), server_default="12")

    valid_from: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    valid_until: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    auto_renewal: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    responsible_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    lawyer_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    deal_id: Mapped[Optional[int]] = mapped_column(ForeignKey("deals.id", ondelete="SET NULL"), nullable=True, index=True)
    project_id: Mapped[Optional[int]] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True)

    status: Mapped[str] = mapped_column(String(20), default="draft", server_default="draft")
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    legal_entity: Mapped[Optional["LegalEntity"]] = relationship("LegalEntity", foreign_keys=[legal_entity_id], lazy="joined")  # type: ignore  # noqa: F821
    company: Mapped[Optional["Company"]] = relationship("Company", foreign_keys=[company_id], lazy="joined")  # type: ignore  # noqa: F821
    responsible: Mapped[Optional["User"]] = relationship("User", foreign_keys=[responsible_user_id], lazy="joined")  # type: ignore  # noqa: F821
    lawyer: Mapped[Optional["User"]] = relationship("User", foreign_keys=[lawyer_user_id], lazy="joined")  # type: ignore  # noqa: F821
    deal: Mapped[Optional["Deal"]] = relationship("Deal", foreign_keys=[deal_id], lazy="select")  # type: ignore  # noqa: F821
    project: Mapped[Optional["Project"]] = relationship("Project", foreign_keys=[project_id], lazy="select")  # type: ignore  # noqa: F821


class ContractStage(Base):
    __tablename__ = "contract_stages"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    contract_id: Mapped[int] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(300))
    planned_start: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    planned_end: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 2), nullable=True)
    percent_complete: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    order_index: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ContractGuarantee(Base):
    __tablename__ = "contract_guarantees"
    __table_args__ = (
        Index("ix_contract_guarantees_valid_until", "valid_until"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    contract_id: Mapped[int] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="other", server_default="other")
    bank_name: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 2), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="KZT", server_default="KZT")
    valid_until: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ContractRetention(Base):
    __tablename__ = "contract_retentions"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    contract_id: Mapped[int] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), index=True)
    description: Mapped[str] = mapped_column(Text)
    percent: Mapped[Optional[Decimal]] = mapped_column(Numeric(7, 3), nullable=True)
    amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 2), nullable=True)
    release_condition: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    release_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ContractPenalty(Base):
    __tablename__ = "contract_penalties"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    contract_id: Mapped[int] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), index=True)
    description: Mapped[str] = mapped_column(Text)
    # Размер: процент (например, 0,1% за день просрочки) и/или фиксированная сумма
    rate_percent: Mapped[Optional[Decimal]] = mapped_column(Numeric(7, 3), nullable=True)
    amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 2), nullable=True)
    basis: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # основание: пункт договора, условие
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ContractReminderMark(Base):
    """Отправленное напоминание: (договор|гарантия, за сколько дней, на какую дату окончания).
    Дата окончания в ключе — если срок продлили, напоминания по новой дате придут снова."""
    __tablename__ = "contract_reminder_marks"
    __table_args__ = (
        UniqueConstraint("kind", "object_id", "days", "target_date", name="uq_contract_reminder_mark"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # contract | guarantee
    object_id: Mapped[int] = mapped_column(Integer)
    days: Mapped[int] = mapped_column(Integer)
    target_date: Mapped[date] = mapped_column(Date)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
