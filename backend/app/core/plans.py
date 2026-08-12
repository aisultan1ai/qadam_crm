"""Тарифы и лимиты.

Каждый tenant имеет `plan` (строка) — в этом файле хранятся лимиты по плану.
Enforcement идёт через dependency `enforce_plan_limit(resource)`.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional

from fastapi import Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Attachment, Project, Tenant, TenantMembership


class Plan(str, Enum):
    free = "free"
    pro = "pro"
    enterprise = "enterprise"


PLAN_LIMITS: dict[str, dict[str, Optional[int]]] = {
    Plan.free.value: {
        "max_users": 5,
        "max_projects": 3,
        "max_storage_bytes": 1 * 1024 * 1024 * 1024,        # 1 GB
        "api_rate_per_min": 60,
    },
    Plan.pro.value: {
        "max_users": 50,
        "max_projects": 50,
        "max_storage_bytes": 20 * 1024 * 1024 * 1024,       # 20 GB
        "api_rate_per_min": 300,
    },
    Plan.enterprise.value: {
        "max_users": None,
        "max_projects": None,
        "max_storage_bytes": None,
        "api_rate_per_min": 1000,
    },
}


PLAN_INFO: dict[str, dict] = {
    Plan.free.value: {
        "title": "Free",
        "price_month": 0,
        "currency": "KZT",
        "tagline": "Для знакомства с CRM и небольших команд",
        "features": [
            "До 5 пользователей",
            "До 3 проектов",
            "1 ГБ файлов",
            "Kanban, чек-листы, комментарии",
            "Email-уведомления (dry-run без SMTP)",
        ],
    },
    Plan.pro.value: {
        "title": "Pro",
        "price_month": 9_990,
        "currency": "KZT",
        "tagline": "Для растущих компаний, где CRM — рабочий инструмент",
        "features": [
            "До 50 пользователей",
            "До 50 проектов",
            "20 ГБ файлов",
            "Экспорт задач в Excel и CSV-импорт",
            "Redis-кэш аналитики и WebSocket-уведомления",
            "Приглашения по email",
        ],
    },
    Plan.enterprise.value: {
        "title": "Enterprise",
        "price_month": None,   # индивидуально
        "currency": "KZT",
        "tagline": "Для крупных компаний с особыми требованиями",
        "features": [
            "Без лимитов на пользователей, проекты и хранилище",
            "Кастомный поддомен (acme.qadam.kz)",
            "Брендирование: логотип и цвет",
            "SLA и поддержка приоритетно",
            "Индивидуальные интеграции",
        ],
    },
}


def get_limits(plan: str) -> dict[str, Optional[int]]:
    return PLAN_LIMITS.get(plan, PLAN_LIMITS[Plan.free.value])


def plan_catalog() -> list[dict]:
    """Список всех планов с описанием, ценой, фичами и лимитами.

    Используется /api/billing/plans для отрисовки страницы тарифов.
    """
    out = []
    for key in (Plan.free.value, Plan.pro.value, Plan.enterprise.value):
        info = PLAN_INFO[key]
        limits = PLAN_LIMITS[key]
        out.append({
            "key": key,
            "title": info["title"],
            "tagline": info["tagline"],
            "price_month": info["price_month"],
            "currency": info["currency"],
            "features": info["features"],
            "limits": limits,
        })
    return out


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
    limits = get_limits(tenant.plan)
    _check_limit(count_users(db, tenant.id), limits["max_users"], "пользователи")


def check_project_limit(db: Session, tenant: Tenant) -> None:
    limits = get_limits(tenant.plan)
    _check_limit(count_projects(db, tenant.id), limits["max_projects"], "проекты")


def check_storage_limit(db: Session, tenant: Tenant, additional_bytes: int = 0) -> None:
    limits = get_limits(tenant.plan)
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


def tenant_usage(db: Session, tenant: Tenant) -> dict:
    limits = get_limits(tenant.plan)
    return {
        "plan": tenant.plan,
        "limits": limits,
        "usage": {
            "users": count_users(db, tenant.id),
            "projects": count_projects(db, tenant.id),
            "storage_bytes": storage_used_bytes(db, tenant.id),
        },
    }
