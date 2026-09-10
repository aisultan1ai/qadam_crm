from datetime import datetime
from typing import Optional

from sqlalchemy import String, Integer, ForeignKey, DateTime, Index, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


# Виды связей. Planfix: blocks, blocked_by, relates, duplicates.
# blocks/blocked_by — обратная пара (при создании A blocks B создаётся B blocked_by A).
LINK_KINDS = ("blocks", "blocked_by", "relates", "duplicates")


class TaskLink(Base):
    __tablename__ = "task_links"
    __table_args__ = (
        UniqueConstraint("from_task_id", "to_task_id", "kind", name="uq_task_link"),
        Index("ix_task_links_from", "from_task_id"),
        Index("ix_task_links_to", "to_task_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    from_task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    to_task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(20))
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
