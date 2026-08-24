"""Cloudflare Turnstile — валидация CAPTCHA-токена.

Если TURNSTILE_SECRET_KEY не задан — проверка пропускается (для dev).
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

from ..config import settings

log = logging.getLogger("qadam.captcha")

VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def is_captcha_required() -> bool:
    return bool(settings.TURNSTILE_SECRET_KEY)


def verify_captcha(token: Optional[str], remote_ip: Optional[str] = None) -> bool:
    """Проверить Turnstile-токен. Возвращает True если проверка не нужна или прошла успешно."""
    if not is_captcha_required():
        return True
    if not token:
        return False
    payload = {"secret": settings.TURNSTILE_SECRET_KEY, "response": token}
    if remote_ip:
        payload["remoteip"] = remote_ip
    try:
        with httpx.Client(timeout=5) as client:
            r = client.post(VERIFY_URL, data=payload)
            r.raise_for_status()
            data = r.json()
            if data.get("success"):
                return True
            log.warning("Turnstile rejected token: %s", data.get("error-codes"))
            return False
    except Exception as exc:
        log.error("Turnstile verification failed: %s", exc)
        # При недоступности провайдера в prod лучше блокировать — иначе можно
        # обойти защиту, положив siteverify. В dev секрет обычно не задан.
        return False
