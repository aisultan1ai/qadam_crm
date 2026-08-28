"""API «Открытых линий»: каналы, разговоры, сообщения, webhook receiver,
auto-reply правила и шаблоны.

Права:
- `messengers.manage` — CRUD каналов, правил, шаблонов, работа с настройками
- `messengers.reply` — чтение inbox + ответы

Webhook `POST /api/messengers/webhook/{channel_id}` не требует auth — только
подпись/секрет провайдера. Тело асинхронно кидается в Celery `messenger.ingest`,
так что ответ мгновенный (важно: Telegram/Meta ретраят если тайм-аут).
"""
from __future__ import annotations

import logging
import secrets as _secrets
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from ..core.celery_app import celery_app
from ..database import get_db
from ..models import (
    AutoReplyKind, AutoReplyRule, ChannelKind, ExternalChannel, ExternalContact,
    ExternalConversation, ExternalMessage, MessageDirection, MessageStatus,
    MessageTemplate, TenantLead, User,
)
from ..schemas.common import Message
from ..services.messenger_service import _serialize_message, send_and_persist_message
from ..services.messengers import ProviderError, get_provider, known_kinds
from .deps import TenantContext, log_action, require

log = logging.getLogger("qadam.messengers.api")

router = APIRouter(prefix="/api/messengers", tags=["messengers"])


# =============================================================================
# Schemas
# =============================================================================


class ChannelCreate(BaseModel):
    kind: str
    name: str = Field(min_length=1, max_length=200)
    provider_config: dict = Field(default_factory=dict)
    external_identifier: Optional[str] = Field(default=None, max_length=200)
    is_active: bool = True

    @field_validator("kind")
    @classmethod
    def _check_kind(cls, v: str) -> str:
        allowed = set(known_kinds())
        if v not in allowed:
            raise ValueError(f"kind must be one of {sorted(allowed)}")
        return v


class ChannelPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    provider_config: Optional[dict] = None
    external_identifier: Optional[str] = Field(default=None, max_length=200)
    is_active: Optional[bool] = None


class AutoReplyBody(BaseModel):
    kind: str
    response_text: str = Field(min_length=1, max_length=2000)
    trigger_config: dict = Field(default_factory=dict)
    is_active: bool = True
    priority: int = 0

    @field_validator("kind")
    @classmethod
    def _check_kind(cls, v: str) -> str:
        allowed = {k.value for k in AutoReplyKind}
        if v not in allowed:
            raise ValueError(f"kind must be one of {sorted(allowed)}")
        return v


class TemplateBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=4000)
    kind: str = "text"
    language: str = Field(default="ru", max_length=10)
    whatsapp_template_name: Optional[str] = Field(default=None, max_length=200)


class SendMessageBody(BaseModel):
    body: Optional[str] = Field(default=None, max_length=4000)
    media: Optional[dict] = None

    @field_validator("body")
    @classmethod
    def _not_both_empty(cls, v, info):
        # проверим что хоть что-то есть — но media проверить нельзя без info.data
        return v


class LinkLeadBody(BaseModel):
    lead_id: Optional[int] = None
    create_new: bool = False


# =============================================================================
# Serialization
# =============================================================================


def _channel_out(c: ExternalChannel, extra: Optional[dict] = None) -> dict:
    """Возвращает безопасное представление канала (без секретов в открытом виде)."""
    cfg = dict(c.provider_config or {})
    # Маскируем секреты: показываем только суффикс
    for secret_key in ("bot_token", "api_key", "app_secret", "page_access_token"):
        if cfg.get(secret_key):
            val = str(cfg[secret_key])
            cfg[secret_key] = ("****" + val[-4:]) if len(val) > 4 else "****"
    result = {
        "id": c.id,
        "kind": c.kind.value if hasattr(c.kind, "value") else c.kind,
        "name": c.name,
        "provider_config": cfg,
        "external_identifier": c.external_identifier,
        "webhook_secret_set": bool(c.webhook_secret),
        "is_active": c.is_active,
        "last_error": c.last_error,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }
    if extra:
        result.update(extra)
    return result


