"""Журнал просмотров: кто и когда открывал запись (документ, позже — договор).

Отдельно от журнала действий: просмотр — не изменение, и строк здесь много.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import String, Integer, ForeignKey, DateTime, Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class RecordView(Base):
    __tablename__ = "record_views"
    __table_args__ = (
        Index("ix_record_views_entity", "tenant_id", "entity_type", "entity_id", "viewed_at"),
        Index("ix_record_views_user_entity", "user_id", "entity_type", "entity_id", "viewed_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    # NULL — открыли по публичной ссылке без входа.
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    entity_type: Mapped[str] = mapped_column(String(50))
    entity_id: Mapped[int] = mapped_column(Integer)
    ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    viewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[Optional["User"]] = relationship("User", lazy="joined")  # type: ignore  # noqa: F821
