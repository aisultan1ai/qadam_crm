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
from ..models import User
from ..schemas.auth import LoginRequest, TokenResponse, RefreshRequest
from ..schemas.user import MeOut
from ..schemas.common import Message
from .deps import get_current_user, get_current_token, log_action

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _issue_pair(user_id: int) -> tuple[str, str, int]:
    access, _access_jti, access_exp = create_access_token(user_id)
    refresh, _refresh_jti, _ = create_refresh_token(user_id)
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
    log_action(db, user_id=user.id, action="login", entity="user", entity_id=user.id)
    db.commit()

    access, refresh, ttl = _issue_pair(user.id)
    set_auth_cookies(response, access, refresh)
    # Возвращаем и в body — для API-клиентов / тестов, которые не используют cookies.
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

    access, new_refresh, ttl = _issue_pair(user.id)
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
    log_action(db, user_id=user.id, action="logout", entity="user", entity_id=user.id)
    db.commit()
    return Message(message="Вы вышли из системы")


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(get_current_user)):
    if user.is_superuser:
        perms = all_permission_codes()
    else:
        perms = sorted({p.code for r in user.roles for p in r.permissions})
    data = MeOut.model_validate(user).model_copy(update={"permissions": perms})
    return data
