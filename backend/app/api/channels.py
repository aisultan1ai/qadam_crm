"""Messenger API: каналы (проектные, DM, группы), сообщения, реакции, опросы, поиск.

Права:
  - messenger.use          — доступ ко всем endpoints (обязательно)
  - messenger.create_group — POST /channels/group
  - messenger.manage_any   — редактировать/удалять чужие сообщения
"""
import asyncio
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import and_, desc, func, or_
from sqlalchemy.orm import Session, joinedload

from ..config import settings
from ..core.file_types import check_magic_bytes
from ..core.plans import check_storage_limit
from ..core.redis_client import get_redis

from ..core.permissions import user_has
from ..core.ws_hub import publish_to_channel, publish_to_tenant, publish_to_user
from ..database import get_db
from ..models import (
    Attachment, Channel, ChannelMember, Message, MessageAttachment, MessageReaction,
    Poll, PollOption, PollVote, Project, User,
)
from ..schemas.common import Message as MessageSchema
from .deps import TenantContext, log_action, require

router = APIRouter(prefix="/api/messenger", tags=["messenger"])

ALLOWED_EMOJIS = {"👍", "❤️", "😂", "😮", "😢", "🎉", "🔥", "✅"}
MESSAGE_MAX_LEN = 4000
BODY_SNIPPET_LEN = 160


# =========================================================================
# Schemas
# =========================================================================


class UserBrief(BaseModel):
    id: int
    name: str
    email: str
    avatar_url: Optional[str] = None

    class Config:
        from_attributes = True


class ChannelMemberOut(BaseModel):
    user_id: int
    role: str
    muted: bool
    last_read_message_id: Optional[int]
    joined_at: datetime
    user: Optional[UserBrief] = None


class ChannelOut(BaseModel):
    id: int
    kind: str
    project_id: Optional[int]
    name: Optional[str]
    topic: Optional[str]
    is_archived: bool
    last_message_at: Optional[datetime]
    created_at: datetime
    members: List[ChannelMemberOut] = []
    unread_count: int = 0
    last_message_preview: Optional[str] = None


class ChannelListItem(BaseModel):
    id: int
    kind: str
    project_id: Optional[int]
    name: Optional[str]
    is_archived: bool
    last_message_at: Optional[datetime]
    unread_count: int = 0
    last_message_preview: Optional[str] = None
    peer: Optional[UserBrief] = None  # для DM — второй участник


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    member_ids: List[int] = Field(default_factory=list)


class GroupUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    topic: Optional[str] = Field(default=None, max_length=500)
    add_member_ids: Optional[List[int]] = None
    remove_member_ids: Optional[List[int]] = None


class ReactionOut(BaseModel):
    emoji: str
    count: int
    user_ids: List[int]


class AttachmentBrief(BaseModel):
    id: int
    filename: str
    content_type: Optional[str]
    size: int


class PollOptionOut(BaseModel):
    id: int
    text: str
    votes: int
    voted: bool = False


class PollOut(BaseModel):
    id: int
    question: str
    allow_multiple: bool
    anonymous: bool
    closes_at: Optional[datetime]
    closed_at: Optional[datetime]
    options: List[PollOptionOut]
    my_votes: List[int] = []
    total_votes: int = 0


class MessageOut(BaseModel):
    id: int
    channel_id: int
    author: Optional[UserBrief]
    body: str
    reply_to_id: Optional[int]
    reply_preview: Optional[str] = None
    edited_at: Optional[datetime]
    deleted_at: Optional[datetime]
    created_at: datetime
    reactions: List[ReactionOut] = []
    attachments: List[AttachmentBrief] = []
    poll: Optional[PollOut] = None


class MessageCreate(BaseModel):
    body: str = Field(default="", max_length=MESSAGE_MAX_LEN)
    reply_to_id: Optional[int] = None
    attachment_ids: List[int] = Field(default_factory=list)


class MessageUpdate(BaseModel):
    body: str = Field(min_length=1, max_length=MESSAGE_MAX_LEN)


class PollCreate(BaseModel):
    question: str = Field(min_length=1, max_length=300)
    options: List[str] = Field(min_length=2, max_length=10)
    allow_multiple: bool = False
    anonymous: bool = False


class PollVoteRequest(BaseModel):
    option_ids: List[int] = Field(min_length=1)


class ReactionRequest(BaseModel):
    emoji: str

    @field_validator("emoji")
    @classmethod
    def _valid_emoji(cls, v: str) -> str:
        if v not in ALLOWED_EMOJIS:
            raise ValueError("emoji not allowed")
        return v


class ReadRequest(BaseModel):
    message_id: int


class SearchHit(BaseModel):
    message_id: int
    channel_id: int
    snippet: str
    author: Optional[UserBrief]
    created_at: datetime


# =========================================================================
# Helpers
# =========================================================================


def _require_member(db: Session, ctx: TenantContext, channel_id: int) -> tuple[Channel, ChannelMember]:
    ch = db.get(Channel, channel_id)
    if not ch or ch.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Канал не найден")
    m = (
        db.query(ChannelMember)
        .filter(ChannelMember.channel_id == ch.id, ChannelMember.user_id == ctx.user.id)
        .first()
    )
    if not m:
        raise HTTPException(403, "Нет доступа к каналу")
    return ch, m


def _snippet(body: str) -> str:
    body = (body or "").strip().replace("\n", " ")
    return body[:BODY_SNIPPET_LEN] + ("…" if len(body) > BODY_SNIPPET_LEN else "")