def _contact_out(c: ExternalContact) -> dict:
    return {
        "id": c.id,
        "external_id": c.external_id,
        "username": c.username,
        "display_name": c.display_name,
        "phone": c.phone,
        "avatar_url": c.avatar_url,
        "linked_lead_id": c.linked_lead_id,
        "is_blocked": c.is_blocked,
    }


def _conversation_out(conv: ExternalConversation, channel_name: Optional[str] = None) -> dict:
    return {
        "id": conv.id,
        "channel_id": conv.channel_id,
        "channel_name": channel_name or (conv.channel.name if conv.channel else None),
        "channel_kind": (
            conv.channel.kind.value if conv.channel and hasattr(conv.channel.kind, "value")
            else (conv.channel.kind if conv.channel else None)
        ),
        "contact": _contact_out(conv.contact) if conv.contact else None,
        "assignee_id": conv.assignee_id,
        "last_message_at": conv.last_message_at.isoformat() if conv.last_message_at else None,
        "last_message_preview": conv.last_message_preview,
        "unread_count": conv.unread_count,
        "is_closed": conv.is_closed,
    }


def _rule_out(r: AutoReplyRule) -> dict:
    return {
        "id": r.id,
        "channel_id": r.channel_id,
        "kind": r.kind.value if hasattr(r.kind, "value") else r.kind,
        "response_text": r.response_text,
        "trigger_config": r.trigger_config or {},
        "is_active": r.is_active,
        "priority": r.priority,
    }


def _template_out(t: MessageTemplate) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "body": t.body,
        "kind": t.kind,
        "language": t.language,
        "whatsapp_template_name": t.whatsapp_template_name,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


def _load_channel(db: Session, tenant_id: int, channel_id: int) -> ExternalChannel:
    ch = db.get(ExternalChannel, channel_id)
    if not ch or ch.tenant_id != tenant_id:
        raise HTTPException(404, "Канал не найден")
    return ch


def _load_conversation(db: Session, tenant_id: int, conv_id: int) -> ExternalConversation:
    conv = db.get(ExternalConversation, conv_id)
    if not conv or conv.tenant_id != tenant_id:
        raise HTTPException(404, "Разговор не найден")
    return conv


# =============================================================================
# Meta / справочники
# =============================================================================


@router.get("/meta")
def get_meta(_ctx: TenantContext = Depends(require("messengers.manage"))):
    """Список доступных типов каналов и видов auto-reply — для UI."""
    return {
        "kinds": known_kinds(),
        "auto_reply_kinds": [k.value for k in AutoReplyKind],
    }


# =============================================================================
# CRUD каналов
# =============================================================================


@router.get("/channels")
def list_channels(
    ctx: TenantContext = Depends(require("messengers.manage")),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(ExternalChannel)
        .filter(ExternalChannel.tenant_id == ctx.tenant.id)
        .order_by(ExternalChannel.created_at.desc())
        .all()
    )
    return [_channel_out(c) for c in rows]


@router.get("/channels/{channel_id}")
def get_channel(
    channel_id: int,
    ctx: TenantContext = Depends(require("messengers.manage")),
    db: Session = Depends(get_db),
):
    return _channel_out(_load_channel(db, ctx.tenant.id, channel_id))


@router.post("/channels", status_code=201)
def create_channel(
    payload: ChannelCreate,
    ctx: TenantContext = Depends(require("messengers.manage")),
    db: Session = Depends(get_db),
):
    # Автогенерация webhook_secret — используется Telegram для подписи входящих
    webhook_secret = _secrets.token_urlsafe(24)
    ch = ExternalChannel(
        tenant_id=ctx.tenant.id,
        kind=ChannelKind(payload.kind),
        name=payload.name.strip(),
        provider_config=payload.provider_config or {},
        external_identifier=payload.external_identifier,
        webhook_secret=webhook_secret,
        is_active=payload.is_active,
        created_by=ctx.user.id,
    )
    db.add(ch)
    db.flush()
    log_action(
        db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
        action="create", entity="external_channel", entity_id=ch.id, detail=f"{ch.kind} '{ch.name}'",
    )
    db.commit()
    db.refresh(ch)
    return _channel_out(ch)


