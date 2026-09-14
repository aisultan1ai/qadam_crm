"""SQLAlchemy TypeDecorator для прозрачного шифрования Text-колонок.

Значение из Python попадает в БД зашифрованным Fernet (тем же ключом
`SECRETS_KEY`, что и остальные секреты), при чтении расшифровывается обратно.

Формат хранения: `enc:v1:<fernet-token>`. Значения без префикса читаются как
есть — это позволяет применять тип к уже существующим колонкам без backfill:
старые plain-записи продолжают работать, новые пишутся зашифрованными.

Важно: SQL-фильтры вида `body ILIKE '%foo%'` перестают находить содержимое
зашифрованных записей. Использовать только для колонок, где полнотекстовый
поиск делается вне БД (или не делается вовсе).
"""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator

from .secrets import decrypt, encrypt

_PREFIX = "enc:v1:"


class EncryptedText(TypeDecorator):
    """Text-колонка, чьё содержимое шифруется Fernet при сохранении."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: Optional[str], dialect: Any) -> Optional[str]:
        if value is None:
            return None
        if not isinstance(value, str):
            value = str(value)
        if value == "":
            return ""
        if value.startswith(_PREFIX):
            # Уже зашифровано — редкий кейс (например, повторная запись после
            # чтения при отключённой сессионной идентити-карте). Не шифруем повторно.
            return value
        enc = encrypt(value)
        if enc is None:
            # Fernet вернул None только для пустых значений; на всякий случай
            # не рискуем терять данные при ошибке шифра — возвращаем как есть.
            return value
        return _PREFIX + enc

    def process_result_value(self, value: Optional[str], dialect: Any) -> Optional[str]:
        if value is None:
            return None
        if not isinstance(value, str):
            return value
        if not value.startswith(_PREFIX):
            return value
        dec = decrypt(value[len(_PREFIX):])
        if dec is None:
            # Не смогли расшифровать (потерян ключ / повреждено) — не рушим
            # выборку. Логика core.secrets уже отправила ERROR в лог.
            return ""
        return dec
