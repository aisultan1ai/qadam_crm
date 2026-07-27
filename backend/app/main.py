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
from .core.scheduler import start_scheduler, stop_scheduler
from .database import engine
from .api import auth, roles, users, projects, tasks, comments, attachments, notifications, analytics, search, ws


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
    start_scheduler()
    try:
        yield
    finally:
        stop_scheduler()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Qadam CRM API",
        version="1.0.0",
        description="Qadam CRM — учёт и трекинг задач компании",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    app.state.limiter = limiter
    app.add_middleware(SlowAPIMiddleware)

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

    avatars_dir = Path(settings.UPLOAD_DIR) / "avatars"
    avatars_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/media/avatars", StaticFiles(directory=str(avatars_dir)), name="media-avatars")

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
