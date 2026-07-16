from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from jose import JWTError
from sqlalchemy.orm import Session

from ..database import get_db
from ..config import settings
from ..core.limiter import limiter
from ..core.security import (
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
    blacklist_token,
    is_blacklisted,
    TOKEN_TYPE_ACCESS,
    TOKEN_TYPE_REFRESH,
)
from ..core.permissions import all_permission_codes
from ..models import User
from ..schemas.auth import LoginRequest, TokenResponse, RefreshRequest
from ..schemas.user import MeOut
from ..schemas.common import Message
from .deps import get_current_user, log_action, oauth2_scheme

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _issue_pair(user_id: int) -> TokenResponse:
    access, _access_jti, access_exp = create_access_token(user_id)
    refresh, _refresh_jti, _ = create_refresh_token(user_id)
    ttl = int((access_exp - datetime.now(timezone.utc)).total_seconds())
    return TokenResponse(access_token=access, refresh_token=refresh, expires_in=ttl)


@router.post("/login", response_model=TokenResponse)
@limiter.limit(settings.LOGIN_RATE_LIMIT)
def login(request: Request, payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный email или пароль")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Пользователь заблокирован")
    user.last_login_at = datetime.now(timezone.utc)
    log_action(db, user_id=user.id, action="login", entity="user", entity_id=user.id)
    db.commit()
    return _issue_pair(user.id)


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("30/minute")
def refresh(request: Request, payload: RefreshRequest, db: Session = Depends(get_db)):
    try:
        data = decode_token(payload.refresh_token)
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

    return _issue_pair(user.id)


@router.post("/logout", response_model=Message)
def logout(
    payload: RefreshRequest | None = None,
    token: str | None = Depends(oauth2_scheme),
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
    # blacklist refresh если пришёл
    if payload and payload.refresh_token:
        try:
            data = decode_token(payload.refresh_token)
            blacklist_token(data.get("jti"), datetime.fromtimestamp(data["exp"], tz=timezone.utc))
        except JWTError:
            pass
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
