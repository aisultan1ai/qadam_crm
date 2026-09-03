"""Интеграция с Google Calendar: OAuth-аккаунт per user и sync-метаданные."""
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class GoogleCalendarAccount(Base):
    __tablename__ = "google_calendar_accounts"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", name="uq_google_accounts_tenant_user"),
        Index("ix_google_accounts_user", "user_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    google_email: Mapped[str] = mapped_column(String(255))
    # Токены хранятся шифрованными (Fernet) через core.secrets
    access_token_enc: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    refresh_token_enc: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    access_token_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    primary_calendar_id: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    # incremental sync token от Google — если сохранён, следующий sync пойдёт быстрее
    sync_token: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    sync_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    last_sync_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_sync_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
