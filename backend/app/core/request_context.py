"""IP и браузер текущего запроса — для журнала действий и журнала просмотров.

log_action/log_view вызываются из десятков мест без `request`, поэтому кладём данные
в ContextVar на входе запроса (чистый ASGI-middleware, без BaseHTTPMiddleware).

Синхронные эндпоинты FastAPI выполняются в threadpool через starlette.concurrency.run_in_threadpool →
anyio.to_thread.run_sync, который запускает функцию в копии текущего контекста (contextvars.copy_context),
поэтому значение, выставленное здесь, видно и в потоке эндпоинта. Проверено тестом с TestClient
(sync- и async-эндпоинт, плюс BaseHTTPMiddleware внутри цепочки).
"""
from __future__ import annotations

from contextvars import ContextVar
from typing import Optional

USER_AGENT_MAX = 300

_client_ip: ContextVar[Optional[str]] = ContextVar("qadam_client_ip", default=None)
_user_agent: ContextVar[Optional[str]] = ContextVar("qadam_user_agent", default=None)


def current_ip() -> Optional[str]:
    return _client_ip.get()


def current_user_agent() -> Optional[str]:
    return _user_agent.get()


def _ip_from_scope(scope) -> tuple[Optional[str], Optional[str]]:
    """Как в core/ip_allowlist: X-Forwarded-For от nginx (он перезаписывает заголовок $remote_addr),
    иначе адрес соединения."""
    fwd = None
    ua = None
    for k, v in scope.get("headers") or []:
        if k == b"x-forwarded-for" and fwd is None:
            fwd = v.decode("latin-1")
        elif k == b"user-agent" and ua is None:
            ua = v.decode("latin-1")
    ip = None
    if fwd:
        ip = fwd.split(",")[0].strip() or None
    if not ip:
        client = scope.get("client")
        ip = client[0] if client else None
    return (ip[:64] if ip else None), (ua[:USER_AGENT_MAX] if ua else None)


class RequestContextMiddleware:
    """Чистый ASGI-middleware: выставляет ContextVar'ы на время обработки запроса."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        ip, ua = _ip_from_scope(scope)
        t1 = _client_ip.set(ip)
        t2 = _user_agent.set(ua)
        try:
            await self.app(scope, receive, send)
        finally:
            _client_ip.reset(t1)
            _user_agent.reset(t2)
