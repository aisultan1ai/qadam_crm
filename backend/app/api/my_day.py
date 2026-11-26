"""«Мой день»: блоки главной страницы, подобранные по правам сотрудника.

Выборки переиспользуют функции чтения из services/ai_tools.py — в них уже фильтр по компании
и проверка прав (нет права → блок помечается allowed=false и на главной не показывается).
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import desc
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Contract, MailThread, Mailbox
from ..models.obligation import ContractObligation
from ..services import ai_tools
from .deps import TenantContext, get_current_context

router = APIRouter(prefix="/api/my-day", tags=["my-day"])

STALE_DAYS = 14
EXPIRING_DAYS = 30
OBLIGATION_DAYS = 7
LIMIT = 6


def _block(result: dict) -> dict:
    if result.get("error"):
        return {"allowed": False, "total": 0, "items": []}
    return {"allowed": True, "total": result.get("total", 0), "items": result.get("items", [])[:LIMIT]}


@router.get("")
def my_day(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    seen = ai_tools.Seen()
    today = date.today()
    pipeline = "offtake" if ctx.tenant.offtake_enabled else "sales"

    stale = _block(ai_tools.search_deals(db, ctx, seen, pipeline=pipeline, stale_days=STALE_DAYS))
    expiring = _block(ai_tools.search_contracts(
        db, ctx, seen, expiring_before=(today + timedelta(days=EXPIRING_DAYS)).isoformat()))

    obligations = {"allowed": False, "total": 0, "items": []}
    if ai_tools._can(ctx, "contracts.view"):
        q = (
            db.query(ContractObligation, Contract)
            .join(Contract, Contract.id == ContractObligation.contract_id)
            .filter(
                ContractObligation.tenant_id == ctx.tenant.id,
                Contract.tenant_id == ctx.tenant.id,
                ContractObligation.status == "open",
                ContractObligation.due_date.is_not(None),
                ContractObligation.due_date <= today + timedelta(days=OBLIGATION_DAYS),
            )
        )
        rows = q.order_by(ContractObligation.due_date.asc()).limit(LIMIT).all()
        obligations = {
            "allowed": True,
            "total": q.count(),
            "items": [
                {
                    "id": o.id,
                    "title": o.title,
                    "due_date": o.due_date.isoformat(),
                    "overdue": o.due_date < today,
                    "contract_id": c.id,
                    "contract_number": c.number,
                    "url": f"/contracts/{c.id}",
                }
                for o, c in rows
            ],
        }

    mail = {"allowed": False, "connected": False, "total": 0, "items": []}
    if ai_tools._can(ctx, "mail.use"):
        mb = db.query(Mailbox).filter(Mailbox.tenant_id == ctx.tenant.id, Mailbox.user_id == ctx.user.id).first()
        mail = {"allowed": True, "connected": bool(mb), "total": 0, "items": []}
        if mb:
            q = db.query(MailThread).filter(
                MailThread.tenant_id == ctx.tenant.id, MailThread.mailbox_id == mb.id,
                MailThread.unread_count > 0, MailThread.is_archived.is_(False),
            )
            mail["total"] = q.count()
            mail["items"] = [
                {
                    "id": t.id,
                    "subject": t.subject or "(без темы)",
                    "unread": t.unread_count,
                    "last_message_at": t.last_message_at.isoformat() if t.last_message_at else None,
                    "url": f"/mail?thread={t.id}",
                }
                for t in q.order_by(desc(MailThread.last_message_at)).limit(LIMIT).all()
            ]

    return {
        "pipeline": pipeline,
        "stale_days": STALE_DAYS,
        "stale_deals": stale,
        "expiring_contracts": expiring,
        "expiring_days": EXPIRING_DAYS,
        "obligations": obligations,
        "obligation_days": OBLIGATION_DAYS,
        "unread_mail": mail,
    }