def _serialize_reactions(msg: Message) -> List[ReactionOut]:
    grouped: dict[str, list[int]] = {}
    for r in msg.reactions:
        grouped.setdefault(r.emoji, []).append(r.user_id)
    return [ReactionOut(emoji=e, count=len(uids), user_ids=uids) for e, uids in grouped.items()]


def _serialize_attachments(db: Session, msg: Message) -> List[AttachmentBrief]:
    if not msg.attachments:
        return []
    ids = [ma.attachment_id for ma in msg.attachments]
    atts = db.query(Attachment).filter(Attachment.id.in_(ids)).all()
    return [
        AttachmentBrief(id=a.id, filename=a.filename, content_type=a.content_type, size=a.size)
        for a in atts
    ]


def _serialize_poll(db: Session, poll: Poll, user_id: int) -> PollOut:
    # my_votes
    my_votes = (
        db.query(PollVote.option_id)
        .filter(PollVote.poll_id == poll.id, PollVote.user_id == user_id)
        .all()
    )
    my_set = {row[0] for row in my_votes}
    total = db.query(func.count(PollVote.id)).filter(PollVote.poll_id == poll.id).scalar() or 0
    options = []
    for opt in poll.options:
        cnt = sum(1 for v in opt.votes)
        options.append(PollOptionOut(id=opt.id, text=opt.text, votes=cnt, voted=(opt.id in my_set)))
    return PollOut(
        id=poll.id,
        question=poll.question,
        allow_multiple=poll.allow_multiple,
        anonymous=poll.anonymous,
        closes_at=poll.closes_at,
        closed_at=poll.closed_at,
        options=options,
        my_votes=list(my_set),
        total_votes=total,
    )


def _serialize_message(db: Session, msg: Message, ctx: TenantContext) -> MessageOut:
    """Одиночная сериализация (send/edit/single-message endpoints).
    Для списков используй _serialize_messages_batch — избегает N+1."""
    return _serialize_messages_batch(db, [msg], ctx)[0]


def _serialize_messages_batch(db: Session, msgs: List[Message], ctx: TenantContext) -> List[MessageOut]:
    """Батч-сериализация списка сообщений: 1 SELECT авторов + 1 SELECT reply-parents +
    1 SELECT вложений вместо N SELECT'ов на сообщение. Poll'ы всё равно требуют
    per-poll SELECT для my_votes (можно оптимизировать позже — обычно польл 1-2 на канал)."""
    if not msgs:
        return []

    # 1) Батч авторов
    author_ids = {m.author_id for m in msgs if m.author_id}
    authors: dict[int, User] = {}
    if author_ids:
        for u in db.query(User).filter(User.id.in_(author_ids)).all():
            authors[u.id] = u

    # 2) Батч reply-parents (только body для preview)
    reply_ids = {m.reply_to_id for m in msgs if m.reply_to_id}
    reply_bodies: dict[int, str] = {}
    if reply_ids:
        rows = db.query(Message.id, Message.body).filter(Message.id.in_(reply_ids)).all()
        for rid, rbody in rows:
            reply_bodies[rid] = rbody or ""

    # 3) Батч вложений: собираем attachment_ids из уже подтянутых message.attachments
    all_att_ids: set[int] = set()
    for m in msgs:
        if m.deleted_at:
            continue
        for ma in m.attachments:
            all_att_ids.add(ma.attachment_id)
    att_map: dict[int, Attachment] = {}
    if all_att_ids:
        for a in db.query(Attachment).filter(Attachment.id.in_(all_att_ids)).all():
            att_map[a.id] = a

    out: List[MessageOut] = []
    for m in msgs:
        author_brief = UserBrief.model_validate(authors[m.author_id]) if m.author_id and m.author_id in authors else None
        reply_preview: Optional[str] = None
        if m.reply_to_id and m.reply_to_id in reply_bodies:
            reply_preview = _snippet(reply_bodies[m.reply_to_id])
        body = m.body if not m.deleted_at else "[сообщение удалено]"

        if m.deleted_at:
            attachments_out: List[AttachmentBrief] = []
            reactions_out: List[ReactionOut] = []
            poll_out: Optional[PollOut] = None
        else:
            attachments_out = [
                AttachmentBrief(id=a.id, filename=a.filename, content_type=a.content_type, size=a.size)
                for a in (att_map.get(ma.attachment_id) for ma in m.attachments)
                if a is not None
            ]
            reactions_out = _serialize_reactions(m)
            poll_out = _serialize_poll(db, m.poll, ctx.user.id) if m.poll else None

        out.append(MessageOut(
            id=m.id,
            channel_id=m.channel_id,
            author=author_brief,
            body=body,
            reply_to_id=m.reply_to_id,
            reply_preview=reply_preview,
            edited_at=m.edited_at,
            deleted_at=m.deleted_at,
            created_at=m.created_at,
            reactions=reactions_out,
            attachments=attachments_out,
            poll=poll_out,
        ))
    return out


UNREAD_CACHE_TTL = 60  # секунд


def _unread_cache_key(channel_id: int, user_id: int) -> str:
    return f"ch_unread:{channel_id}:{user_id}"


def invalidate_unread_cache(channel_id: int, user_ids: Optional[List[int]] = None) -> None:
    """Инвалидация unread-кеша. Вызывать при новом сообщении и mark_read."""
    try:
        r = get_redis()
        if user_ids:
            keys = [_unread_cache_key(channel_id, uid) for uid in user_ids]
            if keys:
                r.delete(*keys)
        else:
            # если user_ids не задан — очистить все ключи по каналу (SCAN)
            pattern = f"ch_unread:{channel_id}:*"
            for key in r.scan_iter(match=pattern, count=200):
                r.delete(key)
    except Exception:
        pass


