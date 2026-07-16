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
from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from sqlalchemy.exc import IntegrityError

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


def envelope(code: str, message: str, details: Any | None = None, status_code: int = 400) -> JSONResponse:
    body: dict[str, Any] = {"error": {"code": code, "message": message}}
    if details is not None:
        body["error"]["details"] = details
    return JSONResponse(status_code=status_code, content=body)


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
    @app.exception_handler(HTTPException)
    async def http_exc(_: Request, exc: HTTPException):
        code = STATUS_TO_CODE.get(exc.status_code, "http_error")
        return envelope(code, _detail_to_message(exc.detail), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_exc(_: Request, exc: RequestValidationError):
        details = []
        for err in exc.errors():
            loc = err.get("loc", [])
            field = ".".join(str(p) for p in loc[1:]) if loc and loc[0] in ("body", "query", "path") else ".".join(str(p) for p in loc)
            details.append({
                "field": field,
                "message": err.get("msg", "invalid value"),
                "type": err.get("type"),
            })
        message = details[0]["message"] if details else "Ошибка валидации"
        return envelope("validation_error", message, details=details, status_code=status.HTTP_422_UNPROCESSABLE_ENTITY)

    @app.exception_handler(RateLimitExceeded)
    async def rate_limit_exc(_: Request, exc: RateLimitExceeded):
        return envelope("rate_limited", f"Слишком много запросов, попробуйте позже ({exc.detail})", status_code=429)

    @app.exception_handler(IntegrityError)
    async def integrity_exc(_: Request, exc: IntegrityError):
        log.warning("IntegrityError: %s", exc)
        return envelope("conflict", "Нарушение целостности данных", status_code=409)

    @app.exception_handler(Exception)
    async def unhandled_exc(_: Request, exc: Exception):
        log.exception("Unhandled exception: %s", exc)
        return envelope("internal_error", "Внутренняя ошибка сервера", status_code=500)
