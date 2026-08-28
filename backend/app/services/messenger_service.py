"""Оркестрация входящих/исходящих сообщений и auto-reply.

Логика жизни сообщения:
- webhook_receiver.py принимает JSON, ставит Celery-задачу `messenger.ingest`
- worker вызывает `ingest_payload` (в этом файле): нормализует через provider,
  создаёт/обновляет ExternalContact и ExternalConversation, сохраняет
  ExternalMessage(direction=inbound), проверяет auto-reply, шлёт WS-события
- outbound: API `POST /conversations/{id}/messages` → `send_and_persist_message`
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.events import fire_event
from ..core.ws_hub import publish_to_tenant
from ..database import SessionLocal
from ..models import (
    AutoReplyKind, AutoReplyRule, ExternalChannel, ExternalContact, ExternalConversation,
    ExternalMessage, ManagerAvailability, MessageDirection, MessageStatus,
    TenantLead,
)
from .messengers import IncomingMessage, ProviderError, get_provider

log = logging.getLogger("qadam.messenger.service")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _upsert_contact(
    db: Session, channel: ExternalChannel, im: IncomingMessage
) -> ExternalContact:
    contact = (
        db.query(ExternalContact)
        .filter(
            ExternalContact.channel_id == channel.id,
            ExternalContact.external_id == im.contact_external_id,
        )
        .first()
    )
    if not contact:
        contact = ExternalContact(
            tenant_id=channel.tenant_id,
            channel_id=channel.id,
            external_id=im.contact_external_id,
            username=im.contact_username,
            display_name=im.contact_display_name,
            phone=im.contact_phone,
            avatar_url=im.contact_avatar_url,
        )
        db.add(contact)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            contact = (
                db.query(ExternalContact)
                .filter(
                    ExternalContact.channel_id == channel.id,
                    ExternalContact.external_id == im.contact_external_id,
                )
                .first()
            )
            if not contact:
                raise
        return contact

    # Обновляем публичные поля если провайдер прислал более свежие
    if im.contact_username and contact.username != im.contact_username:
        contact.username = im.contact_username
    if im.contact_display_name and contact.display_name != im.contact_display_name:
        contact.display_name = im.contact_display_name
    if im.contact_phone and contact.phone != im.contact_phone:
        contact.phone = im.contact_phone
    if im.contact_avatar_url and contact.avatar_url != im.contact_avatar_url:
        contact.avatar_url = im.contact_avatar_url
    return contact


def _upsert_conversation(
    db: Session, channel: ExternalChannel, contact: ExternalContact
) -> ExternalConversation:
    conv = (
        db.query(ExternalConversation)
        .filter(
            ExternalConversation.channel_id == channel.id,
            ExternalConversation.contact_id == contact.id,
        )
        .first()
    )
    if not conv:
        conv = ExternalConversation(
            tenant_id=channel.tenant_id,
            channel_id=channel.id,
            contact_id=contact.id,
        )
        db.add(conv)
        db.flush()
    return conv


def _preview(text: Optional[str], media: Optional[dict]) -> Optional[str]:
    if text:
        return text[:200]
    if media:
        return f"[{media.get('type', 'media')}]"
    return None


def ingest_payload(channel_id: int, payload: dict) -> dict:
    """Основной worker-хендлер входящих сообщений. Возвращает summary."""
    created_ids: list[int] = []
    with SessionLocal() as db:
        channel = db.get(ExternalChannel, channel_id)
        if not channel or not channel.is_active:
            log.info("ingest: канал %s недоступен", channel_id)
            return {"processed": 0, "channel_id": channel_id, "reason": "channel_missing_or_inactive"}
        try:
            provider = get_provider(channel.kind.value if hasattr(channel.kind, "value") else channel.kind,
                                    channel.provider_config or {}, channel.webhook_secret)
            messages = provider.parse_incoming(payload)
        except ProviderError as e:
            log.warning("ingest: parse error: %s", e)
            channel.last_error = str(e)[:2000]
            db.commit()
            return {"processed": 0, "error": str(e)}

        for im in messages:
            contact = _upsert_contact(db, channel, im)
            conv = _upsert_conversation(db, channel, contact)

            # Идемпотентность: если это сообщение уже сохранено — пропустить.
            if im.external_message_id:
                dup = (
                    db.query(ExternalMessage.id)
                    .filter(
                        ExternalMessage.conversation_id == conv.id,
                        ExternalMessage.external_message_id == im.external_message_id,
                        ExternalMessage.direction == MessageDirection.inbound,
                    )
                    .first()
                )
                if dup:
                    continue

            msg = ExternalMessage(
                tenant_id=channel.tenant_id,
                conversation_id=conv.id,
                direction=MessageDirection.inbound,
                status=MessageStatus.delivered,
                external_message_id=im.external_message_id,
                body=im.body,
                media=im.media,
            )
            db.add(msg)
            conv.last_message_at = _now()
            conv.last_message_preview = _preview(im.body, im.media)
            conv.unread_count = (conv.unread_count or 0) + 1
            db.flush()
            created_ids.append(msg.id)

            # Auto-reply — прогоняем правила канала
            reply_text = _match_auto_reply(db, channel, im, is_first_message=(conv.unread_count == 1))
            if reply_text:
                _send_auto_reply(db, provider, channel, conv, contact, reply_text)

            fire_event(
                "messenger.message_received",
                channel.tenant_id,
                {
                    "channel_id": channel.id,
                    "conversation_id": conv.id,
                    "contact_id": contact.id,
                    "message_id": msg.id,
                    "body": im.body,
                },
            )
            # Realtime WS для inbox
            publish_to_tenant(
                channel.tenant_id,
                "messenger.message.new",
                {
                    "channel_id": channel.id,
                    "conversation_id": conv.id,
                    "message": _serialize_message(msg),
                    "contact": {"id": contact.id, "display_name": contact.display_name},
                },
            )
        db.commit()

    return {"processed": len(created_ids), "message_ids": created_ids}


def _match_auto_reply(
    db: Session, channel: ExternalChannel, im: IncomingMessage, is_first_message: bool
) -> Optional[str]:
    """Возвращает ответ по правилам welcome/off_hours/keyword."""
    rules = (
        db.query(AutoReplyRule)
        .filter(
            AutoReplyRule.channel_id == channel.id,
            AutoReplyRule.is_active.is_(True),
        )
        .order_by(AutoReplyRule.priority.desc(), AutoReplyRule.id.asc())
        .all()
    )
    if not rules:
        return None
    text = (im.body or "").lower().strip()
    now = _now()

    for rule in rules:
        if rule.kind == AutoReplyKind.welcome:
            if is_first_message:
                return rule.response_text
        elif rule.kind == AutoReplyKind.off_hours:
            # Считаем «off-hours» — если ни один менеджер сейчас не на смене
            if not _any_manager_on_shift(db, channel.tenant_id, now):
                return rule.response_text
        elif rule.kind == AutoReplyKind.keyword:
            keywords = (rule.trigger_config or {}).get("keywords") or []
            for kw in keywords:
                if kw and str(kw).lower() in text:
                    return rule.response_text
    return None


def _any_manager_on_shift(db: Session, tenant_id: int, now: datetime) -> bool:
    """Есть ли хотя бы один менеджер с ManagerAvailability на смене сейчас."""
    from .lead_router import _is_on_shift
    rows = (
        db.query(ManagerAvailability)
        .filter(ManagerAvailability.tenant_id == tenant_id, ManagerAvailability.is_available.is_(True))
        .all()
    )
    for av in rows:
        if _is_on_shift(av, now):
            return True
    return False


def _send_auto_reply(
    db: Session, provider, channel: ExternalChannel, conv: ExternalConversation,
    contact: ExternalContact, text: str,
) -> None:
    outbound = ExternalMessage(
        tenant_id=channel.tenant_id,
        conversation_id=conv.id,
        direction=MessageDirection.outbound,
        status=MessageStatus.pending,
        body=text,
        is_auto=True,
    )
    db.add(outbound)
    db.flush()
    try:
        result = provider.send_message(contact.external_id, text, None)
        outbound.status = MessageStatus.sent
        outbound.external_message_id = result.external_message_id
    except ProviderError as e:
        outbound.status = MessageStatus.failed
        outbound.error = str(e)[:2000]


def send_and_persist_message(
    db: Session,
    channel: ExternalChannel,
    conversation: ExternalConversation,
    sender_user_id: Optional[int],
    body: Optional[str],
    media: Optional[dict] = None,
) -> ExternalMessage:
    """Отправка исходящего сообщения — вызывается из API-хендлера.

    Пишет запись в БД в состоянии pending, шлёт через provider, обновляет статус.
    """
    contact = conversation.contact
    if not contact:
        raise ProviderError("Диалог без контакта — отправка невозможна")

    msg = ExternalMessage(
        tenant_id=channel.tenant_id,
        conversation_id=conversation.id,
        direction=MessageDirection.outbound,
        status=MessageStatus.pending,
        sender_user_id=sender_user_id,
        body=body,
        media=media,
    )
    db.add(msg)
    db.flush()

    provider = get_provider(
        channel.kind.value if hasattr(channel.kind, "value") else channel.kind,
        channel.provider_config or {},
        channel.webhook_secret,
    )
    try:
        result = provider.send_message(contact.external_id, body, media)
        msg.status = MessageStatus.sent
        msg.external_message_id = result.external_message_id
        conversation.last_message_at = _now()
        conversation.last_message_preview = _preview(body, media)
        # Отправка НЕ увеличивает unread — это наше сообщение
    except ProviderError as e:
        msg.status = MessageStatus.failed
        msg.error = str(e)[:2000]
        # Не raise — сохраним failed-запись, вернём её пользователю
    return msg


def _serialize_message(msg: ExternalMessage) -> dict:
    return {
        "id": msg.id,
        "direction": msg.direction.value if hasattr(msg.direction, "value") else msg.direction,
        "status": msg.status.value if hasattr(msg.status, "value") else msg.status,
        "body": msg.body,
        "media": msg.media,
        "sender_user_id": msg.sender_user_id,
        "external_message_id": msg.external_message_id,
        "is_auto": msg.is_auto,
        "error": msg.error,
        "created_at": msg.created_at.isoformat() if msg.created_at else None,
    }
