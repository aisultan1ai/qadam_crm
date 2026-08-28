"""Тарифы и лимиты.

Планы хранятся в таблице `plans` и управляются платформенным админом
через `/api/admin/plans`. Тенант ссылается на план по строковому ключу
(`Tenant.plan` = `Plan.key`).

Enforcement:
- `check_user_limit` / `check_project_limit` / `check_storage_limit` — количественные
  лимиты, вызываются перед созданием ресурса → 402
- `check_feature(feature)` — булевые фичи, вызываются dependency `require_feature("export")`
- `get_plan(db, key)` — источник истины при рантайме, fallback на free
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Attachment, Plan, Project, Tenant, TenantMembership

log = logging.getLogger("qadam.plans")

DEFAULT_PLAN_KEY = "free"

# Хардкод-фолбэк на случай пустой таблицы plans (сразу после миграции 0013 таблица
# заполнена, но на всякий случай). Реальная конфигурация — в БД.
_FALLBACK_LIMITS = {
    "max_users": 5,
    "max_projects": 3,
    "max_storage_bytes": 1 * 1024 * 1024 * 1024,
    "api_rate_per_min": 60,
}


FEATURE_LABELS: dict[str, str] = {
    "export": "Экспорт в Excel",
    "import": "Импорт из CSV",
    "invitations": "Приглашения по email",
    "lead_forms": "Формы захвата лидов",
    "analytics_cache": "Кэш аналитики",
    "branding": "Брендирование",
    "custom_subdomain": "Кастомный поддомен",
    "priority_support": "Приоритетная поддержка",
}


def _feature_column_name(feature: str) -> str:
    return f"feature_{feature}"


def get_plan(db: Session, key: str) -> Optional[Plan]:
    """Загружает Plan по ключу. Возвращает None если не найден."""
    if not key:
        return None
    return db.query(Plan).filter(Plan.key == key).first()


def _resolve_plan(db: Session, key: str) -> Optional[Plan]:
    """Как get_plan, но с фолбэком на 'free'."""
    plan = get_plan(db, key)
    if plan:
        return plan
    if key != DEFAULT_PLAN_KEY:
        return get_plan(db, DEFAULT_PLAN_KEY)
    return None


def plan_exists(db: Session, key: str) -> bool:
    return db.query(Plan.id).filter(Plan.key == key).first() is not None


def get_limits(db: Session, plan_key: str) -> dict[str, Optional[int]]:
    """Возвращает лимиты плана: {max_users, max_projects, max_storage_bytes, api_rate_per_min}."""
    plan = _resolve_plan(db, plan_key)
    if not plan:
        log.warning("plan '%s' not found in DB — using fallback limits", plan_key)
        return dict(_FALLBACK_LIMITS)
    return {
        "max_users": plan.max_users,
        "max_projects": plan.max_projects,
        "max_storage_bytes": plan.max_storage_bytes,
        "api_rate_per_min": plan.api_rate_per_min,
    }


def plan_to_dict(plan: Plan) -> dict:
    features_text = plan.marketing_features or ""
    features_list = [line.strip() for line in features_text.splitlines() if line.strip()]
    return {
        "key": plan.key,
        "title": plan.title,
        "tagline": plan.tagline,
        "price_month": plan.price_month,
        "currency": plan.currency,
        "features": features_list,
        "limits": {
            "max_users": plan.max_users,
            "max_projects": plan.max_projects,
            "max_storage_bytes": plan.max_storage_bytes,
            "api_rate_per_min": plan.api_rate_per_min,
        },
        "feature_flags": {
            "export": plan.feature_export,
            "import": plan.feature_import,
            "invitations": plan.feature_invitations,
            "lead_forms": plan.feature_lead_forms,
            "analytics_cache": plan.feature_analytics_cache,
            "branding": plan.feature_branding,
            "custom_subdomain": plan.feature_custom_subdomain,
            "priority_support": plan.feature_priority_support,
        },
        "is_active": plan.is_active,
        "is_public": plan.is_public,
        "sort_order": plan.sort_order,
    }


def plan_catalog(db: Session, include_hidden: bool = False) -> list[dict]:
    """Список планов для витрины (по умолчанию — только публичные и активные)."""
    q = db.query(Plan)
    if not include_hidden:
        q = q.filter(Plan.is_active.is_(True), Plan.is_public.is_(True))
    rows = q.order_by(Plan.sort_order.asc(), Plan.id.asc()).all()
    return [plan_to_dict(p) for p in rows]


def count_users(db: Session, tenant_id: int) -> int:
    return db.query(func.count(TenantMembership.id)).filter(TenantMembership.tenant_id == tenant_id).scalar() or 0


def count_projects(db: Session, tenant_id: int) -> int:
    return db.query(func.count(Project.id)).filter(Project.tenant_id == tenant_id).scalar() or 0


def storage_used_bytes(db: Session, tenant_id: int) -> int:
    total = db.query(func.coalesce(func.sum(Attachment.size), 0)).filter(Attachment.tenant_id == tenant_id).scalar()
    return int(total or 0)


def _check_limit(current: int, limit: Optional[int], resource: str) -> None:
    if limit is None:
        return
    if current >= limit:
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            f"Достигнут лимит тарифа: {resource} (max {limit}). Обновите тариф.",
        )


def check_user_limit(db: Session, tenant: Tenant) -> None:
    limits = get_limits(db, tenant.plan)
    _check_limit(count_users(db, tenant.id), limits["max_users"], "пользователи")


def check_project_limit(db: Session, tenant: Tenant) -> None:
    limits = get_limits(db, tenant.plan)
    _check_limit(count_projects(db, tenant.id), limits["max_projects"], "проекты")


def check_storage_limit(db: Session, tenant: Tenant, additional_bytes: int = 0) -> None:
    limits = get_limits(db, tenant.plan)
    limit = limits["max_storage_bytes"]
    if limit is None:
        return
    used = storage_used_bytes(db, tenant.id)
    if used + additional_bytes > limit:
        gb = limit / (1024 ** 3)
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            f"Достигнут лимит хранилища ({gb:.0f} ГБ). Обновите тариф.",
        )


def has_feature(db: Session, tenant: Tenant, feature: str) -> bool:
    """Проверяет boolean-фичу текущего плана тенанта."""
    plan = _resolve_plan(db, tenant.plan)
    if not plan:
        return False
    col = _feature_column_name(feature)
    return bool(getattr(plan, col, False))


def check_feature(db: Session, tenant: Tenant, feature: str) -> None:
    """Бросает 402 если фича недоступна на текущем плане тенанта."""
    if feature not in FEATURE_LABELS:
        raise HTTPException(500, f"Неизвестная фича: {feature}")
    if has_feature(db, tenant, feature):
        return
    label = FEATURE_LABELS[feature]
    raise HTTPException(
        status.HTTP_402_PAYMENT_REQUIRED,
        f"Функция «{label}» недоступна на вашем тарифе. Обновите тариф.",
    )


def tenant_usage(db: Session, tenant: Tenant) -> dict:
    limits = get_limits(db, tenant.plan)
    plan = _resolve_plan(db, tenant.plan)
    return {
        "plan": tenant.plan,
        "limits": limits,
        "features": plan_to_dict(plan)["feature_flags"] if plan else {},
        "usage": {
            "users": count_users(db, tenant.id),
            "projects": count_projects(db, tenant.id),
            "storage_bytes": storage_used_bytes(db, tenant.id),
        },
    }
