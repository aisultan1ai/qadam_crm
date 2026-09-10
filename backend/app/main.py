import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text

from .config import settings
from .core.limiter import limiter
from .core.errors import install_error_handlers
from .core.redis_client import get_redis
from .core.subdomain import SubdomainTenantMiddleware
from .core.ip_allowlist import IPAllowlistMiddleware
from .database import engine
from .api import (
    auth, roles, users, projects, tasks, comments, attachments,
    notifications, analytics, search, ws, exports, imports,
    invitations, tenants as tenants_api, admin as admin_api, billing,
    leads, lead_forms, channels, automations, manager_availability, messengers, mail, wiki,
    calendar as calendar_api,
    booking as booking_api,
    time_tracking,
    hr as hr_api,
    integrations_google,
    contacts as contacts_api,
    activity as activity_api,
    time_off as time_off_api,
    deals as deals_api,
    user_prefs as user_prefs_api,
    reports as reports_api,
    whiteboards as whiteboards_api,
    telephony as telephony_api,
    custom_objects as custom_objects_api,
    ai as ai_api,
    task_links as task_links_api,
    reminders as reminders_api,
    task_statuses as task_statuses_api,
    templates as templates_api,
    custom_fields as custom_fields_api,
    saved_reports as saved_reports_api,
    mail_rules as mail_rules_api,
    task_inbox as task_inbox_api,
    p4 as p4_api,
)


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-site",
}

DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")

# Строгий CSP для API (JSON) и медиа. Без 'unsafe-inline'.
API_CSP_STRICT = (
    "default-src 'none'; "
    "img-src 'self' data: blob:; "
    "connect-src 'self'; "
    "frame-ancestors 'none'; "
    "base-uri 'none'; "
    "form-action 'none'"
)

# Отдельный, более разрешительный CSP для Swagger/ReDoc — они грузят JS/CSS с CDN
# и используют inline. Применяется ТОЛЬКО к /docs, /redoc, /openapi.json.
DOCS_CSP = (
    "default-src 'self'; "
    "img-src 'self' data: blob: https://cdn.jsdelivr.net https://fastapi.tiangolo.com; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "font-src 'self' data: https://cdn.jsdelivr.net; "
    "connect-src 'self'; "
    "frame-ancestors 'none'; "
    "base-uri 'self'; "
    "form-action 'self'"
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield


def create_app() -> FastAPI:
    # В production скрываем Swagger/ReDoc и OpenAPI — они раскрывают структуру API,
    # включая admin/billing эндпоинты. В dev оставляем для удобства.
    docs_enabled = not settings.is_prod
    app = FastAPI(
        title="Qadam CRM API",
        version="1.0.0",
        description="Qadam CRM — учёт и трекинг задач компании",
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
        lifespan=lifespan,
    )

    app.state.limiter = limiter
    app.add_middleware(SlowAPIMiddleware)
    # Порядок middleware: сначала subdomain (устанавливает forced_tenant_slug),
    # потом IP-allowlist (использует slug для lookup policy).
    # Starlette выполняет middleware в обратном порядке добавления, поэтому
    # IPAllowlistMiddleware добавляем ПЕРВЫМ (снаружи), Subdomain — вторым (внутри).
    app.add_middleware(IPAllowlistMiddleware)
    app.add_middleware(SubdomainTenantMiddleware)

    install_error_handlers(app)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Requested-With", "Accept", "Origin"],
        expose_headers=["Content-Disposition"],
        max_age=600,
    )

    @app.middleware("http")
    async def _security_headers(request: Request, call_next):
        response = await call_next(request)
        for k, v in SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        path = request.url.path
        csp = DOCS_CSP if path.startswith(DOCS_PATHS) else API_CSP_STRICT
        response.headers.setdefault("Content-Security-Policy", csp)
        return response

    uploads_dir = Path(settings.UPLOAD_DIR)
    uploads_dir.mkdir(parents=True, exist_ok=True)
    # /media/{tenant_id}/... (аватары, брендинг). Аттачменты не отдаём статикой —
    # там нужны permission-проверки, они идут через /api/tasks/{id}/attachments/{aid}.
    app.mount("/media", StaticFiles(directory=str(uploads_dir)), name="media")

    for r in (
        auth.router,
        roles.router,
        users.router,
        projects.router,
        tasks.router,
        comments.router,
        attachments.router,
        notifications.router,
        analytics.router,
        search.router,
        ws.router,
        exports.router,
        imports.router,
        invitations.router,
        tenants_api.router,
        admin_api.router,
        billing.router,
        leads.router,
        lead_forms.router,
        channels.router,
        automations.router,
        manager_availability.router,
        messengers.router,
        mail.router,
        wiki.router,
        calendar_api.router,
        calendar_api.public_router,
        booking_api.router,
        booking_api.public_router,
        time_tracking.router,
        hr_api.router,
        integrations_google.router,
        contacts_api.router,
        activity_api.router,
        time_off_api.router,
        deals_api.router,
        user_prefs_api.router,
        reports_api.router,
        whiteboards_api.router,
        telephony_api.router,
        telephony_api.webhook_router,
        custom_objects_api.router,
        ai_api.router,
        task_links_api.router,
        reminders_api.router,
        task_statuses_api.router,
        templates_api.router,
        custom_fields_api.router,
        saved_reports_api.router,
        mail_rules_api.router,
        task_inbox_api.router,
        p4_api.router,
        p4_api.public_router,
    ):
        app.include_router(r)

    @app.get("/health", tags=["system"])
    def health():
        """Быстрая liveness-проба. Не трогает БД/Redis."""
        return {"status": "ok"}

    @app.get("/health/ready", tags=["system"])
    def health_ready():
        """Readiness-проба: проверяет БД и Redis. Возвращает 503 если что-то мертво."""
        checks: dict[str, str] = {}
        healthy = True

        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            checks["db"] = "ok"
        except Exception as e:
            checks["db"] = f"fail: {type(e).__name__}"
            healthy = False

        try:
            r = get_redis()
            pong = r.ping()
            checks["redis"] = "ok" if pong else "fail: no PONG"
            if not pong:
                healthy = False
        except Exception as e:
            checks["redis"] = f"fail: {type(e).__name__}"
            healthy = False

        payload = {"status": "ok" if healthy else "degraded", "checks": checks}
        return JSONResponse(status_code=200 if healthy else 503, content=payload)

    return app


app = create_app()
