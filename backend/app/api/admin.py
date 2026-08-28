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

from ..core.plans import plan_to_dict, plan_catalog, plan_exists, tenant_usage
from ..database import get_db
from ..models import Plan, Project, Task, Tenant, TenantMembership, User
from ..schemas.common import Message
from .deps import get_current_user, log_action

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


def _audit(db: Session, actor: User, action: str, tenant: Tenant, detail: str | None = None) -> None:
    """Audit-запись для платформенных действий. tenant_id — целевая компания."""
    log_action(
        db,
        tenant_id=tenant.id,
        user_id=actor.id,
        action=f"platform.{action}",
        entity="tenant",
        entity_id=tenant.id,
        detail=detail,
    )


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
    admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(404, "Компания не найдена")
    changes: list[str] = []

    if payload.name is not None:
        val = payload.name.strip()
        if len(val) < 2:
            raise HTTPException(400, "Название: минимум 2 символа")
        if val != tenant.name:
            changes.append(f"name: '{tenant.name}' → '{val}'")
            tenant.name = val

    if payload.company_display_name is not None:
        new_v = payload.company_display_name.strip() or None
        if new_v != tenant.company_display_name:
            changes.append(f"display_name: '{tenant.company_display_name}' → '{new_v}'")
            tenant.company_display_name = new_v

    if payload.slug is not None:
        val = payload.slug.strip().lower()
        if not SLUG_RE.match(val):
            raise HTTPException(400, "Slug: 2–64 символа, только a-z, 0-9 и '-'")
        if val != tenant.slug:
            exists = db.query(Tenant.id).filter(Tenant.slug == val, Tenant.id != tenant.id).first()
            if exists:
                raise HTTPException(400, "Компания с таким slug уже существует")
            changes.append(f"slug: '{tenant.slug}' → '{val}'")
            tenant.slug = val

    if payload.plan is not None:
        if not plan_exists(db, payload.plan):
            raise HTTPException(400, f"Неизвестный план: {payload.plan}")
        if payload.plan != tenant.plan:
            changes.append(f"plan: '{tenant.plan}' → '{payload.plan}'")
            tenant.plan = payload.plan

    if payload.is_active is not None and payload.is_active != tenant.is_active:
        changes.append(f"is_active: {tenant.is_active} → {payload.is_active}")
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
        if val != tenant.subdomain:
            changes.append(f"subdomain: '{tenant.subdomain}' → '{val}'")
            tenant.subdomain = val

    if changes:
        _audit(db, admin, "update_tenant", tenant, detail="; ".join(changes))
    db.commit()
    db.refresh(tenant)
    return _serialize_tenant(tenant)


