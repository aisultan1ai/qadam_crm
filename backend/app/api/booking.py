"""API букинга: private CRUD страниц + мои bookings + публичные эндпоинты для бронирования."""

import logging
import re
import secrets as _secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, EmailStr, Field
from slugify import slugify
from sqlalchemy import desc, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.limiter import limiter
from ..core.ws_hub import publish_to_user
from ..database import get_db
from ..models import (
    Booking, BookingPage, BookingStatus, BookingTeam, Calendar, CalendarEvent,
    EventKind, EventParticipant, MeetingProvider, ParticipantStatus, Tenant, TenantMembership,
    User,
)
from ..schemas.common import Message
from ..services.booking.slots import available_slots, pick_assignee
from .deps import TenantContext, get_current_context, log_action, require

log = logging.getLogger("qadam.booking.api")

router = APIRouter(prefix="/api/booking", tags=["booking"])
public_router = APIRouter(prefix="", tags=["booking-public"])


# =============================================================================
# Schemas
# =============================================================================


DEFAULT_WORKING_HOURS = {
    "monday": [[9, 18]],
    "tuesday": [[9, 18]],
    "wednesday": [[9, 18]],
    "thursday": [[9, 18]],
    "friday": [[9, 18]],
    "saturday": [],
    "sunday": [],
}


class Question(BaseModel):
    key: str = Field(min_length=1, max_length=50, pattern=r"^[a-z][a-z0-9_]*$")
    label: str = Field(min_length=1, max_length=200)
    type: str = Field(default="text")
    required: bool = False


class PageCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    slug: Optional[str] = Field(default=None, max_length=100)
    description: Optional[str] = None
    color: str = Field(default="#7C5CFF", max_length=20)
    duration_min: int = Field(default=30, ge=5, le=480)
    buffer_before_min: int = Field(default=0, ge=0, le=240)
    buffer_after_min: int = Field(default=0, ge=0, le=240)
    working_hours: Optional[dict] = None
    timezone: str = "Asia/Almaty"
    min_notice_hours: int = Field(default=2, ge=0, le=720)
    max_days_ahead: int = Field(default=30, ge=1, le=365)
    questions: list[Question] = Field(default_factory=list)
    calendar_id: Optional[int] = None
    meeting_provider: str = "none"
    meeting_url_template: Optional[str] = Field(default=None, max_length=500)
    is_active: bool = True
    team_id: Optional[int] = None


