"""Рабочие часы и доступность менеджеров.

Юзер редактирует свою запись через `/me`. Владелец компании и любой с
permission `users.update` может редактировать чужие. Список видит любой
member с `leads.view` — чтобы менеджеры видели «кто сейчас на смене».
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

try:
    from zoneinfo import ZoneInfo, available_timezones
except ImportError:  # pragma: no cover — py<3.9 не поддерживается
    available_timezones = lambda: set()

from ..core.permissions import user_has
from ..database import get_db
from ..models import DEFAULT_WORKING_HOURS, ManagerAvailability, TenantMembership, User
from ..schemas.common import Message
from ..services.lead_router import _is_on_shift, _manager_pool
from .deps import TenantContext, get_current_context, log_action, require

router = APIRouter(prefix="/api/manager-availability", tags=["manager-availability"])

WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


def _validate_working_hours(v: dict) -> dict:
    """working_hours: {day: [start, end]} с 0<=start<end<=24, либо {day: null} для выходного."""
    if not isinstance(v, dict):
        raise ValueError("working_hours должно быть объектом")
    result: dict = {}
    for day in WEEKDAYS:
        hours = v.get(day)
        if hours is None:
            result[day] = None
            continue
        if not isinstance(hours, list) or len(hours) != 2:
            raise ValueError(f"{day}: ожидается [start_hour, end_hour]")
        try:
            start, end = int(hours[0]), int(hours[1])
        except (TypeError, ValueError):
            raise ValueError(f"{day}: часы должны быть целыми")
        if not (0 <= start < end <= 24):
            raise ValueError(f"{day}: 0 <= start < end <= 24")
        result[day] = [start, end]
    return result


def _validate_tz(v: str) -> str:
    v = v.strip() or "Asia/Almaty"
    tzs = available_timezones()
    if tzs and v not in tzs:
        raise ValueError(f"неизвестный timezone: {v}")
    return v


class AvailabilityBody(BaseModel):
    timezone: Optional[str] = Field(default=None, max_length=64)
    working_hours: Optional[dict] = None
    weekly_quota: Optional[int] = Field(default=None, ge=0, le=1000)
    is_available: Optional[bool] = None
    vacation_from: Optional[date] = None
    vacation_until: Optional[date] = None

    @field_validator("timezone")
    @classmethod
    def _tz_check(cls, v: Optional[str]) -> Optional[str]:
        return None if v is None else _validate_tz(v)

    @field_validator("working_hours")
    @classmethod
    def _hours_check(cls, v: Optional[dict]) -> Optional[dict]:
        return None if v is None else _validate_working_hours(v)


def _serialize(av: ManagerAvailability) -> dict:
    return {
        "user_id": av.user_id,
        "user_name": av.user.name if av.user else None,
        "user_email": av.user.email if av.user else None,
        "timezone": av.timezone,
        "working_hours": av.working_hours or {},
        "weekly_quota": av.weekly_quota,
        "is_available": av.is_available,
        "vacation_from": av.vacation_from.isoformat() if av.vacation_from else None,
        "vacation_until": av.vacation_until.isoformat() if av.vacation_until else None,
        "on_shift_now": _is_on_shift(av, datetime.now(timezone.utc)),
    }


def _ensure_row(db: Session, tenant_id: int, user_id: int) -> ManagerAvailability:
    """Возвращает запись доступности; создаёт со значениями по умолчанию если нет."""
    av = (
        db.query(ManagerAvailability)
        .filter(
            ManagerAvailability.tenant_id == tenant_id,
            ManagerAvailability.user_id == user_id,
        )
        .first()
    )
    if av:
        return av
    av = ManagerAvailability(
        tenant_id=tenant_id,
        user_id=user_id,
        timezone="Asia/Almaty",
        working_hours=dict(DEFAULT_WORKING_HOURS),
        weekly_quota=0,
        is_available=True,
    )
    db.add(av)
    db.flush()
    return av


def _assert_user_in_tenant(db: Session, tenant_id: int, user_id: int) -> None:
    exists = (
        db.query(TenantMembership.id)
        .filter(
            TenantMembership.tenant_id == tenant_id,
            TenantMembership.user_id == user_id,
        )
        .first()
    )
    if not exists:
        raise HTTPException(404, "Пользователь не найден в этой компании")


@router.get("/me")
def get_my_availability(
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    av = _ensure_row(db, ctx.tenant.id, ctx.user.id)
    db.commit()
    db.refresh(av)
    return _serialize(av)


@router.put("/me")
def update_my_availability(
    payload: AvailabilityBody,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    av = _ensure_row(db, ctx.tenant.id, ctx.user.id)
    _apply_patch(av, payload)
    log_action(
        db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
        action="update", entity="manager_availability", entity_id=av.id, detail="self",
    )
    db.commit()
    db.refresh(av)
    return _serialize(av)


@router.get("")
def list_availability(
    ctx: TenantContext = Depends(require("leads.view")),
    db: Session = Depends(get_db),
):
    """Список: все менеджеры пула + их часы (создаёт пустые записи если не было)."""
    pool = _manager_pool(db, ctx.tenant.id)
    if not pool:
        return []
    for u in pool:
        _ensure_row(db, ctx.tenant.id, u.id)
    db.commit()
    rows = (
        db.query(ManagerAvailability)
        .filter(
            ManagerAvailability.tenant_id == ctx.tenant.id,
            ManagerAvailability.user_id.in_([u.id for u in pool]),
        )
        .all()
    )
    return [_serialize(r) for r in rows]


@router.patch("/{user_id}")
def patch_availability(
    user_id: int,
    payload: AvailabilityBody,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    """Владелец компании и юзер с users.update могут менять чужие часы."""
    if ctx.user.id != user_id and not (
        ctx.membership.is_owner or user_has(ctx.user, ["users.update"])
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Только владелец или админ могут менять расписание другого пользователя")
    _assert_user_in_tenant(db, ctx.tenant.id, user_id)
    av = _ensure_row(db, ctx.tenant.id, user_id)
    _apply_patch(av, payload)
    log_action(
        db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
        action="update", entity="manager_availability", entity_id=av.id, detail=f"user_id={user_id}",
    )
    db.commit()
    db.refresh(av)
    return _serialize(av)


def _apply_patch(av: ManagerAvailability, payload: AvailabilityBody) -> None:
    if payload.timezone is not None:
        av.timezone = payload.timezone
    if payload.working_hours is not None:
        av.working_hours = payload.working_hours
    if payload.weekly_quota is not None:
        av.weekly_quota = payload.weekly_quota
    if payload.is_available is not None:
        av.is_available = payload.is_available
    if payload.vacation_from is not None:
        av.vacation_from = payload.vacation_from
    if payload.vacation_until is not None:
        av.vacation_until = payload.vacation_until
    # Валидация периода отпуска (from ≤ until)
    if av.vacation_from and av.vacation_until and av.vacation_from > av.vacation_until:
        raise HTTPException(400, "vacation_from должен быть ≤ vacation_until")
