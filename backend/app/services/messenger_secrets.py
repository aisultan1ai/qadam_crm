"""Прозрачное шифрование секретов внутри ExternalChannel.provider_config.

`provider_config` — JSON-словарь настроек провайдера мессенджера. Хранит секреты
(bot_token, api_key, page_access_token и т.п.). Раньше писались в БД plain —
любой с доступом к дампу БД мог украсть токен и слать сообщения от имени
компании. Теперь секретные ключи шифруются Fernet-ключом `SECRETS_KEY`
(та же схема что и IMAP/SMTP-пароли из M4).

Формат хранения зашифрованного значения: `enc:v1:<base64-fernet-token>`.
Простые значения без префикса читаются как есть — это graceful migration
для существующих каналов, писавшихся до включения шифрования.
"""
from __future__ import annotations

from typing import Any

from ..core.secrets import decrypt, encrypt

# Ключи внутри provider_config, значения которых считаются секретами.
# Не-строковые значения не шифруются (например, api_version=17).
SECRET_KEYS: frozenset[str] = frozenset({
    "bot_token",
    "api_key",
    "app_secret",
    "page_access_token",
    "webhook_verify_token",
    "app_id",
    "phone_number_id",
    "business_account_id",
    "verify_token",
})

_PREFIX = "enc:v1:"


def _is_encrypted(value: Any) -> bool:
    return isinstance(value, str) and value.startswith(_PREFIX)


def encrypt_config(cfg: dict[str, Any] | None) -> dict[str, Any]:
    """Возвращает копию словаря, где секретные строковые ключи зашифрованы.

    Идемпотентна: уже зашифрованные значения (с префиксом enc:v1:) не трогает.
    Пустые/None значения не шифруются (иначе получим шум в БД).
    """
    if not cfg:
        return {}
    result: dict[str, Any] = dict(cfg)
    for key in list(result.keys()):
        if key not in SECRET_KEYS:
            continue
        val = result[key]
        if not isinstance(val, str) or not val:
            continue
        if _is_encrypted(val):
            continue
        enc = encrypt(val)
        if enc:
            result[key] = _PREFIX + enc
    return result


def decrypt_config(cfg: dict[str, Any] | None) -> dict[str, Any]:
    """Возвращает копию словаря с расшифрованными значениями секретов.

    Используется перед передачей в провайдер (Telegram/WA/IG API). Если
    значение не зашифровано (legacy plain-token) — возвращается как есть.
    """
    if not cfg:
        return {}
    result: dict[str, Any] = dict(cfg)
    for key, val in list(result.items()):
        if _is_encrypted(val):
            dec = decrypt(val[len(_PREFIX):])
            if dec is not None:
                result[key] = dec
    return result


def is_secret_key(key: str) -> bool:
    return key in SECRET_KEYS


def masked_config(cfg: dict[str, Any] | None) -> dict[str, Any]:
    """Возвращает словарь, где секретные значения замаскированы для UI.

    В отличие от `_channel_out` в API, эта функция не показывает даже
    суффикс зашифрованных значений (там нет смысла — они уже base64).
    Для plain-legacy значений показываем «****xxxx» для распознавания.
    """
    if not cfg:
        return {}
    result: dict[str, Any] = dict(cfg)
    for key in list(result.keys()):
        if key not in SECRET_KEYS:
            continue
        val = result[key]
        if not isinstance(val, str) or not val:
            continue
        if _is_encrypted(val):
            result[key] = "****"  # даже длина не должна утекать
        else:
            result[key] = ("****" + val[-4:]) if len(val) > 4 else "****"
    return result
