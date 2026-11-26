"""«Все входящие»: одна лента из уведомлений, писем своего ящика и диалогов открытых линий.

Каждый источник берётся только если у сотрудника есть на него право (как в самих разделах):
уведомления — свои; почта — mail.use и только свой ящик; открытые линии — messengers.reply.
Всё — в пределах текущей компании.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, or_
from sqlalchemy.orm import Session

from ..core.permissions import user_has
from ..database import get_db
from ..models import MailThread, Mailbox, Notification
from ..models.messenger_channel import ExternalConversation
from .deps import TenantContext, get_current_context

router = APIRouter(prefix="/api/incoming", tags=["incoming"])

Source = Literal["all", "notifications", "mail", "clients"]


def _can(ctx: TenantContext, code: str) -> bool:
    return bool(ctx.membership.is_owner) or user_has(ctx.user, [code], tenant_id=ctx.tenant.id)


def _iso(v: Optional[datetime]) -> Optional[str]:
    return v.isoformat() if v else None


@router.get("")
def incoming(
    source: Source = "all",
    unread: bool = False,
    limit: int = Query(default=60, ge=1, le=200),
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    items: list[dict] = []
    sources = {"notifications": True, "mail": _can(ctx, "mail.use"), "clients": _can(ctx, "messengers.reply")}

    if source in ("all", "notifications"):
        now = datetime.now(timezone.utc)
        q = db.query(Notification).filter(
            Notification.tenant_id == ctx.tenant.id, Notification.user_id == ctx.user.id,
            or_(Notification.snoozed_until.is_(None), Notification.snoozed_until <= now),
        )
        if unread:
            q = q.filter(Notification.is_read.is_(False))
        for n in q.order_by(desc(Notification.created_at)).limit(limit).all():
            url = n.link if (n.link or "").startswith("/") else (f"/tasks/{n.task_id}" if n.task_id else "/notifications")
            items.append({
                "key": f"n{n.id}", "source": "notifications", "id": n.id, "title": n.title, "preview": n.body,
                "at": _iso(n.created_at), "unread": 0 if n.is_read else 1, "url": url,
            })

    if source in ("all", "mail") and sources["mail"]:
        mb = db.query(Mailbox).filter(Mailbox.tenant_id == ctx.tenant.id, Mailbox.user_id == ctx.user.id).first()
        if mb:
            q = db.query(MailThread).filter(
                MailThread.tenant_id == ctx.tenant.id, MailThread.mailbox_id == mb.id, MailThread.is_archived.is_(False),
            )
            if unread:
                q = q.filter(MailThread.unread_count > 0)
            for t in q.order_by(desc(MailThread.last_message_at)).limit(limit).all():
                items.append({
                    "key": f"m{t.id}", "source": "mail", "id": t.id, "title": t.subject or "(без темы)", "preview": None,
                    "at": _iso(t.last_message_at), "unread": t.unread_count or 0, "url": f"/mail?thread={t.id}",
                })

    if source in ("all", "clients") and sources["clients"]:
        q = db.query(ExternalConversation).filter(
            ExternalConversation.tenant_id == ctx.tenant.id, ExternalConversation.is_closed.is_(False),
        )
        if unread:
            q = q.filter(ExternalConversation.unread_count > 0)
        for c in q.order_by(desc(ExternalConversation.last_message_at)).limit(limit).all():
            contact = c.contact
            name = (contact.display_name or contact.username or contact.phone) if contact else None
            items.append({
                "key": f"c{c.id}", "source": "clients", "id": c.id, "title": name or f"Диалог #{c.id}",
                "preview": c.last_message_preview, "channel": c.channel.name if c.channel else None,
                "at": _iso(c.last_message_at), "unread": c.unread_count or 0, "url": f"/inbox?conversation={c.id}",
            })

    items.sort(key=lambda x: x["at"] or "", reverse=True)
    return {"items": items[:limit], "sources": sources}
