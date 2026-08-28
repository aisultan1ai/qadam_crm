"""Instagram Direct provider (через Meta Graph API).

Требует:
- Instagram Business Account, связанный с Facebook Page
- App с разрешениями `instagram_manage_messages` + `pages_messaging`
- Long-lived Page Access Token

Конфиг:
    {
        "api_url": "https://graph.facebook.com/v18.0",
        "page_access_token": "EAA...",
        "ig_user_id": "17841400000000000",
        "app_secret": "..."   # для проверки X-Hub-Signature-256
    }

Docs: https://developers.facebook.com/docs/messenger-platform/instagram
"""
from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Optional

import httpx

from .base import (
    IncomingMessage, MessengerProvider, OutgoingResult, ProviderError, register_provider,
)

log = logging.getLogger("qadam.messengers.instagram")

IG_TIMEOUT = 20.0


@register_provider
class InstagramProvider(MessengerProvider):
    kind = "instagram"

    def _api_url(self) -> str:
        return (self.config.get("api_url") or "https://graph.facebook.com/v18.0").rstrip("/")

    def _access_token(self) -> str:
        token = self.config.get("page_access_token")
        if not token:
            raise ProviderError("Instagram: не задан page_access_token")
        return str(token)

    def _ig_user_id(self) -> str:
        uid = self.config.get("ig_user_id")
        if not uid:
            raise ProviderError("Instagram: не задан ig_user_id")
        return str(uid)

    # --- Webhook -----------------------------------------------------

    def verify_webhook(self, headers: dict, raw_body: bytes) -> None:
        app_secret = self.config.get("app_secret")
        if not app_secret:
            log.warning("instagram: app_secret не задан — подпись не проверяется")
            return
        sig = headers.get("x-hub-signature-256") or headers.get("X-Hub-Signature-256")
        if not sig or not sig.startswith("sha256="):
            raise ValueError("Instagram: отсутствует X-Hub-Signature-256")
        expected = hmac.new(
            str(app_secret).encode(), raw_body, hashlib.sha256,
        ).hexdigest()
        provided = sig.split("=", 1)[1]
        if not hmac.compare_digest(provided.lower(), expected.lower()):
            raise ValueError("Instagram: неверная подпись")

    def parse_incoming(self, payload: dict) -> list[IncomingMessage]:
        """
        Формат Instagram webhook (Messenger platform):
        {
          "entry": [{
            "messaging": [{
              "sender": {"id": "user_ig_id"},
              "recipient": {"id": "page_ig_id"},
              "message": {"mid": "...", "text": "hi", "attachments": [...]}
            }]
          }]
        }
        """
        result: list[IncomingMessage] = []
        for entry in payload.get("entry", []):
            for event in entry.get("messaging", []):
                message = event.get("message") or {}
                if message.get("is_echo"):
                    # Это наше собственное отправленное сообщение (эхо от Meta) — пропускаем
                    continue
                sender_id = (event.get("sender") or {}).get("id")
                if not sender_id:
                    continue
                text = message.get("text")
                media = None
                attachments = message.get("attachments") or []
                if attachments:
                    a = attachments[0]
                    atype = a.get("type", "unknown")
                    url = ((a.get("payload") or {}).get("url"))
                    media = {"type": atype, "url": url}

                result.append(
                    IncomingMessage(
                        external_message_id=str(message.get("mid") or event.get("timestamp") or ""),
                        contact_external_id=str(sender_id),
                        body=text,
                        media=media,
                        raw=event,
                    )
                )
        return result

    # --- Outgoing -----------------------------------------------------

    def send_message(
        self,
        contact_external_id: str,
        body: Optional[str],
        media: Optional[dict] = None,
    ) -> OutgoingResult:
        # POST /{ig_user_id}/messages?access_token=...
        url = f"{self._api_url()}/{self._ig_user_id()}/messages"
        params = {"access_token": self._access_token()}

        msg_payload: dict = {"recipient": {"id": contact_external_id}}
        if media and media.get("url"):
            atype = media.get("type", "image")
            msg_payload["message"] = {
                "attachment": {"type": atype, "payload": {"url": media["url"], "is_reusable": True}}
            }
        else:
            if not body:
                raise ProviderError("Instagram: пустое сообщение")
            msg_payload["message"] = {"text": body}

        try:
            r = httpx.post(url, params=params, json=msg_payload, timeout=IG_TIMEOUT)
        except httpx.HTTPError as e:
            raise ProviderError(f"Instagram HTTP error: {e}") from e

        try:
            data = r.json()
        except ValueError:
            raise ProviderError(f"Instagram non-JSON response: {r.text[:200]!r}")

        if r.status_code >= 400:
            raise ProviderError(f"Instagram API error {r.status_code}: {data}")

        return OutgoingResult(
            external_message_id=data.get("message_id"),
            provider_response=data,
        )

    def get_info(self) -> dict:
        # GET /{ig_user_id}?fields=username,profile_picture_url
        try:
            r = httpx.get(
                f"{self._api_url()}/{self._ig_user_id()}",
                params={
                    "access_token": self._access_token(),
                    "fields": "username,profile_picture_url,followers_count",
                },
                timeout=IG_TIMEOUT,
            )
            return r.json() if r.status_code < 400 else {"error": r.text[:400]}
        except httpx.HTTPError as e:
            return {"error": str(e)}
