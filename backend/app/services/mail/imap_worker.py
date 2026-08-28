"""IMAP-синхронизация: подключение по IMAP4 SSL, инкрементальный fetch новых писем,
парсинг MIME, сохранение MailMessage + MailAttachment.

Стратегия синхронизации:
- Для нового mailbox (last_seen_uid=NULL) — берём последние 20 писем (чтобы не тянуть архив)
- Для существующего — SEARCH UID {last_seen_uid+1}:*  → все новые
- IDLE-режим не используется тут (сложнее в Celery); polling каждые sync_interval_sec
- Читаем в контейнере через docker-mailhog для тестов
"""
from __future__ import annotations

import email
import logging
import uuid
from datetime import datetime, timezone
from email.header import decode_header, make_header
from email.message import Message as EmailMsg
from email.utils import getaddresses, parseaddr, parsedate_to_datetime
from pathlib import Path
from typing import Iterable, Optional

from imapclient import IMAPClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...config import settings
from ...core.events import fire_event
from ...core.secrets import decrypt
from ...core.ws_hub import publish_to_tenant
from ...database import SessionLocal
from ...models import Mailbox, MailAttachment, MailDirection, MailMessage, MailStatus, MailThread
from .threading import find_thread, merge_participants, normalize_subject

log = logging.getLogger("qadam.mail.imap")

MAX_INITIAL_MESSAGES = 20
FETCH_BATCH = 20
MAX_BODY_BYTES = 5 * 1024 * 1024
MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024


def _decode(value: Optional[str]) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def _split_addresses(header_value: Optional[str]) -> list[str]:
    if not header_value:
        return []
    result = []
    for _name, addr in getaddresses([header_value]):
        if addr:
            result.append(addr.lower())
    return result


def _extract_body(msg: EmailMsg) -> tuple[str, str]:
    """Возвращает (plain_text, html)."""
    text = ""
    html = ""
    if msg.is_multipart():
        for part in msg.walk():
            cd = str(part.get("Content-Disposition") or "").lower()
            if "attachment" in cd:
                continue
            ctype = part.get_content_type()
            if ctype == "text/plain" and not text:
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    try:
                        text = payload.decode(charset, errors="replace")[:MAX_BODY_BYTES]
                    except LookupError:
                        text = payload.decode("utf-8", errors="replace")[:MAX_BODY_BYTES]
            elif ctype == "text/html" and not html:
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    try:
                        html = payload.decode(charset, errors="replace")[:MAX_BODY_BYTES]
                    except LookupError:
                        html = payload.decode("utf-8", errors="replace")[:MAX_BODY_BYTES]
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            try:
                body = payload.decode(charset, errors="replace")[:MAX_BODY_BYTES]
            except LookupError:
                body = payload.decode("utf-8", errors="replace")[:MAX_BODY_BYTES]
            if msg.get_content_type() == "text/html":
                html = body
            else:
                text = body
    return text, html


def _extract_attachments(msg: EmailMsg) -> list[dict]:
    """Возвращает список dict с filename/content_type/content(bytes)/content_id."""
    result = []
    if not msg.is_multipart():
        return result
    for part in msg.walk():
        cd = str(part.get("Content-Disposition") or "").lower()
        if "attachment" not in cd and not part.get_filename():
            continue
        filename = _decode(part.get_filename() or "attachment.bin")
        payload = part.get_payload(decode=True)
        if not payload:
            continue
        if len(payload) > MAX_ATTACHMENT_BYTES:
            log.warning("mail: attachment %s too large (%d bytes) — skip", filename, len(payload))
            continue
        result.append({
            "filename": filename[:500],
            "content_type": part.get_content_type(),
            "size": len(payload),
            "content": payload,
            "content_id": (part.get("Content-ID") or "").strip("<>") or None,
        })
    return result


