"""Celery-задачи для email: sync_mailbox (per box) + sync_all (оркестратор)."""
from __future__ import annotations

import logging

from ..core.celery_app import celery_app
from ..database import SessionLocal
from ..models import Mailbox
from ..services.mail.imap_worker import sync_mailbox

log = logging.getLogger("qadam.mail.tasks")


@celery_app.task(name="mail.sync_mailbox", bind=True, max_retries=1, default_retry_delay=30)
def sync_mailbox_task(self, *, mailbox_id: int) -> dict:
    try:
        return sync_mailbox(mailbox_id)
    except Exception as exc:
        log.exception("mail.sync_mailbox %s failed", mailbox_id)
        raise self.retry(exc=exc)


@celery_app.task(name="mail.sync_all")
def sync_all_mailboxes() -> dict:
    """Оркестратор: раз в минуту находит активные mailbox'ы и запускает per-box задачу."""
    with SessionLocal() as db:
        ids = [
            row[0]
            for row in db.query(Mailbox.id)
            .filter(Mailbox.is_active.is_(True))
            .all()
        ]
    for mid in ids:
        sync_mailbox_task.delay(mailbox_id=mid)
    log.info("mail.sync_all: enqueued %d mailboxes", len(ids))
    return {"enqueued": len(ids)}
