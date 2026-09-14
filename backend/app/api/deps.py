from dataclasses import dataclass
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from jose import JWTError
from typing import Callable, Iterable, Optional

from ..config import settings
from ..database import get_db
from ..core.security import decode_token, is_blacklisted, TOKEN_TYPE_ACCESS
from ..core.permissions import user_has
from ..models import User, ActivityLog, Tenant, TenantMembership

# auto_error=False — если Bearer не пришёл, не роняем, а проверим cookie.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def _extract_token(request: Request, bearer: Optional[str]) -> Optional[str]:
    """Токен берём из httpOnly cookie в приоритете; Bearer — для совместимости (API-клиенты, тесты)."""
    cookie_token = request.cookies.get(settings.AUTH_COOKIE_NAME)
    return cookie_token or bearer


def _decode_and_validate(token: str) -> dict:
    try:
        payload = decode_token(token)
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    if payload.get("typ") not in (None, TOKEN_TYPE_ACCESS):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong token type")
    if is_blacklisted(payload.get("jti")):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token revoked")
    return payload


def _assert_token_not_stale(user: "User", payload: dict) -> None:
    """Отклоняет токен, выданный ДО последней смены пароля пользователя.

    Без этой проверки сессии, полученные ранее (с чужого устройства/украденные),
    продолжали работать после смены пароля вплоть до истечения токена.
    """
    changed_at = getattr(user, "password_changed_at", None)
    if not changed_at:
        return
    iat = payload.get("iat")
    if iat is None:
        # Старый токен без iat — считаем что был выдан до всех текущих правок,
        # если пароль когда-либо менялся → он уже устарел.
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Пароль был изменён — войдите заново",
        )
    from datetime import datetime, timezone
    if isinstance(iat, (int, float)):
        iat_dt = datetime.fromtimestamp(int(iat), tz=timezone.utc)
    else:
        # jose кодирует datetime как unix-timestamp, поэтому сюда почти не попадаем.
        return
    # Даём 5 секунд запаса на возможный дрифт clock'а сервера.
    from datetime import timedelta as _td
    if iat_dt + _td(seconds=5) < changed_at:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Пароль был изменён — войдите заново",
        )


