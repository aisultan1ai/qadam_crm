"""Простой Redis-кэш JSON-ответов для read-endpoint'ов.

Ключи всегда содержат tenant_id и версию, чтобы:
- изоляция данных сохранялась;
- при изменении формата ответа можно было сбросить всё поднятием версии.
Redis-ошибки не должны валить запрос — при недоступности просто считаем напрямую.
"""
from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Callable

from .redis_client import get_redis

log = logging.getLogger("qadam.cache")

CACHE_VERSION = "v1"


def make_key(tenant_id: int, namespace: str, extra: dict[str, Any] | None = None) -> str:
    base = f"analytics:{CACHE_VERSION}:{tenant_id}:{namespace}"
    if not extra:
        return base
    payload = json.dumps(extra, sort_keys=True, default=str)
    digest = hashlib.sha1(payload.encode()).hexdigest()[:16]
    return f"{base}:{digest}"


def get_or_set_json(key: str, ttl_seconds: int, compute: Callable[[], Any]) -> Any:
    try:
        r = get_redis()
        cached = r.get(key)
        if cached is not None:
            try:
                return json.loads(cached)
            except (TypeError, ValueError):
                pass
    except Exception:
        log.warning("cache get failed for %s", key, exc_info=True)

    value = compute()

    try:
        r = get_redis()
        r.set(key, json.dumps(value, default=str), ex=ttl_seconds)
    except Exception:
        log.warning("cache set failed for %s", key, exc_info=True)

    return value


def invalidate_analytics(tenant_id: int) -> None:
    """Сбросить весь кэш аналитики tenant'а через SCAN (без блокирующего KEYS)."""
    prefix = f"analytics:{CACHE_VERSION}:{tenant_id}:"
    try:
        r = get_redis()
        cursor = 0
        while True:
            cursor, batch = r.scan(cursor=cursor, match=prefix + "*", count=200)
            if batch:
                r.delete(*batch)
            if cursor == 0:
                break
    except Exception:
        log.warning("cache invalidate failed for tenant=%s", tenant_id, exc_info=True)
