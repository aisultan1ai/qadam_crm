"""Журнал просмотров записей (документы, позже договоры).

log_view(db, ctx, "document", doc.id) — кто открыл запись, с какого IP и браузера.
Не чаще одной строки на человека и запись за 10 минут: повторные открытия подряд — шум.
Для открытия по публичной ссылке без входа: log_view(db, None, ..., tenant_id=...) — тогда
«человек» определяется по IP.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from .request_context import current_ip, current_user_agent

log = logging.getLogger("qadam.view_log")

DEBOUNCE = timedelta(minutes=10)


def log_view(
    db: Session,
    ctx,
    entity_type: str,
    entity_id: int,
    *,
    tenant_id: Optional[int] = None,
    commit: bool = True,
) -> None:
    """ctx — TenantContext (или None для анонимного просмотра; тогда нужен tenant_id).
    Ошибки журнала не должны ломать сам просмотр — глотаем и пишем в лог."""
    from ..models import RecordView
    try:
        tid = tenant_id if tenant_id is not None else ctx.tenant.id
        uid = ctx.user.id if ctx is not None else None
        ip = current_ip()
        since = datetime.now(timezone.utc) - DEBOUNCE
        q = db.query(RecordView.id).filter(
            RecordView.tenant_id == tid,
            RecordView.entity_type == entity_type,
            RecordView.entity_id == entity_id,
            RecordView.viewed_at >= since,
        )
        q = q.filter(RecordView.user_id == uid) if uid is not None else q.filter(
            RecordView.user_id.is_(None), RecordView.ip == ip,
        )
        if q.first():
            return
        db.add(RecordView(
            tenant_id=tid, user_id=uid, entity_type=entity_type, entity_id=entity_id,
            ip=ip, user_agent=current_user_agent(),
        ))
        if commit:
            db.commit()
    except Exception:
        db.rollback()
        log.warning("record view logging failed", exc_info=True)
