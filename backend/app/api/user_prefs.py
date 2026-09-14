from fastapi import APIRouter, Depends, HTTPException, Request
from jose import JWTError
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime, timezone
from pydantic import BaseModel, ConfigDict

from ..config import settings
from ..core.security import decode_token
from ..database import get_db
from ..models import UserSession, UserNotificationPref, LinkedAccount
from .deps import TenantContext, get_current_context


router = APIRouter(prefix="/api/me", tags=["me-prefs"])


# =============================================================================
# Sessions
# =============================================================================

class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_agent: Optional[str] = None
    ip_address: Optional[str] = None
    created_at: datetime
    last_seen_at: datetime
    expires_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None
    is_current: bool = False


def _current_sid(request: Request) -> Optional[int]:
    """Достаёт sid из access-cookie/Bearer — чтобы отметить в списке текущую сессию."""
    tok = request.cookies.get(settings.AUTH_COOKIE_NAME)
    if not tok:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.lower().startswith("bearer "):
            tok = auth_header[7:]
    if not tok:
        return None
    try:
        data = decode_token(tok)
    except JWTError:
        return None
    sid = data.get("sid")
    return int(sid) if sid is not None else None


@router.get("/sessions", response_model=list[SessionOut])
def list_sessions(
    request: Request,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    """Активные сессии пользователя. Показываем всё за 30 дней, включая отозванные —
    UI отрисует revoked серым. Текущая помечается is_current=True.
    """
    cur_sid = _current_sid(request)
    rows = (
        db.query(UserSession)
        .filter(UserSession.user_id == ctx.user.id)
        .order_by(UserSession.last_seen_at.desc())
        .limit(50)
        .all()
    )
    out: list[SessionOut] = []
    for r in rows:
        item = SessionOut.model_validate(r)
        item.is_current = cur_sid is not None and r.id == cur_sid
        out.append(item)
    return out


@router.post("/sessions/{sid}/revoke")
def revoke_session(
    sid: int,
    request: Request,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    """Отзывает конкретную сессию. Отозвать текущую разрешаем — это эквивалент logout."""
    row = db.get(UserSession, sid)
    if not row or row.user_id != ctx.user.id:
        raise HTTPException(404, "Сессия не найдена")
    if row.revoked_at is None:
        row.revoked_at = datetime.now(timezone.utc)
        db.commit()
    return {"message": "Сессия отозвана"}


@router.post("/sessions/revoke-others")
def revoke_other_sessions(
    request: Request,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    """Отзывает все сессии пользователя, КРОМЕ текущей. Полезно если авторизовались
    на чужом устройстве — одним нажатием выкидываем всех, но остаёмся здесь.
    """
    cur_sid = _current_sid(request)
    now = datetime.now(timezone.utc)
    q = (
        db.query(UserSession)
        .filter(
            UserSession.user_id == ctx.user.id,
            UserSession.revoked_at.is_(None),
        )
    )
    if cur_sid is not None:
        q = q.filter(UserSession.id != cur_sid)
    count = 0
    for row in q.all():
        row.revoked_at = now
        count += 1
    db.commit()
    return {"message": f"Отозвано сессий: {count}", "revoked": count}


# =============================================================================
# Notification preferences
# =============================================================================

DEFAULT_KINDS = [
    ("task_assigned", "Мне назначили задачу"),
    ("task_status", "Изменение статуса моих задач"),
    ("comment_mention", "Меня упомянули в комментарии"),
    ("deadline_soon", "Дедлайн скоро наступит"),
    ("deal_won", "Сделка успешно закрыта"),
    ("timeoff_approved", "Заявка на отпуск одобрена"),
]


class PrefOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    kind: str
    label: str
    inapp: bool
    email: bool
    push: bool


class PrefUpdate(BaseModel):
    kind: str
    inapp: Optional[bool] = None
    email: Optional[bool] = None
    push: Optional[bool] = None


@router.get("/notification-prefs", response_model=list[PrefOut])
def list_prefs(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    existing = {
        p.kind: p
        for p in db.query(UserNotificationPref).filter(
            UserNotificationPref.user_id == ctx.user.id,
            UserNotificationPref.tenant_id == ctx.tenant.id,
        ).all()
    }
    out = []
    for kind, label in DEFAULT_KINDS:
        p = existing.get(kind)
        out.append(PrefOut(
            kind=kind,
            label=label,
            inapp=p.inapp if p else True,
            email=p.email if p else False,
            push=p.push if p else False,
        ))
    return out


@router.patch("/notification-prefs")
def update_pref(payload: PrefUpdate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    p = (
        db.query(UserNotificationPref)
        .filter(
            UserNotificationPref.user_id == ctx.user.id,
            UserNotificationPref.tenant_id == ctx.tenant.id,
            UserNotificationPref.kind == payload.kind,
        )
        .first()
    )
    if not p:
        p = UserNotificationPref(user_id=ctx.user.id, tenant_id=ctx.tenant.id, kind=payload.kind)
        db.add(p)
    if payload.inapp is not None:
        p.inapp = payload.inapp
    if payload.email is not None:
        p.email = payload.email
    if payload.push is not None:
        p.push = payload.push
    db.commit()
    return {"message": "Сохранено"}


# =============================================================================
# Linked accounts
# =============================================================================

class LinkedOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    provider: str
    external_id: str
    display_name: Optional[str] = None
    email: Optional[str] = None
    created_at: datetime


@router.get("/linked-accounts", response_model=list[LinkedOut])
def list_linked(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    return db.query(LinkedAccount).filter(LinkedAccount.user_id == ctx.user.id).all()


@router.delete("/linked-accounts/{lid}")
def unlink(lid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(LinkedAccount, lid)
    if not row or row.user_id != ctx.user.id:
        raise HTTPException(404, "Привязка не найдена")
    db.delete(row)
    db.commit()
    return {"message": "Привязка удалена"}
