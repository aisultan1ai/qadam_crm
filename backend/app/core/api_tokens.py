"""API-токены компании: аутентификация, права и лимит запросов по тарифу.

Токен действует от имени сотрудника, который его выпустил, но только в пределах выбранных
при выпуске прав (и не шире текущих прав этого сотрудника). Уволили сотрудника или
сняли с него права — токен сужается или перестаёт работать сам.

Лимит: api_rate_per_min тарифа компании, общий на все токены компании (окно — минута).
Браузерные сессии лимитом API не ограничиваются.
"""
from __future__ import annotations

import hashlib
import secrets
import time
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Iterable, Optional

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from ..models import ApiToken, Tenant, TenantMembership, User
from ..models.api_token import TOKEN_PREFIX

# Чего токен не может никогда: входить/выходить, менять профиль, 2FA, выпускать токены,
# управлять компанией, оплатой и платформой. Это действия человека, а не интеграции.
DENIED_PREFIXES = (
    "/api/auth", "/api/users/me", "/api/me/", "/api/api-tokens", "/api/admin",
    "/api/tenants", "/api/billing", "/api/ws", "/api/onboarding",
)


def generate() -> tuple[str, str, str]:
    """(полный токен, префикс для показа, sha256-хэш для БД)."""
    raw = TOKEN_PREFIX + secrets.token_urlsafe(32)
    return raw, raw[:10], hash_token(raw)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def is_api_token(raw: Optional[str]) -> bool:
    return bool(raw) and raw.startswith(TOKEN_PREFIX)


def effective_scopes(user: User, tenant_id: int, is_owner: bool, wanted: Iterable[str]) -> frozenset[str]:
    """Права токена = выбранные при выпуске ∩ права сотрудника сейчас (владелец — все)."""
    wanted = set(wanted)
    if is_owner:
        return frozenset(wanted)
    granted = {
        p.code for r in (user.roles or []) if r.tenant_id == tenant_id for p in r.permissions
    }
    return frozenset(wanted & granted)


def _rate_limit(tenant: Tenant, db: Session) -> None:
    from .plans import get_limits
    from .redis_client import get_redis
    limit = get_limits(db, tenant.plan).get("api_rate_per_min") or 60
    window = int(time.time() // 60)
    key = f"apirl:{tenant.id}:{window}"
    try:
        r = get_redis()
        n = r.incr(key)
        if n == 1:
            r.expire(key, 70)
    except Exception:
        return  # Redis недоступен — не роняем интеграции клиента (fail-open)
    if n > limit:
        retry = 60 - int(time.time()) % 60
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "rate_limited",
                "message": f"Превышен лимит API вашего тарифа: {limit} запросов в минуту. Повторите через {retry} с.",
            },
            headers={"Retry-After": str(retry), "X-RateLimit-Limit": str(limit)},
        )


def authenticate(db: Session, request: Request, raw: str):
    """Проверяет API-токен и возвращает (user, tenant, membership-копию без прав владельца)."""
    path = request.url.path or ""
    if any(path.startswith(p) for p in DENIED_PREFIXES):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Этот раздел недоступен по API-токену")
    tok = db.query(ApiToken).filter(ApiToken.token_hash == hash_token(raw)).first()
    now = datetime.now(timezone.utc)
    if not tok or tok.revoked_at is not None or (tok.expires_at and tok.expires_at <= now):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "API-токен недействителен или отозван")
    tenant = db.get(Tenant, tok.tenant_id)
    if not tenant or not tenant.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Компания недоступна")
    user = db.get(User, tok.created_by) if tok.created_by else None
    member = None
    if user and user.is_active:
        member = db.query(TenantMembership).filter(
            TenantMembership.tenant_id == tenant.id, TenantMembership.user_id == user.id,
        ).first()
    if not member:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Сотрудник, выпустивший токен, больше не в компании — выпустите новый")

    _rate_limit(tenant, db)

    # Права токена кладём на сам объект пользователя (живёт в рамках сессии запроса):
    # user_has() видит их во всех проверках, включая вызовы внутри эндпоинтов.
    user.__dict__["_token_scopes"] = effective_scopes(user, tenant.id, member.is_owner, tok.permission_codes or [])
    # Копия членства с is_owner=False: «обход владельца» в require() и эндпоинтах на токен не распространяется.
    membership = SimpleNamespace(
        id=member.id, tenant_id=member.tenant_id, user_id=member.user_id, role_id=member.role_id,
        is_owner=False, department_id=member.department_id, manager_id=member.manager_id,
        position=member.position, joined_at=member.joined_at,
    )
    if not tok.last_used_at or (now - tok.last_used_at).total_seconds() > 60:
        tok.last_used_at = now
        db.commit()
    request.state.api_token_id = tok.id
    return user, tenant, membership


def token_scopes(user) -> Optional[frozenset[str]]:
    return getattr(user, "__dict__", {}).get("_token_scopes")
