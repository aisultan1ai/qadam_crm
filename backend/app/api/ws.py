from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect, status
from jose import JWTError
from sqlalchemy.orm import Session

from ..config import settings
from ..core.security import decode_token, is_blacklisted, TOKEN_TYPE_ACCESS
from ..core.ws_hub import hub
from ..database import get_db
from ..models import Tenant, TenantMembership

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(
    ws: WebSocket,
    token: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    # 1) httpOnly cookie в приоритете (не попадает в access-логи), 2) query — фолбэк.
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
        tenant_id = payload.get("tid")
        if tenant_id is None:
            await ws.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        tenant_id = int(tenant_id)
    except (JWTError, TypeError, ValueError):
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # Проверяем, что юзер реально состоит в этом tenant'е — токен мог остаться,
    # а membership отозвали (owner удалил пользователя из компании).
    membership = (
        db.query(TenantMembership.id)
        .join(Tenant, Tenant.id == TenantMembership.tenant_id)
        .filter(
            TenantMembership.user_id == user_id,
            TenantMembership.tenant_id == tenant_id,
            Tenant.is_active.is_(True),
        )
        .first()
    )
    if not membership:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await hub.connect(tenant_id, user_id, ws)
    try:
        while True:
            msg = await ws.receive_text()
            if msg == "ping":
                await ws.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        pass
    finally:
        await hub.disconnect(tenant_id, user_id, ws)
