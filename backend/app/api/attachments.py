import os
import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..config import settings
from ..core.file_types import check_magic_bytes
from ..core.plans import check_storage_limit
from ..models import Task, Attachment, User
from ..schemas.task import AttachmentOut
from ..schemas.common import Message
from .deps import TenantContext, require, log_action

router = APIRouter(prefix="/api/tasks/{task_id}/attachments", tags=["attachments"])


ALLOWED_EXTENSIONS = {
    ".pdf",
    ".doc", ".docx",
    ".xls", ".xlsx", ".csv",
    ".ppt", ".pptx",
    ".txt", ".md", ".rtf",
    # Растровые форматы. .svg НЕ включён — может содержать <script> и приводить к XSS
    # при inline-рендеринге. Если нужны векторные иконки — используем контролируемый набор.
    ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".zip", ".rar", ".7z",
    ".mp4", ".mov", ".webm",
    ".mp3", ".wav", ".ogg",
}

ALLOWED_MIME_PREFIXES = ("image/", "video/", "audio/", "text/")
ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/zip",
    "application/x-zip-compressed",
    "application/x-rar-compressed",
    "application/vnd.rar",
    "application/x-7z-compressed",
    "application/octet-stream",  # частый fallback у браузеров
}

BLOCKED_EXTENSIONS = {
    ".exe", ".bat", ".cmd", ".sh", ".ps1", ".msi", ".scr", ".vbs", ".js",
    ".jar", ".php", ".phtml", ".py", ".pyc", ".pl", ".rb", ".dll", ".so",
    ".com", ".cpl", ".app", ".apk", ".ipa",
    # HTML/SVG/XML — потенциальный XSS при inline-открытии в браузере.
    ".html", ".htm", ".xhtml", ".svg", ".xml", ".xsl", ".xslt",
}

CHUNK_SIZE = 1024 * 1024  # 1 MB


def _validate_and_save(file: UploadFile, dest: Path, max_bytes: int) -> int:
    ext = Path(file.filename or "").suffix.lower()
    if not ext:
        raise HTTPException(400, "Файл без расширения не поддерживается")
    if ext in BLOCKED_EXTENSIONS:
        raise HTTPException(400, f"Такой тип файла запрещён ({ext})")
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Расширение {ext} не разрешено")

    mime = (file.content_type or "").lower()
    if mime and not (
        mime in ALLOWED_MIME_TYPES
        or any(mime.startswith(p) for p in ALLOWED_MIME_PREFIXES)
    ):
        raise HTTPException(400, f"MIME-тип {mime} не разрешён")

    written = 0
    magic_checked = False
    try:
        with dest.open("wb") as out:
            while True:
                chunk = file.file.read(CHUNK_SIZE)
                if not chunk:
                    break
                # Проверка сигнатуры на первом чанке — до записи на диск.
                if not magic_checked:
                    magic_checked = True
                    reason = check_magic_bytes(chunk[:32], ext)
                    if reason:
                        raise HTTPException(400, reason)
                written += len(chunk)
                if written > max_bytes:
                    out.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(413, f"Файл слишком большой (макс {max_bytes // (1024 * 1024)} МБ)")
                out.write(chunk)
    except HTTPException:
        dest.unlink(missing_ok=True)
        raise
    except Exception:
        dest.unlink(missing_ok=True)
        raise HTTPException(500, "Не удалось сохранить файл")

    if written == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, "Пустой файл")

    return written


def _load_task_in_tenant(db: Session, task_id: int, tenant_id: int) -> Task:
    task = db.get(Task, task_id)
    if not task or task.tenant_id != tenant_id:
        raise HTTPException(404, "Задача не найдена")
    return task


@router.post("", response_model=AttachmentOut, status_code=201)
def upload(task_id: int, file: UploadFile = File(...), ctx: TenantContext = Depends(require("files.upload")), db: Session = Depends(get_db)):
    user = ctx.user
    task = _load_task_in_tenant(db, task_id, ctx.tenant.id)
    # Грубая предварительная проверка (текущий usage без нового файла).
    # После записи ниже — ещё раз строгая проверка с реальным размером.
    check_storage_limit(db, ctx.tenant, additional_bytes=0)

    upload_dir = Path(settings.UPLOAD_DIR) / str(ctx.tenant.id) / "attachments"
    upload_dir.mkdir(parents=True, exist_ok=True)

    ext = Path(file.filename or "").suffix.lower()
    stored = f"{uuid.uuid4().hex}{ext}"
    dest = upload_dir / stored

    size = _validate_and_save(file, dest, settings.MAX_UPLOAD_BYTES)

    # Строгая проверка: файл записан, проверяем что не вышли за лимит с ним.
    try:
        check_storage_limit(db, ctx.tenant, additional_bytes=size)
    except HTTPException:
        dest.unlink(missing_ok=True)
        raise

    # stored_name хранит относительный путь под UPLOAD_DIR, чтобы файлы разных
    # tenant'ов не конфликтовали и download/delete находили файл однозначно.
    rel_path = f"{ctx.tenant.id}/attachments/{stored}"
    att = Attachment(
        tenant_id=ctx.tenant.id,
        task_id=task.id,
        filename=file.filename or stored,
        stored_name=rel_path,
        content_type=file.content_type,
        size=size,
        uploaded_by=user.id,
    )
    db.add(att)
    log_action(db, tenant_id=ctx.tenant.id, user_id=user.id, action="upload", entity="attachment", entity_id=att.id, task_id=task.id, detail=file.filename)
    db.commit()
    db.refresh(att)
    return att


def _resolve_attachment_path(att: Attachment) -> Path:
    """stored_name может быть относительным путём (новый формат: {tenant}/attachments/{uuid}.ext)
    или плоским именем (legacy). Оба варианта резолвим относительно UPLOAD_DIR.

    Защита от path traversal: результат обязан лежать внутри UPLOAD_DIR. Если БД
    подделана (`../../etc/passwd`), symlink и т.п. — вернём 404.
    """
    upload_root = Path(settings.UPLOAD_DIR).resolve()
    candidate = (upload_root / att.stored_name).resolve()
    try:
        candidate.relative_to(upload_root)
    except ValueError:
        raise HTTPException(404, "Файл не найден")
    return candidate


@router.get("/{attachment_id}")
def download(task_id: int, attachment_id: int, ctx: TenantContext = Depends(require("files.download")), db: Session = Depends(get_db)):
    att = db.get(Attachment, attachment_id)
    if not att or att.tenant_id != ctx.tenant.id or att.task_id != task_id:
        raise HTTPException(404, "Файл не найден")
    path = _resolve_attachment_path(att)
    if not path.exists():
        raise HTTPException(404, "Файл отсутствует на диске")
    return FileResponse(path, media_type=att.content_type or "application/octet-stream", filename=att.filename)


@router.delete("/{attachment_id}", response_model=Message)
def remove(task_id: int, attachment_id: int, ctx: TenantContext = Depends(require("files.delete")), db: Session = Depends(get_db)):
    user = ctx.user
    att = db.get(Attachment, attachment_id)
    if not att or att.tenant_id != ctx.tenant.id or att.task_id != task_id:
        raise HTTPException(404, "Файл не найден")
    path = _resolve_attachment_path(att)
    if path.exists():
        try:
            os.remove(path)
        except OSError:
            pass
    log_action(db, tenant_id=ctx.tenant.id, user_id=user.id, action="delete", entity="attachment", entity_id=att.id, task_id=task_id)
    db.delete(att)
    db.commit()
    return Message(message="Файл удалён")
