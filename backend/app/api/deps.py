from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from jose import JWTError
from typing import Callable, Iterable, Optional

from ..config import settings
from ..database import get_db
from ..core.security import decode_token, is_blacklisted, TOKEN_TYPE_ACCESS
from ..core.permissions import user_has
from ..models import User, ActivityLog

# auto_error=False — если Bearer не пришёл, не роняем, а проверим cookie.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def _extract_token(request: Request, bearer: Optional[str]) -> Optional[str]:
    """Токен берём из httpOnly cookie в приоритете; Bearer — для совместимости (API-клиенты, тесты)."""
    cookie_token = request.cookies.get(settings.AUTH_COOKIE_NAME)
    return cookie_token or bearer


def get_current_user(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    tok = _extract_token(request, token)
    if not tok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        payload = decode_token(tok)
        user_id = int(payload.get("sub"))
    except (JWTError, TypeError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")

    if payload.get("typ") not in (None, TOKEN_TYPE_ACCESS):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong token type")

    if is_blacklisted(payload.get("jti")):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token revoked")

    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")
    return user


def get_current_token(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
) -> Optional[str]:
    """Возвращает сырой access-токен (для blacklist при logout)."""
    return _extract_token(request, token)


def require(*codes: str) -> Callable[..., User]:
    def _dep(user: User = Depends(get_current_user)) -> User:
        if not user_has(user, codes):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden")
        return user
    return _dep


def require_any(codes: Iterable[str]) -> Callable[..., User]:
    return require(*codes)


def log_action(db: Session, *, user_id: int | None, action: str, entity: str | None = None,
               entity_id: int | None = None, detail: str | None = None, task_id: int | None = None) -> None:
    entry = ActivityLog(
        user_id=user_id, action=action, entity=entity, entity_id=entity_id,
        detail=detail, task_id=task_id,
    )
    db.add(entry)
