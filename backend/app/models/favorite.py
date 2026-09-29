from datetime import datetime

from sqlalchemy import String, Integer, ForeignKey, DateTime, Index, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


# Что можно добавить в избранное (сайдбар «Избранное», как в ClickUp).
FAVORITE_ENTITIES = ("project", "task", "wiki")


class Favorite(Base):
    """Избранное пользователя в рамках компании: проект, задача или статья базы знаний."""
    __tablename__ = "user_favorites"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", "entity", "entity_id", name="uq_user_favorite"),
        Index("ix_user_favorites_owner", "tenant_id", "user_id", "order_index"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    entity: Mapped[str] = mapped_column(String(20))
    entity_id: Mapped[int] = mapped_column(Integer)
    order_index: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