@router.patch("/channels/{channel_id}")
def patch_channel(
    channel_id: int,
    payload: ChannelPatch,
    ctx: TenantContext = Depends(require("messengers.manage")),
    db: Session = Depends(get_db),
):
    ch = _load_channel(db, ctx.tenant.id, channel_id)
    if payload.name is not None:
        ch.name = payload.name.strip()
    if payload.provider_config is not None:
        # Merge: пустые значения (в т.ч. масked "****") — не перезаписываем
        merged = dict(ch.provider_config or {})
        for k, v in payload.provider_config.items():
            if v is None or (isinstance(v, str) and v.startswith("****")):
                continue
            merged[k] = v
        ch.provider_config = merged
    if payload.external_identifier is not None:
        ch.external_identifier = payload.external_identifier or None
    if payload.is_active is not None:
        ch.is_active = payload.is_active
    log_action(
        db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
        action="update", entity="external_channel", entity_id=ch.id,
    )
    db.commit()
    db.refresh(ch)
    return _channel_out(ch)


@router.delete("/channels/{channel_id}", response_model=Message)
def delete_channel(
    channel_id: int,
    ctx: TenantContext = Depends(require("messengers.manage")),
    db: Session = Depends(get_db),
):
    ch = _load_channel(db, ctx.tenant.id, channel_id)
    name = ch.name
    log_action(
        db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
        action="delete", entity="external_channel", entity_id=ch.id, detail=name,
    )
    db.delete(ch)
    db.commit()
    return Message(message=f"Канал «{name}» удалён")


@router.post("/channels/{channel_id}/test")
def test_channel(
    channel_id: int,
    ctx: TenantContext = Depends(require("messengers.manage")),
    db: Session = Depends(get_db),
):
    """Проверка что настройки провайдера корректны (getMe у Telegram и т.п.)."""
    ch = _load_channel(db, ctx.tenant.id, channel_id)
    try:
        provider = get_provider(
            ch.kind.value if hasattr(ch.kind, "value") else ch.kind,
            ch.provider_config or {}, ch.webhook_secret,
        )
        info = provider.get_info()
        ch.last_error = None
        db.commit()
        return {"ok": True, "info": info}
    except (ProviderError, Exception) as e:
        ch.last_error = str(e)[:2000]
        db.commit()
        raise HTTPException(400, f"Ошибка подключения: {e}")


@router.post("/channels/{channel_id}/set-webhook")
def set_webhook(
    channel_id: int,
    request: Request,
    public_url: Optional[str] = Query(default=None, description="Публичный URL (если не задан — из запроса)"),
    ctx: TenantContext = Depends(require("messengers.manage")),
    db: Session = Depends(get_db),
):
    """Регистрирует webhook у провайдера (для Telegram — setWebhook)."""
    ch = _load_channel(db, ctx.tenant.id, channel_id)
    # Автосборка URL: {origin}/api/messengers/webhook/{channel_id}
    if not public_url:
        origin = str(request.base_url).rstrip("/")
        public_url = f"{origin}/api/messengers/webhook/{channel_id}"
    try:
        provider = get_provider(
            ch.kind.value if hasattr(ch.kind, "value") else ch.kind,
            ch.provider_config or {}, ch.webhook_secret,
        )
        result = provider.set_webhook(public_url)
        ch.last_error = None
        db.commit()
        return {"ok": True, "webhook_url": public_url, "provider_response": result}
    except (ProviderError, Exception) as e:
        ch.last_error = str(e)[:2000]
        db.commit()
        raise HTTPException(400, f"Ошибка setWebhook: {e}")


# =============================================================================
# Webhook receiver (публичный — без auth, только по подписи)
# =============================================================================


