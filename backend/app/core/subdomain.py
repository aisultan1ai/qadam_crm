"""Адрес компании на поддомене: soli.qcrm.kz → компания с поддоменом (или slug) «soli».

Что даёт поддомен:
  * страница входа показывает название и логотип компании;
  * вход на поддомене открывает именно эту компанию (а не «первую по умолчанию»);
  * сессия другой компании на этом адресе не работает (403), переключиться можно на основном адресе.

Основной домен — настройка APP_DOMAIN (по умолчанию — хост из APP_BASE_URL без www).
Для локальной проверки работает и soli.localhost.

Заголовок X-Tenant-Slug от клиента не используем: слаг берём только из Host.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Optional
from urllib.parse import urlparse

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from ..config import settings


@lru_cache(maxsize=1)
def base_domain() -> str:
    d = (settings.APP_DOMAIN or "").strip().lower()
    if not d:
        d = (urlparse(settings.APP_BASE_URL).hostname or "").lower()
    return d[4:] if d.startswith("www.") else d


def extract_subdomain(host: str) -> Optional[str]:
    if not host:
        return None
    host = host.split(":")[0].strip().lower().rstrip(".")
    for root in {base_domain(), "localhost"} - {""}:
        if host == root or host == f"www.{root}":
            return None
        suffix = "." + root
        if host.endswith(suffix):
            sub = host[: -len(suffix)]
            if sub and "." not in sub and sub != "www":
                return sub
    return None


def tenant_for_slug(db, slug: Optional[str]):
    """Компания по адресу — только явно настроенный поддомен (Настройки → Брендинг)."""
    if not slug:
        return None
    from ..models import Tenant
    return db.query(Tenant).filter(Tenant.subdomain == slug).first()


class SubdomainTenantMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        request.state.forced_tenant_slug = extract_subdomain(request.headers.get("host", ""))
        return await call_next(request)
