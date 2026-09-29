from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Notification
from ..schemas.notification import NotificationOut
from ..schemas.common import Message, Page, PageParams, page_params, paginate
from .deps import TenantContext, get_current_context

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

# «Входящие»: unread — непрочитанные, mentions — упоминания, snoozed — отложенные, all — всё (кроме отложенных).
Tab = Literal["all", "unread", "mentions", "snoozed"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _own(db: Session, ctx: TenantContext):
    return db.query(Notification).filter(
        Notification.tenant_id == ctx.tenant.id,
        Notification.user_id == ctx.user.id,
    )


def _not_snoozed(query):
    return query.filter(or_(Notification.snoozed_until.is_(None), Notification.snoozed_until <= _now()))


def _get_own(db: Session, ctx: TenantContext, notification_id: int) -> Notification:
    n = db.get(Notification, notification_id)
    if not n or n.tenant_id != ctx.tenant.id or n.user_id != ctx.user.id:
        raise HTTPException(404, "Не найдено")
    return n


@router.get("", response_model=Page[NotificationOut])
def list_own(
    tab: Tab = "all",
    pagination: PageParams = Depends(page_params),
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    query = _own(db, ctx)
    if tab == "snoozed":
        query = query.filter(Notification.snoozed_until > _now()).order_by(Notification.snoozed_until.asc())
        return paginate(query, pagination)
    query = _not_snoozed(query)
    if tab == "unread":
        query = query.filter(Notification.is_read == False)  # noqa: E712
    elif tab == "mentions":
        query = query.filter(Notification.kind == "mention")
    # Отложенное «всплывает» наверх в момент, когда срок откладывания прошёл.
    query = query.order_by(Notification.created_at.desc())
    return paginate(query, pagination)


@router.get("/unread-count")
def unread_count(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    q = _not_snoozed(_own(db, ctx))
    return {
        "unread": q.filter(Notification.is_read == False).count(),  # noqa: E712
        "mentions": q.filter(Notification.is_read == False, Notification.kind == "mention").count(),  # noqa: E712
    }


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_read(notification_id: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    n = _get_own(db, ctx, notification_id)
    n.is_read = True
    db.commit()
    db.refresh(n)
    return n


@router.post("/{notification_id}/unread", response_model=NotificationOut)
def mark_unread(notification_id: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    n = _get_own(db, ctx, notification_id)
    n.is_read = False
    db.commit()
    db.refresh(n)
    return n


class SnoozeIn(BaseModel):
    # None — вернуть сейчас.
    until: Optional[datetime] = None


@router.post("/{notification_id}/snooze", response_model=NotificationOut)
def snooze(notification_id: int, payload: SnoozeIn, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    n = _get_own(db, ctx, notification_id)
    until = payload.until
    if until is not None:
        if until.tzinfo is None:
            until = until.replace(tzinfo=timezone.utc)
        if until <= _now():
            raise HTTPException(400, "Время должно быть в будущем")
    n.snoozed_until = until
    # Когда отложенное вернётся, оно снова должно быть заметным.
    n.is_read = False
    db.commit()
    db.refresh(n)
    return n


@router.post("/read-all", response_model=Message)
def mark_all(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    _not_snoozed(_own(db, ctx)).filter(
        Notification.is_read == False,  # noqa: E712
    ).update({"is_read": True}, synchronize_session=False)
    db.commit()
    return Message(message="Все уведомления отмечены прочитанными")