@router.post("/webhook/{channel_id}")
async def receive_webhook(
    channel_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    """Принимает входящий webhook от провайдера.

    Верифицирует подпись синхронно, тело парсит асинхронно через Celery
    чтобы вернуть 200 быстро (Telegram/Meta ретраят при таймауте >5с).
    """
    ch = db.get(ExternalChannel, channel_id)
    if not ch or not ch.is_active:
        raise HTTPException(404, "Канал не найден или отключён")

    raw_body = await request.body()
    headers = {k.lower(): v for k, v in request.headers.items()}

    try:
        provider = get_provider(
            ch.kind.value if hasattr(ch.kind, "value") else ch.kind,
            ch.provider_config or {}, ch.webhook_secret,
        )
        provider.verify_webhook(headers, raw_body)
    except ValueError as e:
        log.warning("webhook: verify failed for channel %s: %s", channel_id, e)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(e))
    except ProviderError as e:
        raise HTTPException(500, f"Provider error: {e}")

    # Payload JSON
    try:
        import json
        payload = json.loads(raw_body.decode("utf-8")) if raw_body else {}
    except Exception:
        payload = {}

    # В Celery — не блокируем ответ
    try:
        celery_app.send_task(
            "messenger.ingest",
            kwargs={"channel_id": channel_id, "payload": payload},
        )
    except Exception:
        log.exception("webhook: failed to enqueue ingest task")
        raise HTTPException(500, "Не удалось поставить задачу в очередь")

    return {"ok": True}


# =============================================================================
# Разговоры и сообщения (inbox API)
# =============================================================================


