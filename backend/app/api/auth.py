from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from jose import JWTError
from sqlalchemy.orm import Session

from ..database import get_db
from ..config import settings
from ..core.cookies import set_auth_cookies, clear_auth_cookies
from ..core.limiter import limiter
from ..core.security import (
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
    blacklist_token,
    is_blacklisted,
    TOKEN_TYPE_REFRESH,
)
from ..core.permissions import all_permission_codes
from ..core.security import hash_password
from ..core.tenant_setup import create_tenant_with_owner
from ..models import User, Tenant, TenantMembership
from ..schemas.auth import LoginRequest, RegisterRequest, TokenResponse, RefreshRequest
from ..schemas.user import MeOut
from ..schemas.common import Message
from .deps import get_current_user, get_current_token, log_action

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _pick_default_tenant(db: Session, user_id: int) -> int | None:
    """Первый активный tenant пользователя (owner в приоритете)."""
    row = (
        db.query(TenantMembership)
        .join(Tenant, Tenant.id == TenantMembership.tenant_id)
        .filter(TenantMembership.user_id == user_id, Tenant.is_active.is_(True))
        .order_by(TenantMembership.is_owner.desc(), TenantMembership.joined_at.asc())
        .first()
    )
    return row.tenant_id if row else None


def _issue_pair(user_id: int, tenant_id: int | None) -> tuple[str, str, int]:
    access, _access_jti, access_exp = create_access_token(user_id, tenant_id=tenant_id)
    refresh, _refresh_jti, _ = create_refresh_token(user_id, tenant_id=tenant_id)
    ttl = int((access_exp - datetime.now(timezone.utc)).total_seconds())
    return access, refresh, ttl


def _read_refresh(request: Request, body: RefreshRequest | None) -> str | None:
    """Refresh-токен приходит в httpOnly cookie; body — фолбэк для совместимости."""
    cookie_tok = request.cookies.get(settings.REFRESH_COOKIE_NAME)
    if cookie_tok:
        return cookie_tok
    return body.refresh_token if body else None


@router.post("/login", response_model=TokenResponse)
@limiter.limit(settings.LOGIN_RATE_LIMIT)
def login(
    request: Request,
    response: Response,
    payload: LoginRequest,
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный email или пароль")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Пользователь заблокирован")
    user.last_login_at = datetime.now(timezone.utc)
    tenant_id = _pick_default_tenant(db, user.id)
    log_action(db, tenant_id=tenant_id, user_id=user.id, action="login", entity="user", entity_id=user.id)
    db.commit()

    access, refresh, ttl = _issue_pair(user.id, tenant_id)
    set_auth_cookies(response, access, refresh)
    return TokenResponse(access_token=access, refresh_token=refresh, expires_in=ttl)


