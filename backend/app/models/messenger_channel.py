"""Модели «Открытых линий» — внешние мессенджеры (Telegram/WhatsApp/Instagram).

Все каналы моделируются одинаково:
- ExternalChannel — подключение (bot_token, api_key и т.п. per-провайдер)
- ExternalContact — конкретный клиент, приходящий через канал
- ExternalConversation — диалог с этим клиентом
- ExternalMessage — сообщения внутри диалога

provider_config хранит секреты провайдера (bot_token у Telegram, api_key у WhatsApp).
Secrets стоит шифровать на диске — сейчас хранятся plain, шифрование добавим отдельным
модулем на security-этапе (todo: symmetric encryption).
"""
from datetime import datetime
from enum import Enum
from typing import Any, List, Optional

from sqlalchemy import (
    Boolean, DateTime, Enum as SAEnum, ForeignKey, Index, Integer, JSON, String, Text,
    UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class ChannelKind(str, Enum):
    telegram = "telegram"
    whatsapp = "whatsapp"
    instagram = "instagram"


class MessageDirection(str, Enum):
    inbound = "inbound"
    outbound = "outbound"


class MessageStatus(str, Enum):
    pending = "pending"
    sent = "sent"
    delivered = "delivered"
    read = "read"
    failed = "failed"


class ExternalChannel(Base):
    __tablename__ = "external_channels"
    __table_args__ = (
        Index("ix_external_channels_tenant_kind", "tenant_id", "kind"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)

    kind: Mapped[ChannelKind] = mapped_column(SAEnum(ChannelKind, name="channel_kind"))
    name: Mapped[str] = mapped_column(String(200))

    # Секреты + настройки провайдера. Формат см. в services/messengers/*.py.
    provider_config: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")

    # Публичная информация о канале — @username бота, номер телефона WhatsApp, IG page id.
    external_identifier: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    # Webhook secret — валидация входящих запросов.
    webhook_secret: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    contacts: Mapped[List["ExternalContact"]] = relationship(
        "ExternalContact", back_populates="channel", cascade="all, delete-orphan", lazy="selectin",
    )


class ExternalContact(Base):
    """Клиент, которого мы видим через внешний канал (chat_id в Telegram и т.п.)."""
    __tablename__ = "external_contacts"
    __table_args__ = (
        UniqueConstraint("channel_id", "external_id", name="uq_external_contacts_channel_external"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    channel_id: Mapped[int] = mapped_column(
        ForeignKey("external_channels.id", ondelete="CASCADE"), index=True
    )

    # ID клиента у провайдера: chat.id для Telegram, wa_id для WhatsApp, sender.id для IG.
    external_id: Mapped[str] = mapped_column(String(200))
    username: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    display_name: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Связка с внутренним лидом / юзером (если есть).
    linked_lead_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("tenant_leads.id", ondelete="SET NULL"), nullable=True, index=True
    )

    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    channel: Mapped[ExternalChannel] = relationship("ExternalChannel", back_populates="contacts", lazy="joined")


class ExternalConversation(Base):
    __tablename__ = "external_conversations"
    __table_args__ = (
        Index("ix_external_conversations_tenant_last", "tenant_id", "last_message_at"),
        Index("ix_external_conversations_channel_last", "channel_id", "last_message_at"),
        UniqueConstraint("channel_id", "contact_id", name="uq_external_conversations_channel_contact"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    channel_id: Mapped[int] = mapped_column(ForeignKey("external_channels.id", ondelete="CASCADE"), index=True)
    contact_id: Mapped[int] = mapped_column(ForeignKey("external_contacts.id", ondelete="CASCADE"), index=True)

    assignee_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True,
    )

    last_message_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_message_preview: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    unread_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_closed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    channel: Mapped[ExternalChannel] = relationship("ExternalChannel", lazy="joined")
    contact: Mapped[ExternalContact] = relationship("ExternalContact", lazy="joined")


class ExternalMessage(Base):
    __tablename__ = "external_messages"
    __table_args__ = (
        Index("ix_external_messages_conv_created", "conversation_id", "created_at"),
        Index("ix_external_messages_tenant_created", "tenant_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("external_conversations.id", ondelete="CASCADE"), index=True
    )

    direction: Mapped[MessageDirection] = mapped_column(
        SAEnum(MessageDirection, name="external_message_direction")
    )
    status: Mapped[MessageStatus] = mapped_column(
        SAEnum(MessageStatus, name="external_message_status"),
        default=MessageStatus.pending,
    )

    # Кто отправил (только для outbound — user_id менеджера; inbound — NULL).
    sender_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )

    # ID сообщения у провайдера (для идемпотентности и статус-callback'ов)
    external_message_id: Mapped[Optional[str]] = mapped_column(String(200), nullable=True, index=True)

    body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    media: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Флаг что сообщение сгенерил бот (auto-reply)
    is_auto: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AutoReplyKind(str, Enum):
    welcome = "welcome"
    off_hours = "off_hours"
    keyword = "keyword"


class AutoReplyRule(Base):
    __tablename__ = "auto_reply_rules"
    __table_args__ = (
        Index("ix_auto_reply_rules_channel_kind", "channel_id", "kind"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    channel_id: Mapped[int] = mapped_column(
        ForeignKey("external_channels.id", ondelete="CASCADE"), index=True
    )

    kind: Mapped[AutoReplyKind] = mapped_column(SAEnum(AutoReplyKind, name="auto_reply_kind"))
    trigger_config: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    response_text: Mapped[str] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    priority: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class MessageTemplate(Base):
    """Шаблон быстрого ответа. Для WhatsApp — маппится на утверждённый HSM-template."""
    __tablename__ = "message_templates"
    __table_args__ = (
        Index("ix_message_templates_tenant_kind", "tenant_id", "kind"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)

    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(40), default="text", server_default="text")
    body: Mapped[str] = mapped_column(Text)
    language: Mapped[str] = mapped_column(String(10), default="ru", server_default="ru")

    # Для WhatsApp — ID/имя утверждённого HSM-шаблона у BSP
    whatsapp_template_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
