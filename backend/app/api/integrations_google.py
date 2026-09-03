from __future__ import annotations

import base64
import json
import logging
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core.secrets import encrypt
from ..database import get_db
from ..models import GoogleCalendarAccount, Tenant
from ..schemas.common import Message
from ..services import google_calendar as gcal
from .deps import TenantContext, get_current_context, log_action, require

log = logging.getLogger("qadam.integrations.google")

router = APIRouter(prefix="/api/integrations/google", tags=["integrations"])


class AuthUrlOut(BaseModel):
    auth_url: str


class StatusOut(BaseModel):
    connected: bool
    google_email: Optional[str] = None
    sync_enabled: bool = False
    last_sync_at: Optional[str] = None
    last_sync_error: Optional[str] = None
    configured: bool


class TenantConfigOut(BaseModel):
    client_id: Optional[str] = None
    redirect_uri: Optional[str] = None
    has_secret: bool = False


class TenantConfigIn(BaseModel):
    client_id: str = Field(min_length=10, max_length=200)
    client_secret: Optional[str] = Field(default=None, max_length=200)
    redirect_uri: str = Field(min_length=10, max_length=500)


class SyncResult(BaseModel):
    created: int
    updated: int
    deleted: int


def _require_tenant_configured(tenant: Tenant):
    if not gcal.tenant_configured(tenant):
        raise HTTPException(
            503,
            "Google-интеграция не настроена в этой компании. "
            "Owner должен ввести client_id/secret/redirect_uri в /settings/integrations.",
        )


def _require_owner(ctx: TenantContext):
    if not (ctx.membership.is_owner or ctx.user.is_platform_admin):
        raise HTTPException(403, "Только владелец компании может менять эти настройки")


def _encode_state(tenant_id: int, user_id: int, nonce: str) -> str:
    payload = json.dumps({"t": tenant_id, "u": user_id, "n": nonce}).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _decode_state(state: str) -> tuple[int, int, str]:
    pad = "=" * (-len(state) % 4)
    data = json.loads(base64.urlsafe_b64decode((state + pad).encode("ascii")).decode("utf-8"))
    return int(data["t"]), int(data["u"]), str(data["n"])


