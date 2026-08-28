"""Симметричное шифрование секретов в БД (IMAP/SMTP-пароли, API-ключи).

Использует Fernet (AES-128 CBC + HMAC-SHA256). Ключ читается из
`settings.SECRETS_KEY`. В production ключ должен быть задан явно, в dev
без ключа — генерится ephemeral и логируется warning (данные не переживут
рестарт worker'ов).

Usage:
    from ..core.secrets import encrypt, decrypt
    stored = encrypt("my-imap-password")   # str (base64)
    plain = decrypt(stored)                # str
"""
from __future__ import annotations

import logging
from functools import lru_cache
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from ..config import settings

log = logging.getLogger("qadam.secrets")


@lru_cache
def _cipher() -> Fernet:
    key = (settings.SECRETS_KEY or "").strip()
    if not key:
        if settings.is_prod and not settings.ALLOW_INSECURE_PROD:
            raise RuntimeError(
                "SECRETS_KEY не задан в production. "
                "Сгенерируйте: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
            )
        key = Fernet.generate_key().decode()
        log.warning(
            "SECRETS_KEY не задан — сгенерирован ephemeral-ключ. "
            "Зашифрованные секреты НЕ переживут рестарт. Задайте SECRETS_KEY в env для prod."
        )
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt(plain: Optional[str]) -> Optional[str]:
    """Шифрует строку и возвращает base64-текст. None → None."""
    if plain is None or plain == "":
        return None
    return _cipher().encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt(ciphertext: Optional[str]) -> Optional[str]:
    """Расшифровывает. Если данные повреждены/чужим ключом — вернёт None и логнёт."""
    if not ciphertext:
        return None
    try:
        return _cipher().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except InvalidToken:
        log.error("secrets.decrypt: InvalidToken — данные шифрованы другим ключом")
        return None
    except Exception:
        log.exception("secrets.decrypt failed")
        return None
