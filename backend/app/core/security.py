import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Tuple

from jose import jwt, JWTError
from passlib.context import CryptContext

from ..config import settings
from .redis_client import get_redis

log = logging.getLogger("qadam.security")

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


class PasswordPolicyError(ValueError):
    """Пароль не соответствует политике tenant'а (см. TenantSecurityPolicy)."""


def validate_password(password: str, tenant_id: Optional[int] = None) -> None:
    """P4: валидируем пароль по TenantSecurityPolicy.

    Дефолт (без tenant или без policy): min_length=8.
    Кидает PasswordPolicyError с человекочитаемым сообщением.
    """
    import re
    min_length = 8
    require_upper = False
    require_number = False
    require_special = False
    if tenant_id is not None:
        try:
            from ..database import SessionLocal
            from ..models import TenantSecurityPolicy
            db = SessionLocal()
            try:
                p = db.query(TenantSecurityPolicy).filter(TenantSecurityPolicy.tenant_id == tenant_id).first()
                if p:
                    min_length = p.password_min_length or 8
                    require_upper = p.password_require_upper
                    require_number = p.password_require_number
                    require_special = p.password_require_special
            finally:
                db.close()
        except Exception as e:
            log.warning("validate_password: could not load policy (%s)", e)

    if len(password) < min_length:
        raise PasswordPolicyError(f"Пароль должен быть не короче {min_length} символов")
    if require_upper and not re.search(r"[A-ZА-ЯЁ]", password):
        raise PasswordPolicyError("Пароль должен содержать заглавную букву")
    if require_number and not re.search(r"\d", password):
        raise PasswordPolicyError("Пароль должен содержать цифру")
    if require_special and not re.search(r"[!@#$%^&*()_+\-={}\[\]:;\"'<>,.?/\\|~`]", password):
        raise PasswordPolicyError("Пароль должен содержать спецсимвол")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _encode(payload: dict[str, Any]) -> str:
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_access_token(subject: str | int, tenant_id: Optional[int] = None) -> Tuple[str, str, datetime]:
    jti = uuid.uuid4().hex
    now = _now()
    expire = now + timedelta(minutes=settings.JWT_ACCESS_MINUTES)
    # iat нужен чтобы инвалидировать все выданные ранее токены при смене пароля:
    # сравниваем iat с User.password_changed_at.
    payload: dict[str, Any] = {
        "sub": str(subject), "exp": expire, "iat": now, "jti": jti, "typ": TOKEN_TYPE_ACCESS,
    }
    if tenant_id is not None:
        payload["tid"] = tenant_id
    token = _encode(payload)
    return token, jti, expire


def create_refresh_token(subject: str | int, tenant_id: Optional[int] = None) -> Tuple[str, str, datetime]:
    jti = uuid.uuid4().hex
    now = _now()
    expire = now + timedelta(days=settings.JWT_REFRESH_DAYS)
    payload: dict[str, Any] = {
        "sub": str(subject), "exp": expire, "iat": now, "jti": jti, "typ": TOKEN_TYPE_REFRESH,
    }
    if tenant_id is not None:
        payload["tid"] = tenant_id
    token = _encode(payload)
    return token, jti, expire


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])


def _blacklist_key(jti: str) -> str:
    return f"{BLACKLIST_PREFIX}{jti}"


def blacklist_token(jti: str, exp: datetime) -> None:
    """Помечает jti как отозванный в Redis, TTL до истечения токена.

    Если Redis недоступен — логируем ERROR и рейзим, чтобы logout честно
    зафейлился. Молчаливый пропуск раньше приводил к тому, что «logout прошёл»,
    но токен оставался валидным.
    """
    if not jti:
        return
    ttl = int((exp - _now()).total_seconds())
    if ttl <= 0:
        return
    try:
        get_redis().set(_blacklist_key(jti), "1", ex=ttl)
    except Exception as e:
        log.error("blacklist_token failed: Redis unavailable (%s)", e)
        raise


def is_blacklisted(jti: Optional[str]) -> bool:
    """Fail-secure: при недоступности Redis возвращаем True, чтобы отклонить запрос.

    Иначе logout не работает: отозванные токены оставались бы валидными пока Redis лежит.
    Компромисс — на время отказа Redis все запросы получат 401, но это лучше, чем silent
    security bypass.
    """
    if not jti:
        return False
    try:
        return bool(get_redis().exists(_blacklist_key(jti)))
    except Exception as e:
        log.error("is_blacklisted failed: Redis unavailable (%s) — failing secure (True)", e)
        return True