@router.post("/register", response_model=TokenResponse, status_code=201)
@limiter.limit("5/hour")
def register(
    request: Request,
    response: Response,
    payload: RegisterRequest,
    db: Session = Depends(get_db),
):
    """Публичная регистрация: создаёт компанию и владельца одним запросом."""
    email = payload.email.lower().strip()
    if db.query(User.id).filter(User.email == email).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Пользователь с таким email уже существует")

    user = User(
        email=email,
        name=payload.full_name.strip(),
        password_hash=hash_password(payload.password),
        is_active=True,
    )
    db.add(user)
    db.flush()

    tenant = create_tenant_with_owner(
        db,
        company_name=payload.company_name.strip(),
        owner=user,
        plan="free",
    )

    log_action(db, tenant_id=tenant.id, user_id=user.id, action="register", entity="tenant", entity_id=tenant.id, detail=tenant.name)
    db.commit()

    access, refresh, ttl = _issue_pair(user.id, tenant.id)
    set_auth_cookies(response, access, refresh)
    return TokenResponse(access_token=access, refresh_token=refresh, expires_in=ttl)


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("30/minute")
def refresh(
    request: Request,
    response: Response,
    payload: RefreshRequest | None = None,
    db: Session = Depends(get_db),
):
    refresh_tok = _read_refresh(request, payload)
    if not refresh_tok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing refresh token")

    try:
        data = decode_token(refresh_tok)
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")

    if data.get("typ") != TOKEN_TYPE_REFRESH:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong token type")
    if is_blacklisted(data.get("jti")):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token revoked")

    try:
        user_id = int(data.get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid subject")

    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")

    # ротируем refresh: старый попадает в blacklist
    old_exp = datetime.fromtimestamp(data["exp"], tz=timezone.utc)
    blacklist_token(data.get("jti"), old_exp)

    tenant_id = data.get("tid")
    if tenant_id is not None:
        membership = (
            db.query(TenantMembership)
            .join(Tenant, Tenant.id == TenantMembership.tenant_id)
            .filter(
                TenantMembership.user_id == user.id,
                TenantMembership.tenant_id == tenant_id,
                Tenant.is_active.is_(True),
            )
            .first()
        )
        if not membership:
            tenant_id = _pick_default_tenant(db, user.id)
    else:
        tenant_id = _pick_default_tenant(db, user.id)

    access, new_refresh, ttl = _issue_pair(user.id, tenant_id)
    set_auth_cookies(response, access, new_refresh)
    return TokenResponse(access_token=access, refresh_token=new_refresh, expires_in=ttl)


@router.post("/logout", response_model=Message)
def logout(
    request: Request,
    response: Response,
    payload: RefreshRequest | None = None,
    token: str | None = Depends(get_current_token),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # blacklist access
    if token:
        try:
            data = decode_token(token)
            blacklist_token(data.get("jti"), datetime.fromtimestamp(data["exp"], tz=timezone.utc))
        except JWTError:
            pass
    # blacklist refresh — из cookie или body
    refresh_tok = _read_refresh(request, payload)
    if refresh_tok:
        try:
            data = decode_token(refresh_tok)
            blacklist_token(data.get("jti"), datetime.fromtimestamp(data["exp"], tz=timezone.utc))
        except JWTError:
            pass

    clear_auth_cookies(response)
    log_action(db, tenant_id=None, user_id=user.id, action="logout", entity="user", entity_id=user.id)
    db.commit()
    return Message(message="Вы вышли из системы")


@router.get("/me", response_model=MeOut)
def me(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.is_superuser:
        perms = all_permission_codes()
    else:
        perms = sorted({p.code for r in user.roles for p in r.permissions})

    current_tenant = None
    # Читаем tid из access-cookie/Bearer напрямую, чтобы не тащить get_current_context в /me
    tok = request.cookies.get(settings.AUTH_COOKIE_NAME)
    if not tok:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.lower().startswith("bearer "):
            tok = auth_header[7:]
    if tok:
        try:
            payload = decode_token(tok)
            tenant_id = payload.get("tid")
            if tenant_id is not None:
                membership = (
                    db.query(TenantMembership)
                    .join(Tenant, Tenant.id == TenantMembership.tenant_id)
                    .filter(
                        TenantMembership.user_id == user.id,
                        TenantMembership.tenant_id == tenant_id,
                        Tenant.is_active.is_(True),
                    )
                    .first()
                )
                if membership:
                    t = membership.tenant
                    current_tenant = {
                        "id": t.id,
                        "name": t.name,
                        "slug": t.slug,
                        "plan": t.plan,
                        "logo_url": t.logo_url,
                        "primary_color": t.primary_color,
                        "company_display_name": t.company_display_name,
                        "is_owner": membership.is_owner,
                    }
        except JWTError:
            pass

    data = MeOut.model_validate(user).model_copy(update={
        "permissions": perms,
        "current_tenant": current_tenant,
    })
    return data


@router.get("/tenants")
def list_my_tenants(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(TenantMembership, Tenant)
        .join(Tenant, Tenant.id == TenantMembership.tenant_id)
        .filter(TenantMembership.user_id == user.id, Tenant.is_active.is_(True))
        .order_by(TenantMembership.is_owner.desc(), TenantMembership.joined_at.asc())
        .all()
    )
    return [
        {
            "id": t.id,
            "name": t.name,
            "slug": t.slug,
            "plan": t.plan,
            "logo_url": t.logo_url,
            "primary_color": t.primary_color,
            "company_display_name": t.company_display_name,
            "is_owner": m.is_owner,
        }
        for m, t in rows
    ]


@router.post("/switch-tenant/{tenant_id}", response_model=TokenResponse)
def switch_tenant(
    tenant_id: int,
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    membership = (
        db.query(TenantMembership)
        .join(Tenant, Tenant.id == TenantMembership.tenant_id)
        .filter(
            TenantMembership.user_id == user.id,
            TenantMembership.tenant_id == tenant_id,
            Tenant.is_active.is_(True),
        )
        .first()
    )
    if not membership:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа к компании")

    access, refresh, ttl = _issue_pair(user.id, tenant_id)
    set_auth_cookies(response, access, refresh)
    return TokenResponse(access_token=access, refresh_token=refresh, expires_in=ttl)
