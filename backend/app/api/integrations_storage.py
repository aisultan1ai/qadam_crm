"""Storage integrations API — Google Drive и Dropbox (P5.4 / P5.5).

Единый роутер, оба провайдера через один интерфейс:
- GET  /api/integrations/storage/{provider}/status
- GET  /api/integrations/storage/{provider}/auth-url
- GET  /api/integrations/storage/{provider}/callback   (public — Google/Dropbox редиректят сюда)
- DELETE /api/integrations/storage/{provider}/disconnect
- GET  /api/integrations/storage/{provider}/list?path=&folder_id=&page_token=&cursor=
- POST /api/integrations/storage/{provider}/import     (external file → local Document)

Плюс per-tenant конфиг Dropbox (владелец):
- GET/PUT/DELETE /api/integrations/storage/dropbox/tenant-config
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import secrets as pysecrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import settings
from ..core.secrets import encrypt
from ..database import get_db
from ..models import Document, DocumentVersion, StorageAccount, Tenant
from ..schemas.common import Message
from ..services import dropbox_service as dbx_svc
from ..services import google_drive as gdrive
from ..services import google_calendar as gcal  # только для tenant_configured (Google client_id/secret)
from .deps import TenantContext, get_current_context, log_action, require

log = logging.getLogger("qadam.integrations.storage")


router = APIRouter(prefix="/api/integrations/storage", tags=["integrations"])

PROVIDERS = ("google_drive", "dropbox")


def _check_provider(provider: str) -> None:
    if provider not in PROVIDERS:
        raise HTTPException(404, f"Unknown provider: {provider}")


def _require_owner(ctx: TenantContext):
    if not (ctx.membership.is_owner or ctx.user.is_platform_admin):
        raise HTTPException(403, "Только владелец компании может менять эти настройки")


def _encode_state(tenant_id: int, user_id: int, provider: str, nonce: str) -> str:
    payload = json.dumps({"t": tenant_id, "u": user_id, "p": provider, "n": nonce}).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _decode_state(state: str) -> tuple[int, int, str]:
    pad = "=" * (-len(state) % 4)
    data = json.loads(base64.urlsafe_b64decode((state + pad).encode("ascii")).decode("utf-8"))
    return int(data["t"]), int(data["u"]), str(data["p"])


def _get_account(db: Session, tenant_id: int, user_id: int, provider: str) -> Optional[StorageAccount]:
    return (
        db.query(StorageAccount)
        .filter(
            StorageAccount.tenant_id == tenant_id,
            StorageAccount.user_id == user_id,
            StorageAccount.provider == provider,
        )
        .one_or_none()
    )


def _tenant_configured(tenant: Tenant, provider: str) -> bool:
    if provider == "google_drive":
        return gcal.tenant_configured(tenant)
    if provider == "dropbox":
        return dbx_svc.tenant_configured(tenant)
    return False


# =============================================================================
# Status
# =============================================================================


class StatusOut(BaseModel):
    provider: str
    connected: bool
    configured: bool
    account_email: Optional[str] = None
    account_name: Optional[str] = None
    last_error: Optional[str] = None


@router.get("/{provider}/status", response_model=StatusOut)
def status(
    provider: str,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    _check_provider(provider)
    acc = _get_account(db, ctx.tenant.id, ctx.user.id, provider)
    return StatusOut(
        provider=provider,
        connected=acc is not None,
        configured=_tenant_configured(ctx.tenant, provider),
        account_email=acc.account_email if acc else None,
        account_name=acc.account_name if acc else None,
        last_error=acc.last_error if acc else None,
    )


# =============================================================================
# OAuth
# =============================================================================


class AuthUrlOut(BaseModel):
    auth_url: str


@router.get("/{provider}/auth-url", response_model=AuthUrlOut)
def auth_url(
    provider: str,
    ctx: TenantContext = Depends(get_current_context),
):
    _check_provider(provider)
    if not _tenant_configured(ctx.tenant, provider):
        raise HTTPException(
            503,
            f"{provider} не настроен в этой компании. Owner должен ввести client credentials в /settings/integrations.",
        )
    nonce = pysecrets.token_urlsafe(16)
    state = _encode_state(ctx.tenant.id, ctx.user.id, provider, nonce)
    if provider == "google_drive":
        url = gdrive.build_auth_url(ctx.tenant, state)
    else:
        url = dbx_svc.build_auth_url(ctx.tenant, state)
    return AuthUrlOut(auth_url=url)


@router.get("/{provider}/callback")
def callback(
    provider: str,
    request: Request,
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    _check_provider(provider)
    redirect_target = f"/settings/integrations?storage_provider={provider}"
    if error:
        return RedirectResponse(url=f"{redirect_target}&error={error}", status_code=302)
    if not code or not state:
        raise HTTPException(400, "code и state обязательны")
    try:
        tenant_id, user_id, state_provider = _decode_state(state)
    except Exception:
        raise HTTPException(400, "невалидный state")
    if state_provider != provider:
        raise HTTPException(400, "state/provider mismatch")

    tenant = db.get(Tenant, tenant_id)
    if not tenant or not _tenant_configured(tenant, provider):
        return RedirectResponse(url=f"{redirect_target}&error=tenant_not_configured", status_code=302)

    try:
        if provider == "google_drive":
            creds, email = gdrive.exchange_code(tenant, code, state)
            acc = gdrive.save_account(db, tenant_id, user_id, email, creds)
            log_action(db, tenant_id=tenant_id, user_id=user_id,
                       action="connect", entity="storage_account", entity_id=acc.id, detail=f"google_drive {email}")
        else:
            token_payload, info = dbx_svc.exchange_code(tenant, code)
            acc = dbx_svc.save_account(db, tenant_id, user_id, token_payload, info)
            log_action(db, tenant_id=tenant_id, user_id=user_id,
                       action="connect", entity="storage_account", entity_id=acc.id, detail=f"dropbox {info.get('email')}")
        db.commit()
    except Exception as e:
        log.exception("%s oauth exchange failed", provider)
        db.rollback()
        return RedirectResponse(url=f"{redirect_target}&error=exchange_failed", status_code=302)

    return RedirectResponse(url=f"{redirect_target}&connected=1", status_code=302)


@router.delete("/{provider}/disconnect", response_model=Message)
def disconnect(
    provider: str,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    _check_provider(provider)
    acc = _get_account(db, ctx.tenant.id, ctx.user.id, provider)
    if not acc:
        raise HTTPException(404, "Не подключено")
    if provider == "google_drive":
        gdrive.revoke(db, ctx.tenant, acc)
    else:
        dbx_svc.revoke(db, ctx.tenant, acc)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
               action="disconnect", entity="storage_account", entity_id=acc.id, detail=provider)
    db.commit()
    return Message(message=f"{provider} отключён")


# =============================================================================
# List / Import
# =============================================================================


class FileEntry(BaseModel):
    id: Optional[str] = None
    path: Optional[str] = None
    name: str
    kind: str  # file / folder
    mime: Optional[str] = None
    size: Optional[int] = None
    modified: Optional[str] = None


class ListOut(BaseModel):
    provider: str
    files: list[FileEntry]
    next_cursor: Optional[str] = None


@router.get("/{provider}/list", response_model=ListOut)
def list_files(
    provider: str,
    folder_id: Optional[str] = Query(None),
    path: Optional[str] = Query(None),
    page_token: Optional[str] = Query(None),
    cursor: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    _check_provider(provider)
    acc = _get_account(db, ctx.tenant.id, ctx.user.id, provider)
    if not acc:
        raise HTTPException(404, f"{provider} не подключён")
    try:
        if provider == "google_drive":
            r = gdrive.list_files(db, ctx.tenant, acc, folder_id=folder_id, page_token=page_token, query=q)
            db.commit()
            entries = [
                FileEntry(
                    id=f["id"],
                    name=f["name"],
                    kind="folder" if f["mimeType"] == "application/vnd.google-apps.folder" else "file",
                    mime=f["mimeType"],
                    size=int(f["size"]) if f.get("size") else None,
                    modified=f.get("modifiedTime"),
                )
                for f in r["files"]
            ]
            return ListOut(provider=provider, files=entries, next_cursor=r.get("next_page_token"))
        else:
            r = dbx_svc.list_files(db, ctx.tenant, acc, path=path, cursor=cursor)
            db.commit()
            entries = [
                FileEntry(
                    id=f.get("id"),
                    path=f.get("path"),
                    name=f["name"],
                    kind=f["kind"],
                    size=f.get("size"),
                    modified=f.get("modified"),
                )
                for f in r["files"]
            ]
            return ListOut(provider=provider, files=entries, next_cursor=r.get("cursor"))
    except Exception as e:
        db.rollback()
        log.exception("%s list failed", provider)
        raise HTTPException(502, f"{provider} list failed: {e}")


class ImportIn(BaseModel):
    file_id: Optional[str] = None  # Google Drive
    path: Optional[str] = None      # Dropbox
    folder_id: Optional[int] = Field(default=None, description="локальная папка Documents для сохранения")


class ImportOut(BaseModel):
    document_id: int
    name: str
    size: int


@router.post("/{provider}/import", response_model=ImportOut)
async def import_file(
    provider: str,
    payload: ImportIn,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    _check_provider(provider)
    acc = _get_account(db, ctx.tenant.id, ctx.user.id, provider)
    if not acc:
        raise HTTPException(404, f"{provider} не подключён")

    try:
        if provider == "google_drive":
            if not payload.file_id:
                raise HTTPException(400, "file_id обязателен для google_drive")
            content, name, mime = gdrive.download_file(db, ctx.tenant, acc, payload.file_id)
        else:
            if not payload.path:
                raise HTTPException(400, "path обязателен для dropbox")
            content, name, mime = dbx_svc.download_file(db, ctx.tenant, acc, payload.path)
    except HTTPException:
        raise
    except Exception as e:
        log.exception("%s download failed", provider)
        acc.last_error = str(e)[:1000]
        db.commit()
        raise HTTPException(502, f"{provider} download failed: {e}")

    upload_dir = os.path.join(settings.UPLOAD_DIR, f"tenant_{ctx.tenant.id}", "documents")
    os.makedirs(upload_dir, exist_ok=True)
    safe_name = re.sub(r"[^\w.\-]", "_", name or "unnamed")
    unique = pysecrets.token_hex(8)
    stored_path = os.path.join(upload_dir, f"{unique}_{safe_name}")
    with open(stored_path, "wb") as f:
        f.write(content)

    row = Document(
        tenant_id=ctx.tenant.id,
        folder_id=payload.folder_id,
        name=name or "unnamed",
        mime=mime,
        size=len(content),
        file_path=stored_path,
        version_count=1,
        created_by=ctx.user.id,
    )
    db.add(row)
    db.flush()
    db.add(DocumentVersion(
        document_id=row.id, version_no=1, file_path=stored_path,
        size=len(content), uploaded_by=ctx.user.id,
        comment=f"Импорт из {provider}",
    ))
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
               action="import", entity="document", entity_id=row.id, detail=f"from {provider}: {name}")
    db.commit()
    db.refresh(row)
    return ImportOut(document_id=row.id, name=row.name, size=row.size)


# =============================================================================
# Dropbox tenant config (owner)
# =============================================================================


class DropboxConfigOut(BaseModel):
    app_key: Optional[str] = None
    redirect_uri: Optional[str] = None
    has_secret: bool = False


class DropboxConfigIn(BaseModel):
    app_key: str = Field(min_length=5, max_length=200)
    app_secret: Optional[str] = Field(default=None, max_length=200)
    redirect_uri: str = Field(min_length=10, max_length=500)


@router.get("/dropbox/tenant-config", response_model=DropboxConfigOut)
def get_dropbox_config(
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    _require_owner(ctx)
    t = ctx.tenant
    return DropboxConfigOut(
        app_key=t.dropbox_app_key,
        redirect_uri=t.dropbox_redirect_uri,
        has_secret=bool(t.dropbox_app_secret_enc),
    )


@router.put("/dropbox/tenant-config", response_model=DropboxConfigOut)
def put_dropbox_config(
    payload: DropboxConfigIn,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    _require_owner(ctx)
    t = db.get(Tenant, ctx.tenant.id)
    if not t:
        raise HTTPException(404, "Tenant not found")
    t.dropbox_app_key = payload.app_key.strip()
    if payload.app_secret is not None and payload.app_secret.strip():
        secret = payload.app_secret.strip()
        if len(secret) < 5:
            raise HTTPException(422, "app_secret слишком короткий")
        t.dropbox_app_secret_enc = encrypt(secret)
    elif not t.dropbox_app_secret_enc:
        raise HTTPException(422, "app_secret обязателен при первом сохранении")
    t.dropbox_redirect_uri = payload.redirect_uri.strip()
    log_action(db, tenant_id=t.id, user_id=ctx.user.id,
               action="update", entity="tenant_dropbox_config", entity_id=t.id)
    db.commit()
    db.refresh(t)
    return DropboxConfigOut(
        app_key=t.dropbox_app_key,
        redirect_uri=t.dropbox_redirect_uri,
        has_secret=bool(t.dropbox_app_secret_enc),
    )


@router.delete("/dropbox/tenant-config", response_model=Message)
def delete_dropbox_config(
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    _require_owner(ctx)
    t = db.get(Tenant, ctx.tenant.id)
    if not t:
        raise HTTPException(404, "Tenant not found")
    t.dropbox_app_key = None
    t.dropbox_app_secret_enc = None
    t.dropbox_redirect_uri = None
    log_action(db, tenant_id=t.id, user_id=ctx.user.id,
               action="clear", entity="tenant_dropbox_config", entity_id=t.id)
    db.commit()
    return Message(message="Настройки Dropbox очищены")
