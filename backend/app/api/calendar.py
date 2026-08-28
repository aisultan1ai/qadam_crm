"""API календарей: CRUD, events (с recurring expand + task deadlines), respond, ICS export."""
from __future__ import annotations

import logging
import secrets as _secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import quote as _url_quote


def _ics_headers(name: str) -> dict[str, str]:
    """Content-Disposition с utf-8 filename* для кириллических имён (RFC 5987)."""
    ascii_fallback = "calendar.ics"
    filename_star = f"UTF-8''{_url_quote((name or 'calendar') + '.ics', safe='')}"
    return {"Content-Disposition": f'attachment; filename="{ascii_fallback}"; filename*={filename_star}'}

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..core.events import fire_event
from ..core.ws_hub import publish_to_user
from ..database import get_db
from ..models import (
    Calendar, CalendarEvent, EventException, EventKind, EventParticipant, EventReminder,
    ParticipantStatus, ReminderKind, TenantMembership, User,
)
from ..schemas.common import Message
from ..services.calendar.ics import calendar_to_ics
from ..services.calendar.rrule import expand_event
from ..services.calendar.task_events import task_events_in_range
from .deps import TenantContext, get_current_context, log_action, require

log = logging.getLogger("qadam.calendar.api")

router = APIRouter(prefix="/api/calendar", tags=["calendar"])
public_router = APIRouter(prefix="", tags=["calendar-public"])


# =============================================================================
# Schemas
# =============================================================================


class CalendarCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    color: str = Field(default="#7C5CFF", max_length=20)
    is_visible: bool = True
    is_shared: bool = False


class CalendarPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    color: Optional[str] = Field(default=None, max_length=20)
    is_visible: Optional[bool] = None
    is_shared: Optional[bool] = None
    regenerate_ics_token: bool = False


class ReminderIn(BaseModel):
    offset_minutes: int = Field(ge=0, le=60 * 24 * 30)
    kind: str = "notification"


class EventCreate(BaseModel):
    calendar_id: int
    title: str = Field(min_length=1, max_length=300)
    description: Optional[str] = None
    location: Optional[str] = Field(default=None, max_length=300)
    url: Optional[str] = Field(default=None, max_length=500)
    kind: str = "event"
    color: Optional[str] = Field(default=None, max_length=20)
    start_at: datetime
    end_at: datetime
    all_day: bool = False
    timezone: str = "UTC"
    rrule: Optional[str] = Field(default=None, max_length=500)
    participant_user_ids: list[int] = Field(default_factory=list)
    reminders: list[ReminderIn] = Field(default_factory=list)


class EventPatch(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=300)
    description: Optional[str] = None
    location: Optional[str] = Field(default=None, max_length=300)
    url: Optional[str] = Field(default=None, max_length=500)
    color: Optional[str] = Field(default=None, max_length=20)
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    all_day: Optional[bool] = None
    timezone: Optional[str] = Field(default=None, max_length=64)
    rrule: Optional[str] = Field(default=None, max_length=500)
    kind: Optional[str] = None
    participant_user_ids: Optional[list[int]] = None
    reminders: Optional[list[ReminderIn]] = None


class RespondBody(BaseModel):
    status: str  # accepted / declined / tentative


class ExdateBody(BaseModel):
    exdate: datetime
    override_start: Optional[datetime] = None
    override_end: Optional[datetime] = None
    override_title: Optional[str] = Field(default=None, max_length=300)
    override_description: Optional[str] = None


# =============================================================================
# Serialization
# =============================================================================


def _cal_out(c: Calendar) -> dict:
    return {
        "id": c.id,
        "owner_id": c.owner_id,
        "name": c.name,
        "color": c.color,
        "is_visible": c.is_visible,
        "is_shared": c.is_shared,
        "ics_token": c.ics_token,
    }


def _reminder_out(r: EventReminder) -> dict:
    return {"id": r.id, "offset_minutes": r.offset_minutes,
            "kind": r.kind.value if hasattr(r.kind, "value") else r.kind}


def _participant_out(p: EventParticipant) -> dict:
    return {"user_id": p.user_id, "status": p.status.value if hasattr(p.status, "value") else p.status,
            "is_organizer": p.is_organizer}


