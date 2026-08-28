"""Абстракция провайдера мессенджера.

Каждый провайдер (Telegram / WhatsApp / Instagram) реализует эти методы.
Consumer вызывает `parse_incoming` и потом использует нормализованный
`IncomingMessage` — так одна логика хранения работает для всех каналов.

Особенности:
- verify_webhook — валидация подписи/токена входящего запроса. Может выбрасывать
  ValueError, тогда Webhook receiver вернёт 401
- parse_incoming — принимает raw payload (уже JSON-decoded) и хедеры;
  возвращает список IncomingMessage — payload может содержать несколько
  сообщений (batch у WhatsApp/Meta)
- send_message — отправляет сообщение, возвращает external_message_id
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class IncomingMessage:
    """Нормализованное входящее сообщение."""
    # ID сообщения у провайдера, для идемпотентности
    external_message_id: str

    # ID клиента у провайдера (chat_id для Telegram, wa_id для WhatsApp)
    contact_external_id: str

    # Публичные атрибуты клиента для отображения
    contact_username: Optional[str] = None
    contact_display_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_avatar_url: Optional[str] = None

    # Текст (может быть None для чисто медиа)
    body: Optional[str] = None

    # Медиа: {"type": "image|video|document|audio", "url": "...", "mime": "...", "filename": "..."}
    media: Optional[dict] = None

    # Дополнительный контекст (raw payload provider'а)
    raw: dict = field(default_factory=dict)


@dataclass
class OutgoingResult:
    external_message_id: Optional[str]
    provider_response: dict


class ProviderError(Exception):
    """Ошибка на уровне провайдера — оборачиваем для единой обработки."""


class MessengerProvider:
    """Базовый класс. Наследники должны быть stateless или принимать channel в ctor."""

    kind: str = ""

    def __init__(self, provider_config: dict, webhook_secret: Optional[str] = None) -> None:
        self.config = provider_config or {}
        self.webhook_secret = webhook_secret

    # --- Webhook lifecycle -------------------------------------------------

    def verify_webhook(self, headers: dict, raw_body: bytes) -> None:
        """Проверить что запрос действительно от провайдера. Бросить ValueError если нет."""
        raise NotImplementedError

    def parse_incoming(self, payload: dict) -> list[IncomingMessage]:
        """Нормализация payload → список IncomingMessage."""
        raise NotImplementedError

    # --- Outgoing ---------------------------------------------------------

    def send_message(
        self,
        contact_external_id: str,
        body: Optional[str],
        media: Optional[dict] = None,
    ) -> OutgoingResult:
        raise NotImplementedError

    # --- Setup helpers (опционально реализуется в провайдере) --------------

    def set_webhook(self, public_url: str) -> dict:
        """Зарегистрировать webhook у провайдера (для Telegram — setWebhook)."""
        return {"not_implemented": True}

    def get_info(self) -> dict:
        """Проверка что настройки корректные (getMe/business info и т.п.)."""
        return {}


# =============================================================================
# Registry: kind → Provider class
# =============================================================================

_REGISTRY: dict[str, type[MessengerProvider]] = {}


def register_provider(cls: type[MessengerProvider]) -> type[MessengerProvider]:
    if not cls.kind:
        raise ValueError(f"{cls.__name__}: kind не задан")
    _REGISTRY[cls.kind] = cls
    return cls


def get_provider(kind: str, provider_config: dict, webhook_secret: Optional[str] = None) -> MessengerProvider:
    if kind not in _REGISTRY:
        raise ProviderError(f"неизвестный тип канала: {kind}")
    return _REGISTRY[kind](provider_config, webhook_secret)


def known_kinds() -> list[str]:
    return sorted(_REGISTRY.keys())
