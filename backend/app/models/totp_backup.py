"""2FA backup-коды пользователя.

Одноразовые пароли восстановления доступа. Хранятся как bcrypt-хэш — plain-код
видит только пользователь в момент генерации.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class TotpBackupCode(Base):
    __tablename__ = "totp_backup_codes"
    __table_args__ = (
        Index("ix_totp_backup_codes_user_unused", "user_id", "used_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False,
    )
    code_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
