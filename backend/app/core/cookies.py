"""
Установка/удаление auth-cookies (httpOnly).

Access-cookie доступна для всего API, refresh — только на /api/auth (обычно
достаточно для эндпоинта /refresh и /logout). httpOnly защищает от XSS-кражи,
SameSite=Lax защищает от базового CSRF на GET.
"""

from fastapi import Response

from ..config import settings


def _base_kwargs() -> dict:
    kw = {
        "httponly": True,
        "secure": settings.COOKIE_SECURE,
        "samesite": settings.COOKIE_SAMESITE,
    }
    if settings.COOKIE_DOMAIN:
        kw["domain"] = settings.COOKIE_DOMAIN
    return kw


def set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    access_max = settings.JWT_ACCESS_MINUTES * 60
    refresh_max = settings.JWT_REFRESH_DAYS * 24 * 60 * 60

    response.set_cookie(
        key=settings.AUTH_COOKIE_NAME,
        value=access_token,
        max_age=access_max,
        path="/",
        **_base_kwargs(),
    )
    response.set_cookie(
        key=settings.REFRESH_COOKIE_NAME,
        value=refresh_token,
        max_age=refresh_max,
        path=settings.REFRESH_COOKIE_PATH,
        **_base_kwargs(),
    )


def clear_auth_cookies(response: Response) -> None:
    base = _base_kwargs()
    response.delete_cookie(
        key=settings.AUTH_COOKIE_NAME,
        path="/",
        domain=base.get("domain"),
        secure=base["secure"],
        samesite=base["samesite"],
        httponly=True,
    )
    response.delete_cookie(
        key=settings.REFRESH_COOKIE_NAME,
        path=settings.REFRESH_COOKIE_PATH,
        domain=base.get("domain"),
        secure=base["secure"],
        samesite=base["samesite"],
        httponly=True,
    )
