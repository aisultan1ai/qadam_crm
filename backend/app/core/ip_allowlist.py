"""P4t.2: IP allowlist middleware.

Читает TenantSecurityPolicy.ip_allowlist текущего tenant'а и, если непустой,
блокирует запросы с IP вне CIDR-списка.

Порядок работы:
1. SubdomainTenantMiddleware уже установил request.state.forced_tenant_slug.
2. Здесь мы резолвим slug → tenant_id → policy → allowlist.
3. Клиентский IP берём из X-Forwarded-For (доверяем nginx-у), fallback на request.client.host.

Разрешаем всегда: preflight OPTIONS, /health*, публичные endpoints /public/*, /f/*, /book/*.
"""
from __future__ import annotations

import ipaddress
import logging
from typing import Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

log = logging.getLogger("qadam.ip_allowlist")


PUBLIC_PREFIXES = ("/health", "/media/", "/public/", "/f/", "/book/", "/api/webhooks/", "/api/inbox/email")


def _get_client_ip(request: Request) -> Optional[str]:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        # берём первый (клиентский), не proxy
        return fwd.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


def _ip_in_allowlist(ip_str: str, allowlist: list[str]) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    for entry in allowlist:
        entry = (entry or "").strip()
        if not entry:
            continue
        try:
            if "/" in entry:
                if ip in ipaddress.ip_network(entry, strict=False):
                    return True
            else:
                if ip == ipaddress.ip_address(entry):
                    return True
        except ValueError:
            continue
    return False


class IPAllowlistMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path
        if request.method == "OPTIONS":
            return await call_next(request)
        if any(path.startswith(p) for p in PUBLIC_PREFIXES):
            return await call_next(request)

        forced_slug = getattr(request.state, "forced_tenant_slug", None)
        if not forced_slug:
            # без tenant-контекста ничего не блокируем
            return await call_next(request)

        # Ленивая проверка: SessionLocal — короткая query.
        try:
            from ..database import SessionLocal
            from ..models import Tenant, TenantSecurityPolicy
            db = SessionLocal()
            try:
                tenant = db.query(Tenant).filter(Tenant.slug == forced_slug).first()
                if not tenant:
                    return await call_next(request)
                policy = (
                    db.query(TenantSecurityPolicy)
                    .filter(TenantSecurityPolicy.tenant_id == tenant.id)
                    .first()
                )
                if not policy or not policy.ip_allowlist:
                    return await call_next(request)
                ip = _get_client_ip(request)
                if not ip:
                    return await call_next(request)
                if not _ip_in_allowlist(ip, policy.ip_allowlist):
                    log.warning("IP %s blocked for tenant %s (slug=%s)", ip, tenant.id, forced_slug)
                    return JSONResponse(
                        status_code=403,
                        content={"detail": f"Доступ с IP {ip} запрещён политикой безопасности компании"},
                    )
            finally:
                db.close()
        except Exception as e:
            log.error("IPAllowlistMiddleware failed (fail-open): %s", e)
        return await call_next(request)
