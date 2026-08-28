"""Модели автоматизаций (rule engine + история запусков).

Automation — сама автоматизация: triggering event + JSON graph (nodes+edges для React Flow).
AutomationRun — один запуск: полный payload события + агрегированный статус.
AutomationAction — исполнение конкретной action-node в рамках Run: статус, результат, ETA для delay-actions.
"""
from datetime import datetime
from enum import Enum
from typing import List, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, JSON, String, Text, Enum as SAEnum, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class AutomationRunStatus(str, Enum):
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    partial = "partial"


class AutomationActionStatus(str, Enum):
    pending = "pending"
    scheduled = "scheduled"      # delay-action, ждёт ETA в Celery
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    skipped = "skipped"


class Automation(Base):
    __tablename__ = "automations"
    __table_args__ = (
        Index("ix_automations_tenant_active", "tenant_id", "is_active"),
        Index("ix_automations_tenant_trigger", "tenant_id", "trigger_event"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)

    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    trigger_event: Mapped[str] = mapped_column(String(80), index=True)
    trigger_config: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    graph: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")

    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    runs: Mapped[List["AutomationRun"]] = relationship(
        "AutomationRun", back_populates="automation", cascade="all, delete-orphan", lazy="selectin"
    )


class AutomationRun(Base):
    __tablename__ = "automation_runs"
    __table_args__ = (
        Index("ix_automation_runs_tenant_created", "tenant_id", "triggered_at"),
        Index("ix_automation_runs_automation_created", "automation_id", "triggered_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    automation_id: Mapped[int] = mapped_column(
        ForeignKey("automations.id", ondelete="CASCADE"), index=True
    )
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True
    )

    triggered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    status: Mapped[AutomationRunStatus] = mapped_column(
        SAEnum(AutomationRunStatus, name="automation_run_status"),
        default=AutomationRunStatus.running,
    )
    trigger_payload: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    is_dry_run: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    automation: Mapped[Automation] = relationship("Automation", back_populates="runs", lazy="joined")
    actions: Mapped[List["AutomationAction"]] = relationship(
        "AutomationAction", back_populates="run", cascade="all, delete-orphan", lazy="selectin",
        order_by="AutomationAction.id",
    )


class AutomationAction(Base):
    __tablename__ = "automation_actions"
    __table_args__ = (
        Index("ix_automation_actions_scheduled", "status", "scheduled_for"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(
        ForeignKey("automation_runs.id", ondelete="CASCADE"), index=True
    )
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True
    )

    # Ссылка на node в graph.nodes (React Flow node id)
    node_id: Mapped[str] = mapped_column(String(64))
    action_type: Mapped[str] = mapped_column(String(40))
    node_config: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")

    status: Mapped[AutomationActionStatus] = mapped_column(
        SAEnum(AutomationActionStatus, name="automation_action_status"),
        default=AutomationActionStatus.pending,
    )
    scheduled_for: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    executed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    result: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Ключ Celery-задачи для delay-actions (для отладки/отмены)
    celery_task_id: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)

    run: Mapped[AutomationRun] = relationship("AutomationRun", back_populates="actions")
