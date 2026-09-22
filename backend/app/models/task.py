import enum
from datetime import datetime
from typing import Any, List, Optional

from sqlalchemy import String, Integer, ForeignKey, Boolean, DateTime, Text, Enum, Index, Table, Column, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB

from ..database import Base


# ----------------------------------------------------------------------------
# many-to-many связи задачи с пользователями
# ----------------------------------------------------------------------------

task_assignees = Table(
    "task_assignees",
    Base.metadata,
    Column("task_id", Integer, ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("added_at", DateTime(timezone=True), server_default=func.now(), nullable=False),
)

task_auditors = Table(
    "task_auditors",
    Base.metadata,
    Column("task_id", Integer, ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("added_at", DateTime(timezone=True), server_default=func.now(), nullable=False),
)

task_participants = Table(
    "task_participants",
    Base.metadata,
    Column("task_id", Integer, ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("added_at", DateTime(timezone=True), server_default=func.now(), nullable=False),
)


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
        Index("ix_tasks_tenant_status", "tenant_id", "status"),
        Index("ix_tasks_project_status", "project_id", "status"),
        Index("ix_tasks_assignee_status", "assignee_id", "status"),
        Index("ix_tasks_project_order", "project_id", "order_index"),
        Index("ix_tasks_deadline", "deadline"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
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

    start_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    deadline: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    order_index: Mapped[int] = mapped_column(Integer, default=0)

    # --- P3 расширения ---
    # Подзадачи: parent_task_id → Task.id той же таблицы.
    parent_task_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True)

    # Пользовательский статус (foreign key к task_status_defs; если NULL — используется enum status).
    custom_status_id: Mapped[Optional[int]] = mapped_column(ForeignKey("task_status_defs.id", ondelete="SET NULL"), nullable=True, index=True)

    # Периодическая задача (iCal RRULE).
    recurrence_rule: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    recurrence_parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True)
    recurrence_next_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    # E-mail inbox токен для приёма писем в задачу.
    inbox_token: Mapped[Optional[str]] = mapped_column(String(32), nullable=True, unique=True, index=True)

    # Пользовательские поля (значения). Ключи — code из custom_field_defs.
    custom_data: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")

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

    # ---- Planfix-style роли (many-to-many) ---------------------------------
    # Множественные исполнители. Legacy assignee_id остаётся как "primary".
    assignees: Mapped[List["User"]] = relationship(  # type: ignore  # noqa: F821
        "User", secondary=task_assignees, lazy="selectin",
    )
    # Аудиторы (read-only + получают уведомления, не могут менять статус/комментировать).
    auditors: Mapped[List["User"]] = relationship(  # type: ignore  # noqa: F821
        "User", secondary=task_auditors, lazy="selectin",
    )
    # Участники (могут комментировать, получают уведомления о комментариях).
    participants: Mapped[List["User"]] = relationship(  # type: ignore  # noqa: F821
        "User", secondary=task_participants, lazy="selectin",
    )
    reminders: Mapped[List["TaskReminder"]] = relationship(
        "TaskReminder", back_populates="task", cascade="all, delete-orphan", lazy="selectin",
        order_by="TaskReminder.offset_minutes",
    )


class ChecklistItem(Base):
    __tablename__ = "checklist_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    text: Mapped[str] = mapped_column(String(500))
    done: Mapped[bool] = mapped_column(Boolean, default=False)

    task: Mapped["Task"] = relationship("Task", back_populates="checklist")


class TaskReminder(Base):
    __tablename__ = "task_reminders"
    __table_args__ = (
        Index("ix_task_reminders_task_kind_offset", "task_id", "kind", "offset_minutes", unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    # before_deadline | before_start
    kind: Mapped[str] = mapped_column(String(32), default="before_deadline", server_default="before_deadline")
    offset_minutes: Mapped[int] = mapped_column(Integer)
    fired_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    task: Mapped["Task"] = relationship("Task", back_populates="reminders")
