"""Простой in-memory WebSocket-хаб для рассылки событий пользователям.

События идут через Redis pub/sub — так работает даже при нескольких uvicorn-воркерах.
Формат: JSON {"type": "...", "payload": {...}}. Комнаты — по user_id.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket

from .redis_client import get_redis

log = logging.getLogger("qadam.ws")

CHANNEL_PREFIX = "ws:user:"


class WSHub:
    def __init__(self) -> None:
        self._rooms: dict[int, set[WebSocket]] = {}
        self._lock = asyncio.Lock()
        self._listener_task: asyncio.Task | None = None
        self._pubsub = None

    async def connect(self, user_id: int, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._rooms.setdefault(user_id, set()).add(ws)
            await self._subscribe(user_id)

    async def disconnect(self, user_id: int, ws: WebSocket) -> None:
        async with self._lock:
            room = self._rooms.get(user_id)
            if room:
                room.discard(ws)
                if not room:
                    del self._rooms[user_id]

    async def _subscribe(self, user_id: int) -> None:
        if self._pubsub is None:
            r = get_redis()
            self._pubsub = r.pubsub(ignore_subscribe_messages=True)
        self._pubsub.subscribe(f"{CHANNEL_PREFIX}{user_id}")
        if self._listener_task is None or self._listener_task.done():
            self._listener_task = asyncio.create_task(self._listener_loop())

    async def _listener_loop(self) -> None:
        loop = asyncio.get_running_loop()
        try:
            while True:
                msg = await loop.run_in_executor(None, lambda: self._pubsub.get_message(timeout=1.0) if self._pubsub else None)
                if not msg:
                    await asyncio.sleep(0.05)
                    continue
                channel = msg.get("channel", "")
                if isinstance(channel, bytes):
                    channel = channel.decode()
                if not channel.startswith(CHANNEL_PREFIX):
                    continue
                try:
                    user_id = int(channel[len(CHANNEL_PREFIX):])
                except ValueError:
                    continue
                data = msg.get("data")
                await self._broadcast_local(user_id, data if isinstance(data, str) else str(data))
        except Exception:
            log.exception("ws listener loop failed")

    async def _broadcast_local(self, user_id: int, data: str) -> None:
        room = self._rooms.get(user_id)
        if not room:
            return
        dead: list[WebSocket] = []
        for ws in list(room):
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            room.discard(ws)


hub = WSHub()


def publish_to_user(user_id: int, event_type: str, payload: dict[str, Any] | None = None) -> None:
    """Публикация события — sync, из любого места кода (эндпоинт, фоновый воркер)."""
    try:
        get_redis().publish(f"{CHANNEL_PREFIX}{user_id}", json.dumps({"type": event_type, "payload": payload or {}}))
    except Exception:
        log.exception("publish_to_user failed")