@router.delete("/tenants/{tenant_id}", response_model=Message)
def delete_tenant(
    tenant_id: int,
    admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """Полное удаление tenant'а вместе со всеми связанными данными.

    Опасная операция — cascade удалит проекты, задачи, комментарии, вложения, memberships.
    Файлы в uploads/{tenant_id}/ остаются на диске (для аудита).
    """
    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(404, "Компания не найдена")
    name = tenant.name
    # Пишем аудит ДО удаления: FK ActivityLog → tenants ON DELETE SET NULL/CASCADE зависит
    # от миграции; в любом случае detail сохранится с именем + id.
    _audit(db, admin, "delete_tenant", tenant, detail=f"name='{name}', slug='{tenant.slug}'")
    db.delete(tenant)
    db.commit()
    return Message(message=f"Компания «{name}» удалена")


@router.post("/tenants/{tenant_id}/deactivate", response_model=Message)
def deactivate_tenant(
    tenant_id: int,
    admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(404, "Компания не найдена")
    if tenant.is_active:
        tenant.is_active = False
        _audit(db, admin, "deactivate_tenant", tenant)
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


# =============================================================================
# Тарифы: CRUD планов (только платформенный админ)
# =============================================================================

PLAN_KEY_RE = re.compile(r"^[a-z0-9_-]{2,32}$")
PROTECTED_PLAN_KEYS = {"free"}  # free нужен как fallback при downgrade


class PlanBody(BaseModel):
    """Общая форма для create/patch. При patch все поля опциональны."""
    key: Optional[str] = Field(default=None, min_length=2, max_length=32)
    title: Optional[str] = Field(default=None, min_length=1, max_length=100)
    tagline: Optional[str] = Field(default=None, max_length=300)
    price_month: Optional[int] = Field(default=None, ge=0)
    currency: Optional[str] = Field(default=None, min_length=1, max_length=8)

    max_users: Optional[int] = Field(default=None, ge=0)
    max_projects: Optional[int] = Field(default=None, ge=0)
    max_storage_bytes: Optional[int] = Field(default=None, ge=0)
    api_rate_per_min: Optional[int] = Field(default=None, ge=1)

    feature_export: Optional[bool] = None
    feature_import: Optional[bool] = None
    feature_invitations: Optional[bool] = None
    feature_lead_forms: Optional[bool] = None
    feature_analytics_cache: Optional[bool] = None
    feature_branding: Optional[bool] = None
    feature_custom_subdomain: Optional[bool] = None
    feature_priority_support: Optional[bool] = None

    marketing_features: Optional[str] = Field(default=None, max_length=4000)
    is_active: Optional[bool] = None
    is_public: Optional[bool] = None
    sort_order: Optional[int] = Field(default=None, ge=0, le=10000)


def _plan_audit(db: Session, actor: User, action: str, plan: Plan, detail: str | None = None) -> None:
    """Аудит-запись для CRUD планов. tenant_id=None — событие платформенное."""
    log_action(
        db,
        tenant_id=None,
        user_id=actor.id,
        action=f"platform.{action}",
        entity="plan",
        entity_id=plan.id,
        detail=detail or plan.key,
    )


@router.get("/plans")
def admin_list_plans(
    _: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """Все планы (включая скрытые/неактивные) — для управления в админке."""
    return plan_catalog(db, include_hidden=True)


@router.get("/plans/{key}")
def admin_get_plan(
    key: str,
    _: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    plan = db.query(Plan).filter(Plan.key == key).first()
    if not plan:
        raise HTTPException(404, "Тариф не найден")
    return plan_to_dict(plan)


@router.post("/plans", status_code=201)
def admin_create_plan(
    payload: PlanBody,
    admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    if not payload.key or not PLAN_KEY_RE.match(payload.key):
        raise HTTPException(400, "Ключ тарифа: 2–32 символа, a-z, 0-9, '_' или '-'")
    if not payload.title:
        raise HTTPException(400, "Название обязательно")
    if db.query(Plan.id).filter(Plan.key == payload.key).first():
        raise HTTPException(400, "Тариф с таким ключом уже существует")

    plan = Plan(
        key=payload.key,
        title=payload.title,
        tagline=payload.tagline,
        price_month=payload.price_month,
        currency=payload.currency or "KZT",
        max_users=payload.max_users,
        max_projects=payload.max_projects,
        max_storage_bytes=payload.max_storage_bytes,
        api_rate_per_min=payload.api_rate_per_min or 60,
        feature_export=bool(payload.feature_export),
        feature_import=bool(payload.feature_import),
        feature_invitations=bool(payload.feature_invitations) if payload.feature_invitations is not None else True,
        feature_lead_forms=bool(payload.feature_lead_forms),
        feature_analytics_cache=bool(payload.feature_analytics_cache),
        feature_branding=bool(payload.feature_branding),
        feature_custom_subdomain=bool(payload.feature_custom_subdomain),
        feature_priority_support=bool(payload.feature_priority_support),
        marketing_features=payload.marketing_features,
        is_active=payload.is_active if payload.is_active is not None else True,
        is_public=payload.is_public if payload.is_public is not None else True,
        sort_order=payload.sort_order if payload.sort_order is not None else 0,
    )
    db.add(plan)
    db.flush()
    _plan_audit(db, admin, "create_plan", plan)
    db.commit()
    db.refresh(plan)
    return plan_to_dict(plan)


_PLAN_SCALAR_FIELDS = (
    "title", "tagline", "price_month", "currency",
    "max_users", "max_projects", "max_storage_bytes", "api_rate_per_min",
    "feature_export", "feature_import", "feature_invitations", "feature_lead_forms",
    "feature_analytics_cache", "feature_branding", "feature_custom_subdomain", "feature_priority_support",
    "marketing_features", "is_active", "is_public", "sort_order",
)


@router.patch("/plans/{key}")
def admin_patch_plan(
    key: str,
    payload: PlanBody,
    admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    plan = db.query(Plan).filter(Plan.key == key).first()
    if not plan:
        raise HTTPException(404, "Тариф не найден")

    changes: list[str] = []

    # Ключ переименовать нельзя — на него ссылаются tenants.plan.
    if payload.key is not None and payload.key != plan.key:
        raise HTTPException(400, "Переименование ключа тарифа не поддерживается")

    for field in _PLAN_SCALAR_FIELDS:
        val = getattr(payload, field, None)
        if val is None:
            continue
        old = getattr(plan, field)
        if val == old:
            continue
        # Защита: у protected-плана не даём отключать флаг is_active
        if plan.key in PROTECTED_PLAN_KEYS and field == "is_active" and val is False:
            raise HTTPException(400, f"Тариф '{plan.key}' — базовый, его нельзя деактивировать")
        setattr(plan, field, val)
        changes.append(f"{field}: {old!r} → {val!r}")

    if changes:
        _plan_audit(db, admin, "update_plan", plan, detail="; ".join(changes))
    db.commit()
    db.refresh(plan)
    return plan_to_dict(plan)


@router.delete("/plans/{key}", response_model=Message)
def admin_delete_plan(
    key: str,
    admin: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    if key in PROTECTED_PLAN_KEYS:
        raise HTTPException(400, f"Тариф '{key}' защищён от удаления")
    plan = db.query(Plan).filter(Plan.key == key).first()
    if not plan:
        raise HTTPException(404, "Тариф не найден")
    # Проверяем что тариф не используется активными tenant'ами.
    in_use = db.query(func.count(Tenant.id)).filter(Tenant.plan == key).scalar() or 0
    if in_use:
        raise HTTPException(400, f"Тариф используется {in_use} компанией(ями). Переведите их на другой тариф.")
    _plan_audit(db, admin, "delete_plan", plan, detail=f"deleted plan '{key}'")
    db.delete(plan)
    db.commit()
    return Message(message=f"Тариф '{key}' удалён")
