"""Распределение новых лидов между менеджерами по разным стратегиям.

Стратегии (см. LeadForm.assignee_strategy):
- manual       — вернём default_assignee_id (или None)
- round_robin  — по кругу; курсор хранится в Redis: lead_router:{tenant}:{form}:cursor
- least_loaded — с наименьшим кол-вом активных лидов
- schedule     — только менеджеры «на смене» сейчас + не в отпуске + не превысили quota

Пул менеджеров = юзеры с permission `leads.view` в этом tenant + is_active.
Если пул пуст — возвращаем None (лид остаётся неназначенным).
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from ..core.redis_client import get_redis
from ..models import (
    LeadForm, ManagerAvailability, Permission, Role, TenantLead, TenantMembership, User, user_roles, role_permissions,
)

log = logging.getLogger("qadam.lead_router")

ACTIVE_LEAD_STATUSES = ("new", "contacted", "qualified")
WEEKDAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def _manager_pool(db: Session, tenant_id: int) -> list[User]:
    """Все активные юзеры этого tenant'а, у которых есть роль с permission leads.view."""
    return (
        db.query(User)
        .join(TenantMembership, TenantMembership.user_id == User.id)
        .join(user_roles, user_roles.c.user_id == User.id)
        .join(Role, Role.id == user_roles.c.role_id)
        .join(role_permissions, role_permissions.c.role_id == Role.id)
        .join(Permission, Permission.id == role_permissions.c.permission_id)
        .filter(
            TenantMembership.tenant_id == tenant_id,
            User.is_active.is_(True),
            Permission.code == "leads.view",
            # Роль либо системная (tenant_id=NULL), либо принадлежит этому tenant
            (Role.tenant_id == tenant_id) | (Role.tenant_id.is_(None)),
        )
        .distinct()
        .order_by(User.id)
        .all()
    )


def _open_lead_counts(db: Session, tenant_id: int, user_ids: list[int]) -> dict[int, int]:
    if not user_ids:
        return {}
    rows = (
        db.query(TenantLead.assignee_id, func.count(TenantLead.id))
        .filter(
            TenantLead.tenant_id == tenant_id,
            TenantLead.assignee_id.in_(user_ids),
            TenantLead.status.in_(ACTIVE_LEAD_STATUSES),
        )
        .group_by(TenantLead.assignee_id)
        .all()
    )
    return {uid: cnt for uid, cnt in rows}


def _availability_map(db: Session, tenant_id: int, user_ids: list[int]) -> dict[int, ManagerAvailability]:
    if not user_ids:
        return {}
    rows = (
        db.query(ManagerAvailability)
        .filter(
            ManagerAvailability.tenant_id == tenant_id,
            ManagerAvailability.user_id.in_(user_ids),
        )
        .all()
    )
    return {a.user_id: a for a in rows}


def _is_on_shift(av: Optional[ManagerAvailability], now_utc: datetime) -> bool:
    """Проверяет что менеджер сейчас на смене по своему расписанию."""
    if av is None:
        # Без записи — считаем что доступен всегда (это дефолт до первой настройки)
        return True
    if not av.is_available:
        return False
    today = now_utc.date()
    if av.vacation_from and av.vacation_until and av.vacation_from <= today <= av.vacation_until:
        return False

    try:
        tz = ZoneInfo(av.timezone or "UTC")
    except ZoneInfoNotFoundError:
        tz = timezone.utc
    local = now_utc.astimezone(tz)
    weekday_key = WEEKDAY_NAMES[local.weekday()]
    hours = (av.working_hours or {}).get(weekday_key)
    if not hours:
        return False
    try:
        start, end = int(hours[0]), int(hours[1])
    except (TypeError, ValueError, IndexError):
        return False
    return start <= local.hour < end


def _quota_exceeded(av: Optional[ManagerAvailability], open_count: int) -> bool:
    if av is None:
        return False
    quota = int(av.weekly_quota or 0)
    if quota <= 0:
        return False
    return open_count >= quota


def _rr_cursor_key(tenant_id: int, form_id: int) -> str:
    return f"lead_router:{tenant_id}:form:{form_id}:cursor"


def _next_round_robin(tenant_id: int, form_id: int, candidates: list[int]) -> int:
    """Возвращает следующего менеджера по кругу, используя Redis-курсор."""
    if not candidates:
        return 0
    if len(candidates) == 1:
        return candidates[0]
    try:
        r = get_redis()
        key = _rr_cursor_key(tenant_id, form_id)
        # incr = атомарный счётчик, отлично подходит для round-robin
        idx = int(r.incr(key)) - 1
        return candidates[idx % len(candidates)]
    except Exception:
        log.exception("round-robin redis failed, fallback to first candidate")
        return candidates[0]


def pick_assignee(
    db: Session,
    tenant_id: int,
    form: Optional[LeadForm],
    now_utc: Optional[datetime] = None,
) -> Optional[int]:
    """Главная точка входа: возвращает user_id для нового лида или None.

    Если form=None (лид создан не через форму) — используется стратегия round_robin
    среди всех менеджеров пула. Это разумный дефолт для manual create.
    """
    now_utc = now_utc or datetime.now(timezone.utc)
    strategy = (form.assignee_strategy if form else "round_robin") or "manual"

    if strategy == "manual":
        return form.default_assignee_id if form else None

    pool = _manager_pool(db, tenant_id)
    if not pool:
        log.info("lead_router: пул менеджеров пуст для tenant=%s", tenant_id)
        return None
    ids = [u.id for u in pool]

    if strategy == "round_robin":
        return _next_round_robin(tenant_id, form.id if form else 0, ids)

    counts = _open_lead_counts(db, tenant_id, ids)

    if strategy == "least_loaded":
        best_id = min(ids, key=lambda uid: (counts.get(uid, 0), uid))
        return best_id

    if strategy == "schedule":
        availability = _availability_map(db, tenant_id, ids)
        eligible = []
        for uid in ids:
            av = availability.get(uid)
            if not _is_on_shift(av, now_utc):
                continue
            if _quota_exceeded(av, counts.get(uid, 0)):
                continue
            eligible.append(uid)
        if not eligible:
            # Никто не на смене — fallback на default_assignee, потом round-robin
            if form and form.default_assignee_id:
                return form.default_assignee_id
            return _next_round_robin(tenant_id, form.id if form else 0, ids)
        # Среди eligible берём least-loaded для честности
        best_id = min(eligible, key=lambda uid: (counts.get(uid, 0), uid))
        return best_id

    # Неизвестная стратегия — logs + None
    log.warning("lead_router: неизвестная стратегия %r у form=%s", strategy, form.id if form else None)
    return form.default_assignee_id if form else None