def _event_out(e: CalendarEvent) -> dict:
    return {
        "id": e.id,
        "calendar_id": e.calendar_id,
        "title": e.title,
        "description": e.description,
        "location": e.location,
        "url": e.url,
        "kind": e.kind.value if hasattr(e.kind, "value") else e.kind,
        "color": e.color,
        "start_at": e.start_at.isoformat() if e.start_at else None,
        "end_at": e.end_at.isoformat() if e.end_at else None,
        "all_day": e.all_day,
        "timezone": e.timezone,
        "rrule": e.rrule,
        "creator_id": e.creator_id,
        "participants": [_participant_out(p) for p in (e.participants or [])],
        "reminders": [_reminder_out(r) for r in (e.reminders or [])],
    }


def _load_calendar(db: Session, ctx: TenantContext, calendar_id: int, allow_others: bool = True) -> Calendar:
    c = db.get(Calendar, calendar_id)
    if not c or c.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Календарь не найден")
    if not allow_others and c.owner_id != ctx.user.id:
        raise HTTPException(403, "Календарь чужой")
    return c


def _load_event(db: Session, ctx: TenantContext, event_id: int) -> CalendarEvent:
    e = db.get(CalendarEvent, event_id)
    if not e or e.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Событие не найдено")
    return e


def _assert_user_in_tenant(db: Session, tenant_id: int, user_id: int) -> None:
    exists = (
        db.query(TenantMembership.id)
        .filter(TenantMembership.tenant_id == tenant_id, TenantMembership.user_id == user_id)
        .first()
    )
    if not exists:
        raise HTTPException(400, f"User {user_id} не в этой компании")


# =============================================================================
# Calendars CRUD
# =============================================================================


@router.get("/calendars")
def list_calendars(
    ctx: TenantContext = Depends(require("calendar.use")),
    db: Session = Depends(get_db),
):
    """Мои календари + shared календари других пользователей.

    Если у юзера ещё нет своего календаря — создаём «Мой» автоматически.
    """
    own = (
        db.query(Calendar)
        .filter(Calendar.tenant_id == ctx.tenant.id, Calendar.owner_id == ctx.user.id)
        .first()
    )
    if not own:
        own = Calendar(
            tenant_id=ctx.tenant.id, owner_id=ctx.user.id,
            name="Мой календарь", color="#7C5CFF", is_visible=True,
        )
        db.add(own)
        db.commit()

    rows = (
        db.query(Calendar)
        .filter(
            Calendar.tenant_id == ctx.tenant.id,
            or_(Calendar.owner_id == ctx.user.id, Calendar.is_shared.is_(True)),
        )
        .order_by(Calendar.owner_id != ctx.user.id, Calendar.name)
        .all()
    )
    return [_cal_out(c) for c in rows]


