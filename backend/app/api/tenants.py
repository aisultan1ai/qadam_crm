"""Управление текущим tenant'ом: настройки, брендинг, использование, subdomain.

Все действия требуют is_owner (или platform_admin) — данные компании.
"""
from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import settings
from ..core.plans import tenant_usage
from ..database import get_db
from ..models import Tenant
from ..schemas.common import Message
from .deps import TenantContext, get_current_context, log_action

router = APIRouter(prefix="/api/tenants", tags=["tenants"])

HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
SUBDOMAIN_RE = re.compile(r"^[a-z0-9-]{3,32}$")
RESERVED_SUBDOMAINS = {
    "www", "api", "admin", "app", "mail", "static", "media",
    "docs", "help", "support", "billing", "auth",
}

LOGO_EXT_BY_MIME = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
}
LOGO_CHUNK = 256 * 1024


class TenantPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    company_display_name: Optional[str] = Field(default=None, max_length=200)
    primary_color: Optional[str] = Field(default=None, max_length=20)
    subdomain: Optional[str] = Field(default=None, max_length=100)


def _require_owner(ctx: TenantContext) -> None:
    if not (ctx.membership.is_owner or ctx.user.is_platform_admin):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Только владелец компании может менять эти настройки")


def _serialize(tenant: Tenant, ctx: TenantContext) -> dict:
    return {
        "id": tenant.id,
        "name": tenant.name,
        "slug": tenant.slug,
        "plan": tenant.plan,
        "logo_url": tenant.logo_url,
        "primary_color": tenant.primary_color,
        "subdomain": tenant.subdomain,
        "company_display_name": tenant.company_display_name,
        "is_active": tenant.is_active,
        "is_owner": ctx.membership.is_owner,
    }


@router.get("/current")
def get_current(ctx: TenantContext = Depends(get_current_context)):
    return _serialize(ctx.tenant, ctx)


@router.patch("/current")
def patch_current(
    payload: TenantPatch,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    _require_owner(ctx)
    tenant = ctx.tenant
    changed: list[str] = []

    if payload.name is not None and payload.name.strip() != tenant.name:
        tenant.name = payload.name.strip()
        changed.append("name")

    if payload.company_display_name is not None:
        val = payload.company_display_name.strip() or None
        if val != tenant.company_display_name:
            tenant.company_display_name = val
            changed.append("company_display_name")

    if payload.primary_color is not None:
        val = payload.primary_color.strip() or None
        if val and not HEX_COLOR_RE.match(val):
            raise HTTPException(400, "primary_color: формат #RRGGBB")
        if val != tenant.primary_color:
            tenant.primary_color = val
            changed.append("primary_color")

    if payload.subdomain is not None:
        val = payload.subdomain.strip().lower() or None
        if val:
            if not SUBDOMAIN_RE.match(val):
                raise HTTPException(400, "subdomain: 3–32 символа, только a-z, 0-9 и '-'")
            if val in RESERVED_SUBDOMAINS:
                raise HTTPException(400, "Этот поддомен зарезервирован")
            exists = db.query(Tenant.id).filter(Tenant.subdomain == val, Tenant.id != tenant.id).first()
            if exists:
                raise HTTPException(400, "Такой поддомен уже занят")
        if val != tenant.subdomain:
            tenant.subdomain = val
            changed.append("subdomain")

    if changed:
        log_action(
            db, tenant_id=tenant.id, user_id=ctx.user.id,
            action="update", entity="tenant", entity_id=tenant.id,
            detail=", ".join(changed),
        )
    db.commit()
    db.refresh(tenant)
    return _serialize(tenant, ctx)


@router.post("/current/logo")
def upload_logo(
    file: UploadFile = File(...),
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    _require_owner(ctx)
    if not file.content_type or file.content_type not in LOGO_EXT_BY_MIME:
        raise HTTPException(400, "Разрешены JPEG, PNG, WebP или SVG")

    ext = LOGO_EXT_BY_MIME[file.content_type]

    logo_dir = Path(settings.UPLOAD_DIR) / str(ctx.tenant.id) / "branding"
    logo_dir.mkdir(parents=True, exist_ok=True)

    stored = f"logo-{uuid.uuid4().hex[:8]}{ext}"
    dest = logo_dir / stored

    max_bytes = 2 * 1024 * 1024  # 2 MB — логотипы должны быть маленькими
    written = 0
    try:
        with dest.open("wb") as out:
            while True:
                chunk = file.file.read(LOGO_CHUNK)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    out.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(413, "Логотип слишком большой (макс 2 МБ)")
                out.write(chunk)
    except HTTPException:
        raise
    except Exception:
        dest.unlink(missing_ok=True)
        raise HTTPException(500, "Не удалось сохранить файл")

    ctx.tenant.logo_url = f"/media/{ctx.tenant.id}/branding/{stored}"
    log_action(
        db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
        action="update", entity="tenant", entity_id=ctx.tenant.id, detail="logo",
    )
    db.commit()
    db.refresh(ctx.tenant)
    return _serialize(ctx.tenant, ctx)


@router.delete("/current/logo", response_model=Message)
def delete_logo(
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    _require_owner(ctx)
    ctx.tenant.logo_url = None
    db.commit()
    return Message(message="Логотип удалён")


@router.get("/current/usage")
def get_usage(
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    return tenant_usage(db, ctx.tenant)