def get_current_user(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    tok = _extract_token(request, token)
    if not tok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    payload = _decode_and_validate(tok)
    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")

    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")
    _assert_token_not_stale(user, payload)
    return user


@dataclass
class TenantContext:
    user: User
    tenant: Tenant
    membership: TenantMembership


def get_current_context(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> TenantContext:
    """Возвращает пользователя, tenant и membership из JWT.

    Валидирует, что tenant активен и пользователь состоит в нём.
    Использовать во всех защищённых endpoint'ах вместо get_current_user,
    когда нужна изоляция данных по tenant'у.
    """
    tok = _extract_token(request, token)
    if not tok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    payload = _decode_and_validate(tok)
    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")

    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")
    _assert_token_not_stale(user, payload)

    tenant_id = payload.get("tid")
    if tenant_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No active tenant in token")

    membership = (
        db.query(TenantMembership)
        .filter(TenantMembership.user_id == user.id, TenantMembership.tenant_id == tenant_id)
        .first()
    )
    if not membership:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа к компании")

    tenant = db.get(Tenant, tenant_id)
    if not tenant or not tenant.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Компания недоступна")

    # Если запрос пришёл на кастомный subdomain (см. SubdomainTenantMiddleware),
    # он должен совпадать со slug'ом tenant'а из JWT. Иначе — не позволяем
    # смешивать сессию одной компании с домашней страницей другой.
    forced_slug = getattr(request.state, "forced_tenant_slug", None)
    if forced_slug and forced_slug not in (tenant.subdomain, tenant.slug):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Этот поддомен принадлежит другой компании — переключите tenant или откройте прямой URL",
        )

    # P5.2/P5.3: password rotation + session timeout enforcement
    _enforce_security_policies(db, request, user, tenant.id, payload)

    return TenantContext(user=user, tenant=tenant, membership=membership)


# ============================================================================
# P5.2 + P5.3: Security policy enforcement (rotation + session timeout)
# ============================================================================

_SECURITY_BYPASS_PATHS = (
    "/api/auth/logout",
    "/api/auth/refresh",
    "/api/auth/change-password",
    "/api/users/me",
    "/api/me/2fa",
    "/health",
)


def _enforce_security_policies(db: Session, request: Request, user: "User", tenant_id: int, payload: dict) -> None:
    """P5.2: если password_rotation_days задан и password_changed_at устарел → 403 password_expired.
    P5.3: если session_timeout_minutes задан и последняя активность старше → 401 session_timeout.
    Fail-open при отсутствии policy или ошибке БД/Redis.
    """
    from datetime import datetime, timezone
    path = request.url.path or ""
    if any(path.startswith(p) for p in _SECURITY_BYPASS_PATHS):
        return

    try:
        from ..models import TenantSecurityPolicy
        policy = (
            db.query(TenantSecurityPolicy)
            .filter(TenantSecurityPolicy.tenant_id == tenant_id)
            .first()
        )
        if not policy:
            return

        now = datetime.now(timezone.utc)

        if policy.password_rotation_days:
            changed = user.password_changed_at or user.created_at
            if changed:
                age = (now - changed).days
                if age >= policy.password_rotation_days:
                    raise HTTPException(
                        status.HTTP_403_FORBIDDEN,
                        detail={"error": "password_expired", "message": f"Пароль устарел ({age} дн.). Смените в профиле."},
                    )

        if policy.session_timeout_minutes:
            jti = payload.get("jti")
            if jti:
                from ..core.redis_client import get_redis
                try:
                    r = get_redis()
                    key = f"session:last_seen:{user.id}:{jti}"
                    prev = r.get(key)
                    if prev:
                        prev_iso = prev.decode() if isinstance(prev, bytes) else prev
                        prev_dt = datetime.fromisoformat(prev_iso)
                        idle_min = (now - prev_dt).total_seconds() / 60
                        if idle_min >= policy.session_timeout_minutes:
                            raise HTTPException(
                                status.HTTP_401_UNAUTHORIZED,
                                detail={"error": "session_timeout", "message": f"Сессия истекла из-за неактивности ({int(idle_min)} мин)"},
                            )
                    ttl = int(policy.session_timeout_minutes * 60 + 3600)
                    r.set(key, now.isoformat(), ex=ttl)
                except HTTPException:
                    raise
                except Exception:
                    pass
    except HTTPException:
        raise
    except Exception:
        import logging
        logging.getLogger("qadam.security").warning("policy enforcement failed", exc_info=True)


def get_current_tenant(ctx: TenantContext = Depends(get_current_context)) -> Tenant:
    return ctx.tenant


def verify_same_origin(request: Request) -> None:
    """CSRF-защита для чувствительных операций (billing, tenant delete и т.п.).

    Проверяет, что `Origin` header запроса присутствует и входит в CORS_ORIGINS.
    SameSite=lax cookies уже блокируют большинство cross-site POST, но top-level
    navigation (form submit) может обойти это — Origin-check закрывает лазейку.

    В dev, если CORS_ORIGINS пуст (не должен), пропускает с warning.
    """
    origin = request.headers.get("origin") or request.headers.get("referer")
    allowed = settings.cors_origins_list
    if not allowed:
        # config validator запрещает это в prod; в dev — warning в логе достаточно.
        return
    if not origin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing Origin header")
    # Referer может быть полным URL — берём scheme://host
    from urllib.parse import urlparse
    parsed = urlparse(origin)
    origin_root = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme else origin
    if origin_root not in allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Origin not allowed")


def get_current_token(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
) -> Optional[str]:
    """Возвращает сырой access-токен (для blacklist при logout)."""
    return _extract_token(request, token)


def require(*codes: str) -> Callable[..., TenantContext]:
    """Проверка permissions + возврат tenant-context.

    Возвращает TenantContext — эндпоинты, которым важен tenant_id, берут user/tenant из него.
    Для endpoint'ов, где нужен только User (например /me), используем get_current_user.

    Владелец компании (membership.is_owner=True) получает bypass — он имеет все
    права в своей компании независимо от Role.permissions. Проверка permissions
    делается с учётом tenant_id, чтобы роли из других компаний не влияли.
    """
    def _dep(ctx: TenantContext = Depends(get_current_context)) -> TenantContext:
        if ctx.membership.is_owner:
            return ctx
        if not user_has(ctx.user, codes, tenant_id=ctx.tenant.id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden")
        return ctx
    return _dep


def require_any(codes: Iterable[str]) -> Callable[..., TenantContext]:
    return require(*codes)


def log_action(
    db: Session,
    *,
    tenant_id: int | None,
    user_id: int | None,
    action: str,
    entity: str | None = None,
    entity_id: int | None = None,
    detail: str | None = None,
    task_id: int | None = None,
) -> None:
    entry = ActivityLog(
        tenant_id=tenant_id,
        user_id=user_id,
        action=action,
        entity=entity,
        entity_id=entity_id,
        detail=detail,
        task_id=task_id,
    )
    db.add(entry)
