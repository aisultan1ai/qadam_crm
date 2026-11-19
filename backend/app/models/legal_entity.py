"""Юрлица компании-клиента (tenant'а): от чьего имени ведутся сделки, проекты, договоры и документы.

У каждой компании минимум одно юрлицо «по умолчанию»; если юрлиц несколько,
в формах появляется выбор, а в списках — название юрлица.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class LegalEntity(Base):
    __tablename__ = "legal_entities"
    __table_args__ = (
        Index("ix_legal_entities_tenant_default", "tenant_id", "is_default"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)

    full_name: Mapped[str] = mapped_column(String(300))
    short_name: Mapped[str] = mapped_column(String(200))
    bin: Mapped[Optional[str]] = mapped_column(String(12), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    director_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    director_position: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    logo_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="KZT", server_default="KZT")

    is_default: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
