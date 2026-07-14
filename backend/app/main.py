from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .api import auth, roles, users, projects, tasks, comments, attachments, notifications, analytics, search


def create_app() -> FastAPI:
    app = FastAPI(
        title="Qadam CRM API",
        version="1.0.0",
        description="Qadam CRM — учёт и трекинг задач компании",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

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
    ):
        app.include_router(r)

    @app.get("/health", tags=["system"])
    def health():
        return {"status": "ok"}

    return app


app = create_app()
