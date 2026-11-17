"""Google OAuth: одно общее приложение Qadam («Подключить Google» — и всё) или свои ключи компании.

Ключи платформы — переменные окружения GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
Свои ключи компании (enterprise) имеют приоритет, если заданы владельцем.
Адреса возврата считаются от APP_BASE_URL — отдельные для Календаря и Диска
(раньше был один на оба, и одно из подключений не работало).

state в OAuth: tenant/user/provider + одноразовый nonce в Redis. Без nonce кто угодно мог бы
подставить свой Google-аккаунт к чужому сотруднику, сформировав state руками.
"""
from __future__ import annotations

import base64
import json
import secrets
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException

from ..config import settings
from ..models import Tenant
from .secrets import decrypt

STATE_TTL = 15 * 60

REDIRECT_PATHS = {
    "google_calendar": "/api/integrations/google/callback",
    "google_drive": "/api/integrations/storage/google_drive/callback",
    "dropbox": "/api/integrations/storage/dropbox/callback",
}


@dataclass
class GoogleClient:
    client_id: str
    client_secret: str
    source: str  # tenant | platform


def platform_configured() -> bool:
    return bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)


def tenant_has_own_keys(tenant: Tenant) -> bool:
    return bool(tenant.google_client_id and tenant.google_client_secret_enc)


def client_for(tenant: Tenant) -> Optional[GoogleClient]:
    if tenant_has_own_keys(tenant):
        secret = decrypt(tenant.google_client_secret_enc)
        if secret:
            return GoogleClient(tenant.google_client_id, secret, "tenant")
    if platform_configured():
        return GoogleClient(settings.GOOGLE_CLIENT_ID, settings.GOOGLE_CLIENT_SECRET, "platform")
    return None


def configured(tenant: Tenant) -> bool:
    return client_for(tenant) is not None


def redirect_uri(kind: str) -> str:
    return settings.APP_BASE_URL.rstrip("/") + REDIRECT_PATHS[kind]


def client_config(tenant: Tenant, kind: str) -> dict:
    c = client_for(tenant)
    if not c:
        raise HTTPException(503, "Подключение к Google пока недоступно — обратитесь к администратору")
    return {
        "web": {
            "client_id": c.client_id,
            "client_secret": c.client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [redirect_uri(kind)],
        }
    }


def issue_state(tenant_id: int, user_id: int, provider: str) -> str:
    from .redis_client import get_redis
    nonce = secrets.token_urlsafe(16)
    try:
        get_redis().set(f"oauth_state:{nonce}", f"{tenant_id}:{user_id}:{provider}", ex=STATE_TTL)
    except Exception:
        raise HTTPException(503, "Сервис временно недоступен — попробуйте подключить ещё раз через минуту")
    payload = json.dumps({"t": tenant_id, "u": user_id, "p": provider, "n": nonce}).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def consume_state(state: str, provider: str) -> tuple[int, int]:
    """Проверяет и «гасит» state: только тот, кто начал подключение, и только один раз."""
    from .redis_client import get_redis
    try:
        pad = "=" * (-len(state) % 4)
        data = json.loads(base64.urlsafe_b64decode((state + pad).encode("ascii")).decode("utf-8"))
        tenant_id, user_id, p, nonce = int(data["t"]), int(data["u"]), str(data["p"]), str(data["n"])
    except Exception:
        raise HTTPException(400, "Ссылка подключения повреждена — начните подключение заново")
    if p != provider:
        raise HTTPException(400, "Ссылка подключения не от этого сервиса")
    try:
        r = get_redis()
        stored = r.get(f"oauth_state:{nonce}")
        r.delete(f"oauth_state:{nonce}")
    except Exception:
        raise HTTPException(503, "Сервис временно недоступен — попробуйте ещё раз")
    if stored != f"{tenant_id}:{user_id}:{provider}":
        raise HTTPException(400, "Ссылка подключения устарела — начните подключение заново")
    return tenant_id, user_id