def _unread_count(
    db: Session,
    channel_id: int,
    last_read_message_id: Optional[int],
    user_id: Optional[int] = None,
) -> int:
    """Подсчёт непрочитанных сообщений. Использует Redis-кеш при заданном user_id.
    Исключает сообщения самого пользователя (юзер не может быть unread у себя)."""
    if user_id is not None:
        try:
            r = get_redis()
            cached = r.get(_unread_cache_key(channel_id, user_id))
            if cached is not None:
                return int(cached)
        except Exception:
            pass

    q = db.query(func.count(Message.id)).filter(
        Message.channel_id == channel_id,
        Message.deleted_at.is_(None),
    )
    if last_read_message_id:
        q = q.filter(Message.id > last_read_message_id)
    if user_id is not None:
        q = q.filter(Message.author_id != user_id)
    count = q.scalar() or 0

    if user_id is not None:
        try:
            get_redis().setex(_unread_cache_key(channel_id, user_id), UNREAD_CACHE_TTL, count)
        except Exception:
            pass
    return count


def _batch_unread_counts(
    db: Session,
    memberships: List[tuple[ChannelMember, Channel]],
    user_id: int,
) -> dict[int, int]:
    """Батч-подсчёт unread для списка каналов. Кеш через Redis, остальное — одним
    GROUP BY запросом."""
    result: dict[int, int] = {}
    to_compute: list[tuple[int, Optional[int]]] = []

    try:
        r = get_redis()
        keys = [_unread_cache_key(ch.id, user_id) for _, ch in memberships]
        cached_values = r.mget(keys) if keys else []
    except Exception:
        cached_values = [None] * len(memberships)

    for (m, ch), cached in zip(memberships, cached_values):
        if cached is not None:
            result[ch.id] = int(cached)
        else:
            to_compute.append((ch.id, m.last_read_message_id))

    if to_compute:
        # За один GROUP BY считаем всё что не в кеше
        channel_ids = [cid for cid, _ in to_compute]
        rows = (
            db.query(Message.channel_id, func.count(Message.id))
            .filter(
                Message.channel_id.in_(channel_ids),
                Message.deleted_at.is_(None),
                Message.author_id != user_id,
            )
            .group_by(Message.channel_id)
            .all()
        )
        counts_by_channel = {cid: cnt for cid, cnt in rows}
        # Учитываем last_read_message_id — если задан, вычесть count сообщений старше last_read.
        # Проще: делаем второй запрос — сумма всех, минус сумма старых. Или заново с per-channel фильтром через OR.
        # Компромисс: делаем ещё один запрос "старые" по каналам с last_read.
        with_last_read = [(cid, lr) for cid, lr in to_compute if lr]
        old_by_channel: dict[int, int] = {}
        if with_last_read:
            from sqlalchemy import case, and_
            conditions = [
                and_(Message.channel_id == cid, Message.id <= lr)
                for cid, lr in with_last_read
            ]
            old_rows = (
                db.query(Message.channel_id, func.count(Message.id))
                .filter(
                    Message.channel_id.in_([cid for cid, _ in with_last_read]),
                    Message.deleted_at.is_(None),
                    Message.author_id != user_id,
                    or_(*conditions),
                )
                .group_by(Message.channel_id)
                .all()
            )
            old_by_channel = {cid: cnt for cid, cnt in old_rows}

        try:
            r = get_redis()
            pipe = r.pipeline()
            for cid, _ in to_compute:
                total = counts_by_channel.get(cid, 0)
                old = old_by_channel.get(cid, 0)
                unread = max(0, total - old)
                result[cid] = unread
                pipe.setex(_unread_cache_key(cid, user_id), UNREAD_CACHE_TTL, unread)
            pipe.execute()
        except Exception:
            for cid, _ in to_compute:
                total = counts_by_channel.get(cid, 0)
                old = old_by_channel.get(cid, 0)
                result[cid] = max(0, total - old)
    return result


def _brief_user(u: Optional[User]) -> Optional[UserBrief]:
    return UserBrief.model_validate(u) if u else None


# =========================================================================
# MSG3: Каналы
# =========================================================================


