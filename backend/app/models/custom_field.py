from datetime import datetime
from typing import Optional, Any

from sqlalchemy import String, Integer, ForeignKey, DateTime, Boolean, Index, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import JSONB

from ..database import Base


CUSTOM_FIELD_ENTITY_TYPES = ("task", "project", "contact", "company", "deal")
CUSTOM_FIELD_TYPES = ("text", "textarea", "number", "date", "select", "checkbox", "user", "relation")


class CustomFieldDef(Base):
    """Определение пользовательского поля для одной из entity-типов.

    Значения хранятся в JSONB-колонке `custom_data` на самой сущности.
    """
    __tablename__ = "custom_field_defs"
    __table_args__ = (
        UniqueConstraint("tenant_id", "entity_type", "code", name="uq_custom_field_code"),
        Index("ix_custom_field_entity", "tenant_id", "entity_type", "order_index"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)

    entity_type: Mapped[str] = mapped_column(String(30))
    code: Mapped[str] = mapped_column(String(50))  # snake_case
    label: Mapped[str] = mapped_column(String(100))
    field_type: Mapped[str] = mapped_column(String(30))  # см. CUSTOM_FIELD_TYPES
    options: Mapped[Optional[list[str]]] = mapped_column(JSONB, nullable=True)  # для select
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    order_index: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
