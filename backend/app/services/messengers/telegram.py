"""Telegram Bot API provider.

Конфиг канала (`provider_config`):
    {
        "bot_token": "1234567:ABC..."  # обязателен
    }

Webhook Telegram использует `secret_token` (Telegram шлёт в заголовке `X-Telegram-Bot-Api-Secret-Token`).
Сравниваем с `webhook_secret` канала.

Docs: https://core.telegram.org/bots/api
"""
from __future__ import annotations

import hmac
import logging
from typing import Optional

import httpx

from .base import (
    IncomingMessage, MessengerProvider, OutgoingResult, ProviderError, register_provider,
)

log = logging.getLogger("qadam.messengers.telegram")

TG_API = "https://api.telegram.org"
TG_REQUEST_TIMEOUT = 15.0


@register_provider
class TelegramProvider(MessengerProvider):
    kind = "telegram"

    def _bot_token(self) -> str:
        token = self.config.get("bot_token")
        if not token:
            raise ProviderError("Telegram: не задан bot_token")
        return str(token)

    def _base(self) -> str:
        return f"{TG_API}/bot{self._bot_token()}"

    def _file_base(self) -> str:
        return f"{TG_API}/file/bot{self._bot_token()}"

    # --- Webhook -----------------------------------------------------------

    def verify_webhook(self, headers: dict, raw_body: bytes) -> None:
        # Telegram присылает secret в заголовке X-Telegram-Bot-Api-Secret-Token
        # (мы задали его при setWebhook). Регистр значения хедера строгий.
        if not self.webhook_secret:
            # На локалхосте / dev можно допустить пустой секрет — просто warning.
            log.warning("telegram: webhook_secret не задан, проверка пропущена")
            return
        provided = headers.get("x-telegram-bot-api-secret-token") or headers.get(
            "X-Telegram-Bot-Api-Secret-Token"
        )
        if not provided or not hmac.compare_digest(str(provided), str(self.webhook_secret)):
            raise ValueError("Telegram: неверный webhook secret")

    def parse_incoming(self, payload: dict) -> list[IncomingMessage]:
        # Update = единичное событие, у Telegram batch'ей нет.
        msg = payload.get("message") or payload.get("edited_message") or payload.get("channel_post")
        if not msg:
            # Callback query / прочие — не мессенджные, пропускаем
            return []

        chat = msg.get("chat") or {}
        from_user = msg.get("from") or {}
        contact_external_id = str(chat.get("id"))
        text = msg.get("text") or msg.get("caption")

        display_name = " ".join(filter(None, [from_user.get("first_name"), from_user.get("last_name")]))
        if not display_name:
            display_name = chat.get("title") or from_user.get("username") or contact_external_id

        media = None
        # У Telegram могут быть photo (list разных размеров), document, video, audio, voice
        if msg.get("photo"):
            photos = msg["photo"]
            largest = max(photos, key=lambda p: p.get("width", 0) * p.get("height", 0))
            media = {
                "type": "image",
                "file_id": largest.get("file_id"),
                "mime": "image/jpeg",
            }
        elif msg.get("document"):
            d = msg["document"]
            media = {
                "type": "document",
                "file_id": d.get("file_id"),
                "mime": d.get("mime_type"),
                "filename": d.get("file_name"),
            }
        elif msg.get("video"):
            v = msg["video"]
            media = {"type": "video", "file_id": v.get("file_id"), "mime": v.get("mime_type")}
        elif msg.get("voice"):
            v = msg["voice"]
            media = {"type": "audio", "file_id": v.get("file_id"), "mime": v.get("mime_type", "audio/ogg")}
        elif msg.get("audio"):
            a = msg["audio"]
            media = {"type": "audio", "file_id": a.get("file_id"), "mime": a.get("mime_type")}
        elif msg.get("sticker"):
            s = msg["sticker"]
            media = {"type": "sticker", "file_id": s.get("file_id"), "emoji": s.get("emoji")}

        return [
            IncomingMessage(
                external_message_id=str(msg.get("message_id")),
                contact_external_id=contact_external_id,
                contact_username=from_user.get("username"),
                contact_display_name=display_name,
                body=text,
                media=media,
                raw=payload,
            )
        ]

    # --- Outgoing ---------------------------------------------------------

    def send_message(
        self,
        contact_external_id: str,
        body: Optional[str],
        media: Optional[dict] = None,
    ) -> OutgoingResult:
        base = self._base()
        # Приоритет медиа над текстом — Telegram позволяет caption у медиа-сообщений
        if media and media.get("type") == "image" and media.get("url"):
            resp = self._post(f"{base}/sendPhoto", json={
                "chat_id": contact_external_id,
                "photo": media["url"],
                "caption": body or None,
            })
        elif media and media.get("type") == "document" and media.get("url"):
            resp = self._post(f"{base}/sendDocument", json={
                "chat_id": contact_external_id,
                "document": media["url"],
                "caption": body or None,
            })
        else:
            if not body:
                raise ProviderError("Telegram: пустое сообщение")
            resp = self._post(f"{base}/sendMessage", json={
                "chat_id": contact_external_id,
                "text": body,
            })

        result = resp.get("result") or {}
        return OutgoingResult(
            external_message_id=str(result.get("message_id")) if result.get("message_id") else None,
            provider_response=resp,
        )

    # --- Setup ------------------------------------------------------------

    def set_webhook(self, public_url: str) -> dict:
        payload = {
            "url": public_url,
            "drop_pending_updates": False,
            "allowed_updates": ["message", "edited_message"],
        }
        if self.webhook_secret:
            payload["secret_token"] = self.webhook_secret
        return self._post(f"{self._base()}/setWebhook", json=payload)

    def get_info(self) -> dict:
        return self._post(f"{self._base()}/getMe")

    # --- HTTP helpers -----------------------------------------------------

    def _post(self, url: str, *, json: Optional[dict] = None) -> dict:
        try:
            r = httpx.post(url, json=json, timeout=TG_REQUEST_TIMEOUT)
        except httpx.HTTPError as e:
            raise ProviderError(f"Telegram HTTP error: {e}") from e
        try:
            data = r.json()
        except ValueError:
            raise ProviderError(f"Telegram: не-JSON ответ, status={r.status_code}, body={r.text[:200]!r}")
        if not data.get("ok", False):
            raise ProviderError(
                f"Telegram API error: {data.get('description') or data} (code={data.get('error_code')})"
            )
        return data
