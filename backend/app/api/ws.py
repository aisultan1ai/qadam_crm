import time

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect, status
from jose import JWTError
from sqlalchemy.orm import Session

from ..config import settings
from ..core.security import decode_token, is_blacklisted, TOKEN_TYPE_ACCESS
from ..core.ws_hub import hub
from ..database import get_db
from ..models import Tenant, TenantMembership

router = APIRouter()

# Re-check membership не чаще чем раз в 60 секунд (по клиентскому ping).
MEMBERSHIP_RECHECK_SEC = 60


def _membership_active(db: Session, user_id: int, tenant_id: int) -> bool:
    return (
        db.query(TenantMembership.id)
        .join(Tenant, Tenant.id == TenantMembership.tenant_id)
        .filter(
            TenantMembership.user_id == user_id,
            TenantMembership.tenant_id == tenant_id,
            Tenant.is_active.is_(True),
        )
        .first()
        is not None
    )


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
    if not _membership_active(db, user_id, tenant_id):
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await hub.connect(tenant_id, user_id, ws)
    last_check = time.monotonic()
    try:
        while True:
            msg = await ws.receive_text()
            if msg == "ping":
                # Re-validate membership по ping'у, но не чаще MEMBERSHIP_RECHECK_SEC —
                # чтобы не бить БД на каждом пинге и не ловить события удалённого юзера.
                now = time.monotonic()
                if now - last_check >= MEMBERSHIP_RECHECK_SEC:
                    if not _membership_active(db, user_id, tenant_id) or is_blacklisted(payload.get("jti")):
                        await ws.send_text('{"type":"membership.revoked"}')
                        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
                        return
                    last_check = now
                await ws.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        pass
    finally:
        await hub.disconnect(tenant_id, user_id, ws)
