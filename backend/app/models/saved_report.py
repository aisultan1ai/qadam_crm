from datetime import datetime
from typing import Optional, Any

from sqlalchemy import String, Integer, ForeignKey, DateTime, Boolean, Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB

from ..database import Base


class ReportGroup(Base):
    __tablename__ = "report_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SavedReport(Base):
    """Сохранённый отчёт. config = {metric, group_by, from_date, to_date, project_id...}."""
    __tablename__ = "saved_reports"
    __table_args__ = (
        Index("ix_saved_reports_tenant_owner", "tenant_id", "owner_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    owner_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    group_id: Mapped[Optional[int]] = mapped_column(ForeignKey("report_groups.id", ondelete="SET NULL"), nullable=True)

    name: Mapped[str] = mapped_column(String(200))
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    # Расписание — простая CRON-строка (min hour day month dow) или пусто.
    schedule_cron: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    email_to: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)  # опц. кому слать
    is_shared: Mapped[bool] = mapped_column(Boolean, default=False)

    last_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    group: Mapped[Optional["ReportGroup"]] = relationship("ReportGroup", lazy="joined")
