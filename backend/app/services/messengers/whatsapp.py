"""WhatsApp Cloud API provider (совместим с Meta WhatsApp Cloud + 360dialog).

Конфиг канала:
    {
        "api_url": "https://waba-v2.360dialog.io",  # или "https://graph.facebook.com/v18.0"
        "api_key": "...",                            # 360dialog: D360-API-KEY. Meta: Bearer <access_token>
        "phone_number_id": "..."                     # только для Meta Graph API
    }

Webhook: Meta Graph шлёт X-Hub-Signature-256 (HMAC-SHA256 body с app_secret).
360dialog проверку упрощает — используем webhook_secret из URL или подпись HMAC.

Templates (HSM):
    send_message с media={"type":"template","name":"welcome","language":"ru","components":[...]}
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

log = logging.getLogger("qadam.messengers.whatsapp")

WA_REQUEST_TIMEOUT = 20.0


@register_provider
class WhatsAppProvider(MessengerProvider):
    kind = "whatsapp"

    def _api_url(self) -> str:
        return (self.config.get("api_url") or "").rstrip("/")

    def _api_key(self) -> str:
        key = self.config.get("api_key")
        if not key:
            raise ProviderError("WhatsApp: не задан api_key")
        return str(key)

    def _is_meta(self) -> bool:
        return "graph.facebook.com" in self._api_url()

    def _headers(self) -> dict:
        if self._is_meta():
            return {"Authorization": f"Bearer {self._api_key()}", "Content-Type": "application/json"}
        # 360dialog
        return {"D360-API-KEY": self._api_key(), "Content-Type": "application/json"}

    # --- Webhook ---------------------------------------------------------

    def verify_webhook(self, headers: dict, raw_body: bytes) -> None:
        if self._is_meta():
            # Meta: X-Hub-Signature-256 = sha256=<hex(hmac_sha256(app_secret, body))>
            app_secret = self.config.get("app_secret")
            if not app_secret:
                if self.webhook_secret:
                    return self._verify_generic(headers, raw_body)
                log.warning("whatsapp/meta: app_secret не задан — подпись не проверяется")
                return
            sig = headers.get("x-hub-signature-256") or headers.get("X-Hub-Signature-256")
            if not sig or not sig.startswith("sha256="):
                raise ValueError("WhatsApp/Meta: отсутствует X-Hub-Signature-256")
            expected = hmac.new(
                str(app_secret).encode(), raw_body, hashlib.sha256,
            ).hexdigest()
            provided = sig.split("=", 1)[1]
            if not hmac.compare_digest(provided.lower(), expected.lower()):
                raise ValueError("WhatsApp/Meta: неверная подпись")
            return
        self._verify_generic(headers, raw_body)

    def _verify_generic(self, headers: dict, raw_body: bytes) -> None:
        """Универсальная HMAC-подпись через webhook_secret (для 360dialog custom setup)."""
        if not self.webhook_secret:
            log.warning("whatsapp: webhook_secret пуст, проверка пропущена")
            return
        provided = headers.get("x-signature") or headers.get("X-Signature")
        if not provided:
            raise ValueError("WhatsApp: отсутствует X-Signature")
        raw_sig = provided.split("=", 1)[1] if "=" in provided else provided
        expected = hmac.new(
            str(self.webhook_secret).encode(), raw_body, hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(raw_sig.lower(), expected.lower()):
            raise ValueError("WhatsApp: неверная подпись")

    def parse_incoming(self, payload: dict) -> list[IncomingMessage]:
        """
        Meta Cloud API формат:
        {
          "entry": [{
            "changes": [{
              "field": "messages",
              "value": {
                "messages": [{"from":"77001234567","id":"wamid.xxx","type":"text","text":{"body":"hi"}}],
                "contacts": [{"wa_id":"77001234567","profile":{"name":"Иван"}}]
              }
            }]
          }]
        }
        """
        result: list[IncomingMessage] = []
        for entry in payload.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value") or {}
                contacts_by_wa = {c.get("wa_id"): c for c in value.get("contacts", []) if c.get("wa_id")}
                for msg in value.get("messages", []):
                    wa_from = msg.get("from")
                    if not wa_from:
                        continue
                    contact = contacts_by_wa.get(wa_from, {})
                    profile = (contact.get("profile") or {})
                    body: Optional[str] = None
                    media: Optional[dict] = None
                    mtype = msg.get("type")
                    if mtype == "text":
                        body = (msg.get("text") or {}).get("body")
                    elif mtype == "image":
                        img = msg.get("image") or {}
                        body = img.get("caption")
                        media = {"type": "image", "media_id": img.get("id"), "mime": img.get("mime_type")}
                    elif mtype == "document":
                        d = msg.get("document") or {}
                        body = d.get("caption")
                        media = {"type": "document", "media_id": d.get("id"), "mime": d.get("mime_type"),
                                 "filename": d.get("filename")}
                    elif mtype in ("audio", "voice"):
                        a = msg.get(mtype) or {}
                        media = {"type": "audio", "media_id": a.get("id"), "mime": a.get("mime_type")}
                    elif mtype == "video":
                        v = msg.get("video") or {}
                        body = v.get("caption")
                        media = {"type": "video", "media_id": v.get("id"), "mime": v.get("mime_type")}
                    elif mtype == "location":
                        loc = msg.get("location") or {}
                        media = {"type": "location", "latitude": loc.get("latitude"), "longitude": loc.get("longitude")}
                    else:
                        body = f"[{mtype}] (не поддерживается для отображения)"

                    result.append(
                        IncomingMessage(
                            external_message_id=str(msg.get("id")),
                            contact_external_id=str(wa_from),
                            contact_display_name=profile.get("name"),
                            contact_phone=wa_from,
                            body=body,
                            media=media,
                            raw=msg,
                        )
                    )
        return result

    # --- Outgoing -------------------------------------------------------

    def send_message(
        self,
        contact_external_id: str,
        body: Optional[str],
        media: Optional[dict] = None,
    ) -> OutgoingResult:
        # WhatsApp Cloud API: POST {api_url}/{phone_id}/messages (Meta)
        # или POST {api_url}/messages (360dialog).
        phone_id = self.config.get("phone_number_id")
        if self._is_meta():
            if not phone_id:
                raise ProviderError("WhatsApp/Meta: не задан phone_number_id")
            url = f"{self._api_url()}/{phone_id}/messages"
        else:
            url = f"{self._api_url()}/messages"

        # HSM template: media={"type":"template","name":...,"language":"ru","components":[...]}
        if media and media.get("type") == "template":
            payload = {
                "messaging_product": "whatsapp",
                "to": contact_external_id,
                "type": "template",
                "template": {
                    "name": media.get("name"),
                    "language": {"code": media.get("language", "ru")},
                },
            }
            if media.get("components"):
                payload["template"]["components"] = media["components"]
        elif media and media.get("type") == "image" and media.get("url"):
            payload = {
                "messaging_product": "whatsapp",
                "to": contact_external_id,
                "type": "image",
                "image": {"link": media["url"], "caption": body or ""},
            }
        elif media and media.get("type") == "document" and media.get("url"):
            payload = {
                "messaging_product": "whatsapp",
                "to": contact_external_id,
                "type": "document",
                "document": {
                    "link": media["url"], "caption": body or "",
                    "filename": media.get("filename") or "file",
                },
            }
        else:
            if not body:
                raise ProviderError("WhatsApp: пустое сообщение")
            payload = {
                "messaging_product": "whatsapp",
                "to": contact_external_id,
                "type": "text",
                "text": {"body": body},
            }

        try:
            r = httpx.post(url, json=payload, headers=self._headers(), timeout=WA_REQUEST_TIMEOUT)
        except httpx.HTTPError as e:
            raise ProviderError(f"WhatsApp HTTP error: {e}") from e

        try:
            data = r.json()
        except ValueError:
            raise ProviderError(f"WhatsApp non-JSON response: status={r.status_code}, body={r.text[:200]!r}")

        if r.status_code >= 400:
            raise ProviderError(f"WhatsApp API error {r.status_code}: {data}")
        wamid = None
        try:
            wamid = data.get("messages", [{}])[0].get("id")
        except Exception:
            pass
        return OutgoingResult(external_message_id=wamid, provider_response=data)

    def get_info(self) -> dict:
        # Meta: GET /{phone_id}
        if self._is_meta():
            phone_id = self.config.get("phone_number_id")
            if not phone_id:
                return {"error": "phone_number_id не задан"}
            try:
                r = httpx.get(f"{self._api_url()}/{phone_id}", headers=self._headers(), timeout=WA_REQUEST_TIMEOUT)
                return r.json() if r.status_code < 400 else {"error": r.text[:400]}
            except httpx.HTTPError as e:
                return {"error": str(e)}
        # 360dialog: попытка GET /profile/about (не всегда доступен)
        try:
            r = httpx.get(f"{self._api_url()}/profile/about", headers=self._headers(), timeout=WA_REQUEST_TIMEOUT)
            return r.json() if r.status_code < 400 else {"status": r.status_code}
        except httpx.HTTPError as e:
            return {"error": str(e)}
