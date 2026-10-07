"""Единый формат ошибок API.

Отдаётся всегда как:
    {
      "error": {
        "code": "validation_error",
        "message": "человекочитаемая ошибка",
        "details": [...]        # optional, поля с ошибками для форм
      }
    }
"""
from __future__ import annotations

import logging
import re
from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("qadam.errors")


STATUS_TO_CODE = {
    400: "bad_request",
    401: "unauthenticated",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    422: "validation_error",
    429: "rate_limited",
    500: "internal_error",
}


_HAS_CYRILLIC = re.compile(r"[А-Яа-яЁё]")

# Сообщения по статусу — когда исходный текст технический/английский или его нет.
STATUS_MESSAGES = {
    400: "Не удалось выполнить действие: проверьте введённые данные",
    401: "Сессия истекла — войдите снова",
    403: "Недостаточно прав для этого действия",
    404: "Не найдено — возможно, это уже удалили",
    405: "Это действие недоступно",
    409: "Данные изменились или уже существуют — обновите страницу и повторите",
    413: "Файл слишком большой",
    415: "Этот тип файла не поддерживается",
    422: "Проверьте введённые данные",
    429: "Слишком много запросов — подождите минуту и повторите",
    500: "Внутренняя ошибка сервера. Попробуйте ещё раз, а если повторится — сообщите в поддержку",
    502: "Сервис временно недоступен. Попробуйте через минуту",
    503: "Сервис временно недоступен. Попробуйте через минуту",
    504: "Сервер не ответил вовремя. Попробуйте ещё раз",
}

# Известные технические сообщения, у которых есть точный человеческий смысл.
KNOWN_MESSAGES = {
    "invalid token": "Сессия недействительна — войдите снова",
    "token revoked": "Сессия завершена — войдите снова",
    "not authenticated": "Войдите в систему, чтобы продолжить",
    "user not found or inactive": "Учётная запись не найдена или отключена",
    "missing origin header": "Запрос заблокирован защитой. Откройте сайт по основному адресу и повторите",
    "origin not allowed": "Запрос заблокирован защитой: сайт открыт по неразрешённому адресу. Откройте его по основному адресу компании",
    "tenant not found": "Компания не найдена",
    "not found": "Не найдено — возможно, это уже удалили",
    "method not allowed": "Это действие недоступно",
    "forbidden": "Недостаточно прав для этого действия",
    "unknown status": "Недопустимый статус",
    "status invalid": "Недопустимый статус",
}


def humanize(message: str | None, status_code: int) -> str:
    """Пользователь видит только понятный русский текст; технические строки заменяем."""
    msg = (message or "").strip()
    if msg and _HAS_CYRILLIC.search(msg):
        return msg
    known = KNOWN_MESSAGES.get(msg.lower())
    if known:
        return known
    return STATUS_MESSAGES.get(status_code) or ("Не удалось выполнить действие" if status_code < 500 else STATUS_MESSAGES[500])


def envelope(code: str, message: str, details: Any | None = None, status_code: int = 400) -> JSONResponse:
    body: dict[str, Any] = {"error": {"code": code, "message": message}}
    if details is not None:
        body["error"]["details"] = details
    return JSONResponse(status_code=status_code, content=body)


def _ru_validation_message(err: dict) -> str:
    """Понятная русская формулировка для типовых ошибок pydantic (UI показывает её пользователю)."""
    typ = err.get("type") or ""
    msg = str(err.get("msg") or "")
    ctx = err.get("ctx") or {}
    if typ == "missing":
        return "Обязательное поле"
    if "valid email" in msg:
        return "Некорректный email"
    if typ == "string_too_short":
        return f"Слишком коротко: минимум {ctx.get('min_length', '')} символов".strip()
    if typ == "string_too_long":
        return f"Слишком длинно: максимум {ctx.get('max_length', '')} символов".strip()
    if typ in ("int_parsing", "int_type", "float_parsing", "float_type"):
        return "Нужно число"
    if typ.startswith(("datetime_", "date_")):
        return "Некорректная дата"
    if typ in ("literal_error", "enum"):
        return "Недопустимое значение"
    if typ in ("greater_than_equal", "greater_than"):
        return f"Значение должно быть не меньше {ctx.get('ge', ctx.get('gt', ''))}".strip()
    if typ in ("less_than_equal", "less_than"):
        return f"Значение должно быть не больше {ctx.get('le', ctx.get('lt', ''))}".strip()
    # Наши собственные валидаторы: убираем служебный префикс pydantic.
    cleaned = msg.removeprefix("Value error, ").strip()
    return cleaned if _HAS_CYRILLIC.search(cleaned) else "Некорректное значение"


def _detail_to_message(detail: Any) -> str:
    if isinstance(detail, str):
        return detail
    if isinstance(detail, list) and detail:
        parts = []
        for d in detail:
            if isinstance(d, dict) and "msg" in d:
                parts.append(str(d["msg"]))
            else:
                parts.append(str(d))
        return "; ".join(parts)
    return str(detail)


def install_error_handlers(app: FastAPI) -> None:
    # Starlette-класс ловит и наши HTTPException, и 404/405 самого роутера (неизвестный адрес).
    @app.exception_handler(StarletteHTTPException)
    async def http_exc(_: Request, exc: StarletteHTTPException):
        code = STATUS_TO_CODE.get(exc.status_code, "http_error")
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": code, "message": humanize(_detail_to_message(exc.detail), exc.status_code)}},
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exc(_: Request, exc: RequestValidationError):
        details = []
        for err in exc.errors():
            loc = err.get("loc", [])
            field = ".".join(str(p) for p in loc[1:]) if loc and loc[0] in ("body", "query", "path") else ".".join(str(p) for p in loc)
            details.append({
                "field": field,
                "message": _ru_validation_message(err),
                "type": err.get("type"),
            })
        message = details[0]["message"] if details else "Ошибка валидации"
        return envelope("validation_error", message, details=details, status_code=status.HTTP_422_UNPROCESSABLE_ENTITY)

    @app.exception_handler(RateLimitExceeded)
    async def rate_limit_exc(_: Request, exc: RateLimitExceeded):
        return envelope("rate_limited", "Слишком много попыток. Подождите немного и повторите", status_code=429)

    @app.exception_handler(IntegrityError)
    async def integrity_exc(_: Request, exc: IntegrityError):
        log.warning("IntegrityError: %s", exc)
        sqlstate = getattr(getattr(exc, "orig", None), "sqlstate", None)
        message = {
            "23505": "Такая запись уже существует",
            "23503": "Действие невозможно: запись связана с другими данными",
            "23502": "Заполните все обязательные поля",
        }.get(sqlstate, "Данные не удалось сохранить: они конфликтуют с существующими")
        return envelope("conflict", message, status_code=409)

    @app.exception_handler(Exception)
    async def unhandled_exc(_: Request, exc: Exception):
        log.exception("Unhandled exception: %s", exc)
        return envelope("internal_error", STATUS_MESSAGES[500], status_code=500)
