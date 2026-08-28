"""Провайдеры мессенджеров — все регистрируются автоматически при импорте."""
from .base import (
    IncomingMessage, MessengerProvider, OutgoingResult, ProviderError,
    get_provider, known_kinds,
)
# Импорты провайдеров нужны для регистрации в реестре — не удалять.
from . import telegram, whatsapp, instagram  # noqa: F401

__all__ = [
    "IncomingMessage",
    "MessengerProvider",
    "OutgoingResult",
    "ProviderError",
    "get_provider",
    "known_kinds",
]