@router.post("/calendars", status_code=201)
def create_calendar(
    payload: CalendarCreate,
    ctx: TenantContext = Depends(require("calendar.use")),
    db: Session = Depends(get_db),
):
    c = Calendar(
        tenant_id=ctx.tenant.id,
        owner_id=ctx.user.id,
        name=payload.name.strip(),
        color=payload.color,
        is_visible=payload.is_visible,
        is_shared=payload.is_shared,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return _cal_out(c)


@router.patch("/calendars/{calendar_id}")
def patch_calendar(
    calendar_id: int,
    payload: CalendarPatch,
    ctx: TenantContext = Depends(require("calendar.use")),
    db: Session = Depends(get_db),
):
    c = _load_calendar(db, ctx, calendar_id, allow_others=False)
    if payload.name is not None:
        c.name = payload.name.strip()
    if payload.color is not None:
        c.color = payload.color
    if payload.is_visible is not None:
        c.is_visible = payload.is_visible
    if payload.is_shared is not None:
        c.is_shared = payload.is_shared
    if payload.regenerate_ics_token or (payload.is_shared and not c.ics_token):
        c.ics_token = _secrets.token_urlsafe(24)
    db.commit()
    db.refresh(c)
    return _cal_out(c)


@router.delete("/calendars/{calendar_id}", response_model=Message)
def delete_calendar(
    calendar_id: int,
    ctx: TenantContext = Depends(require("calendar.use")),
    db: Session = Depends(get_db),
):
    c = _load_calendar(db, ctx, calendar_id, allow_others=False)
    name = c.name
    db.delete(c)
    db.commit()
    return Message(message=f"Календарь «{name}» удалён")


# =============================================================================
# Events
# =============================================================================


@router.get("/events")
def list_events(
    start: datetime = Query(...),
    end: datetime = Query(...),
    calendar_ids: Optional[str] = Query(default=None, description="CSV списка календарей; если пусто — все видимые"),
    include_tasks: bool = Query(default=True),
    ctx: TenantContext = Depends(require("calendar.use")),
    db: Session = Depends(get_db),
):
    """Возвращает occurrence-события в диапазоне [start, end).

    Каждое recurring master-событие разворачивается в несколько occurrence через
    dateutil.rrule; учитываются exdates и overrides. Плюс виртуальные события
    из tasks.deadline.
    """
    if end <= start:
        raise HTTPException(400, "end должен быть > start")
    if (end - start).days > 400:
        raise HTTPException(400, "диапазон слишком большой (макс 400 дней)")

    ids: Optional[list[int]] = None
    if calendar_ids:
        try:
            ids = [int(x) for x in calendar_ids.split(",") if x.strip()]
        except ValueError:
            raise HTTPException(400, "calendar_ids должны быть числами")

    q = (
        db.query(Calendar)
        .filter(
            Calendar.tenant_id == ctx.tenant.id,
            or_(Calendar.owner_id == ctx.user.id, Calendar.is_shared.is_(True)),
            Calendar.is_visible.is_(True),
        )
    )
    if ids:
        q = q.filter(Calendar.id.in_(ids))
    calendars = q.all()
    if not calendars:
        base_events = []
    else:
        cal_map = {c.id: c for c in calendars}
        events = (
            db.query(CalendarEvent)
            .filter(
                CalendarEvent.tenant_id == ctx.tenant.id,
                CalendarEvent.calendar_id.in_(list(cal_map.keys())),
            )
            .all()
        )
        base_events = []
        for e in events:
            exceptions = list(e.exceptions or [])
            exdates = [x.exdate for x in exceptions if x.is_cancelled and x.override_start is None]
            overrides_by_exdate = {x.exdate.replace(microsecond=0): x for x in exceptions if x.override_start is not None}
            for occ in expand_event(e, start, end, exdates=exdates):
                key = occ["start"].replace(microsecond=0)
                override = overrides_by_exdate.get(key)
                cal = cal_map.get(e.calendar_id)
                base_events.append({
                    "id": occ["occurrence_id"],
                    "event_id": e.id,
                    "occurrence_start": occ["start"].isoformat(),
                    "is_recurring": occ["is_recurring"],
                    "is_master": occ["is_master"],
                    "calendar_id": e.calendar_id,
                    "calendar_name": cal.name if cal else None,
                    "color": e.color or (cal.color if cal else "#7C5CFF"),
                    "title": (override.override_title if override and override.override_title else e.title),
                    "description": (override.override_description if override and override.override_description else e.description),
                    "location": e.location,
                    "url": e.url,
                    "start": (override.override_start.isoformat() if override and override.override_start else occ["start"].isoformat()),
                    "end": (override.override_end.isoformat() if override and override.override_end else occ["end"].isoformat()),
                    "all_day": e.all_day,
                    "kind": e.kind.value if hasattr(e.kind, "value") else e.kind,
                })

    result = base_events
    if include_tasks:
        result = result + task_events_in_range(db, ctx.tenant.id, start, end)
    result.sort(key=lambda x: x["start"])
    return result


@router.get("/events/{event_id}")
def get_event(
    event_id: int,
    ctx: TenantContext = Depends(require("calendar.use")),
    db: Session = Depends(get_db),
):
    e = _load_event(db, ctx, event_id)
    return _event_out(e)


@router.post("/events", status_code=201)
def create_event(
    payload: EventCreate,
    ctx: TenantContext = Depends(require("calendar.use")),
    db: Session = Depends(get_db),
):
    cal = _load_calendar(db, ctx, payload.calendar_id, allow_others=False)
    if payload.end_at <= payload.start_at:
        raise HTTPException(400, "end_at должен быть > start_at")
    try:
        kind = EventKind(payload.kind)
    except ValueError:
        kind = EventKind.event

    e = CalendarEvent(
        tenant_id=ctx.tenant.id,
        calendar_id=cal.id,
        title=payload.title.strip(),
        description=payload.description,
        location=payload.location,
        url=payload.url,
        kind=kind,
        color=payload.color,
        start_at=payload.start_at,
        end_at=payload.end_at,
        all_day=payload.all_day,
        timezone=payload.timezone or "UTC",
        rrule=(payload.rrule or "").strip() or None,
        creator_id=ctx.user.id,
    )
    db.add(e)
    db.flush()

    # Participants
    for uid in dict.fromkeys(payload.participant_user_ids or []):
        _assert_user_in_tenant(db, ctx.tenant.id, uid)
        db.add(EventParticipant(
            tenant_id=ctx.tenant.id, event_id=e.id, user_id=uid,
            is_organizer=(uid == ctx.user.id),
        ))
    # Organizer сам всегда участник
    if ctx.user.id not in (payload.participant_user_ids or []):
        db.add(EventParticipant(
            tenant_id=ctx.tenant.id, event_id=e.id, user_id=ctx.user.id,
            status=ParticipantStatus.accepted, is_organizer=True, responded_at=datetime.now(timezone.utc),
        ))

    # Reminders
    for r in payload.reminders:
        try:
            r_kind = ReminderKind(r.kind)
        except ValueError:
            r_kind = ReminderKind.notification
        db.add(EventReminder(
            tenant_id=ctx.tenant.id, event_id=e.id,
            offset_minutes=r.offset_minutes, kind=r_kind,
        ))

    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
               action="create", entity="calendar_event", entity_id=e.id, detail=e.title)
    db.commit()
    db.refresh(e)
    fire_event("calendar.event_created", ctx.tenant.id, {"event_id": e.id, "title": e.title})
    # Уведомить участников через WS
    for p in e.participants:
        if p.user_id != ctx.user.id:
            publish_to_user(ctx.tenant.id, p.user_id, "calendar.event.new",
                            {"event_id": e.id, "title": e.title})
    return _event_out(e)


