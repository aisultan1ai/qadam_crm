"""Middleware для tenant-по-subdomain.

Если запрос пришёл на `acme.qadam.kz`, читаем `Host` (или доверенный
`X-Tenant-Slug` от nginx) и складываем `request.state.forced_tenant_slug = "acme"`.

`get_current_context` затем проверяет: если forced_tenant_slug задан и
не совпадает со slug'ом tenant'а из JWT — возвращаем 403. Это защищает
от кросс-tenant-навигации по неправильной ссылке.
"""
from __future__ import annotations

from typing import Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

# Домены, при попадании на которые subdomain-логика НЕ применяется:
# сам apex, локальные адреса, IP.
BARE_HOSTS = {"qadam.kz", "www.qadam.kz", "localhost", "127.0.0.1", "0.0.0.0"}


def _extract_subdomain(host: str) -> Optional[str]:
    if not host:
        return None
    host = host.split(":")[0].lower()
    if host in BARE_HOSTS or host.replace(".", "").isdigit():
        return None
    parts = host.split(".")
    if len(parts) < 3:
        return None
    sub = parts[0]
    return sub if sub not in ("www",) else None


class SubdomainTenantMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        # nginx может пробросить более надёжный slug (см. nginx.conf).
        header_slug = request.headers.get("X-Tenant-Slug")
        if header_slug:
            request.state.forced_tenant_slug = header_slug.strip().lower() or None
        else:
            host = request.headers.get("host", "")
            request.state.forced_tenant_slug = _extract_subdomain(host)
        return await call_next(request)
