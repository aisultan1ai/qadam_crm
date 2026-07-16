from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Notification, User
from ..schemas.notification import NotificationOut
from ..schemas.common import Message, Page, PageParams, page_params, paginate
from .deps import get_current_user

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("", response_model=Page[NotificationOut])
def list_own(
    pagination: PageParams = Depends(page_params),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Notification).filter(Notification.user_id == user.id).order_by(Notification.created_at.desc())
    return paginate(query, pagination)


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_read(notification_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    n = db.get(Notification, notification_id)
    if not n or n.user_id != user.id:
        raise HTTPException(404, "Не найдено")
    n.is_read = True
    db.commit()
    db.refresh(n)
    return n


@router.post("/read-all", response_model=Message)
def mark_all(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(Notification).filter(Notification.user_id == user.id, Notification.is_read == False).update({"is_read": True})  # noqa: E712
    db.commit()
    return Message(message="Все уведомления отмечены прочитанными")