@router.patch("/events/{event_id}")
def patch_event(
    event_id: int,
    payload: EventPatch,
    ctx: TenantContext = Depends(require("calendar.use")),
    db: Session = Depends(get_db),
):
    e = _load_event(db, ctx, event_id)
    # Только creator или организатор
    if e.creator_id != ctx.user.id:
        # проверим organizer
        p = next((x for x in e.participants if x.user_id == ctx.user.id and x.is_organizer), None)
        if not p:
            raise HTTPException(403, "Только организатор может редактировать")

    for field in ("title", "description", "location", "url", "color", "timezone", "rrule"):
        v = getattr(payload, field, None)
        if v is not None:
            setattr(e, field, v)
    if payload.start_at is not None:
        e.start_at = payload.start_at
    if payload.end_at is not None:
        e.end_at = payload.end_at
    if payload.all_day is not None:
        e.all_day = payload.all_day
    if payload.kind is not None:
        try:
            e.kind = EventKind(payload.kind)
        except ValueError:
            pass
    if e.end_at <= e.start_at:
        raise HTTPException(400, "end_at должен быть > start_at")

    if payload.participant_user_ids is not None:
        # Полная замена списка
        existing_uids = {p.user_id for p in e.participants}
        new_uids = set(payload.participant_user_ids or [])
        # Удаляем
        for p in list(e.participants):
            if p.user_id not in new_uids and not p.is_organizer:
                db.delete(p)
        # Добавляем
        for uid in new_uids - existing_uids:
            _assert_user_in_tenant(db, ctx.tenant.id, uid)
            db.add(EventParticipant(tenant_id=ctx.tenant.id, event_id=e.id, user_id=uid))

    if payload.reminders is not None:
        # Полная замена
        for r in list(e.reminders):
            db.delete(r)
        for r in payload.reminders:
            try:
                r_kind = ReminderKind(r.kind)
            except ValueError:
                r_kind = ReminderKind.notification
            db.add(EventReminder(tenant_id=ctx.tenant.id, event_id=e.id,
                                 offset_minutes=r.offset_minutes, kind=r_kind))

    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
               action="update", entity="calendar_event", entity_id=e.id)
    db.commit()
    db.refresh(e)
    fire_event("calendar.event_updated", ctx.tenant.id, {"event_id": e.id, "title": e.title})
    return _event_out(e)


