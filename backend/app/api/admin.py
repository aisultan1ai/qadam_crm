"""Платформенный админ: управление всеми tenant'ами.

Доступ по флагу User.is_platform_admin (не путать с per-tenant is_owner).
Bootstrap проставляет этот флаг администратору по ADMIN_EMAIL.
"""
from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core.plans import PLAN_LIMITS, tenant_usage
from ..database import get_db
from ..models import Project, Task, Tenant, TenantMembership, User
from ..schemas.common import Message
from .deps import get_current_user

router = APIRouter(prefix="/api/admin", tags=["admin"])

SLUG_RE = re.compile(r"^[a-z0-9-]{2,64}$")
SUBDOMAIN_RE = re.compile(r"^[a-z0-9-]{3,32}$")
RESERVED_SUBDOMAINS = {
    "www", "api", "admin", "app", "mail", "static", "media",
    "docs", "help", "support", "billing", "auth",
}


def require_platform_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_platform_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Доступ только для платформенных админов")
    return user


class TenantPatchAdmin(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    slug: Optional[str] = Field(default=None, min_length=2, max_length=64)
    company_display_name: Optional[str] = Field(default=None, max_length=200)
    plan: Optional[str] = None
    is_active: Optional[bool] = None
    subdomain: Optional[str] = None


@router.get("/tenants")
def list_tenants(
    _: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    rows = db.query(Tenant).order_by(Tenant.created_at.desc()).all()
    users_count = dict(
        db.query(TenantMembership.tenant_id, func.count(TenantMembership.id))
        .group_by(TenantMembership.tenant_id)
        .all()
    )
    projects_count = dict(
        db.query(Project.tenant_id, func.count(Project.id))
        .group_by(Project.tenant_id)
        .all()
    )
    tasks_count = dict(
        db.query(Task.tenant_id, func.count(Task.id))
        .group_by(Task.tenant_id)
        .all()
    )
    return [
        {
            "id": t.id,
            "name": t.name,
            "slug": t.slug,
            "subdomain": t.subdomain,
            "company_display_name": t.company_display_name,
            "plan": t.plan,
            "is_active": t.is_active,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "users": users_count.get(t.id, 0),
            "projects": projects_count.get(t.id, 0),
            "tasks": tasks_count.get(t.id, 0),
        }
        for t in rows
    ]


def _serialize_tenant(t: Tenant) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "slug": t.slug,
        "subdomain": t.subdomain,
        "company_display_name": t.company_display_name,
        "plan": t.plan,
        "is_active": t.is_active,
    }


@router.patch("/tenants/{tenant_id}")
def patch_tenant(
    tenant_id: int,
    payload: TenantPatchAdmin,
    _: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(404, "Компания не найдена")

    if payload.name is not None:
        val = payload.name.strip()
        if len(val) < 2:
            raise HTTPException(400, "Название: минимум 2 символа")
        tenant.name = val

    if payload.company_display_name is not None:
        tenant.company_display_name = payload.company_display_name.strip() or None

    if payload.slug is not None:
        val = payload.slug.strip().lower()
        if not SLUG_RE.match(val):
            raise HTTPException(400, "Slug: 2–64 символа, только a-z, 0-9 и '-'")
        if val != tenant.slug:
            exists = db.query(Tenant.id).filter(Tenant.slug == val, Tenant.id != tenant.id).first()
            if exists:
                raise HTTPException(400, "Компания с таким slug уже существует")
            tenant.slug = val

    if payload.plan is not None:
        if payload.plan not in PLAN_LIMITS:
            raise HTTPException(400, f"Неизвестный план: {payload.plan}")
        tenant.plan = payload.plan

    if payload.is_active is not None:
        tenant.is_active = payload.is_active

    if payload.subdomain is not None:
        val = payload.subdomain.strip().lower() or None
        if val:
            if not SUBDOMAIN_RE.match(val):
                raise HTTPException(400, "Subdomain: 3–32 символа, только a-z, 0-9 и '-'")
            if val in RESERVED_SUBDOMAINS:
                raise HTTPException(400, "Этот поддомен зарезервирован")
            exists = db.query(Tenant.id).filter(Tenant.subdomain == val, Tenant.id != tenant.id).first()
            if exists:
                raise HTTPException(400, "Такой поддомен уже занят")
        tenant.subdomain = val

    db.commit()
    db.refresh(tenant)
    return _serialize_tenant(tenant)


@router.delete("/tenants/{tenant_id}", response_model=Message)
def delete_tenant(
    tenant_id: int,
    _: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """Полное удаление tenant'а вместе со всеми связанными данными.

    Опасная операция — cascade удалит проекты, задачи, комментарии, вложения, memberships.
    Файлы в uploads/{tenant_id}/ остаются на диске (для аудита).
    """
    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(404, "Компания не найдена")
    db.delete(tenant)
    db.commit()
    return Message(message=f"Компания «{tenant.name}» удалена")


@router.post("/tenants/{tenant_id}/deactivate", response_model=Message)
def deactivate_tenant(
    tenant_id: int,
    _: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(404, "Компания не найдена")
    tenant.is_active = False
    db.commit()
    return Message(message="Компания деактивирована")


@router.get("/tenants/{tenant_id}/usage")
def get_tenant_usage(
    tenant_id: int,
    _: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(404, "Компания не найдена")
    return tenant_usage(db, tenant)


@router.get("/users")
def list_users(
    _: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
    limit: int = 200,
):
    rows = db.query(User).order_by(User.id).limit(min(limit, 1000)).all()
    return [
        {
            "id": u.id,
            "email": u.email,
            "name": u.name,
            "is_active": u.is_active,
            "is_superuser": u.is_superuser,
            "is_platform_admin": u.is_platform_admin,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }
        for u in rows
    ]
