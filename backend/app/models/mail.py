"""Email как канал CRM: mailbox per-user, threading по Message-ID, вложения.

Все чувствительные поля (пароли IMAP/SMTP) шифруются через `core/secrets.py`.
Threading:
- inbound: подтягиваем `Message-ID`, `In-Reply-To`, `References` из заголовков;
  ищем thread по: (1) любому Message-ID из References; (2) normalized subject
  (Re:/Fwd: удаляются) + участники; создаём новый если не нашли
- outbound: генерим `Message-ID` = uuid@domain, ставим In-Reply-To/References
  цепочкой из последнего сообщения треда
"""
from datetime import datetime
from enum import Enum
from typing import Any, List, Optional

from sqlalchemy import (
    BigInteger, Boolean, DateTime, Enum as SAEnum, ForeignKey, Index, Integer, JSON, String,
    Text, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class MailDirection(str, Enum):
    inbound = "inbound"
    outbound = "outbound"


class MailStatus(str, Enum):
    pending = "pending"
    sent = "sent"
    failed = "failed"
    received = "received"


class Mailbox(Base):
    """IMAP+SMTP настройки для конкретного юзера. Один mailbox на юзера в tenant."""
    __tablename__ = "mailboxes"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", name="uq_mailboxes_tenant_user"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(320), index=True)
    reply_to_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    imap_host: Mapped[str] = mapped_column(String(200))
    imap_port: Mapped[int] = mapped_column(Integer, default=993)
    imap_ssl: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    imap_user: Mapped[str] = mapped_column(String(200))
    imap_password_enc: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    imap_folder: Mapped[str] = mapped_column(String(100), default="INBOX", server_default="INBOX")

    smtp_host: Mapped[str] = mapped_column(String(200))
    smtp_port: Mapped[int] = mapped_column(Integer, default=587)
    smtp_tls: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    smtp_user: Mapped[str] = mapped_column(String(200))
    smtp_password_enc: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    sync_interval_sec: Mapped[int] = mapped_column(Integer, default=120, server_default="120")

    last_sync_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    last_seen_uid: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class MailThread(Base):
    __tablename__ = "mail_threads"
    __table_args__ = (
        Index("ix_mail_threads_tenant_last", "tenant_id", "last_message_at"),
        Index("ix_mail_threads_mailbox_last", "mailbox_id", "last_message_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    mailbox_id: Mapped[int] = mapped_column(ForeignKey("mailboxes.id", ondelete="CASCADE"), index=True)

    subject: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    normalized_subject: Mapped[Optional[str]] = mapped_column(String(500), nullable=True, index=True)

    # {"from": [...], "to": [...], "cc": [...]} — уникальные адреса за всё время треда
    participants: Mapped[Any] = mapped_column(JSON, default=dict, server_default="{}")

    linked_lead_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("tenant_leads.id", ondelete="SET NULL"), nullable=True, index=True
    )
    linked_task_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True
    )

    first_message_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_message_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_message_preview: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    unread_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    total_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class MailMessage(Base):
    __tablename__ = "mail_messages"
    __table_args__ = (
        UniqueConstraint("mailbox_id", "message_id", name="uq_mail_messages_mailbox_msgid"),
        Index("ix_mail_messages_thread_created", "thread_id", "sent_at"),
        Index("ix_mail_messages_mailbox_uid", "mailbox_id", "imap_uid"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    mailbox_id: Mapped[int] = mapped_column(ForeignKey("mailboxes.id", ondelete="CASCADE"), index=True)
    thread_id: Mapped[int] = mapped_column(ForeignKey("mail_threads.id", ondelete="CASCADE"), index=True)

    direction: Mapped[MailDirection] = mapped_column(
        SAEnum(MailDirection, name="mail_direction"),
    )
    status: Mapped[MailStatus] = mapped_column(
        SAEnum(MailStatus, name="mail_status"),
        default=MailStatus.received,
    )

    # RFC 5322 идентификаторы
    message_id: Mapped[str] = mapped_column(String(500))
    in_reply_to: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    references: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # IMAP UID нужен для инкрементального fetch (SEARCH UID > last_seen_uid)
    imap_uid: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    from_addr: Mapped[str] = mapped_column(String(320))
    from_name: Mapped[Optional[str]] = mapped_column(String(320), nullable=True)
    to_addrs: Mapped[Any] = mapped_column(JSON, default=list, server_default="[]")
    cc_addrs: Mapped[Any] = mapped_column(JSON, default=list, server_default="[]")
    subject: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    body_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    body_html: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    is_read: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    attachments: Mapped[List["MailAttachment"]] = relationship(
        "MailAttachment", back_populates="message", cascade="all, delete-orphan", lazy="selectin",
    )


class MailAttachment(Base):
    __tablename__ = "mail_attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    message_id: Mapped[int] = mapped_column(
        ForeignKey("mail_messages.id", ondelete="CASCADE"), index=True
    )
    filename: Mapped[str] = mapped_column(String(500))
    content_type: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    size: Mapped[int] = mapped_column(Integer, default=0)
    stored_path: Mapped[str] = mapped_column(String(500))  # относительно UPLOAD_DIR
    content_id: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)  # для inline

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    message: Mapped[MailMessage] = relationship("MailMessage", back_populates="attachments")