@router.delete("/events/{event_id}", response_model=Message)
def delete_event(
    event_id: int,
    ctx: TenantContext = Depends(require("calendar.use")),
    db: Session = Depends(get_db),
):
    e = _load_event(db, ctx, event_id)
    if e.creator_id != ctx.user.id:
        p = next((x for x in e.participants if x.user_id == ctx.user.id and x.is_organizer), None)
        if not p:
            raise HTTPException(403, "Только организатор может удалить")
    title = e.title
    db.delete(e)
    db.commit()
    return Message(message=f"Событие «{title}» удалено")


@router.post("/events/{event_id}/exceptions", status_code=201)
def add_exception(
    event_id: int,
    payload: ExdateBody,
    ctx: TenantContext = Depends(require("calendar.use")),
    db: Session = Depends(get_db),
):
    """Добавляет исключение к recurring: удалить occurrence или переопределить его."""
    e = _load_event(db, ctx, event_id)
    if not e.rrule:
        raise HTTPException(400, "Событие не является повторяющимся")
    exc = EventException(
        tenant_id=ctx.tenant.id,
        event_id=e.id,
        exdate=payload.exdate,
        is_cancelled=(payload.override_start is None),
        override_start=payload.override_start,
        override_end=payload.override_end,
        override_title=payload.override_title,
        override_description=payload.override_description,
    )
    db.add(exc)
    db.commit()
    return {"id": exc.id, "exdate": exc.exdate.isoformat(), "is_cancelled": exc.is_cancelled}


@router.post("/events/{event_id}/respond")
def respond_to_event(
    event_id: int,
    payload: RespondBody,
    ctx: TenantContext = Depends(require("calendar.use")),
    db: Session = Depends(get_db),
):
    if payload.status not in ("accepted", "declined", "tentative", "pending"):
        raise HTTPException(400, "status invalid")
    e = _load_event(db, ctx, event_id)
    p = next((x for x in e.participants if x.user_id == ctx.user.id), None)
    if not p:
        raise HTTPException(404, "Вы не приглашены на это событие")
    p.status = ParticipantStatus(payload.status)
    p.responded_at = datetime.now(timezone.utc)
    db.commit()
    return {"status": p.status.value, "event_id": e.id}


# =============================================================================
# ICS export
# =============================================================================


@public_router.get("/api/calendar/public/{token}.ics")
def public_ics(token: str, db: Session = Depends(get_db)):
    """Публичный ICS-канал: без auth, только по токену календаря.

    Для subscribe в Google Calendar / Outlook «Add calendar by URL».
    """
    cal = db.query(Calendar).filter(Calendar.ics_token == token).first()
    if not cal:
        raise HTTPException(404, "Календарь не найден или ссылка отозвана")
    events = (
        db.query(CalendarEvent)
        .filter(CalendarEvent.calendar_id == cal.id)
        .order_by(CalendarEvent.start_at)
        .all()
    )
    events_with_exc = [(e, list(e.exceptions or [])) for e in events]
    body = calendar_to_ics(cal, events_with_exc)
    return Response(
        content=body,
        media_type="text/calendar; charset=utf-8",
        headers=_ics_headers(cal.name),
    )


@router.get("/calendars/{calendar_id}/export.ics")
def export_calendar_ics(
    calendar_id: int,
    ctx: TenantContext = Depends(require("calendar.use")),
    db: Session = Depends(get_db),
):
    cal = _load_calendar(db, ctx, calendar_id)
    events = (
        db.query(CalendarEvent)
        .filter(CalendarEvent.calendar_id == cal.id)
        .order_by(CalendarEvent.start_at)
        .all()
    )
    events_with_exc = [(e, list(e.exceptions or [])) for e in events]
    body = calendar_to_ics(cal, events_with_exc)
    return Response(
        content=body,
        media_type="text/calendar; charset=utf-8",
        headers=_ics_headers(cal.name),
    )
