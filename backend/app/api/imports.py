"""API запуска фонового импорта CSV и опроса статуса."""
from __future__ import annotations

from celery.result import AsyncResult
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from ..core.celery_app import celery_app
from ..core.redis_client import get_redis
from ..tasks.imports import import_tasks_csv
from .deps import TenantContext, require

router = APIRouter(prefix="/api/imports", tags=["imports"])


MAX_CSV_BYTES = 5 * 1024 * 1024  # 5 MB


@router.post("/tasks")
async def start_tasks_import(
    file: UploadFile = File(...),
    ctx: TenantContext = Depends(require("tasks.create")),
):
    raw = await file.read()
    if len(raw) > MAX_CSV_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "CSV слишком большой")

    try:
        csv_text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            csv_text = raw.decode("cp1251")
        except UnicodeDecodeError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Кодировка CSV не UTF-8 и не CP1251")

    async_result = import_tasks_csv.delay(
        tenant_id=ctx.tenant.id,
        csv_text=csv_text,
        user_id=ctx.user.id,
    )
    return {"job_id": async_result.id, "state": async_result.state}


@router.get("/{job_id}")
def get_import_status(
    job_id: str,
    ctx: TenantContext = Depends(require("tasks.create")),
):
    res = AsyncResult(job_id, app=celery_app)
    payload: dict = {"job_id": job_id, "state": res.state}

    try:
        progress = get_redis().get(f"import:{job_id}:progress")
        if progress:
            payload["progress"] = progress
    except Exception:
        pass

    if res.state == "SUCCESS":
        meta = res.result or {}
        if meta.get("tenant_id") != ctx.tenant.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Импорт не найден")
        payload.update({
            "total": meta.get("total"),
            "created": meta.get("created"),
            "error_count": meta.get("error_count"),
            "errors": meta.get("errors"),
        })
    elif res.state == "FAILURE":
        payload["error"] = str(res.result)

    return payload
