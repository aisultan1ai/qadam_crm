from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status
from jose import JWTError

from ..config import settings
from ..core.security import decode_token, is_blacklisted, TOKEN_TYPE_ACCESS
from ..core.ws_hub import hub

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: str | None = Query(default=None)):
    # 1) Приоритет — httpOnly cookie (безопаснее чем query, не попадает в access-логи).
    # 2) Query-параметр — фолбэк для клиентов, которые ещё не мигрировали.
    cookie_token = ws.cookies.get(settings.AUTH_COOKIE_NAME)
    auth_token = cookie_token or token

    if not auth_token:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        payload = decode_token(auth_token)
        if payload.get("typ") not in (None, TOKEN_TYPE_ACCESS):
            await ws.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        if is_blacklisted(payload.get("jti")):
            await ws.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        user_id = int(payload.get("sub"))
    except (JWTError, TypeError, ValueError):
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await hub.connect(user_id, ws)
    try:
        while True:
            # держим соединение открытым; клиент может слать ping "ping"
            msg = await ws.receive_text()
            if msg == "ping":
                await ws.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        pass
    finally:
        await hub.disconnect(user_id, ws)
