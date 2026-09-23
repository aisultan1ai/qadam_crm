"""P4 API — все новые endpoints для P4-модулей одним файлом.

Роутеры:
- /api/project-groups
- /api/projects/{id}/roles
- /api/directories (schemas + entries)
- /api/documents (folders + files + versions)
- /api/holidays
- /api/security-policy
- /api/log-retention
- /api/integrations (витрина)
- /api/me/2fa (setup/verify/disable)
- /api/comments/{id}/pin | unpin | hide | move
- /api/comments/{id}/edit-history
- /api/contacts/import (xlsx/csv) + /merge + /duplicates + /convert-to-employee
- /api/admin/export-account
"""
from __future__ import annotations

import io
import csv
import re
import secrets
import base64
from datetime import date, datetime, timezone
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse, JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_, func, and_
from pydantic import BaseModel, ConfigDict, field_validator

from ..database import get_db
from ..models import (
    ProjectGroup, ProjectRoleAssignment, Project, CommentEditHistory, Comment, Task, TenantMembership,
    Directory, DirectoryEntry, DocumentFolder, Document, DocumentVersion,
    TenantLogRetention, TenantHoliday, TenantSecurityPolicy, IntegrationProvider,
    Contact, Company, User, TotpBackupCode,
)
from ..schemas.common import Message
from .deps import TenantContext, get_current_context, log_action, require


router = APIRouter(tags=["p4"])


# =============================================================================
# 1. Project groups
# =============================================================================

class GroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    color: Optional[str] = None
    order_index: int


class GroupCreate(BaseModel):
    name: str
    color: Optional[str] = None
    order_index: int = 0


