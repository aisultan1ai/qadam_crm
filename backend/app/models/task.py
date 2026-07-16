import enum
from datetime import datetime
from sqlalchemy import String, Integer, ForeignKey, Boolean, DateTime, Text, Enum, Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from typing import List, Optional

from ..database import Base


class TaskStatus(str, enum.Enum):
    new = "new"
    in_progress = "in_progress"
    review = "review"
    done = "done"
    cancelled = "cancelled"


class TaskPriority(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        Index("ix_tasks_project_status", "project_id", "status"),
        Index("ix_tasks_assignee_status", "assignee_id", "status"),
        Index("ix_tasks_project_order", "project_id", "order_index"),
        Index("ix_tasks_deadline", "deadline"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(300), index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    status: Mapped[TaskStatus] = mapped_column(Enum(TaskStatus), default=TaskStatus.new, index=True)
    priority: Mapped[TaskPriority] = mapped_column(Enum(TaskPriority), default=TaskPriority.medium, index=True)

    project_id: Mapped[Optional[int]] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True)
    project: Mapped[Optional["Project"]] = relationship("Project", lazy="joined")  # type: ignore  # noqa: F821

    assignee_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    assignee: Mapped[Optional["User"]] = relationship("User", foreign_keys=[assignee_id], lazy="joined")  # type: ignore  # noqa: F821

    author_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    author: Mapped[Optional["User"]] = relationship("User", foreign_keys=[author_id], lazy="joined")  # type: ignore  # noqa: F821

    deadline: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    order_index: Mapped[int] = mapped_column(Integer, default=0)

    checklist: Mapped[List["ChecklistItem"]] = relationship(
        "ChecklistItem", back_populates="task", cascade="all, delete-orphan", lazy="selectin", order_by="ChecklistItem.id"
    )
    comments: Mapped[List["Comment"]] = relationship(  # type: ignore  # noqa: F821
        "Comment", back_populates="task", cascade="all, delete-orphan", lazy="selectin", order_by="Comment.created_at"
    )
    attachments: Mapped[List["Attachment"]] = relationship(  # type: ignore  # noqa: F821
        "Attachment", back_populates="task", cascade="all, delete-orphan", lazy="selectin"
    )
    activities: Mapped[List["ActivityLog"]] = relationship(  # type: ignore  # noqa: F821
        "ActivityLog", back_populates="task", cascade="all, delete-orphan", lazy="selectin", order_by="ActivityLog.created_at.desc()"
    )


class ChecklistItem(Base):
    __tablename__ = "checklist_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    text: Mapped[str] = mapped_column(String(500))
    done: Mapped[bool] = mapped_column(Boolean, default=False)

    task: Mapped["Task"] = relationship("Task", back_populates="checklist")
