"""API для управления фоновыми экспортами (запуск, статус, скачивание)."""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from celery.result import AsyncResult
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse

from ..config import settings
from ..core.celery_app import celery_app
from ..tasks.reports import export_tasks_excel
from .deps import TenantContext, require

router = APIRouter(prefix="/api/exports", tags=["exports"])


@router.post("/tasks")
def start_tasks_export(
    status_filter: Optional[str] = None,
    project_id: Optional[int] = None,
    assignee_id: Optional[int] = None,
    ctx: TenantContext = Depends(require("analytics.reports")),
):
    """Ставит в очередь генерацию Excel-отчёта по задачам текущей компании."""
    async_result = export_tasks_excel.delay(
        tenant_id=ctx.tenant.id,
        status=status_filter,
        project_id=project_id,
        assignee_id=assignee_id,
    )
    return {"job_id": async_result.id, "state": async_result.state}


@router.get("/{job_id}")
def get_export_status(
    job_id: str,
    ctx: TenantContext = Depends(require("analytics.reports")),
):
    res = AsyncResult(job_id, app=celery_app)
    payload: dict = {"job_id": job_id, "state": res.state}
    if res.state == "SUCCESS":
        meta = res.result or {}
        # Изоляция: не отдаём инфу о чужом tenant'е
        if meta.get("tenant_id") != ctx.tenant.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Экспорт не найден")
        payload["filename"] = meta.get("filename")
        payload["rows"] = meta.get("rows")
        payload["download_url"] = f"/api/exports/{job_id}/download"
    elif res.state == "FAILURE":
        payload["error"] = str(res.result)
    return payload


@router.get("/{job_id}/download")
def download_export(
    job_id: str,
    ctx: TenantContext = Depends(require("analytics.reports")),
):
    res = AsyncResult(job_id, app=celery_app)
    if res.state != "SUCCESS":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Экспорт ещё не готов (state={res.state})")

    meta = res.result or {}
    if meta.get("tenant_id") != ctx.tenant.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Экспорт не найден")

    path = Path(meta.get("path", ""))
    expected_dir = Path(settings.EXPORT_DIR) / str(ctx.tenant.id)
    try:
        path.resolve().relative_to(expected_dir.resolve())
    except ValueError:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Некорректный путь")

    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Файл экспорта не найден")

    return FileResponse(
        str(path),
        filename=meta.get("filename", "export.xlsx"),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
