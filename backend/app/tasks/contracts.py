"""Напоминания по договорам (раз в сутки, Celery beat).

- Действующий договор: срок действия (valid_until) истекает через 60, 30 или 7 дней.
- Банковская гарантия по договору (кроме исполненных/расторгнутых): срок гарантии через 60, 30 или 7 дней.

Получатели — ответственный и юрист договора (если они ещё в компании): уведомление в системе
и письмо, если настроена почта (SMTP). Каждое напоминание отправляется один раз —
отметка в contract_reminder_marks по (вид, запись, порог, дата окончания). Если задача
пропустила день, порог всё равно сработает: берём ближайший порог, который ≥ оставшихся дней.
"""
from __future__ import annotations

import html
import logging
from datetime import date
from typing import Optional

from celery import shared_task
from sqlalchemy.exc import IntegrityError

from ..config import settings
from ..database import SessionLocal
from ..models import (
    Contract, ContractGuarantee, ContractReminderMark, Notification, TenantMembership, User,
)
from ..models.contract import GUARANTEE_KINDS

log = logging.getLogger(__name__)

THRESHOLDS = (7, 30, 60)  # по возрастанию
CONTRACT_KIND = "contract_expiry"
GUARANTEE_KIND = "guarantee_expiry"


def _threshold(days_left: int) -> Optional[int]:
    """Наименьший порог, в который попадает остаток дней (0..60), иначе None."""
    if days_left < 0:
        return None
    for t in THRESHOLDS:
        if days_left <= t:
            return t
    return None


def _days_word(n: int) -> str:
    n10, n100 = n % 10, n % 100
    if n10 == 1 and n100 != 11:
        return "день"
    if 2 <= n10 <= 4 and not 12 <= n100 <= 14:
        return "дня"
    return "дней"


def _when(days_left: int) -> str:
    if days_left == 0:
        return "сегодня"
    if days_left == 1:
        return "завтра"
    return f"через {days_left} {_days_word(days_left)}"


def _mark(db, tenant_id: int, kind: str, object_id: int, days: int, target: date) -> bool:
    """True — отметка создана сейчас (напоминание ещё не отправляли)."""
    exists = db.query(ContractReminderMark.id).filter(
        ContractReminderMark.kind == kind, ContractReminderMark.object_id == object_id,
        ContractReminderMark.days == days, ContractReminderMark.target_date == target,
    ).first()
    if exists:
        return False
    try:
        with db.begin_nested():
            db.add(ContractReminderMark(tenant_id=tenant_id, kind=kind, object_id=object_id, days=days, target_date=target))
    except IntegrityError:
        return False
    return True


def _recipients(db, c: Contract) -> list[User]:
    ids = {uid for uid in (c.responsible_user_id, c.lawyer_user_id) if uid}
    if not ids:
        return []
    members = {
        uid for (uid,) in db.query(TenantMembership.user_id).filter(
            TenantMembership.tenant_id == c.tenant_id, TenantMembership.user_id.in_(ids),
        )
    }
    return [u for u in db.query(User).filter(User.id.in_(members), User.is_active.is_(True)).all()]


def _send(db, c: Contract, kind: str, title: str, body: str, outbox: list) -> None:
    for u in _recipients(db, c):
        db.add(Notification(tenant_id=c.tenant_id, user_id=u.id, kind=kind, title=title[:300], body=body[:1000], link=f"/contracts/{c.id}"))
        outbox.append((c.tenant_id, u.id, u.email, title, body, c.id))


def _contract_name(c: Contract) -> str:
    cp = c.company.name if c.company else None
    return f"№ {c.number}" + (f" с «{cp}»" if cp else "")


@shared_task(name="contracts.expiry_reminders")
def expiry_reminders() -> dict:
    today = date.today()
    sent_contracts = sent_guarantees = 0
    outbox: list[tuple[int, int, Optional[str], str, str, int]] = []
    db = SessionLocal()
    try:
        # --- сроки действия договоров ---
        horizon = date.fromordinal(today.toordinal() + THRESHOLDS[-1])
        contracts = (
            db.query(Contract)
            .filter(
                Contract.status == "active",
                Contract.valid_until.is_not(None),
                Contract.valid_until >= today,
                Contract.valid_until <= horizon,
            )
            .all()
        )
        for c in contracts:
            days_left = (c.valid_until - today).days
            t = _threshold(days_left)
            if t is None or not _mark(db, c.tenant_id, "contract", c.id, t, c.valid_until):
                continue
            title = f"Договор {_contract_name(c)} истекает {_when(days_left)}"
            body = f"Срок действия — до {c.valid_until.strftime('%d.%m.%Y')}."
            if c.auto_renewal:
                body += " Автопролонгация включена — проверьте, что продление нужно."
            else:
                body += " Продлите договор или подготовьте новый."
            _send(db, c, CONTRACT_KIND, title, body, outbox)
            sent_contracts += 1

        # --- банковские гарантии ---
        rows = (
            db.query(ContractGuarantee, Contract)
            .join(Contract, Contract.id == ContractGuarantee.contract_id)
            .filter(
                Contract.status.notin_(["completed", "terminated"]),
                ContractGuarantee.valid_until.is_not(None),
                ContractGuarantee.valid_until >= today,
                ContractGuarantee.valid_until <= horizon,
            )
            .all()
        )
        for g, c in rows:
            days_left = (g.valid_until - today).days
            t = _threshold(days_left)
            if t is None or not _mark(db, c.tenant_id, "guarantee", g.id, t, g.valid_until):
                continue
            kind = GUARANTEE_KINDS.get(g.kind, "Банковская").lower()
            bank = f" ({g.bank_name})" if g.bank_name else ""
            title = f"Гарантия по договору {_contract_name(c)} истекает {_when(days_left)}"
            body = f"{kind.capitalize()} банковская гарантия{bank} действует до {g.valid_until.strftime('%d.%m.%Y')}."
            if c.auto_renewal:
                body += " По договору включена автопролонгация — гарантию, возможно, нужно продлить."
            _send(db, c, GUARANTEE_KIND, title, body, outbox)
            sent_guarantees += 1

        db.commit()
    except Exception:
        db.rollback()
        log.exception("contracts.expiry_reminders failed")
        raise
    finally:
        db.close()

    # После коммита: живое обновление колокольчика и письма.
    try:
        from ..core.ws_hub import publish_to_user
        for tid, uid, _email, _t, _b, cid in outbox:
            publish_to_user(tid, uid, "notification.new", {"kind": "contract", "contract_id": cid})
    except Exception:
        log.warning("ws publish failed", exc_info=True)

    if settings.SMTP_HOST:
        from .email import send_email
        base = (getattr(settings, "APP_BASE_URL", None) or "").rstrip("/")
        for _tid, _uid, email, title, body, cid in outbox:
            if not email:
                continue
            link = f"{base}/contracts/{cid}" if base else ""
            html_body = f"<p>{html.escape(title)}</p><p>{html.escape(body)}</p>"
            if link:
                html_body += f'<p><a href="{html.escape(link)}">Открыть договор</a></p>'
            try:
                send_email.delay(to=email, subject=title, html=html_body)
            except Exception:
                log.warning("contract reminder email failed", exc_info=True)

    log.info("contracts.expiry_reminders: contracts=%d guarantees=%d", sent_contracts, sent_guarantees)
    return {"contracts": sent_contracts, "guarantees": sent_guarantees}
