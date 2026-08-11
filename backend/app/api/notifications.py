from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Notification
from ..schemas.notification import NotificationOut
from ..schemas.common import Message, Page, PageParams, page_params, paginate
from .deps import TenantContext, get_current_context

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("", response_model=Page[NotificationOut])
def list_own(
    pagination: PageParams = Depends(page_params),
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    query = (
        db.query(Notification)
        .filter(
            Notification.tenant_id == ctx.tenant.id,
            Notification.user_id == ctx.user.id,
        )
        .order_by(Notification.created_at.desc())
    )
    return paginate(query, pagination)


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_read(notification_id: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    n = db.get(Notification, notification_id)
    if not n or n.tenant_id != ctx.tenant.id or n.user_id != ctx.user.id:
        raise HTTPException(404, "Не найдено")
    n.is_read = True
    db.commit()
    db.refresh(n)
    return n


@router.post("/read-all", response_model=Message)
def mark_all(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    db.query(Notification).filter(
        Notification.tenant_id == ctx.tenant.id,
        Notification.user_id == ctx.user.id,
        Notification.is_read == False,  # noqa: E712
    ).update({"is_read": True})
    db.commit()
    return Message(message="Все уведомления отмечены прочитанными")