@router.get("/channels", response_model=List[ChannelListItem])
def list_channels(
    ctx: TenantContext = Depends(require("messenger.use")),
    db: Session = Depends(get_db),
):
    """Все каналы, где юзер участник, отсортированные по last_message_at.
    Оптимизировано под 50+ каналов на юзера: 4 SQL-запроса вместо N."""
    memberships = (
        db.query(ChannelMember, Channel)
        .join(Channel, Channel.id == ChannelMember.channel_id)
        .filter(
            ChannelMember.user_id == ctx.user.id,
            Channel.tenant_id == ctx.tenant.id,
            Channel.is_archived.is_(False),
        )
        .all()
    )
    if not memberships:
        return []

    channel_ids = [ch.id for _, ch in memberships]
    dm_channel_ids = [ch.id for _, ch in memberships if ch.kind == "dm"]
    project_ids = [ch.project_id for _, ch in memberships if ch.kind == "project" and ch.project_id]

    # 1) Батч peers для DM (один запрос на все DM-каналы)
    peer_by_channel: dict[int, UserBrief] = {}
    if dm_channel_ids:
        peer_rows = (
            db.query(ChannelMember.channel_id, User)
            .join(User, User.id == ChannelMember.user_id)
            .filter(
                ChannelMember.channel_id.in_(dm_channel_ids),
                ChannelMember.user_id != ctx.user.id,
            )
            .all()
        )
        for cid, u in peer_rows:
            peer_by_channel[cid] = _brief_user(u)

    # 2) Батч проектов для project-каналов
    project_by_id: dict[int, Project] = {}
    if project_ids:
        for p in db.query(Project).filter(Project.id.in_(project_ids)).all():
            project_by_id[p.id] = p

    # 3) Батч last_message: subquery с MAX(id) per channel, потом JOIN к messages.
    last_msg_by_channel: dict[int, Message] = {}
    if channel_ids:
        max_id_subq = (
            db.query(Message.channel_id, func.max(Message.id).label("max_id"))
            .filter(
                Message.channel_id.in_(channel_ids),
                Message.deleted_at.is_(None),
            )
            .group_by(Message.channel_id)
            .subquery()
        )
        last_rows = (
            db.query(Message)
            .join(max_id_subq, Message.id == max_id_subq.c.max_id)
            .all()
        )
        for m in last_rows:
            last_msg_by_channel[m.channel_id] = m

    # 4) Батч unread через Redis-кеш + один GROUP BY для промахов
    unread_by_channel = _batch_unread_counts(db, memberships, ctx.user.id)

    out: List[ChannelListItem] = []
    for m, ch in memberships:
        peer = peer_by_channel.get(ch.id)
        name = ch.name
        if ch.kind == "dm" and peer and not name:
            name = peer.name
        elif ch.kind == "project" and not name and ch.project_id:
            p = project_by_id.get(ch.project_id)
            if p:
                name = f"#{p.name}"

        last_msg = last_msg_by_channel.get(ch.id)
        preview = _snippet(last_msg.body) if last_msg else None
        unread = unread_by_channel.get(ch.id, 0)

        out.append(ChannelListItem(
            id=ch.id, kind=ch.kind, project_id=ch.project_id, name=name,
            is_archived=ch.is_archived, last_message_at=ch.last_message_at,
            unread_count=unread, last_message_preview=preview, peer=peer,
        ))
    out.sort(key=lambda c: (c.last_message_at or datetime.min.replace(tzinfo=timezone.utc)), reverse=True)
    return out


@router.get("/channels/{channel_id}", response_model=ChannelOut)
def get_channel(
    channel_id: int,
    ctx: TenantContext = Depends(require("messenger.use")),
    db: Session = Depends(get_db),
):
    ch, m = _require_member(db, ctx, channel_id)
    members_out: List[ChannelMemberOut] = []
    for cm in ch.members:
        u = db.get(User, cm.user_id)
        members_out.append(ChannelMemberOut(
            user_id=cm.user_id, role=cm.role, muted=cm.muted,
            last_read_message_id=cm.last_read_message_id, joined_at=cm.joined_at,
            user=_brief_user(u),
        ))

    last_msg = (
        db.query(Message)
        .filter(Message.channel_id == ch.id, Message.deleted_at.is_(None))
        .order_by(desc(Message.id))
        .first()
    )
    name = ch.name
    if ch.kind == "dm" and not name:
        peer = next((mm.user_id for mm in ch.members if mm.user_id != ctx.user.id), None)
        if peer:
            u = db.get(User, peer)
            if u:
                name = u.name

    return ChannelOut(
        id=ch.id, kind=ch.kind, project_id=ch.project_id, name=name, topic=ch.topic,
        is_archived=ch.is_archived, last_message_at=ch.last_message_at, created_at=ch.created_at,
        members=members_out, unread_count=_unread_count(db, ch.id, m.last_read_message_id, ctx.user.id),
        last_message_preview=_snippet(last_msg.body) if last_msg else None,
    )


@router.post("/channels/dm/{user_id}", response_model=ChannelOut, status_code=201)
def get_or_create_dm(
    user_id: int,
    ctx: TenantContext = Depends(require("messenger.use")),
    db: Session = Depends(get_db),
):
    if user_id == ctx.user.id:
        raise HTTPException(400, "Нельзя писать самому себе")
    peer = db.get(User, user_id)
    if not peer or not peer.is_active:
        raise HTTPException(404, "Пользователь не найден")
    from sqlalchemy import text
    from ..models import TenantMembership
    same_tenant = (
        db.query(TenantMembership.id)
        .filter(TenantMembership.tenant_id == ctx.tenant.id, TenantMembership.user_id == peer.id)
        .first()
    )
    if not same_tenant:
        raise HTTPException(404, "Пользователь не в вашей компании")

    # Advisory lock: гарантированно один процесс создаёт DM для пары юзеров.
    # Ключ — упорядоченная пара (меньший, больший) в tenant scope.
    a, b = sorted([ctx.user.id, peer.id])
    lock_key = (ctx.tenant.id * 1_000_000_007 + a * 100_003 + b) % (2**63 - 1)
    db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": lock_key})

    # После lock — повторно ищем существующий DM.
    subq_me = (
        db.query(ChannelMember.channel_id)
        .filter(ChannelMember.user_id == ctx.user.id)
        .subquery()
    )
    existing = (
        db.query(Channel)
        .join(ChannelMember, ChannelMember.channel_id == Channel.id)
        .filter(
            Channel.tenant_id == ctx.tenant.id,
            Channel.kind == "dm",
            Channel.id.in_(subq_me),
            ChannelMember.user_id == peer.id,
        )
        .first()
    )
    if existing:
        db.commit()  # освобождаем xact-lock
        return get_channel(existing.id, ctx=ctx, db=db)

    ch = Channel(tenant_id=ctx.tenant.id, kind="dm", created_by=ctx.user.id)
    db.add(ch)
    db.flush()
    db.add_all([
        ChannelMember(channel_id=ch.id, user_id=ctx.user.id, role="member"),
        ChannelMember(channel_id=ch.id, user_id=peer.id, role="member"),
    ])
    db.commit()
    db.refresh(ch)
    publish_to_user(ctx.tenant.id, peer.id, "channel.new", {"channel_id": ch.id, "kind": "dm"})
    return get_channel(ch.id, ctx=ctx, db=db)


