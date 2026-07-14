import os
import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..config import settings
from ..models import Task, Attachment, User
from ..schemas.task import AttachmentOut
from ..schemas.common import Message
from .deps import require, log_action

router = APIRouter(prefix="/api/tasks/{task_id}/attachments", tags=["attachments"])


@router.post("", response_model=AttachmentOut, status_code=201)
def upload(task_id: int, file: UploadFile = File(...), user: User = Depends(require("files.upload")), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Задача не найдена")

    upload_dir = Path(settings.UPLOAD_DIR)
    upload_dir.mkdir(parents=True, exist_ok=True)

    ext = Path(file.filename or "").suffix
    stored = f"{uuid.uuid4().hex}{ext}"
    dest = upload_dir / stored

    content = file.file.read()
    dest.write_bytes(content)

    att = Attachment(
        task_id=task.id,
        filename=file.filename or stored,
        stored_name=stored,
        content_type=file.content_type,
        size=len(content),
        uploaded_by=user.id,
    )
    db.add(att)
    log_action(db, user_id=user.id, action="upload", entity="attachment", entity_id=att.id, task_id=task.id, detail=file.filename)
    db.commit()
    db.refresh(att)
    return att


@router.get("/{attachment_id}")
def download(task_id: int, attachment_id: int, user: User = Depends(require("files.download")), db: Session = Depends(get_db)):
    att = db.get(Attachment, attachment_id)
    if not att or att.task_id != task_id:
        raise HTTPException(404, "Файл не найден")
    path = Path(settings.UPLOAD_DIR) / att.stored_name
    if not path.exists():
        raise HTTPException(404, "Файл отсутствует на диске")
    return FileResponse(path, media_type=att.content_type or "application/octet-stream", filename=att.filename)


@router.delete("/{attachment_id}", response_model=Message)
def remove(task_id: int, attachment_id: int, user: User = Depends(require("files.delete")), db: Session = Depends(get_db)):
    att = db.get(Attachment, attachment_id)
    if not att or att.task_id != task_id:
        raise HTTPException(404, "Файл не найден")
    path = Path(settings.UPLOAD_DIR) / att.stored_name
    if path.exists():
        try:
            os.remove(path)
        except OSError:
            pass
    log_action(db, user_id=user.id, action="delete", entity="attachment", entity_id=att.id, task_id=task_id)
    db.delete(att)
    db.commit()
    return Message(message="Файл удалён")
