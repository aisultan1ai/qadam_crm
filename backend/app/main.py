import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi.middleware import SlowAPIMiddleware

from .config import settings
from .core.limiter import limiter
from .core.errors import install_error_handlers
from .core.scheduler import start_scheduler, stop_scheduler
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
}

# CSP для API + Swagger UI (/docs) + ReDoc (/redoc) + отдачи аватаров.
# Swagger/ReDoc грузятся с cdn.jsdelivr.net и используют inline-стили/скрипты.
API_CSP = (
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
        response.headers.setdefault("Content-Security-Policy", API_CSP)
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
        return {"status": "ok"}

    return app


app = create_app()
