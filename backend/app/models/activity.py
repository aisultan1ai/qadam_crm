from datetime import datetime
from sqlalchemy import Boolean, String, Integer, ForeignKey, DateTime, Index, UniqueConstraint, func, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from typing import Optional

from ..database import Base


class ActivityLog(Base):
    __tablename__ = "activity_logs"
    __table_args__ = (
        Index("ix_activity_tenant_created", "tenant_id", "created_at"),
        Index("ix_activity_task_created", "task_id", "created_at"),
        Index("ix_activity_user_created", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True
    )
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    task_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(100))
    entity: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    entity_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    user: Mapped[Optional["User"]] = relationship("User", lazy="joined")  # type: ignore  # noqa: F821
    task: Mapped[Optional["Task"]] = relationship("Task", back_populates="activities")  # type: ignore  # noqa: F821


class ActivityState(Base):
    """Личное состояние события ленты: прочитано / «лайк» конкретным пользователем."""
    __tablename__ = "activity_states"
    __table_args__ = (
        UniqueConstraint("activity_id", "user_id", name="uq_activity_states_activity_user"),
        Index("ix_activity_states_user", "user_id", "is_read"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    activity_id: Mapped[int] = mapped_column(ForeignKey("activity_logs.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    liked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
