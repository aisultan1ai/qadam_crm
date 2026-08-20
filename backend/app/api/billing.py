"""Биллинг: mock-провайдер + заготовка под Stripe/Kaspi Pay.

Модель Subscription хранит текущую подписку tenant'а (один активный ряд на tenant).
Endpoint /subscribe — mock: сразу меняет `Tenant.plan` и создаёт/обновляет подписку.
Webhook — только логирует payload и меняет статус для известных событий.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import settings
from ..core.plans import PLAN_LIMITS, plan_catalog
from ..database import get_db
from ..models import Subscription, SubscriptionStatus, Tenant
from ..schemas.common import Message
from .deps import TenantContext, get_current_context, log_action, verify_same_origin

router = APIRouter(prefix="/api/billing", tags=["billing"])

log = logging.getLogger("qadam.billing")

TRIAL_DAYS = 30


class SubscribeRequest(BaseModel):
    plan: str


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize(sub: Optional[Subscription], tenant: Tenant) -> dict:
    return {
        "plan": (sub.plan if sub else tenant.plan),
        "status": (sub.status.value if sub else "active"),
        "current_period_start": sub.current_period_start.isoformat() if sub and sub.current_period_start else None,
        "current_period_end": sub.current_period_end.isoformat() if sub and sub.current_period_end else None,
        "provider": sub.provider if sub else "mock",
    }


@router.get("/plans")
def get_plans():
    """Каталог тарифов: цена, фичи, лимиты. Доступ без auth — маркетинговая инфа."""
    return plan_catalog()


@router.get("/subscription")
def get_subscription(
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    sub = db.query(Subscription).filter(Subscription.tenant_id == ctx.tenant.id).first()
    return _serialize(sub, ctx.tenant)


@router.post("/subscribe", dependencies=[Depends(verify_same_origin)])
def subscribe(
    payload: SubscribeRequest,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    if not (ctx.membership.is_owner or ctx.user.is_platform_admin):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Только владелец может менять тариф")

    if payload.plan not in PLAN_LIMITS:
        raise HTTPException(400, f"Неизвестный план: {payload.plan}")

    now = _now()
    period_end = now + timedelta(days=TRIAL_DAYS)

    sub = db.query(Subscription).filter(Subscription.tenant_id == ctx.tenant.id).first()
    if sub:
        sub.plan = payload.plan
        sub.status = SubscriptionStatus.active
        sub.current_period_start = now
        sub.current_period_end = period_end
    else:
        sub = Subscription(
            tenant_id=ctx.tenant.id,
            plan=payload.plan,
            status=SubscriptionStatus.active,
            current_period_start=now,
            current_period_end=period_end,
            provider="mock",
        )
        db.add(sub)

    ctx.tenant.plan = payload.plan
    log_action(
        db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
        action="subscribe", entity="tenant", entity_id=ctx.tenant.id,
        detail=payload.plan,
    )
    db.commit()
    db.refresh(sub)
    return _serialize(sub, ctx.tenant)


def _verify_webhook_signature(raw_body: bytes, signature_header: Optional[str]) -> None:
    """Валидация HMAC-SHA256 подписи webhook. В prod BILLING_WEBHOOK_SECRET обязателен.
    Пустой секрет разрешён только в dev (APP_ENV != production) — тогда пропускаем с warning.
    """
    secret = settings.BILLING_WEBHOOK_SECRET
    if not secret:
        if settings.is_prod:
            log.error("BILLING_WEBHOOK_SECRET is not set in production — rejecting webhook")
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Webhook signature secret not configured")
        log.warning("BILLING_WEBHOOK_SECRET not set (dev mode) — signature check skipped")
        return

    if not signature_header:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing X-Signature header")

    # Поддержка формата "sha256=<hex>" (Stripe-like) и просто "<hex>"
    provided = signature_header.split("=", 1)[1] if "=" in signature_header else signature_header
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(provided.lower(), expected.lower()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid webhook signature")


@router.post("/webhook", response_model=Message)
async def webhook(request: Request, db: Session = Depends(get_db)):
    """Приёмник событий провайдера (Stripe/Kaspi mock).

    Валидирует HMAC-SHA256 подпись из заголовка X-Signature. В prod без BILLING_WEBHOOK_SECRET
    вернёт 503; в dev — warning + пропуск (для локального тестирования).
    """
    raw_body = await request.body()
    _verify_webhook_signature(raw_body, request.headers.get("X-Signature"))

    try:
        payload = json.loads(raw_body.decode()) if raw_body else {}
    except Exception:
        payload = {}
    log.info("billing webhook: %s", payload)

    event = str(payload.get("type") or payload.get("event") or "").lower()
    tenant_id = payload.get("tenant_id") or (payload.get("data") or {}).get("tenant_id")

    if not tenant_id:
        return Message(message="ok")

    sub = db.query(Subscription).filter(Subscription.tenant_id == int(tenant_id)).first()
    tenant = db.get(Tenant, int(tenant_id))
    if not sub or not tenant:
        return Message(message="ok")

    if event in ("invoice.payment_failed", "payment.failed"):
        sub.status = SubscriptionStatus.past_due
    elif event in ("customer.subscription.deleted", "subscription.canceled"):
        sub.status = SubscriptionStatus.canceled
        sub.plan = "free"
        tenant.plan = "free"

    db.commit()
    return Message(message="ok")