@router.get("/tenant-config", response_model=TenantConfigOut)
def get_tenant_config(
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    _require_owner(ctx)
    t = ctx.tenant
    return TenantConfigOut(
        client_id=t.google_client_id,
        redirect_uri=t.google_redirect_uri,
        has_secret=bool(t.google_client_secret_enc),
    )


@router.put("/tenant-config", response_model=TenantConfigOut)
def put_tenant_config(
    payload: TenantConfigIn,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    _require_owner(ctx)
    t = db.get(Tenant, ctx.tenant.id)
    if not t:
        raise HTTPException(404, "Tenant not found")
    t.google_client_id = payload.client_id.strip()
    if payload.client_secret is not None and payload.client_secret.strip():
        secret = payload.client_secret.strip()
        if len(secret) < 10:
            raise HTTPException(422, "client_secret слишком короткий")
        t.google_client_secret_enc = encrypt(secret)
    elif not t.google_client_secret_enc:
        raise HTTPException(422, "client_secret обязателен при первом сохранении")
    t.google_redirect_uri = payload.redirect_uri.strip()
    log_action(db, tenant_id=t.id, user_id=ctx.user.id,
               action="update", entity="tenant_google_config", entity_id=t.id)
    db.commit()
    db.refresh(t)
    return TenantConfigOut(
        client_id=t.google_client_id,
        redirect_uri=t.google_redirect_uri,
        has_secret=bool(t.google_client_secret_enc),
    )


@router.delete("/tenant-config", response_model=Message)
def delete_tenant_config(
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    _require_owner(ctx)
    t = db.get(Tenant, ctx.tenant.id)
    if not t:
        raise HTTPException(404, "Tenant not found")
    t.google_client_id = None
    t.google_client_secret_enc = None
    t.google_redirect_uri = None
    log_action(db, tenant_id=t.id, user_id=ctx.user.id,
               action="clear", entity="tenant_google_config", entity_id=t.id)
    db.commit()
    return Message(message="Настройки Google очищены")


@router.get("/status", response_model=StatusOut)
def status(
    ctx: TenantContext = Depends(require("calendar.use")),
    db: Session = Depends(get_db),
):
    acc = (
        db.query(GoogleCalendarAccount)
        .filter(
            GoogleCalendarAccount.tenant_id == ctx.tenant.id,
            GoogleCalendarAccount.user_id == ctx.user.id,
        )
        .one_or_none()
    )
    return StatusOut(
        connected=acc is not None,
        google_email=acc.google_email if acc else None,
        sync_enabled=acc.sync_enabled if acc else False,
        last_sync_at=acc.last_sync_at.isoformat() if acc and acc.last_sync_at else None,
        last_sync_error=acc.last_sync_error if acc else None,
        configured=gcal.tenant_configured(ctx.tenant),
    )


@router.get("/auth-url", response_model=AuthUrlOut)
def auth_url(
    ctx: TenantContext = Depends(require("calendar.use")),
):
    _require_tenant_configured(ctx.tenant)
    nonce = secrets.token_urlsafe(16)
    state = _encode_state(ctx.tenant.id, ctx.user.id, nonce)
    url = gcal.build_auth_url(ctx.tenant, state)
    return AuthUrlOut(auth_url=url)


@router.get("/callback")
def callback(
    request: Request,
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    if error:
        return RedirectResponse(url=f"/settings/integrations?google_error={error}", status_code=302)
    if not code or not state:
        raise HTTPException(400, "code и state обязательны")
    try:
        tenant_id, user_id, _nonce = _decode_state(state)
    except Exception:
        raise HTTPException(400, "невалидный state")

    tenant = db.get(Tenant, tenant_id)
    if not tenant or not gcal.tenant_configured(tenant):
        return RedirectResponse(
            url="/settings/integrations?google_error=tenant_not_configured", status_code=302,
        )

    try:
        creds, email = gcal.exchange_code(tenant, code, state)
    except Exception:
        log.exception("google oauth exchange failed")
        return RedirectResponse(url="/settings/integrations?google_error=exchange_failed", status_code=302)

    acc = gcal.save_account(db, tenant_id, user_id, email, creds)
    log_action(db, tenant_id=tenant_id, user_id=user_id,
               action="connect", entity="google_calendar_account", entity_id=acc.id, detail=email)
    db.commit()

    try:
        gcal.sync_account(db, acc)
        db.commit()
    except Exception as e:
        log.warning("google initial sync failed: %s", e)
        db.rollback()

    return RedirectResponse(url="/settings/integrations?google_connected=1", status_code=302)


@router.post("/sync", response_model=SyncResult)
def sync_now(
    ctx: TenantContext = Depends(require("calendar.use")),
    db: Session = Depends(get_db),
):
    _require_tenant_configured(ctx.tenant)
    acc = (
        db.query(GoogleCalendarAccount)
        .filter(
            GoogleCalendarAccount.tenant_id == ctx.tenant.id,
            GoogleCalendarAccount.user_id == ctx.user.id,
        )
        .one_or_none()
    )
    if acc is None:
        raise HTTPException(404, "Google-аккаунт не подключён")
    try:
        created, updated, deleted = gcal.sync_account(db, acc)
        db.commit()
    except Exception as e:
        db.rollback()
        acc.last_sync_error = str(e)[:1000]
        db.commit()
        raise HTTPException(502, f"Sync failed: {e}")
    return SyncResult(created=created, updated=updated, deleted=deleted)


@router.delete("/disconnect", response_model=Message)
def disconnect(
    ctx: TenantContext = Depends(require("calendar.use")),
    db: Session = Depends(get_db),
):
    acc = (
        db.query(GoogleCalendarAccount)
        .filter(
            GoogleCalendarAccount.tenant_id == ctx.tenant.id,
            GoogleCalendarAccount.user_id == ctx.user.id,
        )
        .one_or_none()
    )
    if acc is None:
        raise HTTPException(404, "Google-аккаунт не подключён")
    gcal.delete_account(db, acc)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
               action="disconnect", entity="google_calendar_account", entity_id=acc.id)
    db.commit()
    return Message(message="Google-аккаунт отключён")
