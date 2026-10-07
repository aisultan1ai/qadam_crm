"""Запрос на перенос срока задачи: исполнитель/участник просит, постановщик или аудитор решает."""
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class DeadlineRequest(Base):
    __tablename__ = "deadline_requests"
    __table_args__ = (
        Index("ix_deadline_requests_task_status", "task_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    requested_by_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    old_deadline: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    new_deadline: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    reason: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # pending | approved | rejected | cancelled (заменён новым запросом того же человека)
    status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending")
    decided_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_note: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
