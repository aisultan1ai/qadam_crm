import enum
from datetime import datetime, date
from typing import Any, Optional

from decimal import Decimal

from sqlalchemy import BigInteger, Boolean, String, Integer, ForeignKey, DateTime, Date, Text, Index, Numeric, func
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


# ---------------------------------------------------------------------------
# Offtake-воронка (включается в настройках компании: tenants.offtake_enabled)
# ---------------------------------------------------------------------------

class DealPipeline(str, enum.Enum):
    sales = "sales"
    offtake = "offtake"


class OfftakeStage(str, enum.Enum):
    initial_contact = "initial_contact"    # 1 Первичный контакт
    materials_sent = "materials_sent"      # 2 Письмо/презентация отправлены
    nda_signed = "nda_signed"              # 3 NDA подписан
    loi_mou = "loi_mou"                    # 4 Получен LOI / MOU
    term_sheet = "term_sheet"              # 5 Term Sheet согласован
    agreement_draft = "agreement_draft"    # 6 Проект Offtake Agreement
    signed = "signed"                      # 7 Подписан (won)
    refused = "refused"                    # 8 Отказ (lost)


OFFTAKE_STAGE_ORDER: list[OfftakeStage] = list(OfftakeStage)

OFFTAKE_STAGE_LABEL: dict[str, str] = {
    "initial_contact": "Первичный контакт",
    "materials_sent": "Письмо/презентация отправлены",
    "nda_signed": "NDA подписан",
    "loi_mou": "Получен LOI / MOU",
    "term_sheet": "Term Sheet согласован",
    "agreement_draft": "Проект Offtake Agreement",
    "signed": "Подписан",
    "refused": "Отказ",
}

# Вероятность по умолчанию для стадии offtake (0..100).
OFFTAKE_STAGE_PROBABILITY: dict[str, int] = {
    "initial_contact": 5,
    "materials_sent": 10,
    "nda_signed": 20,
    "loi_mou": 35,
    "term_sheet": 55,
    "agreement_draft": 75,
    "signed": 100,
    "refused": 0,
}

# Соответствие стадии offtake стадии обычной воронки: deals.stage остаётся
# согласованным, чтобы прогноз и отчёты по stage/status не ломались.
OFFTAKE_TO_SALES_STAGE: dict[str, str] = {
    "initial_contact": "new",
    "materials_sent": "new",
    "nda_signed": "qualified",
    "loi_mou": "qualified",
    "term_sheet": "proposal",
    "agreement_draft": "negotiation",
    "signed": "won",
    "refused": "lost",
}

# Причины отказа
LOSS_REASONS: dict[str, str] = {
    "price": "Цена",
    "volume": "Объём",
    "timing": "Сроки",
    "logistics": "Логистика",
    "other": "Другое",
}

INCOTERMS = ("EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP")

# Документ сделки: вид
DEAL_DOC_KINDS: dict[str, str] = {
    "nda": "NDA",
    "loi": "LOI",
    "mou": "MOU",
    "term_sheet": "Term Sheet",
    "agreement": "Offtake Agreement",
    "other": "Другое",
}

# Какой документ нужен, чтобы перейти в стадию (и все последующие, кроме «Отказ»)
OFFTAKE_REQUIRED_DOCS: list[tuple[str, str]] = [
    ("nda_signed", "nda"),
    ("term_sheet", "term_sheet"),
]


class OfftakeProduct(Base):
    """Продукт для offtake-сделок — справочник компании, заполняется в настройках."""
    __tablename__ = "offtake_products"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    order_index: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


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
    amount_cents: Mapped[int] = mapped_column(BigInteger, default=0)  # тиыны; BIGINT — крупные сделки (сотни млн ₸)
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

    # Юрлицо компании, от имени которого ведётся запись (миграция 0051)
    legal_entity_id: Mapped[Optional[int]] = mapped_column(ForeignKey("legal_entities.id", ondelete="SET NULL"), nullable=True, index=True)
    legal_entity: Mapped[Optional["LegalEntity"]] = relationship("LegalEntity", foreign_keys=[legal_entity_id], lazy="joined")  # type: ignore  # noqa: F821

    # --- Offtake (миграция 0055); для обычной воронки pipeline="sales", остальные поля пусты
    pipeline: Mapped[str] = mapped_column(String(20), default=DealPipeline.sales.value, server_default="sales")
    offtake_stage: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    # Вероятность задана вручную: смена стадии её не перезаписывает (кроме «Подписан»/«Отказ»)
    probability_manual: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    loss_reason: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    loss_comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    product_id: Mapped[Optional[int]] = mapped_column(ForeignKey("offtake_products.id", ondelete="SET NULL"), nullable=True, index=True)
    product: Mapped[Optional["OfftakeProduct"]] = relationship("OfftakeProduct", foreign_keys=[product_id], lazy="joined")
    volume_tpy: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 3), nullable=True)  # тонн в год
    term_years: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    start_year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    total_volume: Mapped[Optional[Decimal]] = mapped_column(Numeric(20, 3), nullable=True)  # = volume_tpy × term_years (сервер)
    price_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # fixed | index
    price_value: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 2), nullable=True)  # за тонну, фикс
    index_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    discount_value: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 2), nullable=True)
    discount_unit: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # per_t | pct
    incoterms: Mapped[Optional[str]] = mapped_column(String(5), nullable=True)
    delivery_point: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
