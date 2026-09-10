from datetime import datetime
from typing import Optional, Any

from sqlalchemy import String, Integer, ForeignKey, DateTime, Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB

from ..database import Base


class Whiteboard(Base):
    __tablename__ = "whiteboards"
    __table_args__ = (
        Index("ix_whiteboards_tenant", "tenant_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200), default="Новая доска")
    # Excalidraw scene: {"elements":[...], "appState":{...}, "files":{...}}
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    creator: Mapped[Optional["User"]] = relationship("User", foreign_keys=[created_by], lazy="joined")  # type: ignore  # noqa: F821
    updater: Mapped[Optional["User"]] = relationship("User", foreign_keys=[updated_by], lazy="joined")  # type: ignore  # noqa: F821
