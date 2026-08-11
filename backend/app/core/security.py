import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Tuple

from jose import jwt, JWTError
from passlib.context import CryptContext

from ..config import settings
from .redis_client import get_redis

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


TOKEN_TYPE_ACCESS = "access"
TOKEN_TYPE_REFRESH = "refresh"
BLACKLIST_PREFIX = "jwt:blacklist:"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return pwd_context.verify(plain, hashed)
    except Exception:
        return False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _encode(payload: dict[str, Any]) -> str:
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_access_token(subject: str | int, tenant_id: Optional[int] = None) -> Tuple[str, str, datetime]:
    jti = uuid.uuid4().hex
    expire = _now() + timedelta(minutes=settings.JWT_ACCESS_MINUTES)
    payload: dict[str, Any] = {"sub": str(subject), "exp": expire, "jti": jti, "typ": TOKEN_TYPE_ACCESS}
    if tenant_id is not None:
        payload["tid"] = tenant_id
    token = _encode(payload)
    return token, jti, expire


def create_refresh_token(subject: str | int, tenant_id: Optional[int] = None) -> Tuple[str, str, datetime]:
    jti = uuid.uuid4().hex
    expire = _now() + timedelta(days=settings.JWT_REFRESH_DAYS)
    payload: dict[str, Any] = {"sub": str(subject), "exp": expire, "jti": jti, "typ": TOKEN_TYPE_REFRESH}
    if tenant_id is not None:
        payload["tid"] = tenant_id
    token = _encode(payload)
    return token, jti, expire


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])


def _blacklist_key(jti: str) -> str:
    return f"{BLACKLIST_PREFIX}{jti}"


def blacklist_token(jti: str, exp: datetime) -> None:
    """Помечает jti как отозванный в Redis, TTL до истечения токена."""
    if not jti:
        return
    ttl = int((exp - _now()).total_seconds())
    if ttl <= 0:
        return
    try:
        get_redis().set(_blacklist_key(jti), "1", ex=ttl)
    except Exception:
        # Redis временно недоступен — не роняем выход из системы
        pass


def is_blacklisted(jti: Optional[str]) -> bool:
    if not jti:
        return False
    try:
        return bool(get_redis().exists(_blacklist_key(jti)))
    except Exception:
        return False