@router.post("/channels/group", response_model=ChannelOut, status_code=201)
def create_group(
    payload: GroupCreate,
    ctx: TenantContext = Depends(require("messenger.create_group")),
    db: Session = Depends(get_db),
):
    ids = set(payload.member_ids) | {ctx.user.id}
    from ..models import TenantMembership
    valid = (
        db.query(TenantMembership.user_id)
        .filter(TenantMembership.tenant_id == ctx.tenant.id, TenantMembership.user_id.in_(ids))
        .all()
    )
    valid_ids = {row[0] for row in valid}
    if len(valid_ids) < 2:
        raise HTTPException(400, "Нужно минимум 2 участника из вашей компании")

    ch = Channel(tenant_id=ctx.tenant.id, kind="group", name=payload.name.strip(), created_by=ctx.user.id)
    db.add(ch)
    db.flush()
    for uid in valid_ids:
        db.add(ChannelMember(
            channel_id=ch.id, user_id=uid,
            role="owner" if uid == ctx.user.id else "member",
        ))
    db.commit()
    db.refresh(ch)
    for uid in valid_ids:
        if uid != ctx.user.id:
            publish_to_user(ctx.tenant.id, uid, "channel.new", {"channel_id": ch.id, "kind": "group"})
    return get_channel(ch.id, ctx=ctx, db=db)


@router.patch("/channels/{channel_id}", response_model=ChannelOut)
def update_channel(
    channel_id: int,
    payload: GroupUpdate,
    ctx: TenantContext = Depends(require("messenger.use")),
    db: Session = Depends(get_db),
):
    ch, me = _require_member(db, ctx, channel_id)
    if ch.kind == "dm":
        raise HTTPException(400, "DM нельзя редактировать")
    if ch.kind == "project":
        raise HTTPException(400, "Канал проекта редактируется через проект")
    if me.role != "owner" and not user_has(ctx.user, ["messenger.manage_any"]):
        raise HTTPException(403, "Только владелец может изменять группу")

    if payload.name is not None:
        ch.name = payload.name.strip()
    if payload.topic is not None:
        ch.topic = payload.topic.strip() or None
    if payload.add_member_ids:
        from ..models import TenantMembership
        valid = (
            db.query(TenantMembership.user_id)
            .filter(TenantMembership.tenant_id == ctx.tenant.id, TenantMembership.user_id.in_(payload.add_member_ids))
            .all()
        )
        for row in valid:
            uid = row[0]
            existing = (
                db.query(ChannelMember.id)
                .filter(ChannelMember.channel_id == ch.id, ChannelMember.user_id == uid)
                .first()
            )
            if not existing:
                db.add(ChannelMember(channel_id=ch.id, user_id=uid))
                publish_to_user(ctx.tenant.id, uid, "channel.new", {"channel_id": ch.id, "kind": ch.kind})
    if payload.remove_member_ids:
        db.query(ChannelMember).filter(
            ChannelMember.channel_id == ch.id,
            ChannelMember.user_id.in_(payload.remove_member_ids),
            ChannelMember.user_id != ctx.user.id,
        ).delete(synchronize_session=False)

    db.commit()
    db.refresh(ch)
    publish_to_channel(ctx.tenant.id, ch.id, "channel.updated", {"id": ch.id})
    return get_channel(ch.id, ctx=ctx, db=db)


@router.delete("/channels/{channel_id}", response_model=MessageSchema)
def delete_channel(
    channel_id: int,
    ctx: TenantContext = Depends(require("messenger.use")),
    db: Session = Depends(get_db),
):
    ch, me = _require_member(db, ctx, channel_id)
    if ch.kind == "project":
        raise HTTPException(400, "Канал проекта нельзя удалить отдельно от проекта")
    if ch.kind == "group" and me.role != "owner" and not user_has(ctx.user, ["messenger.manage_any"]):
        raise HTTPException(403, "Только владелец может удалить группу")
    tenant_id = ch.tenant_id
    cid = ch.id
    db.delete(ch)
    db.commit()
    publish_to_channel(tenant_id, cid, "channel.deleted", {"id": cid})
    return MessageSchema(message="Канал удалён")


@router.post("/channels/{channel_id}/leave", response_model=MessageSchema)
def leave_channel(
    channel_id: int,
    ctx: TenantContext = Depends(require("messenger.use")),
    db: Session = Depends(get_db),
):
    ch, me = _require_member(db, ctx, channel_id)
    if ch.kind == "project":
        raise HTTPException(400, "Выйти из канала проекта нельзя — покиньте сам проект")
    db.delete(me)
    db.commit()
    return MessageSchema(message="Вы покинули канал")


# =========================================================================
# MSG4: Сообщения + реакции + read-receipts
# =========================================================================


@router.get("/channels/{channel_id}/messages", response_model=List[MessageOut])
def list_messages(
    channel_id: int,
    before: Optional[int] = Query(default=None),
    after: Optional[int] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    ctx: TenantContext = Depends(require("messenger.use")),
    db: Session = Depends(get_db),
):
    _require_member(db, ctx, channel_id)
    q = db.query(Message).filter(Message.channel_id == channel_id)
    if before:
        q = q.filter(Message.id < before)
    if after:
        q = q.filter(Message.id > after)
    rows = q.order_by(desc(Message.id)).limit(limit).all()
    rows.reverse()
    return _serialize_messages_batch(db, rows, ctx)


