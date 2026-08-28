"""API email: mailbox per-user (CRUD/test), thread + messages, reply/new, link-lead/task.

Права:
- `mail.use` — свой mailbox + inbox
- `mail.manage_all` — админ видит все mailbox'ы tenant'а (не покрывается тут, оставлено на будущее)
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from ..core.secrets import decrypt, encrypt
from ..database import get_db
from ..models import (
    Mailbox, MailAttachment, MailDirection, MailMessage, MailStatus, MailThread,
    TenantLead, Task,
)
from ..schemas.common import Message
from ..services.mail.smtp_sender import send_new, send_reply, test_imap, test_smtp
from ..services.mail.threading import normalize_subject
from .deps import TenantContext, get_current_context, log_action, require

log = logging.getLogger("qadam.mail.api")

router = APIRouter(prefix="/api/mail", tags=["mail"])


# =============================================================================
# Schemas
# =============================================================================


class MailboxIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    reply_to_name: Optional[str] = Field(default=None, max_length=200)
    imap_host: str = Field(min_length=1, max_length=200)
    imap_port: int = Field(default=993, ge=1, le=65535)
    imap_ssl: bool = True
    imap_user: str = Field(min_length=1, max_length=200)
    imap_password: Optional[str] = Field(default=None, max_length=500)  # None → не менять
    imap_folder: str = Field(default="INBOX", max_length=100)
    smtp_host: str = Field(min_length=1, max_length=200)
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_tls: bool = True
    smtp_user: str = Field(min_length=1, max_length=200)
    smtp_password: Optional[str] = Field(default=None, max_length=500)
    is_active: bool = True
    sync_interval_sec: int = Field(default=120, ge=30, le=3600)


class ReplyBody(BaseModel):
    body_text: Optional[str] = Field(default=None, max_length=100_000)
    body_html: Optional[str] = Field(default=None, max_length=200_000)
    to: Optional[list[EmailStr]] = None
    cc: Optional[list[EmailStr]] = None


class NewMessageBody(BaseModel):
    subject: str = Field(min_length=1, max_length=500)
    to: list[EmailStr] = Field(min_length=1)
    cc: Optional[list[EmailStr]] = None
    body_text: Optional[str] = Field(default=None, max_length=100_000)
    body_html: Optional[str] = Field(default=None, max_length=200_000)


class LinkBody(BaseModel):
    lead_id: Optional[int] = None
    task_id: Optional[int] = None


# =============================================================================
# Serialization
# =============================================================================


def _mailbox_out(mb: Mailbox) -> dict:
    return {
        "id": mb.id,
        "name": mb.name,
        "email": mb.email,
        "reply_to_name": mb.reply_to_name,
        "imap_host": mb.imap_host,
        "imap_port": mb.imap_port,
        "imap_ssl": mb.imap_ssl,
        "imap_user": mb.imap_user,
        "imap_password_set": bool(mb.imap_password_enc),
        "imap_folder": mb.imap_folder,
        "smtp_host": mb.smtp_host,
        "smtp_port": mb.smtp_port,
        "smtp_tls": mb.smtp_tls,
        "smtp_user": mb.smtp_user,
        "smtp_password_set": bool(mb.smtp_password_enc),
        "is_active": mb.is_active,
        "sync_interval_sec": mb.sync_interval_sec,
        "last_sync_at": mb.last_sync_at.isoformat() if mb.last_sync_at else None,
        "last_error": mb.last_error,
        "last_seen_uid": mb.last_seen_uid,
    }


def _thread_out(t: MailThread) -> dict:
    return {
        "id": t.id,
        "mailbox_id": t.mailbox_id,
        "subject": t.subject,
        "participants": t.participants or {},
        "linked_lead_id": t.linked_lead_id,
        "linked_task_id": t.linked_task_id,
        "first_message_at": t.first_message_at.isoformat() if t.first_message_at else None,
        "last_message_at": t.last_message_at.isoformat() if t.last_message_at else None,
        "last_message_preview": t.last_message_preview,
        "unread_count": t.unread_count,
        "total_count": t.total_count,
        "is_archived": t.is_archived,
    }


def _msg_out(m: MailMessage) -> dict:
    return {
        "id": m.id,
        "thread_id": m.thread_id,
        "direction": m.direction.value if hasattr(m.direction, "value") else m.direction,
        "status": m.status.value if hasattr(m.status, "value") else m.status,
        "message_id": m.message_id,
        "from_addr": m.from_addr,
        "from_name": m.from_name,
        "to_addrs": m.to_addrs or [],
        "cc_addrs": m.cc_addrs or [],
        "subject": m.subject,
        "body_text": m.body_text,
        "body_html": m.body_html,
        "is_read": m.is_read,
        "error": m.error,
        "sent_at": m.sent_at.isoformat() if m.sent_at else None,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "attachments": [
            {"id": a.id, "filename": a.filename, "content_type": a.content_type, "size": a.size}
            for a in (m.attachments or [])
        ],
    }


def _my_mailbox(db: Session, ctx: TenantContext) -> Optional[Mailbox]:
    return (
        db.query(Mailbox)
        .filter(Mailbox.tenant_id == ctx.tenant.id, Mailbox.user_id == ctx.user.id)
        .first()
    )


# =============================================================================
# Mailbox CRUD (per user)
# =============================================================================


@router.get("/mailboxes/me")
def get_my_mailbox(
    ctx: TenantContext = Depends(require("mail.use")),
    db: Session = Depends(get_db),
):
    mb = _my_mailbox(db, ctx)
    if not mb:
        return None
    return _mailbox_out(mb)


@router.put("/mailboxes/me")
def upsert_my_mailbox(
    payload: MailboxIn,
    ctx: TenantContext = Depends(require("mail.use")),
    db: Session = Depends(get_db),
):
    mb = _my_mailbox(db, ctx)
    is_new = mb is None
    if is_new:
        mb = Mailbox(tenant_id=ctx.tenant.id, user_id=ctx.user.id)
        db.add(mb)
    mb.name = payload.name.strip()
    mb.email = payload.email
    mb.reply_to_name = payload.reply_to_name
    mb.imap_host = payload.imap_host.strip()
    mb.imap_port = payload.imap_port
    mb.imap_ssl = payload.imap_ssl
    mb.imap_user = payload.imap_user.strip()
    if payload.imap_password is not None and payload.imap_password != "":
        mb.imap_password_enc = encrypt(payload.imap_password)
    mb.imap_folder = payload.imap_folder or "INBOX"
    mb.smtp_host = payload.smtp_host.strip()
    mb.smtp_port = payload.smtp_port
    mb.smtp_tls = payload.smtp_tls
    mb.smtp_user = payload.smtp_user.strip()
    if payload.smtp_password is not None and payload.smtp_password != "":
        mb.smtp_password_enc = encrypt(payload.smtp_password)
    mb.is_active = payload.is_active
    mb.sync_interval_sec = payload.sync_interval_sec

    log_action(
        db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
        action="create" if is_new else "update", entity="mailbox",
        entity_id=None, detail=mb.email,
    )
    db.commit()
    db.refresh(mb)
    return _mailbox_out(mb)


@router.delete("/mailboxes/me", response_model=Message)
def delete_my_mailbox(
    ctx: TenantContext = Depends(require("mail.use")),
    db: Session = Depends(get_db),
):
    mb = _my_mailbox(db, ctx)
    if not mb:
        raise HTTPException(404, "Mailbox не настроен")
    db.delete(mb)
    db.commit()
    return Message(message="Mailbox удалён")


@router.post("/mailboxes/me/test")
def test_my_mailbox(
    ctx: TenantContext = Depends(require("mail.use")),
    db: Session = Depends(get_db),
):
    mb = _my_mailbox(db, ctx)
    if not mb:
        raise HTTPException(404, "Настройте mailbox сначала")
    imap_pw = decrypt(mb.imap_password_enc)
    smtp_pw = decrypt(mb.smtp_password_enc)
    if not imap_pw or not smtp_pw:
        raise HTTPException(400, "Пароли не заданы или не расшифрованы")
    imap_result = test_imap(mb, imap_pw)
    smtp_result = test_smtp(mb, smtp_pw)
    ok = imap_result.get("ok") and smtp_result.get("ok")
    mb.last_error = None if ok else str({**imap_result, **smtp_result})[:2000]
    db.commit()
    return {"ok": ok, "imap": imap_result, "smtp": smtp_result}


@router.post("/mailboxes/me/sync-now")
def sync_now(
    ctx: TenantContext = Depends(require("mail.use")),
    db: Session = Depends(get_db),
):
    mb = _my_mailbox(db, ctx)
    if not mb:
        raise HTTPException(404, "Mailbox не настроен")
    from ..tasks.mail import sync_mailbox_task
    r = sync_mailbox_task.delay(mailbox_id=mb.id)
    return {"job_id": r.id, "queued": True}


# =============================================================================
# Threads
# =============================================================================


@router.get("/threads")
def list_threads(
    q: Optional[str] = None,
    linked_lead_id: Optional[int] = None,
    is_archived: Optional[bool] = None,
    only_unread: Optional[bool] = None,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    ctx: TenantContext = Depends(require("mail.use")),
    db: Session = Depends(get_db),
):
    mb = _my_mailbox(db, ctx)
    if not mb:
        return {"items": [], "total": 0, "page": page, "per_page": per_page, "pages": 0}

    query = (
        db.query(MailThread)
        .filter(MailThread.tenant_id == ctx.tenant.id, MailThread.mailbox_id == mb.id)
    )
    if linked_lead_id:
        query = query.filter(MailThread.linked_lead_id == linked_lead_id)
    if is_archived is not None:
        query = query.filter(MailThread.is_archived == is_archived)
    if only_unread:
        query = query.filter(MailThread.unread_count > 0)
    if q:
        like = f"%{q.strip().lower()}%"
        query = query.filter(func.lower(MailThread.subject).like(like))

    total = query.with_entities(func.count(MailThread.id)).scalar() or 0
    rows = (
        query.order_by(desc(MailThread.last_message_at))
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    return {
        "items": [_thread_out(t) for t in rows],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page if per_page else 1,
    }


def _load_thread(db: Session, ctx: TenantContext, thread_id: int) -> MailThread:
    t = db.get(MailThread, thread_id)
    if not t or t.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Thread не найден")
    mb = _my_mailbox(db, ctx)
    if not mb or t.mailbox_id != mb.id:
        raise HTTPException(403, "Thread не в вашем mailbox'е")
    return t


@router.get("/threads/{thread_id}")
def get_thread(
    thread_id: int,
    ctx: TenantContext = Depends(require("mail.use")),
    db: Session = Depends(get_db),
):
    return _thread_out(_load_thread(db, ctx, thread_id))


@router.get("/threads/{thread_id}/messages")
def list_thread_messages(
    thread_id: int,
    ctx: TenantContext = Depends(require("mail.use")),
    db: Session = Depends(get_db),
):
    _load_thread(db, ctx, thread_id)
    rows = (
        db.query(MailMessage)
        .filter(MailMessage.thread_id == thread_id)
        .order_by(MailMessage.sent_at.asc().nullslast(), MailMessage.id.asc())
        .all()
    )
    return [_msg_out(m) for m in rows]


@router.post("/threads/{thread_id}/read")
def mark_thread_read(
    thread_id: int,
    ctx: TenantContext = Depends(require("mail.use")),
    db: Session = Depends(get_db),
):
    t = _load_thread(db, ctx, thread_id)
    db.query(MailMessage).filter(
        MailMessage.thread_id == t.id, MailMessage.is_read.is_(False),
    ).update({"is_read": True}, synchronize_session=False)
    t.unread_count = 0
    db.commit()
    return {"ok": True}


@router.post("/threads/{thread_id}/archive")
def archive_thread(
    thread_id: int,
    ctx: TenantContext = Depends(require("mail.use")),
    db: Session = Depends(get_db),
):
    t = _load_thread(db, ctx, thread_id)
    t.is_archived = not t.is_archived
    db.commit()
    return _thread_out(t)


@router.post("/threads/{thread_id}/reply", status_code=201)
def reply_to_thread(
    thread_id: int,
    payload: ReplyBody,
    ctx: TenantContext = Depends(require("mail.use")),
    db: Session = Depends(get_db),
):
    if not (payload.body_text or payload.body_html):
        raise HTTPException(400, "body_text или body_html обязателен")
    t = _load_thread(db, ctx, thread_id)
    mb = _my_mailbox(db, ctx)
    m = send_reply(
        db=db, mb=mb, thread=t,
        body_text=payload.body_text, body_html=payload.body_html,
        to_override=payload.to, cc=payload.cc,
    )
    log_action(
        db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
        action="reply", entity="mail_message", entity_id=m.id, detail=f"thread={t.id}",
    )
    db.commit()
    db.refresh(m)
    return _msg_out(m)


@router.post("/messages", status_code=201)
def send_new_message(
    payload: NewMessageBody,
    ctx: TenantContext = Depends(require("mail.use")),
    db: Session = Depends(get_db),
):
    if not (payload.body_text or payload.body_html):
        raise HTTPException(400, "body_text или body_html обязателен")
    mb = _my_mailbox(db, ctx)
    if not mb:
        raise HTTPException(400, "Настройте mailbox в Настройки → Почта")
    m = send_new(
        db=db, mb=mb, subject=payload.subject,
        body_text=payload.body_text, body_html=payload.body_html,
        to_addrs=list(payload.to), cc_addrs=list(payload.cc or []),
    )
    log_action(
        db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
        action="send", entity="mail_message", entity_id=m.id, detail=f"to={payload.to}",
    )
    db.commit()
    db.refresh(m)
    return _msg_out(m)


@router.post("/threads/{thread_id}/link")
def link_thread(
    thread_id: int,
    payload: LinkBody,
    ctx: TenantContext = Depends(require("mail.use")),
    db: Session = Depends(get_db),
):
    t = _load_thread(db, ctx, thread_id)
    if payload.lead_id is not None:
        if payload.lead_id == 0:
            t.linked_lead_id = None
        else:
            lead = db.get(TenantLead, payload.lead_id)
            if not lead or lead.tenant_id != ctx.tenant.id:
                raise HTTPException(404, "Лид не найден")
            t.linked_lead_id = lead.id
    if payload.task_id is not None:
        if payload.task_id == 0:
            t.linked_task_id = None
        else:
            task = db.get(Task, payload.task_id)
            if not task or task.tenant_id != ctx.tenant.id:
                raise HTTPException(404, "Задача не найдена")
            t.linked_task_id = task.id
    db.commit()
    return _thread_out(t)
