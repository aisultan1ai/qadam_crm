"""WebSocket-хаб с изоляцией по tenant.

События идут через Redis pub/sub. Каналы построены так, чтобы данные одного tenant'а
никогда не могли попасть подписчику другого:
    ws:tenant:{tenant_id}:user:{user_id}      — точечное сообщение конкретному юзеру
    ws:tenant:{tenant_id}:broadcast           — всем подписчикам tenant'а

Формат сообщения: JSON {"type": "...", "payload": {...}}.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket

from .redis_client import get_redis

log = logging.getLogger("qadam.ws")

USER_CHANNEL_PREFIX = "ws:tenant:"


def _user_channel(tenant_id: int, user_id: int) -> str:
    return f"ws:tenant:{tenant_id}:user:{user_id}"


def _broadcast_channel(tenant_id: int) -> str:
    return f"ws:tenant:{tenant_id}:broadcast"


def _messenger_channel(tenant_id: int, channel_id: int) -> str:
    return f"ws:tenant:{tenant_id}:channel:{channel_id}"


class WSHub:
    def __init__(self) -> None:
        # (tenant_id, user_id) -> set of websockets
        self._rooms: dict[tuple[int, int], set[WebSocket]] = {}
        # (tenant_id, channel_id) -> set of websockets — активные подписки на канал
        self._channel_rooms: dict[tuple[int, int], set[WebSocket]] = {}
        # ws -> set of (tenant_id, channel_id) — обратный индекс для очистки при disconnect
        self._ws_channels: dict[WebSocket, set[tuple[int, int]]] = {}
        self._lock = asyncio.Lock()
        self._listener_task: asyncio.Task | None = None
        self._pubsub = None

    async def connect(self, tenant_id: int, user_id: int, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._rooms.setdefault((tenant_id, user_id), set()).add(ws)
            self._ws_channels.setdefault(ws, set())
            await self._subscribe(tenant_id, user_id)

    async def disconnect(self, tenant_id: int, user_id: int, ws: WebSocket) -> None:
        async with self._lock:
            key = (tenant_id, user_id)
            room = self._rooms.get(key)
            if room:
                room.discard(ws)
                if not room:
                    del self._rooms[key]
            # Убираем сокет из всех каналов, к которым он был подписан.
            subs = self._ws_channels.pop(ws, set())
            for ck in subs:
                room = self._channel_rooms.get(ck)
                if room:
                    room.discard(ws)
                    if not room:
                        del self._channel_rooms[ck]

    async def subscribe_channel_ws(self, tenant_id: int, channel_id: int, ws: WebSocket) -> None:
        """Клиент открыл чат — подписываемся на события конкретного канала."""
        async with self._lock:
            key = (tenant_id, channel_id)
            self._channel_rooms.setdefault(key, set()).add(ws)
            self._ws_channels.setdefault(ws, set()).add(key)
            if self._pubsub is not None:
                try:
                    self._pubsub.subscribe(_messenger_channel(tenant_id, channel_id))
                except Exception:
                    log.exception("subscribe_channel_ws pubsub failed")

    async def unsubscribe_channel_ws(self, tenant_id: int, channel_id: int, ws: WebSocket) -> None:
        async with self._lock:
            key = (tenant_id, channel_id)
            room = self._channel_rooms.get(key)
            if room:
                room.discard(ws)
                if not room:
                    del self._channel_rooms[key]
            subs = self._ws_channels.get(ws)
            if subs:
                subs.discard(key)

    async def _subscribe(self, tenant_id: int, user_id: int) -> None:
        if self._pubsub is None:
            r = get_redis()
            self._pubsub = r.pubsub(ignore_subscribe_messages=True)
        self._pubsub.subscribe(_user_channel(tenant_id, user_id))
        self._pubsub.subscribe(_broadcast_channel(tenant_id))
        if self._listener_task is None or self._listener_task.done():
            self._listener_task = asyncio.create_task(self._listener_loop())

    async def subscribe_channel(self, tenant_id: int, channel_id: int) -> None:
        """Подписка на конкретный канал мессенджера (для активной вкладки чата)."""
        if self._pubsub is None:
            r = get_redis()
            self._pubsub = r.pubsub(ignore_subscribe_messages=True)
        self._pubsub.subscribe(_messenger_channel(tenant_id, channel_id))

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
                data = msg.get("data")
                text = data if isinstance(data, str) else str(data)
                await self._route(channel, text)
        except Exception:
            log.exception("ws listener loop failed")

    async def _route(self, channel: str, text: str) -> None:
        parts = channel.split(":")
        # ws:tenant:{tid}:user:{uid}
        if len(parts) == 5 and parts[3] == "user":
            try:
                tenant_id = int(parts[2])
                user_id = int(parts[4])
            except ValueError:
                return
            room = self._rooms.get((tenant_id, user_id))
            await self._send_all(room, text)
        # ws:tenant:{tid}:channel:{cid} — только подписанным на этот канал сокетам.
        elif len(parts) == 5 and parts[3] == "channel":
            try:
                tenant_id = int(parts[2])
                channel_id = int(parts[4])
            except ValueError:
                return
            room = self._channel_rooms.get((tenant_id, channel_id))
            await self._send_all(room, text)
        # ws:tenant:{tid}:broadcast
        elif len(parts) == 4 and parts[3] == "broadcast":
            try:
                tenant_id = int(parts[2])
            except ValueError:
                return
            for (t_id, _u_id), room in list(self._rooms.items()):
                if t_id == tenant_id:
                    await self._send_all(room, text)

    async def _send_all(self, room: set[WebSocket] | None, text: str) -> None:
        if not room:
            return
        dead: list[WebSocket] = []
        for ws in list(room):
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            room.discard(ws)


hub = WSHub()


def publish_to_user(tenant_id: int, user_id: int, event_type: str, payload: dict[str, Any] | None = None) -> None:
    """Точечное сообщение пользователю в контексте tenant'а."""
    try:
        get_redis().publish(
            _user_channel(tenant_id, user_id),
            json.dumps({"type": event_type, "payload": payload or {}}),
        )
    except Exception:
        log.exception("publish_to_user failed")


def publish_to_tenant(tenant_id: int, event_type: str, payload: dict[str, Any] | None = None) -> None:
    """Broadcast всем подписчикам tenant'а."""
    try:
        get_redis().publish(
            _broadcast_channel(tenant_id),
            json.dumps({"type": event_type, "payload": payload or {}}),
        )
    except Exception:
        log.exception("publish_to_tenant failed")


def publish_to_channel(tenant_id: int, channel_id: int, event_type: str, payload: dict[str, Any] | None = None) -> None:
    """Событие мессенджера в конкретный чат. Payload обязан содержать channel_id."""
    body = payload or {}
    body.setdefault("channel_id", channel_id)
    try:
        get_redis().publish(
            _messenger_channel(tenant_id, channel_id),
            json.dumps({"type": event_type, "payload": body}),
        )
    except Exception:
        log.exception("publish_to_channel failed")