@router.post("/channels/{channel_id}/messages", response_model=MessageOut, status_code=201)
def send_message(
    channel_id: int,
    payload: MessageCreate,
    ctx: TenantContext = Depends(require("messenger.use")),
    db: Session = Depends(get_db),
):
    ch, me = _require_member(db, ctx, channel_id)
    body = payload.body.strip()
    if not body and not payload.attachment_ids:
        raise HTTPException(400, "Пустое сообщение")

    if payload.reply_to_id:
        parent = db.get(Message, payload.reply_to_id)
        if not parent or parent.channel_id != ch.id:
            raise HTTPException(400, "reply_to_id не из этого канала")

    msg = Message(
        tenant_id=ctx.tenant.id,
        channel_id=ch.id,
        author_id=ctx.user.id,
        body=body,
        reply_to_id=payload.reply_to_id,
    )
    db.add(msg)
    db.flush()

    for att_id in payload.attachment_ids or []:
        att = db.get(Attachment, att_id)
        if not att or att.tenant_id != ctx.tenant.id:
            continue
        db.add(MessageAttachment(message_id=msg.id, attachment_id=att.id))

    ch.last_message_at = msg.created_at
    me.last_read_message_id = msg.id
    db.commit()
    db.refresh(msg)

    # Инвалидируем unread-кеш всех членов канала кроме автора (у автора unread не меняется).
    other_member_ids = [cm.user_id for cm in ch.members if cm.user_id != ctx.user.id]
    if other_member_ids:
        invalidate_unread_cache(ch.id, other_member_ids)

    out = _serialize_message(db, msg, ctx)
    publish_to_channel(ctx.tenant.id, ch.id, "message.new", {"message": out.model_dump(mode="json")})
    _notify_mentions_and_new_message(db, ctx, ch, msg)
    return out


def _notify_mentions_and_new_message(db: Session, ctx: TenantContext, ch: Channel, msg: Message) -> None:
    """WS-нотификация участникам канала с инкрементом unread — одним broadcast
    вместо N per-user publish. Клиент фильтрует по user_ids в payload."""
    other_ids = [cm.user_id for cm in ch.members if cm.user_id != ctx.user.id]
    if not other_ids:
        return
    publish_to_tenant(
        ctx.tenant.id, "messenger.unread",
        {"channel_id": ch.id, "message_id": msg.id, "user_ids": other_ids},
    )


@router.patch("/channels/{channel_id}/messages/{message_id}", response_model=MessageOut)
def edit_message(
    channel_id: int,
    message_id: int,
    payload: MessageUpdate,
    ctx: TenantContext = Depends(require("messenger.use")),
    db: Session = Depends(get_db),
):
    ch, _ = _require_member(db, ctx, channel_id)
    msg = db.get(Message, message_id)
    if not msg or msg.channel_id != ch.id or msg.deleted_at:
        raise HTTPException(404, "Сообщение не найдено")
    if msg.author_id != ctx.user.id and not user_has(ctx.user, ["messenger.manage_any"]):
        raise HTTPException(403, "Можно редактировать только свои сообщения")

    msg.body = payload.body.strip()
    msg.edited_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(msg)
    out = _serialize_message(db, msg, ctx)
    publish_to_channel(ctx.tenant.id, ch.id, "message.edit", {"message": out.model_dump(mode="json")})
    return out


@router.delete("/channels/{channel_id}/messages/{message_id}", response_model=MessageSchema)
def delete_message(
    channel_id: int,
    message_id: int,
    ctx: TenantContext = Depends(require("messenger.use")),
    db: Session = Depends(get_db),
):
    ch, _ = _require_member(db, ctx, channel_id)
    msg = db.get(Message, message_id)
    if not msg or msg.channel_id != ch.id or msg.deleted_at:
        raise HTTPException(404, "Сообщение не найдено")
    if msg.author_id != ctx.user.id and not user_has(ctx.user, ["messenger.manage_any"]):
        raise HTTPException(403, "Можно удалять только свои сообщения")

    msg.deleted_at = datetime.now(timezone.utc)
    db.commit()
    publish_to_channel(ctx.tenant.id, ch.id, "message.delete", {"message_id": msg.id, "channel_id": ch.id})
    return MessageSchema(message="Сообщение удалено")


@router.post("/messages/{message_id}/reactions", response_model=MessageSchema, status_code=201)
def add_reaction(
    message_id: int,
    payload: ReactionRequest,
    ctx: TenantContext = Depends(require("messenger.use")),
    db: Session = Depends(get_db),
):
    msg = db.get(Message, message_id)
    if not msg or msg.tenant_id != ctx.tenant.id or msg.deleted_at:
        raise HTTPException(404, "Сообщение не найдено")
    _require_member(db, ctx, msg.channel_id)
    existing = (
        db.query(MessageReaction.id)
        .filter(
            MessageReaction.message_id == message_id,
            MessageReaction.user_id == ctx.user.id,
            MessageReaction.emoji == payload.emoji,
        )
        .first()
    )
    if existing:
        return MessageSchema(message="Уже есть")
    db.add(MessageReaction(message_id=message_id, user_id=ctx.user.id, emoji=payload.emoji))
    db.commit()
    publish_to_channel(ctx.tenant.id, msg.channel_id, "reaction.add",
                       {"message_id": message_id, "emoji": payload.emoji, "user_id": ctx.user.id})
    return MessageSchema(message="Реакция добавлена")


