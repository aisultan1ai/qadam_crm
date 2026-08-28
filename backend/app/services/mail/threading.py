"""Threading email по RFC 5322.

Логика:
1. Извлекаем все Message-ID из References + In-Reply-To
2. Ищем MailMessage с любым из этих ID — если нашли → thread_id оттуда
3. Иначе ищем thread по normalized_subject + пересечению participants
4. Иначе создаём новый thread
"""
from __future__ import annotations

import re
from typing import Iterable, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ...models import MailMessage, MailThread


_MSGID_RE = re.compile(r"<([^<>]+)>")
_RE_PREFIX_RE = re.compile(r"^(?:\s*(?:re|fwd?|fw|аw|ответ|ответить)\s*:\s*)+", re.IGNORECASE)


def parse_msgids(header_value: Optional[str]) -> list[str]:
    """Извлекает <id@host> токены из строки заголовка."""
    if not header_value:
        return []
    return _MSGID_RE.findall(header_value)


def normalize_subject(subject: Optional[str]) -> str:
    if not subject:
        return ""
    s = subject.strip()
    # Убираем повторяющиеся Re: / Fwd: с начала (кириллица тоже)
    while True:
        new = _RE_PREFIX_RE.sub("", s).strip()
        if new == s:
            break
        s = new
    return s[:500].lower()


def find_thread(
    db: Session,
    tenant_id: int,
    mailbox_id: int,
    message_id: Optional[str],
    in_reply_to: Optional[str],
    references_header: Optional[str],
    subject: Optional[str],
    participant_emails: Iterable[str],
) -> Optional[MailThread]:
    """Ищет thread для входящего сообщения. Возвращает None если не найдено."""
    ref_ids: list[str] = []
    if in_reply_to:
        ref_ids.extend(parse_msgids(in_reply_to))
    if references_header:
        ref_ids.extend(parse_msgids(references_header))
    # Дедупликация
    seen = set()
    ref_ids = [r for r in ref_ids if not (r in seen or seen.add(r))]

    if ref_ids:
        # Ищем любое сообщение с этими Message-ID (со скобками или без — мы храним без)
        prior = (
            db.query(MailMessage.thread_id)
            .filter(
                MailMessage.tenant_id == tenant_id,
                MailMessage.mailbox_id == mailbox_id,
                MailMessage.message_id.in_(ref_ids),
            )
            .first()
        )
        if prior:
            return db.get(MailThread, prior[0])

    # Fallback: normalized subject + пересечение отправителей/получателей
    norm = normalize_subject(subject)
    if norm:
        candidates = (
            db.query(MailThread)
            .filter(
                MailThread.tenant_id == tenant_id,
                MailThread.mailbox_id == mailbox_id,
                MailThread.normalized_subject == norm,
            )
            .order_by(MailThread.last_message_at.desc().nullslast())
            .limit(10)
            .all()
        )
        emails_lc = {e.lower() for e in participant_emails if e}
        for thread in candidates:
            existing = set()
            if isinstance(thread.participants, dict):
                for key in ("from", "to", "cc"):
                    for e in thread.participants.get(key, []) or []:
                        if isinstance(e, str):
                            existing.add(e.lower())
            if emails_lc & existing:
                return thread
        # Если ни один не пересёкся — берём последний с таким subject
        if candidates:
            return candidates[0]
    return None


def merge_participants(current: dict, addition: dict) -> dict:
    """Объединяет участников: current = {from: [], to: [], cc: []}."""
    out = {"from": [], "to": [], "cc": []}
    for key in ("from", "to", "cc"):
        cur = current.get(key, []) or [] if isinstance(current, dict) else []
        add = addition.get(key, []) or []
        seen = set()
        merged = []
        for item in list(cur) + list(add):
            if not isinstance(item, str):
                continue
            k = item.lower()
            if k in seen:
                continue
            seen.add(k)
            merged.append(item)
        out[key] = merged[:50]
    return out
