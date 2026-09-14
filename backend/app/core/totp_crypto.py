"""Прозрачное шифрование TOTP-секретов пользователя.

TOTP-секрет — критический материал: с ним третье лицо может генерить валидные
коды 2FA. Раньше хранился в БД как plain base32 в колонке String(64). Теперь
шифруется тем же Fernet-ключом что и IMAP-пароли (`SECRETS_KEY`), формат
записи `enc:v1:<fernet-token>`.

Читаем graceful: legacy plain-значения (без префикса) возвращаются как есть,
чтобы миграция 0031 не требовала backfill. При следующей записи (setup / disable
+ setup) значение перезапишется в зашифрованном виде.
"""
from __future__ import annotations

from typing import Optional

from .secrets import decrypt, encrypt

_PREFIX = "enc:v1:"


def encrypt_totp(secret: Optional[str]) -> Optional[str]:
    """Кодирует plain TOTP-секрет в форму для БД. None/пустая → None."""
    if not secret:
        return None
    if secret.startswith(_PREFIX):
        return secret
    enc = encrypt(secret)
    if not enc:
        return secret
    return _PREFIX + enc


def decrypt_totp(stored: Optional[str]) -> Optional[str]:
    """Возвращает plain-секрет из БД. Legacy без префикса — как есть."""
    if not stored:
        return None
    if not stored.startswith(_PREFIX):
        return stored
    dec = decrypt(stored[len(_PREFIX):])
    return dec