def _save_attachment(
    tenant_id: int, mailbox_id: int, msg_pk: int, filename: str, content: bytes,
) -> str:
    """Сохраняет вложение в uploads/{tenant}/mail/{mailbox}/{msg}/{filename}. Возвращает rel-path."""
    safe_name = "".join(c for c in filename if c.isalnum() or c in "._-() ").strip() or "file.bin"
    rel = f"{tenant_id}/mail/{mailbox_id}/{msg_pk}/{uuid.uuid4().hex[:8]}_{safe_name}"
    full = Path(settings.UPLOAD_DIR) / rel
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_bytes(content)
    return rel


def _parse_date(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return parsedate_to_datetime(value)
    except Exception:
        return None


def sync_mailbox(mailbox_id: int) -> dict:
    """Синхронизирует один mailbox: fetch новых сообщений, сохраняет в БД.

    Идемпотентно: UNIQUE(mailbox_id, message_id) защищает от дублирования.
    """
    with SessionLocal() as db:
        mb = db.get(Mailbox, mailbox_id)
        if not mb or not mb.is_active:
            return {"mailbox_id": mailbox_id, "status": "inactive"}

        password = decrypt(mb.imap_password_enc)
        if not password:
            log.warning("sync_mailbox %s: пароль не задан или не расшифрован", mailbox_id)
            mb.last_error = "IMAP пароль не задан"
            db.commit()
            return {"mailbox_id": mailbox_id, "status": "no_password"}

        try:
            processed = _fetch_and_save(db, mb, password)
            mb.last_sync_at = datetime.now(timezone.utc)
            mb.last_error = None
            db.commit()
            return {"mailbox_id": mailbox_id, "processed": processed}
        except Exception as exc:
            log.exception("sync_mailbox %s failed", mailbox_id)
            mb.last_error = str(exc)[:2000]
            db.commit()
            return {"mailbox_id": mailbox_id, "status": "failed", "error": str(exc)}


def _fetch_and_save(db: Session, mb: Mailbox, password: str) -> int:
    processed = 0
    with IMAPClient(mb.imap_host, port=mb.imap_port, ssl=mb.imap_ssl, timeout=30) as client:
        client.login(mb.imap_user, password)
        client.select_folder(mb.imap_folder, readonly=False)

        if mb.last_seen_uid:
            uids = client.search(["UID", f"{mb.last_seen_uid + 1}:*"])
        else:
            # Первая синхронизация — берём последние N писем
            all_uids = client.search(["ALL"])
            uids = sorted(all_uids)[-MAX_INITIAL_MESSAGES:]

        if not uids:
            return 0
        uids = sorted(uids)
        max_seen = mb.last_seen_uid or 0

        for i in range(0, len(uids), FETCH_BATCH):
            batch = uids[i : i + FETCH_BATCH]
            fetched = client.fetch(batch, ["RFC822", "FLAGS"])
            for uid, data in fetched.items():
                raw = data.get(b"RFC822")
                if not raw:
                    continue
                try:
                    _ingest_one(db, mb, uid, raw)
                    processed += 1
                    max_seen = max(max_seen, int(uid))
                except IntegrityError:
                    db.rollback()
                    # UNIQUE — уже было
                    max_seen = max(max_seen, int(uid))
                except Exception:
                    db.rollback()
                    log.exception("ingest failed uid=%s mailbox=%s", uid, mb.id)

        if max_seen > (mb.last_seen_uid or 0):
            mb.last_seen_uid = max_seen
            db.commit()
    return processed


def _ingest_one(db: Session, mb: Mailbox, uid: int, raw: bytes) -> None:
    """Парсит одно письмо и сохраняет как MailMessage + attachments."""
    msg = email.message_from_bytes(raw)

    message_id = _decode(msg.get("Message-ID") or "").strip("<>").strip()
    if not message_id:
        message_id = f"synth-{uid}-{uuid.uuid4().hex}@qadam"

    # Идемпотентность — быстрая проверка (UNIQUE тоже отловит, но так экономим).
    existing = (
        db.query(MailMessage.id)
        .filter(MailMessage.mailbox_id == mb.id, MailMessage.message_id == message_id)
        .first()
    )
    if existing:
        return

    subject = _decode(msg.get("Subject"))
    from_name, from_addr = parseaddr(_decode(msg.get("From") or ""))
    to_addrs = _split_addresses(msg.get("To"))
    cc_addrs = _split_addresses(msg.get("Cc"))
    date_hdr = _decode(msg.get("Date"))
    sent_at = _parse_date(date_hdr)
    in_reply_to = _decode(msg.get("In-Reply-To") or "").strip("<>").strip() or None
    references_hdr = _decode(msg.get("References") or "") or None

    # Направление: если From — это наш адрес → outbound (мы сами отправили и IMAP видит копию)
    direction = MailDirection.outbound if from_addr.lower() == mb.email.lower() else MailDirection.inbound

    body_text, body_html = _extract_body(msg)

    participants_from_msg = {
        "from": [from_addr] if from_addr else [],
        "to": to_addrs,
        "cc": cc_addrs,
    }
    involved = list(participants_from_msg["from"]) + participants_from_msg["to"] + participants_from_msg["cc"]

    thread = find_thread(
        db, tenant_id=mb.tenant_id, mailbox_id=mb.id,
        message_id=message_id, in_reply_to=in_reply_to, references_header=references_hdr,
        subject=subject, participant_emails=involved,
    )
    if not thread:
        thread = MailThread(
            tenant_id=mb.tenant_id,
            mailbox_id=mb.id,
            subject=subject or "(без темы)",
            normalized_subject=normalize_subject(subject),
            participants=participants_from_msg,
            first_message_at=sent_at,
            last_message_at=sent_at,
        )
        db.add(thread)
        db.flush()
    else:
        thread.participants = merge_participants(thread.participants or {}, participants_from_msg)
        if thread.first_message_at is None or (sent_at and sent_at < thread.first_message_at):
            thread.first_message_at = sent_at
        if sent_at and (thread.last_message_at is None or sent_at > thread.last_message_at):
            thread.last_message_at = sent_at

    m = MailMessage(
        tenant_id=mb.tenant_id,
        mailbox_id=mb.id,
        thread_id=thread.id,
        direction=direction,
        status=MailStatus.received if direction == MailDirection.inbound else MailStatus.sent,
        message_id=message_id[:500],
        in_reply_to=in_reply_to[:500] if in_reply_to else None,
        references=references_hdr,
        imap_uid=int(uid),
        from_addr=(from_addr or "unknown")[:320],
        from_name=from_name[:320] if from_name else None,
        to_addrs=to_addrs,
        cc_addrs=cc_addrs,
        subject=(subject or "")[:500],
        body_text=body_text or None,
        body_html=body_html or None,
        is_read=(direction == MailDirection.outbound),
        sent_at=sent_at,
    )
    db.add(m)
    db.flush()

    # Attachments
    for att in _extract_attachments(msg):
        rel = _save_attachment(mb.tenant_id, mb.id, m.id, att["filename"], att["content"])
        db.add(MailAttachment(
            tenant_id=mb.tenant_id,
            message_id=m.id,
            filename=att["filename"],
            content_type=att["content_type"],
            size=att["size"],
            stored_path=rel,
            content_id=att["content_id"],
        ))

    # Обновляем thread-метрики
    thread.total_count = (thread.total_count or 0) + 1
    if direction == MailDirection.inbound:
        thread.unread_count = (thread.unread_count or 0) + 1
    thread.last_message_at = sent_at or datetime.now(timezone.utc)
    preview = (body_text or "").strip().split("\n", 1)[0][:200] if body_text else (subject or "")[:200]
    thread.last_message_preview = preview or None
    db.flush()

    # Realtime + event
    publish_to_tenant(
        mb.tenant_id,
        "mail.new",
        {
            "mailbox_id": mb.id,
            "thread_id": thread.id,
            "message_id": m.id,
            "direction": direction.value,
            "from": from_addr,
            "subject": subject or "",
        },
    )
    if direction == MailDirection.inbound:
        fire_event(
            "mail.message_received",
            mb.tenant_id,
            {
                "mailbox_id": mb.id,
                "thread_id": thread.id,
                "message_id": m.id,
                "from": from_addr,
                "subject": subject or "",
                "body_preview": preview,
            },
        )
