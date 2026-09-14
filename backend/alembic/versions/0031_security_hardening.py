"""security-hardening: totp_secret шифрование, password reset, email change confirm

Пакет расширений схемы под security-фиксы 2026-09-14:

1. users.totp_secret VARCHAR(64) → VARCHAR(500) — Fernet-ciphertext длиннее чем
   plain base32 (32 символа). Существующие plain-значения не переписываем —
   приложение читает их через graceful-декрипт (см. core.totp_crypto).
2. users.password_reset_token / password_reset_sent_at — для self-service
   восстановления пароля.
3. users.pending_email / email_change_token / email_change_sent_at — для
   confirmation flow при смене email (значение переносится из pending в email
   только после клика по ссылке из письма).

Revision ID: 0031_security_hardening
Revises: 0030_storage_accounts
Create Date: 2026-09-14
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0031_security_hardening"
down_revision: Union[str, None] = "0030_storage_accounts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # TOTP: расширяем колонку под Fernet-ciphertext
    op.alter_column(
        "users",
        "totp_secret",
        existing_type=sa.String(length=64),
        type_=sa.String(length=500),
        existing_nullable=True,
    )

    # Password reset
    op.add_column("users", sa.Column("password_reset_token", sa.String(length=80), nullable=True))
    op.add_column("users", sa.Column("password_reset_sent_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(
        "ix_users_password_reset_token",
        "users",
        ["password_reset_token"],
        unique=True,
    )

    # Email change confirmation
    op.add_column("users", sa.Column("pending_email", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("email_change_token", sa.String(length=80), nullable=True))
    op.add_column("users", sa.Column("email_change_sent_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(
        "ix_users_email_change_token",
        "users",
        ["email_change_token"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_users_email_change_token", table_name="users")
    op.drop_index("ix_users_password_reset_token", table_name="users")
    for col in (
        "email_change_sent_at",
        "email_change_token",
        "pending_email",
        "password_reset_sent_at",
        "password_reset_token",
    ):
        op.drop_column("users", col)

    op.alter_column(
        "users",
        "totp_secret",
        existing_type=sa.String(length=500),
        type_=sa.String(length=64),
        existing_nullable=True,
    )