@router.get("/api/project-groups", response_model=list[GroupOut])
def list_project_groups(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    return (
        db.query(ProjectGroup)
        .filter(ProjectGroup.tenant_id == ctx.tenant.id)
        .order_by(ProjectGroup.order_index, ProjectGroup.name)
        .all()
    )


@router.post("/api/project-groups", response_model=GroupOut, status_code=201)
def create_project_group(payload: GroupCreate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = ProjectGroup(tenant_id=ctx.tenant.id, **payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/api/project-groups/{gid}", response_model=GroupOut)
def update_project_group(gid: int, payload: GroupCreate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(ProjectGroup, gid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Группа не найдена")
    row.name, row.color, row.order_index = payload.name, payload.color, payload.order_index
    db.commit()
    db.refresh(row)
    return row


@router.delete("/api/project-groups/{gid}", response_model=Message)
def delete_project_group(gid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(ProjectGroup, gid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Группа не найдена")
    db.delete(row)
    db.commit()
    return Message(message="Удалено")


# =============================================================================
# 2. Project roles
# =============================================================================

class ProjectRoleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    user_id: int
    role_name: str


class ProjectRoleAssign(BaseModel):
    user_id: int
    role_name: str


@router.get("/api/projects/{project_id}/roles", response_model=list[ProjectRoleOut])
def list_project_roles(project_id: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    proj = db.get(Project, project_id)
    if not proj or proj.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Проект не найден")
    return db.query(ProjectRoleAssignment).filter(ProjectRoleAssignment.project_id == project_id).all()


def _project_in_tenant(db: Session, ctx: TenantContext, project_id: int) -> Project:
    proj = db.get(Project, project_id)
    if not proj or proj.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Проект не найден")
    return proj


@router.post("/api/projects/{project_id}/roles", response_model=ProjectRoleOut, status_code=201)
def assign_project_role(project_id: int, payload: ProjectRoleAssign, ctx: TenantContext = Depends(require("projects.update")), db: Session = Depends(get_db)):
    _project_in_tenant(db, ctx, project_id)
    # Назначать можно только сотрудника этой же компании.
    member = (
        db.query(TenantMembership)
        .filter(TenantMembership.tenant_id == ctx.tenant.id, TenantMembership.user_id == payload.user_id)
        .first()
    )
    if not member:
        raise HTTPException(404, "Пользователь не найден в компании")
    row = ProjectRoleAssignment(project_id=project_id, user_id=payload.user_id, role_name=payload.role_name)
    db.add(row)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(409, "Такая роль уже назначена")
    db.refresh(row)
    return row


@router.delete("/api/projects/{project_id}/roles/{rid}", response_model=Message)
def remove_project_role(project_id: int, rid: int, ctx: TenantContext = Depends(require("projects.update")), db: Session = Depends(get_db)):
    _project_in_tenant(db, ctx, project_id)
    row = db.get(ProjectRoleAssignment, rid)
    if not row or row.project_id != project_id:
        raise HTTPException(404, "Роль не найдена")
    db.delete(row)
    db.commit()
    return Message(message="Удалено")


# =============================================================================
# 3. Comments — pin/hide/edit-history/move
# =============================================================================

class CommentAction(BaseModel):
    pinned: Optional[bool] = None
    hidden: Optional[bool] = None
    draft: Optional[bool] = None


@router.patch("/api/comments/{cid}/flags", response_model=Message)
def update_comment_flags(cid: int, payload: CommentAction, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    c = db.get(Comment, cid)
    if not c or c.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Комментарий не найден")
    if payload.pinned is not None:
        c.is_pinned = payload.pinned
    if payload.hidden is not None:
        c.is_hidden = payload.hidden
    if payload.draft is not None:
        c.is_draft = payload.draft
    db.commit()
    return Message(message="OK")


class EditHistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    old_body: str
    edited_by: Optional[int] = None
    edited_at: datetime


@router.get("/api/comments/{cid}/edit-history", response_model=list[EditHistoryOut])
def comment_edit_history(cid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    c = db.get(Comment, cid)
    if not c or c.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Комментарий не найден")
    return (
        db.query(CommentEditHistory)
        .filter(CommentEditHistory.comment_id == cid)
        .order_by(CommentEditHistory.edited_at.desc())
        .all()
    )


class MoveComment(BaseModel):
    to_task_id: int


@router.post("/api/comments/{cid}/move", response_model=Message)
def move_comment(cid: int, payload: MoveComment, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    c = db.get(Comment, cid)
    if not c or c.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Комментарий не найден")
    target = db.get(Task, payload.to_task_id)
    if not target or target.tenant_id != ctx.tenant.id:
        raise HTTPException(400, "Целевая задача не найдена")
    c.task_id = payload.to_task_id
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="move_comment", entity="comment", entity_id=cid, task_id=payload.to_task_id)
    db.commit()
    return Message(message=f"Перенесён в задачу #{payload.to_task_id}")


# =============================================================================
# 4. Directories (справочники)
# =============================================================================

CODE_RE = re.compile(r"^[a-z][a-z0-9_]{1,49}$")


class DirectoryField(BaseModel):
    name: str
    label: str
    type: str = "text"
    required: bool = False


class DirectoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    label: str
    icon: Optional[str] = None
    fields: list[dict] = []


class DirectoryCreate(BaseModel):
    code: str
    label: str
    icon: Optional[str] = None
    fields: list[DirectoryField] = []

    @field_validator("code")
    @classmethod
    def _code(cls, v: str) -> str:
        if not CODE_RE.match(v):
            raise ValueError("code must be snake_case")
        return v


@router.get("/api/directories", response_model=list[DirectoryOut])
def list_directories(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    return (
        db.query(Directory)
        .filter(Directory.tenant_id == ctx.tenant.id)
        .order_by(Directory.label)
        .all()
    )


@router.post("/api/directories", response_model=DirectoryOut, status_code=201)
def create_directory(payload: DirectoryCreate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    if db.query(Directory).filter(Directory.tenant_id == ctx.tenant.id, Directory.code == payload.code).first():
        raise HTTPException(409, f"Справочник {payload.code} уже существует")
    row = Directory(
        tenant_id=ctx.tenant.id,
        code=payload.code,
        label=payload.label,
        icon=payload.icon,
        fields=[f.model_dump() for f in payload.fields],
        created_by=ctx.user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/api/directories/{did}", response_model=Message)
def delete_directory(did: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(Directory, did)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Справочник не найден")
    db.delete(row)
    db.commit()
    return Message(message="Удалено")


class EntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    label: Optional[str] = None
    values: dict[str, Any] = {}


class EntryCreate(BaseModel):
    label: Optional[str] = None
    values: dict[str, Any] = {}


@router.get("/api/directories/{code}/entries", response_model=list[EntryOut])
def list_entries(code: str, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    d = db.query(Directory).filter(Directory.tenant_id == ctx.tenant.id, Directory.code == code).first()
    if not d:
        raise HTTPException(404, "Справочник не найден")
    return db.query(DirectoryEntry).filter(DirectoryEntry.directory_id == d.id).order_by(DirectoryEntry.id.desc()).limit(500).all()


@router.post("/api/directories/{code}/entries", response_model=EntryOut, status_code=201)
def create_entry(code: str, payload: EntryCreate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    d = db.query(Directory).filter(Directory.tenant_id == ctx.tenant.id, Directory.code == code).first()
    if not d:
        raise HTTPException(404, "Справочник не найден")
    row = DirectoryEntry(tenant_id=ctx.tenant.id, directory_id=d.id, label=payload.label, values=payload.values, created_by=ctx.user.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/api/directory-entries/{eid}", response_model=Message)
def delete_entry(eid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(DirectoryEntry, eid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Запись не найдена")
    db.delete(row)
    db.commit()
    return Message(message="Удалено")


# =============================================================================
# 5. Documents (отдельный модуль)
# =============================================================================

class FolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    parent_id: Optional[int] = None
    name: str
    created_at: datetime


class FolderCreate(BaseModel):
    name: str
    parent_id: Optional[int] = None


@router.get("/api/documents/folders", response_model=list[FolderOut])
def list_folders(parent_id: Optional[int] = None, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    q = db.query(DocumentFolder).filter(DocumentFolder.tenant_id == ctx.tenant.id)
    if parent_id is None:
        q = q.filter(DocumentFolder.parent_id.is_(None))
    else:
        q = q.filter(DocumentFolder.parent_id == parent_id)
    return q.order_by(DocumentFolder.name).all()


@router.post("/api/documents/folders", response_model=FolderOut, status_code=201)
def create_folder(payload: FolderCreate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = DocumentFolder(tenant_id=ctx.tenant.id, parent_id=payload.parent_id, name=payload.name, created_by=ctx.user.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


class DocOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    folder_id: Optional[int] = None
    name: str
    mime: Optional[str] = None
    size: int
    version_count: int
    is_public: bool
    public_slug: Optional[str] = None
    created_at: datetime
    updated_at: datetime


@router.get("/api/documents", response_model=list[DocOut])
def list_documents(folder_id: Optional[int] = None, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    q = db.query(Document).filter(Document.tenant_id == ctx.tenant.id)
    if folder_id is not None:
        q = q.filter(Document.folder_id == folder_id)
    else:
        q = q.filter(Document.folder_id.is_(None))
    return q.order_by(Document.updated_at.desc()).limit(500).all()


@router.post("/api/documents/upload", response_model=DocOut, status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    folder_id: Optional[int] = Form(None),
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    from ..config import settings
    import os
    upload_dir = os.path.join(settings.UPLOAD_DIR, f"tenant_{ctx.tenant.id}", "documents")
    os.makedirs(upload_dir, exist_ok=True)
    safe_name = re.sub(r"[^\w.\-]", "_", file.filename or "unnamed")
    unique = secrets.token_hex(8)
    path = os.path.join(upload_dir, f"{unique}_{safe_name}")
    content = await file.read()
    with open(path, "wb") as f:
        f.write(content)

    row = Document(
        tenant_id=ctx.tenant.id,
        folder_id=folder_id,
        name=file.filename or "unnamed",
        mime=file.content_type,
        size=len(content),
        file_path=path,
        version_count=1,
        created_by=ctx.user.id,
    )
    db.add(row)
    db.flush()
    db.add(DocumentVersion(document_id=row.id, version_no=1, file_path=path, size=len(content), uploaded_by=ctx.user.id))
    db.commit()
    db.refresh(row)
    return row


@router.post("/api/documents/{did}/publish", response_model=DocOut)
def publish_document(did: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(Document, did)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Документ не найден")
    if not row.public_slug:
        row.public_slug = secrets.token_urlsafe(16)
    row.is_public = True
    db.commit()
    db.refresh(row)
    return row


@router.post("/api/documents/{did}/unpublish", response_model=DocOut)
def unpublish_document(did: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(Document, did)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Документ не найден")
    row.is_public = False
    db.commit()
    db.refresh(row)
    return row


@router.delete("/api/documents/{did}", response_model=Message)
def delete_document(did: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(Document, did)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Документ не найден")
    db.delete(row)
    db.commit()
    return Message(message="Удалено")


class PreviewOut(BaseModel):
    kind: str  # "google_docs_viewer" | "onlyoffice" | "download_only"
    url: Optional[str] = None
    config: Optional[dict[str, Any]] = None  # для OnlyOffice — конфиг iframe/API
    message: Optional[str] = None


@router.get("/api/documents/{did}/preview-url", response_model=PreviewOut)
def document_preview(did: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    """P4t.4: возвращает URL для просмотра документа.

    - Если документ публичный (is_public=true) → Google Docs Viewer URL (использует public_slug).
    - Иначе, если настроен ONLYOFFICE_URL → OnlyOffice конфиг с JWT.
    - Иначе → download_only (фронт покажет кнопку скачивания).
    """
    from ..config import settings
    row = db.get(Document, did)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Документ не найден")

    base = (getattr(settings, "APP_BASE_URL", None) or "http://localhost").rstrip("/")

    if row.is_public and row.public_slug:
        # Google Docs Viewer работает с любым публичным URL — рендерит превью Office/PDF.
        public_url = f"{base}/public/documents/{row.public_slug}/download"
        return PreviewOut(
            kind="google_docs_viewer",
            url=f"https://docs.google.com/viewer?url={public_url}&embedded=true",
        )

    onlyoffice = getattr(settings, "ONLYOFFICE_URL", None)
    if onlyoffice:
        # Собираем OnlyOffice config. JWT подпись обязательна на prod OO серверах.
        from jose import jwt as pyjwt  # python-jose уже в requirements
        secret = getattr(settings, "ONLYOFFICE_JWT_SECRET", None) or ""
        ext = (row.name.rsplit(".", 1)[-1] if "." in row.name else "").lower() or "docx"
        cfg = {
            "document": {
                "fileType": ext,
                "key": f"doc-{row.id}-{int(row.updated_at.timestamp())}",
                "title": row.name,
                "url": f"{base}/api/documents/{row.id}/download-internal",  # OnlyOffice дёрнет этот URL
            },
            "documentType": "text" if ext in ("docx", "doc", "odt", "rtf", "txt") else "spreadsheet" if ext in ("xlsx", "xls", "ods", "csv") else "presentation" if ext in ("pptx", "ppt", "odp") else "text",
            "editorConfig": {
                "mode": "view",
                "user": {"id": str(ctx.user.id), "name": ctx.user.name},
            },
        }
        if secret:
            cfg["token"] = pyjwt.encode(cfg, secret, algorithm="HS256")
        return PreviewOut(kind="onlyoffice", url=onlyoffice, config=cfg)

    return PreviewOut(kind="download_only", message="Онлайн-просмотр недоступен. Скачайте файл.")


@router.get("/api/documents/{did}/download-internal")
def download_internal(did: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    """Внутренний download для OnlyOffice — с auth."""
    row = db.get(Document, did)
    if not row or row.tenant_id != ctx.tenant.id or not row.file_path:
        raise HTTPException(404, "Not found")
    def gen():
        with open(row.file_path, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                yield chunk
    return StreamingResponse(gen(), media_type=row.mime or "application/octet-stream")


# =============================================================================
# 6. Holidays
# =============================================================================

class HolidayOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    date: date
    name: str
    is_workday: bool


class HolidayCreate(BaseModel):
    date: date
    name: str
    is_workday: bool = False


@router.get("/api/holidays", response_model=list[HolidayOut])
def list_holidays(
    year: Optional[int] = None,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    q = db.query(TenantHoliday).filter(TenantHoliday.tenant_id == ctx.tenant.id)
    if year:
        q = q.filter(func.extract("year", TenantHoliday.date) == year)
    return q.order_by(TenantHoliday.date).all()


@router.post("/api/holidays", response_model=HolidayOut, status_code=201)
def create_holiday(payload: HolidayCreate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = TenantHoliday(tenant_id=ctx.tenant.id, **payload.model_dump())
    db.add(row)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(409, "На эту дату уже есть запись")
    db.refresh(row)
    return row


@router.delete("/api/holidays/{hid}", response_model=Message)
def delete_holiday(hid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(TenantHoliday, hid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Не найдено")
    db.delete(row)
    db.commit()
    return Message(message="Удалено")


# =============================================================================
# 7. Security policy
# =============================================================================

class SecPolicyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    password_min_length: int
    password_require_upper: bool
    password_require_number: bool
    password_require_special: bool
    password_rotation_days: Optional[int] = None
    session_timeout_minutes: Optional[int] = None
    ip_allowlist: list[str] = []
    require_2fa: bool
    require_2fa_for_admins: bool


class SecPolicyUpdate(BaseModel):
    password_min_length: Optional[int] = None
    password_require_upper: Optional[bool] = None
    password_require_number: Optional[bool] = None
    password_require_special: Optional[bool] = None
    password_rotation_days: Optional[int] = None
    session_timeout_minutes: Optional[int] = None
    ip_allowlist: Optional[list[str]] = None
    require_2fa: Optional[bool] = None
    require_2fa_for_admins: Optional[bool] = None


def _get_or_create_policy(db: Session, tenant_id: int) -> TenantSecurityPolicy:
    p = db.query(TenantSecurityPolicy).filter(TenantSecurityPolicy.tenant_id == tenant_id).first()
    if not p:
        p = TenantSecurityPolicy(tenant_id=tenant_id)
        db.add(p)
        db.commit()
        db.refresh(p)
    return p


@router.get("/api/security-policy", response_model=SecPolicyOut)
def get_security_policy(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    return _get_or_create_policy(db, ctx.tenant.id)


@router.patch("/api/security-policy", response_model=SecPolicyOut)
def update_security_policy(payload: SecPolicyUpdate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    p = _get_or_create_policy(db, ctx.tenant.id)
    for f in payload.model_fields:
        v = getattr(payload, f)
        if v is not None:
            setattr(p, f, v)
    db.commit()
    db.refresh(p)
    return p


# =============================================================================
# 8. Log retention
# =============================================================================

class RetentionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    entity_type: str
    retention_days: Optional[int] = None


class RetentionSet(BaseModel):
    entity_type: str
    retention_days: Optional[int] = None  # None = ∞


@router.get("/api/log-retention", response_model=list[RetentionOut])
def list_retention(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    return db.query(TenantLogRetention).filter(TenantLogRetention.tenant_id == ctx.tenant.id).all()


@router.post("/api/log-retention", response_model=RetentionOut)
def set_retention(payload: RetentionSet, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = (
        db.query(TenantLogRetention)
        .filter(TenantLogRetention.tenant_id == ctx.tenant.id, TenantLogRetention.entity_type == payload.entity_type)
        .first()
    )
    if not row:
        row = TenantLogRetention(tenant_id=ctx.tenant.id, entity_type=payload.entity_type, retention_days=payload.retention_days)
        db.add(row)
    else:
        row.retention_days = payload.retention_days
    db.commit()
    db.refresh(row)
    return row


# =============================================================================
# 9. Integration providers (витрина)
# =============================================================================

class ProviderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    label: str
    category: str
    status: str
    is_enabled: bool


@router.get("/api/integrations", response_model=list[ProviderOut])
def list_integrations(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    return (
        db.query(IntegrationProvider)
        .filter(or_(IntegrationProvider.tenant_id == ctx.tenant.id, IntegrationProvider.tenant_id.is_(None)))
        .order_by(IntegrationProvider.category, IntegrationProvider.label)
        .all()
    )


@router.post("/api/integrations/{code}/toggle", response_model=ProviderOut)
def toggle_integration(code: str, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = (
        db.query(IntegrationProvider)
        .filter(IntegrationProvider.tenant_id == ctx.tenant.id, IntegrationProvider.code == code)
        .first()
    )
    if not row:
        template = db.query(IntegrationProvider).filter(IntegrationProvider.tenant_id.is_(None), IntegrationProvider.code == code).first()
        if not template:
            raise HTTPException(404, f"Провайдер {code} не найден")
        row = IntegrationProvider(
            tenant_id=ctx.tenant.id, code=code, label=template.label, category=template.category,
            status=template.status, is_enabled=False,
        )
        db.add(row)
        db.flush()
    row.is_enabled = not row.is_enabled
    db.commit()
    db.refresh(row)
    return row


# --- P4t.5: OAuth-инициация для интеграций ---
# MVP: возвращаем redirect URL на consent screen провайдера. Callback реализован
# для google_drive (переиспользуем /api/integrations/google/callback), для остальных
# провайдеров — URL на официальные consent, но обработчик callback пока placeholder.

class OAuthStartOut(BaseModel):
    provider: str
    consent_url: str
    note: Optional[str] = None


@router.get("/api/integrations/{code}/oauth-start", response_model=OAuthStartOut)
def integration_oauth_start(code: str, ctx: TenantContext = Depends(get_current_context)):
    """Возвращает URL для перехода на consent-экран провайдера.

    Для google_drive и dropbox — генерируем реальный consent URL с state (P5.4/P5.5).
    Для остальных — заглушки на официальные страницы.
    """
    import secrets as _secrets
    import base64 as _b64
    import json as _json

    if code in ("google_drive", "dropbox"):
        from ..services import google_drive as gdrive
        from ..services import dropbox_service as dbx_svc
        from ..services import google_calendar as gcal
        configured = (
            gcal.tenant_configured(ctx.tenant) if code == "google_drive"
            else dbx_svc.tenant_configured(ctx.tenant)
        )
        if not configured:
            raise HTTPException(
                503,
                f"{code} не настроен: owner должен ввести client credentials в /settings/integrations",
            )
        nonce = _secrets.token_urlsafe(16)
        state_payload = _json.dumps(
            {"t": ctx.tenant.id, "u": ctx.user.id, "p": code, "n": nonce}
        ).encode("utf-8")
        state = _b64.urlsafe_b64encode(state_payload).decode("ascii").rstrip("=")
        if code == "google_drive":
            url = gdrive.build_auth_url(ctx.tenant, state)
        else:
            url = dbx_svc.build_auth_url(ctx.tenant, state)
        return OAuthStartOut(provider=code, consent_url=url)

    base_urls = {
        "onedrive": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=YOUR_APP&response_type=code",
        "slack": "https://slack.com/oauth/v2/authorize?client_id=YOUR_APP&scope=chat:write,channels:read",
        "mailchimp": "https://login.mailchimp.com/oauth2/authorize?response_type=code&client_id=YOUR_APP",
        "viber": "https://developers.viber.com/",
        "tiktok": "https://developers.tiktok.com/apps",
        "facebook_lead_ads": "https://www.facebook.com/v18.0/dialog/oauth?client_id=YOUR_APP&response_type=code",
        "google_forms": "/api/integrations/google/auth?scopes=forms",
        "google_calendar": "/api/integrations/google/auth",
        "google_maps": "https://console.cloud.google.com/apis/library/maps-backend.googleapis.com",
        "twilio": "https://console.twilio.com/",
    }
    url = base_urls.get(code)
    if not url:
        raise HTTPException(404, f"OAuth-flow для {code} не настроен")
    note = None
    if not url.startswith("/api/"):
        note = "Заглушка: настройте YOUR_APP на реальный client_id/redirect_uri в консоли провайдера"
    return OAuthStartOut(provider=code, consent_url=url, note=note)


# =============================================================================
# 10. 2FA TOTP
# =============================================================================

class TotpSetupOut(BaseModel):
    secret: str
    otpauth_url: str


@router.post("/api/me/2fa/setup", response_model=TotpSetupOut)
def totp_setup(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    try:
        import pyotp
    except ImportError:
        raise HTTPException(501, "pyotp не установлен")
    from ..core.totp_crypto import decrypt_totp, encrypt_totp
    user = ctx.user
    plain_secret = decrypt_totp(user.totp_secret)
    if not plain_secret:
        plain_secret = pyotp.random_base32()
        user.totp_secret = encrypt_totp(plain_secret)
    db.commit()
    totp = pyotp.TOTP(plain_secret)
    otpauth = totp.provisioning_uri(name=user.email, issuer_name=f"Qadam CRM ({ctx.tenant.name})")
    return TotpSetupOut(secret=plain_secret, otpauth_url=otpauth)


class TotpVerifyIn(BaseModel):
    code: str


@router.post("/api/me/2fa/verify", response_model=Message)
def totp_verify(payload: TotpVerifyIn, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    try:
        import pyotp
    except ImportError:
        raise HTTPException(501, "pyotp не установлен")
    from ..core.totp_crypto import decrypt_totp, encrypt_totp
    user = ctx.user
    plain_secret = decrypt_totp(user.totp_secret)
    if not plain_secret:
        raise HTTPException(400, "Сначала /2fa/setup")
    totp = pyotp.TOTP(plain_secret)
    if not totp.verify(payload.code, valid_window=1):
        raise HTTPException(400, "Неверный код")
    user.totp_enabled = True
    # На случай если секрет был legacy plain — перезапишем зашифрованным.
    if user.totp_secret and not user.totp_secret.startswith("enc:v1:"):
        user.totp_secret = encrypt_totp(plain_secret)
    db.commit()
    return Message(message="2FA включена")


@router.post("/api/me/2fa/disable", response_model=Message)
def totp_disable(payload: TotpVerifyIn, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    try:
        import pyotp
    except ImportError:
        raise HTTPException(501, "pyotp не установлен")
    from ..core.totp_crypto import decrypt_totp
    user = ctx.user
    plain_secret = decrypt_totp(user.totp_secret)
    if plain_secret:
        totp = pyotp.TOTP(plain_secret)
        if not totp.verify(payload.code, valid_window=1):
            raise HTTPException(400, "Неверный код")
    user.totp_secret = None
    user.totp_enabled = False
    # Backup-коды становятся бесполезными без TOTP — чистим сразу, чтобы не
    # висели «неиспользованные» в списке при повторном включении.
    db.query(TotpBackupCode).filter(TotpBackupCode.user_id == user.id).delete(synchronize_session=False)
    db.commit()
    return Message(message="2FA выключена")


# =============================================================================
# 10a. 2FA backup codes
# =============================================================================

BACKUP_CODE_COUNT = 10


def _generate_backup_code() -> str:
    """Формат XXXX-XXXX: 8 hex-символов через дефис, ~32 бита энтропии.

    Достаточно для одноразового кода — bruteforce за ~2 млрд попыток с rate-limit
    в 10/hour нереалистичен. Формат легко читать/вводить вручную.
    """
    raw = secrets.token_hex(4).upper()  # 8 hex chars
    return f"{raw[:4]}-{raw[4:]}"


def _hash_backup_code(code: str) -> str:
    from ..core.security import hash_password
    return hash_password(code.strip().upper())


def _verify_backup_code(plain: str, hashed: str) -> bool:
    from ..core.security import verify_password
    return verify_password(plain.strip().upper(), hashed)


class BackupCodesOut(BaseModel):
    codes: list[str]
    message: str


class BackupCodesStatus(BaseModel):
    total: int
    unused: int
    generated_at: Optional[datetime] = None


@router.post("/api/me/2fa/backup-codes/regenerate", response_model=BackupCodesOut)
def regenerate_backup_codes(
    payload: TotpVerifyIn,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    """Генерирует новые backup-коды. Требует валидный TOTP-код: без него любой
    угнавший access-токен смог бы сгенерить новые коды и обойти 2FA.

    Возвращает plain-коды один раз — UI обязан показать их пользователю и
    предложить сохранить/распечатать. При повторном вызове старые коды удаляются.
    """
    try:
        import pyotp
    except ImportError:
        raise HTTPException(501, "pyotp не установлен")
    from ..core.totp_crypto import decrypt_totp
    user = ctx.user
    if not user.totp_enabled:
        raise HTTPException(400, "2FA не включена — сначала /2fa/verify")
    plain_secret = decrypt_totp(user.totp_secret)
    if not plain_secret:
        raise HTTPException(400, "TOTP-секрет недоступен, переустановите 2FA")
    totp = pyotp.TOTP(plain_secret)
    if not totp.verify((payload.code or "").strip(), valid_window=1):
        raise HTTPException(400, "Неверный TOTP-код")

    # Удаляем старые (все — used и unused). Пользователь при взгляде на список
    # должен видеть только актуальные коды.
    db.query(TotpBackupCode).filter(TotpBackupCode.user_id == user.id).delete(synchronize_session=False)

    plain_codes: list[str] = []
    for _ in range(BACKUP_CODE_COUNT):
        code = _generate_backup_code()
        plain_codes.append(code)
        db.add(TotpBackupCode(user_id=user.id, code_hash=_hash_backup_code(code)))
    db.commit()

    return BackupCodesOut(
        codes=plain_codes,
        message="Сохраните коды в надёжном месте. Мы больше не покажем их — только пересгенерируем новые.",
    )


@router.get("/api/me/2fa/backup-codes/status", response_model=BackupCodesStatus)
def backup_codes_status(
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    """Сводка по backup-кодам: сколько всего, сколько неиспользованных."""
    rows = db.query(TotpBackupCode).filter(TotpBackupCode.user_id == ctx.user.id).all()
    total = len(rows)
    unused = sum(1 for r in rows if r.used_at is None)
    latest = max((r.created_at for r in rows), default=None)
    return BackupCodesStatus(total=total, unused=unused, generated_at=latest)


class BackupCodeConsumeIn(BaseModel):
    code: str


@router.post("/api/me/2fa/backup-codes/consume", response_model=Message)
def consume_backup_code(
    payload: BackupCodeConsumeIn,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    """Использует backup-код (вместо TOTP). Одноразово — помечает used_at.

    Отдельный endpoint (не в /2fa/verify) даёт чётко читаемое разделение и
    отдельный лимит на попытки brute-force.
    """
    code = (payload.code or "").strip().upper()
    if not code:
        raise HTTPException(400, "Код не передан")
    rows = (
        db.query(TotpBackupCode)
        .filter(
            TotpBackupCode.user_id == ctx.user.id,
            TotpBackupCode.used_at.is_(None),
        )
        .all()
    )
    matched: Optional[TotpBackupCode] = None
    for row in rows:
        if _verify_backup_code(code, row.code_hash):
            matched = row
            break
    if not matched:
        raise HTTPException(400, "Код недействителен или уже использован")
    matched.used_at = datetime.now(timezone.utc)
    db.commit()
    return Message(message="Код принят")


# =============================================================================
# 11. Contacts import / merge / duplicates / convert-to-employee
# =============================================================================

class DuplicateGroup(BaseModel):
    key: str
    ids: list[int]


@router.get("/api/contacts/duplicates", response_model=list[DuplicateGroup])
def find_duplicates(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    """Простой алгоритм: группировка по email или phone."""
    from collections import defaultdict
    contacts = db.query(Contact).filter(Contact.tenant_id == ctx.tenant.id).all()
    by_email = defaultdict(list)
    by_phone = defaultdict(list)
    for c in contacts:
        if c.email:
            by_email[c.email.lower().strip()].append(c.id)
        if c.phone:
            by_phone[re.sub(r"\D", "", c.phone)].append(c.id)
    out = []
    for key, ids in by_email.items():
        if len(ids) > 1:
            out.append(DuplicateGroup(key=f"email:{key}", ids=ids))
    for key, ids in by_phone.items():
        if len(ids) > 1:
            out.append(DuplicateGroup(key=f"phone:{key}", ids=ids))
    return out


class MergeIn(BaseModel):
    primary_id: int
    other_ids: list[int]


@router.post("/api/contacts/merge", response_model=Message)
def merge_contacts(payload: MergeIn, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    primary = db.get(Contact, payload.primary_id)
    if not primary or primary.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Primary не найден")
    others = db.query(Contact).filter(Contact.tenant_id == ctx.tenant.id, Contact.id.in_(payload.other_ids)).all()
    for o in others:
        # склеиваем пустые поля primary из других
        for f in ("last_name", "email", "phone", "position", "note", "source", "company_id", "owner_id"):
            if getattr(primary, f) in (None, "") and getattr(o, f) not in (None, ""):
                setattr(primary, f, getattr(o, f))
        # мержим custom_data
        merged = dict(primary.custom_data or {})
        merged.update(o.custom_data or {})
        primary.custom_data = merged
        db.delete(o)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="merge", entity="contact", entity_id=primary.id, detail=f"merged {len(others)}")
    db.commit()
    return Message(message=f"Склеено: {len(others)}")


@router.post("/api/contacts/import", response_model=Message)
async def import_contacts(
    file: UploadFile = File(...),
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    content = await file.read()
    imported = 0
    if (file.filename or "").lower().endswith(".csv") or (file.content_type or "").startswith("text/csv"):
        text = content.decode("utf-8", errors="replace")
        reader = csv.DictReader(io.StringIO(text))
        for row in reader:
            c = Contact(
                tenant_id=ctx.tenant.id,
                first_name=(row.get("first_name") or row.get("Имя") or "").strip()[:100] or "—",
                last_name=(row.get("last_name") or row.get("Фамилия") or "").strip()[:100] or None,
                email=(row.get("email") or row.get("Email") or "").strip() or None,
                phone=(row.get("phone") or row.get("Телефон") or "").strip() or None,
                position=(row.get("position") or row.get("Должность") or "").strip() or None,
                owner_id=ctx.user.id,
            )
            db.add(c)
            imported += 1
    elif (file.filename or "").lower().endswith((".xlsx", ".xls")):
        try:
            from openpyxl import load_workbook
        except ImportError:
            raise HTTPException(501, "openpyxl не установлен")
        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            return Message(message="Файл пуст")
        headers = [str(h).strip().lower() if h else "" for h in rows[0]]
        for r in rows[1:]:
            data = dict(zip(headers, r))
            fn = str(data.get("first_name") or data.get("имя") or "").strip()
            if not fn:
                continue
            c = Contact(
                tenant_id=ctx.tenant.id,
                first_name=fn[:100],
                last_name=(str(data.get("last_name") or data.get("фамилия") or "").strip() or None),
                email=(str(data.get("email") or "").strip() or None),
                phone=(str(data.get("phone") or data.get("телефон") or "").strip() or None),
                position=(str(data.get("position") or data.get("должность") or "").strip() or None),
                owner_id=ctx.user.id,
            )
            db.add(c)
            imported += 1
    else:
        raise HTTPException(400, "Поддерживаются только .csv / .xlsx")

    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="import", entity="contact", detail=f"{imported} rows")
    db.commit()
    return Message(message=f"Импортировано контактов: {imported}")


class ConvertToEmployeeIn(BaseModel):
    email: str
    password: str


@router.post("/api/contacts/{cid}/convert-to-employee", response_model=Message)
def convert_to_employee(cid: int, payload: ConvertToEmployeeIn, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    from ..core.security import hash_password
    c = db.get(Contact, cid)
    if not c or c.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Контакт не найден")
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(409, "Пользователь с таким email уже существует")
    u = User(
        email=payload.email,
        name=f"{c.first_name} {c.last_name or ''}".strip(),
        password_hash=hash_password(payload.password),
        position=c.position,
        phone=c.phone,
    )
    db.add(u)
    db.flush()
    db.add(TenantMembership(tenant_id=ctx.tenant.id, user_id=u.id, role="member"))
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="convert", entity="contact", entity_id=cid, detail=f"→ user {u.id}")
    db.commit()
    return Message(message=f"Создан сотрудник #{u.id}")


# =============================================================================
# 12. Full account export
# =============================================================================

@router.get("/api/admin/export-account")
def export_account(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    """Экспорт данных tenant в один JSON. Только для владельца/админа."""
    import json
    tid = ctx.tenant.id
    def dump(model, extra_filter=None):
        q = db.query(model)
        if hasattr(model, "tenant_id"):
            q = q.filter(model.tenant_id == tid)
        if extra_filter is not None:
            q = q.filter(extra_filter)
        rows = q.all()
        out = []
        for r in rows:
            d = {c.name: getattr(r, c.name) for c in r.__table__.columns}
            for k, v in list(d.items()):
                if isinstance(v, (date, datetime)):
                    d[k] = v.isoformat()
            out.append(d)
        return out

    from ..models import (
        Task, Project, Contact, Company, Deal, Comment, Attachment,
        Directory, DirectoryEntry, Document, TenantHoliday,
    )

    data = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "tenant": {
            "id": ctx.tenant.id, "name": ctx.tenant.name,
            "slug": getattr(ctx.tenant, "slug", None),
        },
        "tasks": dump(Task),
        "projects": dump(Project),
        "contacts": dump(Contact),
        "companies": dump(Company),
        "deals": dump(Deal),
        "comments": dump(Comment),
        "directories": dump(Directory),
        "directory_entries": dump(DirectoryEntry),
        "documents": dump(Document),
        "holidays": dump(TenantHoliday),
    }

    body = json.dumps(data, ensure_ascii=False, indent=2, default=str).encode("utf-8")
    stream = io.BytesIO(body)
    return StreamingResponse(
        stream,
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename=qadam_account_{tid}_{int(datetime.now().timestamp())}.json"},
    )


# =============================================================================
# 13. Public document view (unauthenticated)
# =============================================================================

public_router = APIRouter(tags=["p4-public"])


@public_router.get("/public/documents/{slug}")
def public_doc_info(slug: str, db: Session = Depends(get_db)):
    d = db.query(Document).filter(Document.public_slug == slug, Document.is_public == True).first()  # noqa: E712
    if not d:
        raise HTTPException(404, "Not found")
    return {"name": d.name, "size": d.size, "mime": d.mime, "download_url": f"/public/documents/{slug}/download"}


@public_router.get("/public/documents/{slug}/download")
def public_doc_download(slug: str, db: Session = Depends(get_db)):
    d = db.query(Document).filter(Document.public_slug == slug, Document.is_public == True).first()  # noqa: E712
    if not d or not d.file_path:
        raise HTTPException(404, "Not found")
    def gen():
        with open(d.file_path, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                yield chunk
    return StreamingResponse(
        gen(),
        media_type=d.mime or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{d.name}"'},
    )
