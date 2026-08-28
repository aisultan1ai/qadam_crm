"""SMTP-отправка исходящих писем с учётом threading.

Собирает MIME с multipart/alternative (text+html) и attachments,
подставляет In-Reply-To/References из последнего сообщения треда для
корректного grouping'а у получателя.
"""
from __future__ import annotations

import logging
import mimetypes
import smtplib
import uuid
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid
from pathlib import Path
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from ...config import settings
from ...core.secrets import decrypt
from ...core.ws_hub import publish_to_tenant
from ...models import Mailbox, MailAttachment, MailDirection, MailMessage, MailStatus, MailThread
from .threading import merge_participants, normalize_subject

log = logging.getLogger("qadam.mail.smtp")


def _resolve_from(mb: Mailbox) -> str:
    display = mb.reply_to_name or mb.name or mb.email
    return formataddr((display, mb.email))


def _last_in_thread(db: Session, thread_id: int) -> Optional[MailMessage]:
    return (
        db.query(MailMessage)
        .filter(MailMessage.thread_id == thread_id)
        .order_by(MailMessage.id.desc())
        .first()
    )


def send_reply(
    db: Session,
    mb: Mailbox,
    thread: MailThread,
    body_text: Optional[str],
    body_html: Optional[str],
    to_override: Optional[list[str]] = None,
    cc: Optional[list[str]] = None,
    attachments: Optional[list[dict]] = None,
) -> MailMessage:
    """Отправляет ответ в существующий тред. attachments: list of {filename, path, content_type}."""
    last = _last_in_thread(db, thread.id)
    subject = thread.subject or "(без темы)"
    if last and last.subject and not subject.lower().startswith("re:"):
        base = last.subject
        if not base.lower().startswith("re:"):
            subject = f"Re: {base}"
        else:
            subject = base
    to_list = to_override or _reply_recipients(mb, last)
    return _send_and_persist(
        db, mb, thread, subject=subject, body_text=body_text, body_html=body_html,
        to_addrs=to_list, cc_addrs=cc or [], attachments=attachments or [],
        in_reply_to=last.message_id if last else None,
        references=_build_references_header(last),
    )


def send_new(
    db: Session,
    mb: Mailbox,
    subject: str,
    body_text: Optional[str],
    body_html: Optional[str],
    to_addrs: list[str],
    cc_addrs: Optional[list[str]] = None,
    attachments: Optional[list[dict]] = None,
) -> MailMessage:
    """Создаёт новый тред и отправляет письмо."""
    thread = MailThread(
        tenant_id=mb.tenant_id,
        mailbox_id=mb.id,
        subject=subject,
        normalized_subject=normalize_subject(subject),
        participants={"from": [mb.email], "to": to_addrs, "cc": cc_addrs or []},
        first_message_at=datetime.now(timezone.utc),
    )
    db.add(thread)
    db.flush()
    return _send_and_persist(
        db, mb, thread, subject=subject, body_text=body_text, body_html=body_html,
        to_addrs=to_addrs, cc_addrs=cc_addrs or [], attachments=attachments or [],
        in_reply_to=None, references=None,
    )


def _reply_recipients(mb: Mailbox, last: Optional[MailMessage]) -> list[str]:
    if not last:
        return []
    if last.direction == MailDirection.inbound:
        # Отвечаем отправителю
        return [last.from_addr]
    # Отвечаем на своё же исходящее — берём кому оно шло (обычно клиент)
    to = list(last.to_addrs or [])
    return [addr for addr in to if addr and addr.lower() != mb.email.lower()]


def _build_references_header(last: Optional[MailMessage]) -> Optional[str]:
    if not last:
        return None
    parts: list[str] = []
    if last.references:
        parts.append(last.references)
    if last.message_id:
        parts.append(f"<{last.message_id}>")
    return " ".join(parts) if parts else None