@router.delete("/messages/{message_id}/reactions/{emoji}", response_model=MessageSchema)
def remove_reaction(
    message_id: int,
    emoji: str,
    ctx: TenantContext = Depends(require("messenger.use")),
    db: Session = Depends(get_db),
):
    if emoji not in ALLOWED_EMOJIS:
        raise HTTPException(400, "emoji not allowed")
    msg = db.get(Message, message_id)
    if not msg or msg.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Сообщение не найдено")
    _require_member(db, ctx, msg.channel_id)
    db.query(MessageReaction).filter(
        MessageReaction.message_id == message_id,
        MessageReaction.user_id == ctx.user.id,
        MessageReaction.emoji == emoji,
    ).delete(synchronize_session=False)
    db.commit()
    publish_to_channel(ctx.tenant.id, msg.channel_id, "reaction.remove",
                       {"message_id": message_id, "emoji": emoji, "user_id": ctx.user.id})
    return MessageSchema(message="Реакция снята")


@router.post("/channels/{channel_id}/read", response_model=MessageSchema)
def mark_read(
    channel_id: int,
    payload: ReadRequest,
    ctx: TenantContext = Depends(require("messenger.use")),
    db: Session = Depends(get_db),
):
    _, me = _require_member(db, ctx, channel_id)
    if not me.last_read_message_id or payload.message_id > me.last_read_message_id:
        me.last_read_message_id = payload.message_id
        db.commit()
        invalidate_unread_cache(channel_id, [ctx.user.id])
    publish_to_channel(ctx.tenant.id, channel_id, "read.receipt",
                       {"channel_id": channel_id, "user_id": ctx.user.id, "message_id": payload.message_id})
    return MessageSchema(message="OK")


# =========================================================================
# MSG5: Опросы
# =========================================================================


@router.post("/messages/{message_id}/polls", response_model=PollOut, status_code=201)
def create_poll(
    message_id: int,
    payload: PollCreate,
    ctx: TenantContext = Depends(require("messenger.use")),
    db: Session = Depends(get_db),
):
    msg = db.get(Message, message_id)
    if not msg or msg.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Сообщение не найдено")
    if msg.author_id != ctx.user.id and not user_has(ctx.user, ["messenger.manage_any"]):
        raise HTTPException(403, "Опрос может создать только автор сообщения")
    if msg.poll:
        raise HTTPException(400, "Опрос уже привязан к сообщению")
    _require_member(db, ctx, msg.channel_id)

    poll = Poll(
        message_id=msg.id,
        question=payload.question.strip(),
        allow_multiple=payload.allow_multiple,
        anonymous=payload.anonymous,
    )
    db.add(poll)
    db.flush()
    for i, text in enumerate(payload.options):
        db.add(PollOption(poll_id=poll.id, text=text.strip()[:300], order_index=i))
    db.commit()
    db.refresh(poll)
    out = _serialize_poll(db, poll, ctx.user.id)
    publish_to_channel(ctx.tenant.id, msg.channel_id, "poll.create",
                       {"message_id": message_id, "poll": out.model_dump(mode="json")})
    return out


@router.post("/polls/{poll_id}/vote", response_model=PollOut)
def vote_poll(
    poll_id: int,
    payload: PollVoteRequest,
    ctx: TenantContext = Depends(require("messenger.use")),
    db: Session = Depends(get_db),
):
    poll = db.get(Poll, poll_id)
    if not poll:
        raise HTTPException(404, "Опрос не найден")
    if poll.closed_at:
        raise HTTPException(400, "Опрос закрыт")
    msg = db.get(Message, poll.message_id)
    if not msg:
        raise HTTPException(404, "Опрос не найден")
    _require_member(db, ctx, msg.channel_id)

    valid_option_ids = {opt.id for opt in poll.options}
    to_add = [oid for oid in payload.option_ids if oid in valid_option_ids]
    if not to_add:
        raise HTTPException(400, "Не выбраны варианты")
    if not poll.allow_multiple and len(to_add) > 1:
        raise HTTPException(400, "В этом опросе можно выбрать только один вариант")

    # Снимаем предыдущие голоса юзера в этом опросе (для перевыбора)
    db.query(PollVote).filter(PollVote.poll_id == poll_id, PollVote.user_id == ctx.user.id).delete(synchronize_session=False)
    for oid in to_add:
        db.add(PollVote(poll_id=poll_id, option_id=oid, user_id=ctx.user.id))
    db.commit()
    db.refresh(poll)
    out = _serialize_poll(db, poll, ctx.user.id)
    publish_to_channel(ctx.tenant.id, msg.channel_id, "poll.vote",
                       {"message_id": poll.message_id, "poll": out.model_dump(mode="json")})
    return out


@router.post("/polls/{poll_id}/close", response_model=PollOut)
def close_poll(
    poll_id: int,
    ctx: TenantContext = Depends(require("messenger.use")),
    db: Session = Depends(get_db),
):
    poll = db.get(Poll, poll_id)
    if not poll:
        raise HTTPException(404, "Опрос не найден")
    msg = db.get(Message, poll.message_id)
    if not msg:
        raise HTTPException(404, "Опрос не найден")
    if msg.author_id != ctx.user.id and not user_has(ctx.user, ["messenger.manage_any"]):
        raise HTTPException(403, "Закрыть может только автор")
    poll.closed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(poll)
    out = _serialize_poll(db, poll, ctx.user.id)
    publish_to_channel(ctx.tenant.id, msg.channel_id, "poll.close",
                       {"message_id": poll.message_id, "poll": out.model_dump(mode="json")})
    return out


