from fastapi import Request
from jose import JWTError
from slowapi import Limiter
from slowapi.util import get_remote_address

from ..config import settings
from .security import decode_token


def _auth_or_ip_key(request: Request) -> str:
    """Ключ rate-limit: для аутентифицированных запросов — по user_id + endpoint,
    иначе (публичные /login, /register, /f/...) — по IP + endpoint.

    Это защищает от ситуации когда 50 юзеров за одним NAT/proxy делят IP-лимит.
    """
    endpoint = request.url.path
    # Попытка достать user_id из access-cookie/Bearer без обращения к БД.
    token = request.cookies.get(settings.AUTH_COOKIE_NAME)
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:]
    if token:
        try:
            payload = decode_token(token)
            sub = payload.get("sub")
            if sub is not None:
                return f"u:{sub}:{endpoint}"
        except JWTError:
            pass
    return f"ip:{get_remote_address(request)}:{endpoint}"


limiter = Limiter(
    key_func=_auth_or_ip_key,
    storage_uri=settings.REDIS_URL,
    strategy="fixed-window",
)
