from datetime import datetime
from typing import Optional, Any

from sqlalchemy import String, Integer, ForeignKey, DateTime, Index, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB

from ..database import Base


class CustomObjectSchema(Base):
    """Schema-level: описание пользовательской сущности (BPM-объекты).

    fields JSONB: [{"name":"amount","label":"Сумма","type":"number","required":true}, ...]
    Типы полей: text, textarea, number, date, select, checkbox, user, relation
    """
    __tablename__ = "custom_object_schemas"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_custom_schema_code"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(50))  # slug: contract, invoice, ticket…
    label: Mapped[str] = mapped_column(String(100))  # человекочитаемое
    icon: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)  # lucide icon key
    fields: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)

    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class CustomObjectRecord(Base):
    """Row-level: запись пользовательского объекта.

    data JSONB: {"field_name": value}. Валидация типов — на API-слое.
    """
    __tablename__ = "custom_object_records"
    __table_args__ = (
        Index("ix_custom_records_schema", "schema_id"),
        Index("ix_custom_records_tenant_schema", "tenant_id", "schema_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    schema_id: Mapped[int] = mapped_column(ForeignKey("custom_object_schemas.id", ondelete="CASCADE"))

    title: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)  # denormalized display
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    schema: Mapped["CustomObjectSchema"] = relationship("CustomObjectSchema", lazy="joined")