class PagePatch(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    color: Optional[str] = Field(default=None, max_length=20)
    duration_min: Optional[int] = Field(default=None, ge=5, le=480)
    buffer_before_min: Optional[int] = Field(default=None, ge=0, le=240)
    buffer_after_min: Optional[int] = Field(default=None, ge=0, le=240)
    working_hours: Optional[dict] = None
    timezone: Optional[str] = Field(default=None, max_length=64)
    min_notice_hours: Optional[int] = Field(default=None, ge=0, le=720)
    max_days_ahead: Optional[int] = Field(default=None, ge=1, le=365)
    questions: Optional[list[Question]] = None
    calendar_id: Optional[int] = None
    meeting_provider: Optional[str] = None
    meeting_url_template: Optional[str] = Field(default=None, max_length=500)
    is_active: Optional[bool] = None


class PublicBookRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    phone: Optional[str] = Field(default=None, max_length=50)
    start_at: datetime
    answers: dict = Field(default_factory=dict)


# =============================================================================
# Serialization
# =============================================================================


def _page_out(p: BookingPage, tenant_slug: Optional[str] = None) -> dict:
    return {
        "id": p.id,
        "owner_user_id": p.owner_user_id,
        "team_id": p.team_id,
        "slug": p.slug,
        "title": p.title,
        "description": p.description,
        "color": p.color,
        "duration_min": p.duration_min,
        "buffer_before_min": p.buffer_before_min,
        "buffer_after_min": p.buffer_after_min,
        "working_hours": p.working_hours or {},
        "timezone": p.timezone,
        "min_notice_hours": p.min_notice_hours,
        "max_days_ahead": p.max_days_ahead,
        "questions": p.questions or [],
        "calendar_id": p.calendar_id,
        "meeting_provider": p.meeting_provider.value if hasattr(p.meeting_provider, "value") else p.meeting_provider,
        "meeting_url_template": p.meeting_url_template,
        "is_active": p.is_active,
        "public_url": (f"/book/{tenant_slug}/{p.slug}" if tenant_slug else None),
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


def _booking_out(b: Booking) -> dict:
    return {
        "id": b.id,
        "page_id": b.page_id,
        "assignee_user_id": b.assignee_user_id,
        "name": b.name,
        "email": b.email,
        "phone": b.phone,
        "start_at": b.start_at.isoformat() if b.start_at else None,
        "end_at": b.end_at.isoformat() if b.end_at else None,
        "status": b.status.value if hasattr(b.status, "value") else b.status,
        "answers": b.answers or {},
        "meeting_url": b.meeting_url,
        "calendar_event_id": b.calendar_event_id,
        "created_at": b.created_at.isoformat() if b.created_at else None,
    }


def _make_slug(db: Session, tenant_id: int, base: str) -> str:
    root = slugify(base or "meeting")[:90] or "meeting"
    s = root
    n = 2
    while db.query(BookingPage.id).filter(BookingPage.tenant_id == tenant_id, BookingPage.slug == s).first():
        s = f"{root}-{n}"[:100]
        n += 1
    return s


# =============================================================================
# Private CRUD
# =============================================================================


@router.get("/pages")
def list_pages(
    ctx: TenantContext = Depends(require("booking.use")),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(BookingPage)
        .filter(
            BookingPage.tenant_id == ctx.tenant.id,
            or_(BookingPage.owner_user_id == ctx.user.id, BookingPage.team_id.is_not(None)),
        )
        .order_by(BookingPage.created_at.desc())
        .all()
    )
    return [_page_out(p, tenant_slug=ctx.tenant.slug) for p in rows]


@router.post("/pages", status_code=201)
def create_page(
    payload: PageCreate,
    ctx: TenantContext = Depends(require("booking.use")),
    db: Session = Depends(get_db),
):
    slug = payload.slug or payload.title
    slug = _make_slug(db, ctx.tenant.id, slug)

    if payload.calendar_id:
        cal = db.get(Calendar, payload.calendar_id)
        if not cal or cal.tenant_id != ctx.tenant.id:
            raise HTTPException(404, "Календарь не найден")
        if cal.owner_id != ctx.user.id:
            raise HTTPException(403, "Календарь чужой")

    try:
        provider = MeetingProvider(payload.meeting_provider)
    except ValueError:
        provider = MeetingProvider.none

    p = BookingPage(
        tenant_id=ctx.tenant.id,
        owner_user_id=ctx.user.id if not payload.team_id else None,
        team_id=payload.team_id,
        slug=slug,
        title=payload.title.strip(),
        description=payload.description,
        color=payload.color,
        duration_min=payload.duration_min,
        buffer_before_min=payload.buffer_before_min,
        buffer_after_min=payload.buffer_after_min,
        working_hours=payload.working_hours or dict(DEFAULT_WORKING_HOURS),
        timezone=payload.timezone or "Asia/Almaty",
        min_notice_hours=payload.min_notice_hours,
        max_days_ahead=payload.max_days_ahead,
        questions=[q.model_dump() for q in payload.questions],
        calendar_id=payload.calendar_id,
        meeting_provider=provider,
        meeting_url_template=payload.meeting_url_template,
        is_active=payload.is_active,
    )
    db.add(p)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
               action="create", entity="booking_page", detail=p.title)
    db.commit()
    db.refresh(p)
    return _page_out(p, tenant_slug=ctx.tenant.slug)


def _load_page(db: Session, tenant_id: int, page_id: int, user_id: int) -> BookingPage:
    p = db.get(BookingPage, page_id)
    if not p or p.tenant_id != tenant_id:
        raise HTTPException(404, "Страница не найдена")
    # Только owner или member team может редактировать
    if p.owner_user_id and p.owner_user_id != user_id:
        raise HTTPException(403, "Не ваша страница")
    return p


@router.patch("/pages/{page_id}")
def patch_page(
    page_id: int,
    payload: PagePatch,
    ctx: TenantContext = Depends(require("booking.use")),
    db: Session = Depends(get_db),
):
    p = _load_page(db, ctx.tenant.id, page_id, ctx.user.id)
    data = payload.model_dump(exclude_unset=True)
    if "questions" in data and data["questions"] is not None:
        data["questions"] = [
            (q.model_dump() if hasattr(q, "model_dump") else q)
            for q in data["questions"]
        ]
    if "meeting_provider" in data and data["meeting_provider"] is not None:
        try:
            p.meeting_provider = MeetingProvider(data["meeting_provider"])
        except ValueError:
            pass
        del data["meeting_provider"]
    for k, v in data.items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return _page_out(p, tenant_slug=ctx.tenant.slug)


@router.delete("/pages/{page_id}", response_model=Message)
def delete_page(
    page_id: int,
    ctx: TenantContext = Depends(require("booking.use")),
    db: Session = Depends(get_db),
):
    p = _load_page(db, ctx.tenant.id, page_id, ctx.user.id)
    title = p.title
    db.delete(p)
    db.commit()
    return Message(message=f"Страница «{title}» удалена")


@router.get("/bookings")
def list_bookings(
    page_id: Optional[int] = None,
    only_mine: bool = True,
    limit: int = Query(default=100, ge=1, le=500),
    ctx: TenantContext = Depends(require("booking.use")),
    db: Session = Depends(get_db),
):
    q = db.query(Booking).filter(Booking.tenant_id == ctx.tenant.id)
    if page_id:
        q = q.filter(Booking.page_id == page_id)
    if only_mine:
        q = q.filter(Booking.assignee_user_id == ctx.user.id)
    rows = q.order_by(desc(Booking.start_at)).limit(limit).all()
    return [_booking_out(b) for b in rows]


@router.post("/bookings/{booking_id}/cancel", response_model=Message)
def cancel_booking(
    booking_id: int,
    ctx: TenantContext = Depends(require("booking.use")),
    db: Session = Depends(get_db),
):
    b = db.get(Booking, booking_id)
    if not b or b.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Booking не найден")
    if b.assignee_user_id != ctx.user.id and b.page.owner_user_id != ctx.user.id:
        raise HTTPException(403, "Только assignee или owner страницы")
    if b.status == BookingStatus.canceled:
        return Message(message="Уже отменён")
    b.status = BookingStatus.canceled
    # Удаляем связанный CalendarEvent
    if b.calendar_event_id:
        ev = db.get(CalendarEvent, b.calendar_event_id)
        if ev:
            db.delete(ev)
        b.calendar_event_id = None
    db.commit()
    return Message(message="Отменено")


# =============================================================================
# Public endpoints (без auth)
# =============================================================================


def _load_public_page(db: Session, tenant_slug: str, page_slug: str) -> tuple[Tenant, BookingPage]:
    t = db.query(Tenant).filter(Tenant.slug == tenant_slug, Tenant.is_active.is_(True)).first()
    if not t:
        raise HTTPException(404, "Компания не найдена")
    p = (
        db.query(BookingPage)
        .filter(
            BookingPage.tenant_id == t.id,
            BookingPage.slug == page_slug,
            BookingPage.is_active.is_(True),
        )
        .first()
    )
    if not p:
        raise HTTPException(404, "Страница букинга не найдена или отключена")
    return t, p


@public_router.get("/api/public/book/{tenant_slug}/{page_slug}")
def public_get_page(
    tenant_slug: str,
    page_slug: str,
    db: Session = Depends(get_db),
):
    t, p = _load_public_page(db, tenant_slug, page_slug)
    return {
        "tenant_name": t.company_display_name or t.name,
        "tenant_slug": t.slug,
        "title": p.title,
        "description": p.description,
        "color": p.color,
        "duration_min": p.duration_min,
        "timezone": p.timezone,
        "questions": p.questions or [],
        "slug": p.slug,
        "min_notice_hours": p.min_notice_hours,
        "max_days_ahead": p.max_days_ahead,
    }


@public_router.get("/api/public/book/{tenant_slug}/{page_slug}/slots")
def public_get_slots(
    tenant_slug: str,
    page_slug: str,
    from_dt: Optional[datetime] = Query(default=None, alias="from"),
    to_dt: Optional[datetime] = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
):
    t, p = _load_public_page(db, tenant_slug, page_slug)
    now = datetime.now(timezone.utc)
    if not from_dt:
        from_dt = now
    if not to_dt:
        to_dt = now + timedelta(days=p.max_days_ahead)
    if (to_dt - from_dt).days > 60:
        raise HTTPException(400, "Диапазон слишком большой (макс 60 дней)")
    slots = available_slots(db, p, from_dt, to_dt)
    # Не отдаём eligible_user_ids публично
    return [{"start": s["start"], "end": s["end"]} for s in slots]


@public_router.post("/api/public/book/{tenant_slug}/{page_slug}/bookings", status_code=201)
@limiter.limit("10/hour")
def public_create_booking(
    request: Request,
    tenant_slug: str,
    page_slug: str,
    payload: PublicBookRequest = Body(..., embed=False),
    db: Session = Depends(get_db),
):
    from ..tasks.email import send_notification_email

    t, p = _load_public_page(db, tenant_slug, page_slug)

    start = payload.start_at
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    else:
        start = start.astimezone(timezone.utc)
    end = start + timedelta(minutes=p.duration_min)

    now = datetime.now(timezone.utc)
    if start < now + timedelta(hours=p.min_notice_hours):
        raise HTTPException(400, "Слот в прошлом или слишком близко")
    if start > now + timedelta(days=p.max_days_ahead):
        raise HTTPException(400, "Слот слишком далеко в будущем")

    # Проверим что слот всё ещё доступен (race с параллельным бронированием)
    slots = available_slots(db, p, start - timedelta(minutes=1), start + timedelta(minutes=p.duration_min + 1))
    if not any(datetime.fromisoformat(s["start"]) == start for s in slots):
        raise HTTPException(409, "Слот больше не доступен")

    # Валидация required questions
    for q in (p.questions or []):
        if q.get("required") and not str(payload.answers.get(q.get("key"), "") or "").strip():
            raise HTTPException(400, f"Ответ на вопрос «{q.get('label')}» обязателен")

    # Выбор assignee
    eligible = []
    if p.owner_user_id and not p.team_id:
        eligible = [p.owner_user_id]
    elif p.team_id:
        eligible = [int(x) for x in ((p.team.member_user_ids or []) if p.team else []) if str(x).isdigit()]
    assignee_id = pick_assignee(p, eligible, db)
    if not assignee_id:
        raise HTTPException(500, "Не удалось выбрать ответственного менеджера")

    cancel_token = _secrets.token_urlsafe(24)

    # Создаём CalendarEvent если у страницы указан calendar
    cal_event_id: Optional[int] = None
    if p.calendar_id:
        ev = CalendarEvent(
            tenant_id=t.id,
            calendar_id=p.calendar_id,
            title=f"Встреча: {payload.name}",
            description=(
                f"Клиент: {payload.name}\nEmail: {payload.email}\n"
                + (f"Телефон: {payload.phone}\n" if payload.phone else "")
                + (f"\n{p.description}" if p.description else "")
            ),
            location=None,
            url=p.meeting_url_template,
            kind=EventKind.meeting,
            start_at=start,
            end_at=end,
            all_day=False,
            timezone=p.timezone,
            creator_id=assignee_id,
        )
        db.add(ev)
        db.flush()
        # Assignee = организатор события
        db.add(EventParticipant(
            tenant_id=t.id, event_id=ev.id, user_id=assignee_id,
            status=ParticipantStatus.accepted, is_organizer=True, responded_at=now,
        ))
        cal_event_id = ev.id

    b = Booking(
        tenant_id=t.id,
        page_id=p.id,
        assignee_user_id=assignee_id,
        name=payload.name.strip()[:200],
        email=payload.email.lower(),
        phone=(payload.phone or "").strip() or None,
        start_at=start,
        end_at=end,
        status=(BookingStatus.pending if p.require_confirmation else BookingStatus.confirmed),
        answers=dict(payload.answers or {}),
        meeting_url=p.meeting_url_template,
        calendar_event_id=cal_event_id,
        cancel_token=cancel_token,
        ip_address=(request.client.host if request.client else None),
        user_agent=(request.headers.get("user-agent") or "")[:500] or None,
    )
    try:
        db.add(b)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Не удалось создать бронь (конфликт)")
    db.refresh(b)

    # Уведомляем assignee через WS
    publish_to_user(t.id, assignee_id, "booking.new", {
        "booking_id": b.id, "name": b.name, "start_at": start.isoformat(),
    })

    # Email подтверждение клиенту + менеджеру
    cancel_url = f"{str(request.base_url).rstrip('/')}/api/public/booking/cancel/{cancel_token}"
    body_client = (
        f"Здравствуйте, {b.name}!\n\n"
        f"Ваша встреча «{p.title}» подтверждена на {start.strftime('%d.%m.%Y %H:%M UTC')}.\n"
        + (f"\nСсылка на встречу: {b.meeting_url}\n" if b.meeting_url else "")
        + f"\nОтменить: {cancel_url}\n"
    )
    try:
        send_notification_email.delay(
            to=b.email,
            title=f"Встреча забронирована: {p.title}",
            body=body_client,
            link_url=b.meeting_url,
        )
    except Exception:
        log.exception("booking confirmation email failed")

    # Уведомить менеджера
    manager = db.get(User, assignee_id)
    if manager and manager.email:
        try:
            send_notification_email.delay(
                to=manager.email,
                title=f"Новая встреча: {b.name}",
                body=f"Клиент {b.name} ({b.email}) забронировал встречу «{p.title}» на {start.strftime('%d.%m.%Y %H:%M UTC')}.",
                link_url=None,
            )
        except Exception:
            pass

    return {
        "id": b.id,
        "status": b.status.value if hasattr(b.status, "value") else b.status,
        "start_at": start.isoformat(),
        "end_at": end.isoformat(),
        "cancel_url": cancel_url,
    }


@public_router.get("/api/public/booking/cancel/{token}")
def public_cancel(token: str, db: Session = Depends(get_db)):
    """Клиент отменяет свою бронь по ссылке из email."""
    b = db.query(Booking).filter(Booking.cancel_token == token).first()
    if not b:
        raise HTTPException(404, "Бронь не найдена или уже отменена")
    if b.status == BookingStatus.canceled:
        return {"ok": True, "status": "already_canceled"}
    b.status = BookingStatus.canceled
    if b.calendar_event_id:
        ev = db.get(CalendarEvent, b.calendar_event_id)
        if ev:
            db.delete(ev)
        b.calendar_event_id = None
    db.commit()
    return {"ok": True, "status": "canceled", "name": b.name, "start_at": b.start_at.isoformat()}
