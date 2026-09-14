"""2FA backup codes

Одноразовые backup-коды для входа при потере доступа к authenticator-приложению.
Хранятся как bcrypt-хэш (аналогично паролям): даже с дампом БД нельзя восстановить
plain-коды. Пользователь видит plain-коды один раз в момент генерации.

Revision ID: 0032_backup_codes
Revises: 0031_security_hardening
Create Date: 2026-09-14
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0032_backup_codes"
down_revision: Union[str, None] = "0031_security_hardening"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "totp_backup_codes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("code_hash", sa.String(length=255), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_totp_backup_codes_user_unused",
        "totp_backup_codes",
        ["user_id", "used_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_totp_backup_codes_user_unused", table_name="totp_backup_codes")
    op.drop_table("totp_backup_codes")