def _send_and_persist(
    db: Session,
    mb: Mailbox,
    thread: MailThread,
    subject: str,
    body_text: Optional[str],
    body_html: Optional[str],
    to_addrs: list[str],
    cc_addrs: list[str],
    attachments: list[dict],
    in_reply_to: Optional[str],
    references: Optional[str],
) -> MailMessage:
    now = datetime.now(timezone.utc)
    msg_id_full = make_msgid(domain=mb.email.split("@", 1)[-1] or "qadam.crm")
    msg_id_short = msg_id_full.strip("<>")

    m = MailMessage(
        tenant_id=mb.tenant_id,
        mailbox_id=mb.id,
        thread_id=thread.id,
        direction=MailDirection.outbound,
        status=MailStatus.pending,
        message_id=msg_id_short[:500],
        in_reply_to=(in_reply_to or "")[:500] or None,
        references=references,
        from_addr=mb.email,
        from_name=mb.reply_to_name or mb.name,
        to_addrs=to_addrs,
        cc_addrs=cc_addrs,
        subject=subject[:500],
        body_text=body_text or None,
        body_html=body_html or None,
        is_read=True,
        sent_at=now,
    )
    db.add(m)
    db.flush()

    # Собираем MIME
    email_msg = EmailMessage()
    email_msg["From"] = _resolve_from(mb)
    email_msg["To"] = ", ".join(to_addrs)
    if cc_addrs:
        email_msg["Cc"] = ", ".join(cc_addrs)
    email_msg["Subject"] = subject
    email_msg["Date"] = formatdate(now.timestamp(), localtime=False)
    email_msg["Message-ID"] = msg_id_full
    if in_reply_to:
        email_msg["In-Reply-To"] = f"<{in_reply_to}>"
    if references:
        email_msg["References"] = references

    if body_html:
        email_msg.set_content(body_text or _strip_html(body_html))
        email_msg.add_alternative(body_html, subtype="html")
    else:
        email_msg.set_content(body_text or "")

    for att in attachments:
        path = Path(settings.UPLOAD_DIR) / att["path"]
        if not path.exists():
            log.warning("attachment file missing: %s", path)
            continue
        mime, _ = mimetypes.guess_type(att["filename"])
        maintype, subtype = (mime or "application/octet-stream").split("/", 1)
        data = path.read_bytes()
        email_msg.add_attachment(
            data, maintype=maintype, subtype=subtype, filename=att["filename"],
        )
        db.add(MailAttachment(
            tenant_id=mb.tenant_id,
            message_id=m.id,
            filename=att["filename"],
            content_type=mime,
            size=len(data),
            stored_path=att["path"],
        ))

    # Отправляем
    smtp_password = decrypt(mb.smtp_password_enc)
    try:
        client = _smtp_connect(mb, smtp_password)
        try:
            if smtp_password:
                client.login(mb.smtp_user, smtp_password)
            client.send_message(email_msg)
        finally:
            try:
                client.quit()
            except Exception:
                pass
        m.status = MailStatus.sent
    except Exception as exc:
        log.exception("SMTP send failed mailbox=%s", mb.id)
        m.status = MailStatus.failed
        m.error = str(exc)[:2000]

    # Обновляем thread
    thread.participants = merge_participants(thread.participants or {}, {
        "from": [mb.email], "to": to_addrs, "cc": cc_addrs,
    })
    thread.total_count = (thread.total_count or 0) + 1
    thread.last_message_at = now
    preview = (body_text or _strip_html(body_html or "")).strip().split("\n", 1)[0][:200] or subject[:200]
    thread.last_message_preview = preview or None

    publish_to_tenant(
        mb.tenant_id,
        "mail.new",
        {
            "mailbox_id": mb.id,
            "thread_id": thread.id,
            "message_id": m.id,
            "direction": "outbound",
            "from": mb.email,
            "subject": subject,
        },
    )
    return m


def _strip_html(html: str) -> str:
    """Простая замена <br>/<p> на \n + удаление тегов. Не для XSS-защиты, только preview."""
    import re
    text = re.sub(r"<(br|/p|/div)[^>]*>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return text.strip()


def _smtp_connect(mb: Mailbox, password: Optional[str]) -> smtplib.SMTP:
    """Выбирает правильный режим подключения по mb.smtp_tls и порту.

    - smtp_tls=True: plain connect + STARTTLS (обычно 587)
    - smtp_tls=False + port 465: SMTP_SSL с самого начала
    - smtp_tls=False + другой порт (25/1025): plain SMTP без шифрования (dev/интранет)
    """
    if mb.smtp_tls:
        client = smtplib.SMTP(mb.smtp_host, mb.smtp_port, timeout=30)
        client.ehlo()
        client.starttls()
        client.ehlo()
        return client
    if mb.smtp_port == 465:
        return smtplib.SMTP_SSL(mb.smtp_host, mb.smtp_port, timeout=30)
    # Plain SMTP — например MailHog:1025 или локальный relay
    client = smtplib.SMTP(mb.smtp_host, mb.smtp_port, timeout=30)
    client.ehlo()
    return client


def test_smtp(mb: Mailbox, password: str) -> dict:
    """Просто пробует подключиться и авторизоваться без отправки."""
    try:
        client = _smtp_connect(mb, password)
        try:
            # AUTH не всегда требуется (MailHog, локальные relay) — если ошибка «unsupported» — считаем OK.
            if password:
                try:
                    client.login(mb.smtp_user, password)
                except smtplib.SMTPNotSupportedError:
                    pass
        finally:
            try:
                client.quit()
            except Exception:
                pass
        return {"ok": True, "smtp": "connected"}
    except Exception as exc:
        return {"ok": False, "smtp_error": str(exc)}


def test_imap(mb: Mailbox, password: str) -> dict:
    from imapclient import IMAPClient
    try:
        with IMAPClient(mb.imap_host, port=mb.imap_port, ssl=mb.imap_ssl, timeout=15) as client:
            client.login(mb.imap_user, password)
            folders = [f[-1] for f in client.list_folders() if f]
        return {"ok": True, "imap": "connected", "folders": folders[:20]}
    except Exception as exc:
        return {"ok": False, "imap_error": str(exc)}