# =========================================================================
# Вложения в мессенджере (переиспользуем модель Attachment с task_id=NULL)
# =========================================================================


ALLOWED_MSG_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt", ".md",
    ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".zip", ".mp3", ".mp4", ".mov",
}
BLOCKED_MSG_EXTENSIONS = {
    ".exe", ".bat", ".cmd", ".sh", ".ps1", ".msi", ".scr", ".vbs", ".js",
    ".html", ".htm", ".xhtml", ".svg", ".xml", ".php",
}


@router.post("/channels/{channel_id}/upload", status_code=201)
async def upload_message_attachment(
    channel_id: int,
    file: UploadFile = File(...),
    ctx: TenantContext = Depends(require("messenger.use")),
    db: Session = Depends(get_db),
):
    _require_member(db, ctx, channel_id)
    check_storage_limit(db, ctx.tenant, additional_bytes=0)

    ext = Path(file.filename or "").suffix.lower()
    if not ext or ext in BLOCKED_MSG_EXTENSIONS or ext not in ALLOWED_MSG_EXTENSIONS:
        raise HTTPException(400, f"Расширение {ext or '?'} не разрешено")

    upload_dir = Path(settings.UPLOAD_DIR) / str(ctx.tenant.id) / "attachments"
    upload_dir.mkdir(parents=True, exist_ok=True)
    stored = f"{uuid.uuid4().hex}{ext}"
    dest = upload_dir / stored

    # Синхронный I/O выполняем в thread-pool, чтобы не блокировать event loop
    # (10 MB файл через chunk-by-chunk .read() блокировал бы ~500ms-1s).
    def _write_sync() -> int:
        written = 0
        magic_checked = False
        with dest.open("wb") as out:
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    break
                if not magic_checked:
                    magic_checked = True
                    reason = check_magic_bytes(chunk[:32], ext)
                    if reason:
                        raise HTTPException(400, reason)
                written += len(chunk)
                if written > settings.MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "Файл слишком большой")
                out.write(chunk)
        return written

    try:
        written = await asyncio.to_thread(_write_sync)
    except HTTPException:
        dest.unlink(missing_ok=True)
        raise
    except Exception:
        dest.unlink(missing_ok=True)
        raise HTTPException(500, "Не удалось сохранить файл")

    if written == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, "Пустой файл")

    check_storage_limit(db, ctx.tenant, additional_bytes=written)

    att = Attachment(
        tenant_id=ctx.tenant.id,
        task_id=None,
        filename=file.filename or stored,
        stored_name=f"{ctx.tenant.id}/attachments/{stored}",
        content_type=file.content_type,
        size=written,
        uploaded_by=ctx.user.id,
    )
    db.add(att)
    db.commit()
    db.refresh(att)
    return {"id": att.id, "filename": att.filename, "content_type": att.content_type, "size": att.size}


@router.get("/attachments/{attachment_id}")
def download_message_attachment(
    attachment_id: int,
    ctx: TenantContext = Depends(require("messenger.use")),
    db: Session = Depends(get_db),
):
    att = db.get(Attachment, attachment_id)
    if not att or att.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Файл не найден")
    # Проверяем, что юзер — участник канала, где это вложение прикреплено к сообщению
    linked = (
        db.query(Message)
        .join(MessageAttachment, MessageAttachment.message_id == Message.id)
        .filter(MessageAttachment.attachment_id == att.id)
        .first()
    )
    if not linked:
        raise HTTPException(404, "Файл не найден")
    is_member = (
        db.query(ChannelMember.id)
        .filter(ChannelMember.channel_id == linked.channel_id, ChannelMember.user_id == ctx.user.id)
        .first()
    )
    if not is_member:
        raise HTTPException(403, "Нет доступа")

    upload_root = Path(settings.UPLOAD_DIR).resolve()
    candidate = (upload_root / att.stored_name).resolve()
    try:
        candidate.relative_to(upload_root)
    except ValueError:
        raise HTTPException(404, "Файл не найден")
    if not candidate.exists():
        raise HTTPException(404, "Файл отсутствует на диске")
    return FileResponse(candidate, media_type=att.content_type or "application/octet-stream", filename=att.filename)


# =========================================================================
# MSG7: Поиск
# =========================================================================


@router.get("/search", response_model=List[SearchHit])
def search_messages(
    q: str = Query(min_length=2, max_length=200),
    channel_id: Optional[int] = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    ctx: TenantContext = Depends(require("messenger.use")),
    db: Session = Depends(get_db),
):
    # Список каналов, где юзер — участник
    my_channels_subq = (
        db.query(ChannelMember.channel_id)
        .filter(ChannelMember.user_id == ctx.user.id)
        .subquery()
    )
    like = f"%{q.strip().lower()}%"
    qy = (
        db.query(Message)
        .filter(
            Message.tenant_id == ctx.tenant.id,
            Message.deleted_at.is_(None),
            Message.channel_id.in_(my_channels_subq),
            func.lower(Message.body).like(like),
        )
        .order_by(desc(Message.id))
    )
    if channel_id:
        _require_member(db, ctx, channel_id)
        qy = qy.filter(Message.channel_id == channel_id)
    rows = qy.limit(limit).all()
    hits: List[SearchHit] = []
    for m in rows:
        u = db.get(User, m.author_id) if m.author_id else None
        hits.append(SearchHit(
            message_id=m.id, channel_id=m.channel_id,
            snippet=_snippet(m.body), author=_brief_user(u), created_at=m.created_at,
        ))
    return hits