@router.get("/conversations")
def list_conversations(
    channel_id: Optional[int] = None,
    is_closed: Optional[bool] = None,
    assignee_id: Optional[int] = None,
    q: Optional[str] = None,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    ctx: TenantContext = Depends(require("messengers.reply")),
    db: Session = Depends(get_db),
):
    query = db.query(ExternalConversation).filter(ExternalConversation.tenant_id == ctx.tenant.id)
    if channel_id is not None:
        query = query.filter(ExternalConversation.channel_id == channel_id)
    if is_closed is not None:
        query = query.filter(ExternalConversation.is_closed == is_closed)
    if assignee_id is not None:
        query = query.filter(ExternalConversation.assignee_id == assignee_id)
    if q:
        like = f"%{q.strip().lower()}%"
        query = (
            query.join(ExternalContact, ExternalContact.id == ExternalConversation.contact_id)
            .filter(
                (func.lower(ExternalContact.display_name).like(like))
                | (func.lower(ExternalContact.username).like(like))
                | (func.lower(ExternalContact.phone).like(like))
            )
        )

    total = query.with_entities(func.count(ExternalConversation.id)).scalar() or 0
    rows = (
        query.order_by(desc(ExternalConversation.last_message_at))
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    return {
        "items": [_conversation_out(c) for c in rows],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page if per_page else 1,
    }


@router.get("/conversations/{conv_id}")
def get_conversation(
    conv_id: int,
    ctx: TenantContext = Depends(require("messengers.reply")),
    db: Session = Depends(get_db),
):
    conv = _load_conversation(db, ctx.tenant.id, conv_id)
    return _conversation_out(conv)


@router.get("/conversations/{conv_id}/messages")
def list_messages(
    conv_id: int,
    limit: int = Query(default=100, ge=1, le=500),
    before_id: Optional[int] = None,
    ctx: TenantContext = Depends(require("messengers.reply")),
    db: Session = Depends(get_db),
):
    _load_conversation(db, ctx.tenant.id, conv_id)
    q = (
        db.query(ExternalMessage)
        .filter(
            ExternalMessage.tenant_id == ctx.tenant.id,
            ExternalMessage.conversation_id == conv_id,
        )
    )
    if before_id:
        q = q.filter(ExternalMessage.id < before_id)
    rows = q.order_by(desc(ExternalMessage.id)).limit(limit).all()
    rows.reverse()  # клиенту нужен chronological ascending
    return [_serialize_message(m) for m in rows]


@router.post("/conversations/{conv_id}/messages", status_code=201)
def send_message(
    conv_id: int,
    payload: SendMessageBody,
    ctx: TenantContext = Depends(require("messengers.reply")),
    db: Session = Depends(get_db),
):
    if not (payload.body or payload.media):
        raise HTTPException(400, "body или media обязательны")
    conv = _load_conversation(db, ctx.tenant.id, conv_id)
    ch = _load_channel(db, ctx.tenant.id, conv.channel_id)
    if not ch.is_active:
        raise HTTPException(400, "Канал отключён")

    msg = send_and_persist_message(
        db=db,
        channel=ch,
        conversation=conv,
        sender_user_id=ctx.user.id,
        body=payload.body,
        media=payload.media,
    )
    log_action(
        db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
        action="send", entity="external_message", entity_id=msg.id, detail=f"conv={conv.id}",
    )
    db.commit()
    db.refresh(msg)
    return _serialize_message(msg)


@router.post("/conversations/{conv_id}/read")
def mark_read(
    conv_id: int,
    ctx: TenantContext = Depends(require("messengers.reply")),
    db: Session = Depends(get_db),
):
    conv = _load_conversation(db, ctx.tenant.id, conv_id)
    conv.unread_count = 0
    db.commit()
    return {"ok": True}


@router.post("/conversations/{conv_id}/close")
def close_conversation(
    conv_id: int,
    ctx: TenantContext = Depends(require("messengers.reply")),
    db: Session = Depends(get_db),
):
    conv = _load_conversation(db, ctx.tenant.id, conv_id)
    conv.is_closed = True
    db.commit()
    return _conversation_out(conv)


@router.post("/conversations/{conv_id}/reopen")
def reopen_conversation(
    conv_id: int,
    ctx: TenantContext = Depends(require("messengers.reply")),
    db: Session = Depends(get_db),
):
    conv = _load_conversation(db, ctx.tenant.id, conv_id)
    conv.is_closed = False
    db.commit()
    return _conversation_out(conv)


@router.post("/conversations/{conv_id}/assign")
def assign_conversation(
    conv_id: int,
    user_id: Optional[int] = None,
    ctx: TenantContext = Depends(require("messengers.reply")),
    db: Session = Depends(get_db),
):
    conv = _load_conversation(db, ctx.tenant.id, conv_id)
    if user_id is not None:
        # Проверяем что юзер в этом tenant
        from ..models import TenantMembership
        ok = (
            db.query(TenantMembership.id)
            .filter(TenantMembership.tenant_id == ctx.tenant.id, TenantMembership.user_id == user_id)
            .first()
        )
        if not ok:
            raise HTTPException(400, "Пользователь не в этой компании")
    conv.assignee_id = user_id
    db.commit()
    return _conversation_out(conv)


@router.post("/conversations/{conv_id}/link-lead")
def link_lead(
    conv_id: int,
    payload: LinkLeadBody,
    ctx: TenantContext = Depends(require("messengers.reply")),
    db: Session = Depends(get_db),
):
    """Связать разговор с лидом. lead_id=null + create_new=true → создать нового лида из контакта."""
    conv = _load_conversation(db, ctx.tenant.id, conv_id)
    contact = conv.contact
    if not contact:
        raise HTTPException(400, "У разговора нет контакта")

    if payload.create_new:
        lead = TenantLead(
            tenant_id=ctx.tenant.id,
            form_id=None,
            name=(contact.display_name or contact.username or contact.external_id)[:200],
            contact=(contact.phone or contact.username or contact.external_id)[:255],
            custom_fields={
                "source_channel_id": conv.channel_id,
                "external_id": contact.external_id,
            },
            status="new",
            source=f"messenger:{conv.channel.kind.value if hasattr(conv.channel.kind, 'value') else conv.channel.kind}",
            assignee_id=conv.assignee_id or ctx.user.id,
        )
        db.add(lead)
        db.flush()
        contact.linked_lead_id = lead.id
        log_action(
            db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
            action="convert", entity="lead", entity_id=lead.id,
            detail=f"из разговора #{conv.id}",
        )
    elif payload.lead_id:
        lead = db.get(TenantLead, payload.lead_id)
        if not lead or lead.tenant_id != ctx.tenant.id:
            raise HTTPException(404, "Лид не найден")
        contact.linked_lead_id = lead.id
    else:
        contact.linked_lead_id = None

    db.commit()
    return {"lead_id": contact.linked_lead_id, "contact": _contact_out(contact)}


# =============================================================================
# Auto-reply rules
# =============================================================================


@router.get("/channels/{channel_id}/auto-reply-rules")
def list_rules(
    channel_id: int,
    ctx: TenantContext = Depends(require("messengers.manage")),
    db: Session = Depends(get_db),
):
    _load_channel(db, ctx.tenant.id, channel_id)
    rows = (
        db.query(AutoReplyRule)
        .filter(AutoReplyRule.channel_id == channel_id)
        .order_by(AutoReplyRule.priority.desc(), AutoReplyRule.id.asc())
        .all()
    )
    return [_rule_out(r) for r in rows]


@router.post("/channels/{channel_id}/auto-reply-rules", status_code=201)
def create_rule(
    channel_id: int,
    payload: AutoReplyBody,
    ctx: TenantContext = Depends(require("messengers.manage")),
    db: Session = Depends(get_db),
):
    ch = _load_channel(db, ctx.tenant.id, channel_id)
    rule = AutoReplyRule(
        tenant_id=ctx.tenant.id,
        channel_id=ch.id,
        kind=AutoReplyKind(payload.kind),
        trigger_config=payload.trigger_config or {},
        response_text=payload.response_text,
        is_active=payload.is_active,
        priority=payload.priority,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return _rule_out(rule)


@router.patch("/auto-reply-rules/{rule_id}")
def patch_rule(
    rule_id: int,
    payload: AutoReplyBody,
    ctx: TenantContext = Depends(require("messengers.manage")),
    db: Session = Depends(get_db),
):
    rule = db.get(AutoReplyRule, rule_id)
    if not rule or rule.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Правило не найдено")
    rule.kind = AutoReplyKind(payload.kind)
    rule.trigger_config = payload.trigger_config or {}
    rule.response_text = payload.response_text
    rule.is_active = payload.is_active
    rule.priority = payload.priority
    db.commit()
    db.refresh(rule)
    return _rule_out(rule)


@router.delete("/auto-reply-rules/{rule_id}", response_model=Message)
def delete_rule(
    rule_id: int,
    ctx: TenantContext = Depends(require("messengers.manage")),
    db: Session = Depends(get_db),
):
    rule = db.get(AutoReplyRule, rule_id)
    if not rule or rule.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Правило не найдено")
    db.delete(rule)
    db.commit()
    return Message(message="Правило удалено")


# =============================================================================
# Message templates (per-tenant, не привязаны к каналу)
# =============================================================================


@router.get("/templates")
def list_templates(
    ctx: TenantContext = Depends(require("messengers.reply")),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(MessageTemplate)
        .filter(MessageTemplate.tenant_id == ctx.tenant.id)
        .order_by(MessageTemplate.name)
        .all()
    )
    return [_template_out(t) for t in rows]


@router.post("/templates", status_code=201)
def create_template(
    payload: TemplateBody,
    ctx: TenantContext = Depends(require("messengers.manage")),
    db: Session = Depends(get_db),
):
    t = MessageTemplate(
        tenant_id=ctx.tenant.id,
        name=payload.name.strip(),
        body=payload.body,
        kind=payload.kind,
        language=payload.language,
        whatsapp_template_name=payload.whatsapp_template_name,
        created_by=ctx.user.id,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return _template_out(t)


@router.patch("/templates/{template_id}")
def patch_template(
    template_id: int,
    payload: TemplateBody,
    ctx: TenantContext = Depends(require("messengers.manage")),
    db: Session = Depends(get_db),
):
    t = db.get(MessageTemplate, template_id)
    if not t or t.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Шаблон не найден")
    t.name = payload.name.strip()
    t.body = payload.body
    t.kind = payload.kind
    t.language = payload.language
    t.whatsapp_template_name = payload.whatsapp_template_name
    db.commit()
    db.refresh(t)
    return _template_out(t)


@router.delete("/templates/{template_id}", response_model=Message)
def delete_template(
    template_id: int,
    ctx: TenantContext = Depends(require("messengers.manage")),
    db: Session = Depends(get_db),
):
    t = db.get(MessageTemplate, template_id)
    if not t or t.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Шаблон не найден")
    db.delete(t)
    db.commit()
    return Message(message="Шаблон удалён")
