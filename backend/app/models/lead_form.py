from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class LeadForm(Base):
    """Публичная форма захвата лидов, принадлежит tenant'у.

    fields_config — список объектов вида:
        [
          {"key": "name",  "label": "Имя",   "type": "text",     "required": true},
          {"key": "phone", "label": "Телефон","type": "phone",   "required": true},
          {"key": "message","label": "Сообщение","type": "textarea","required": false},
        ]
    """
    __tablename__ = "lead_forms"
    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_lead_forms_tenant_slug"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(80), index=True)
    title: Mapped[str] = mapped_column(String(200), default="Оставьте заявку")
    subtitle: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    submit_label: Mapped[str] = mapped_column(String(80), default="Отправить")
    success_message: Mapped[str] = mapped_column(Text, default="Спасибо! Мы свяжемся с вами.")
    brand_color: Mapped[str] = mapped_column(String(20), default="#0f67fd")
    fields_config: Mapped[Any] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    # Стратегия распределения новых лидов между менеджерами:
    #   manual       — assignee пуст, менеджер назначается вручную
    #   round_robin  — по кругу среди менеджеров с leads.view
    #   least_loaded — тот, у кого меньше открытых лидов
    #   schedule     — только менеджеры на смене (working_hours + не в отпуске + не превысил quota)
    assignee_strategy: Mapped[str] = mapped_column(String(20), default="manual", server_default="manual")
    default_assignee_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class TenantLead(Base):
    """Лид, поступивший в конкретный tenant через LeadForm (или созданный вручную)."""
    __tablename__ = "tenant_leads"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    form_id: Mapped[Optional[int]] = mapped_column(ForeignKey("lead_forms.id", ondelete="SET NULL"), nullable=True, index=True)

    name: Mapped[str] = mapped_column(String(200))
    contact: Mapped[str] = mapped_column(String(255), index=True)
    custom_fields: Mapped[Any] = mapped_column(JSON, default=dict)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(String(20), default="new", server_default="new", index=True)
    source: Mapped[str] = mapped_column(String(50), default="form")

    assignee_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    converted_task_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)

    ip_address: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    referer: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    form: Mapped[Optional["LeadForm"]] = relationship("LeadForm", lazy="joined")
