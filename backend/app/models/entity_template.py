from datetime import datetime
from typing import Optional, Any

from sqlalchemy import String, Integer, ForeignKey, DateTime, Index, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import JSONB

from ..database import Base


ENTITY_TYPES = ("task", "project", "contact", "company", "deal", "document")


class EntityTemplate(Base):
    """Шаблон сущности. payload — то, что подставим при создании (title, description, priority, checklist...).

    entity_type — на что распространяется. Хранение позволяет вложенные структуры (например, checklist).
    """
    __tablename__ = "entity_templates"
    __table_args__ = (
        Index("ix_templates_tenant_type", "tenant_id", "entity_type"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)

    entity_type: Mapped[str] = mapped_column(String(30))
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
