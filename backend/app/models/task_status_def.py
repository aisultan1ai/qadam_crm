from datetime import datetime
from typing import Optional, Any

from sqlalchemy import String, Integer, ForeignKey, DateTime, Boolean, Index, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB

from ..database import Base


# Категории (для BI и совместимости со стандартными фильтрами).
STATUS_CATEGORIES = ("new", "in_progress", "review", "done", "cancelled")


class TaskStatusDef(Base):
    """Пользовательский статус задачи. Категории — для группировки и BI."""
    __tablename__ = "task_status_defs"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_status_code"),
        Index("ix_status_tenant_order", "tenant_id", "order_index"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)

    code: Mapped[str] = mapped_column(String(40))  # slug
    label: Mapped[str] = mapped_column(String(100))
    color: Mapped[str] = mapped_column(String(20), default="#6B7280")
    category: Mapped[str] = mapped_column(String(20), default="new")  # см. STATUS_CATEGORIES
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_terminal: Mapped[bool] = mapped_column(Boolean, default=False)  # done/cancelled

    # workflow: список кодов, куда МОЖНО переходить из этого статуса. Пусто = куда угодно.
    allowed_next: Mapped[list[str]] = mapped_column(JSONB, default=list)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
