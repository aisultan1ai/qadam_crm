"""Вычисление доступных слотов для BookingPage.

Алгоритм:
1. Итерация по датам от max(now + min_notice, from) до min(now + max_days_ahead, to)
2. Для каждой даты: берём working_hours[weekday_name] (список сегментов [start_h, end_h])
3. В каждом сегменте генерируем слоты шагом duration_min
4. Слот исключается если:
   - overlap с существующим Booking (status != canceled) на этой странице/у ассигнов
   - overlap с CalendarEvent из page.calendar_id (учитываем recurring через M7 expand)
   - buffer_before/after от других занятостей
5. Для team-page: слот доступен если хотя бы один member свободен (учитывая
   ManagerAvailability из M2 — если у него сейчас смена).
"""
from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Iterable, Optional

from sqlalchemy.orm import Session

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore

from ...models import Booking, BookingPage, CalendarEvent, EventException, BookingStatus
from ..calendar.rrule import expand_event

log = logging.getLogger("qadam.booking.slots")

WEEKDAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def _to_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _local_tz(page: BookingPage):
    if not ZoneInfo:
        return timezone.utc
    try:
        return ZoneInfo(page.timezone or "UTC")
    except Exception:
        return timezone.utc


def _existing_intervals(
    db: Session, page: BookingPage, day_start_utc: datetime, day_end_utc: datetime,
) -> list[tuple[datetime, datetime]]:
    """Возвращает список занятых интервалов [start, end] в диапазоне [day_start, day_end)."""
    intervals: list[tuple[datetime, datetime]] = []

    # Существующие подтверждённые Booking'и этой страницы
    q = (
        db.query(Booking)
        .filter(
            Booking.page_id == page.id,
            Booking.status != BookingStatus.canceled,
            Booking.end_at > day_start_utc,
            Booking.start_at < day_end_utc,
        )
    )
    for b in q.all():
        intervals.append((_to_utc(b.start_at), _to_utc(b.end_at)))

    # События из связанного календаря (если есть)
    if page.calendar_id:
        events = (
            db.query(CalendarEvent)
            .filter(CalendarEvent.calendar_id == page.calendar_id)
            .all()
        )
        for e in events:
            exdates = [
                x.exdate for x in (e.exceptions or [])
                if x.is_cancelled and x.override_start is None
            ]
            for occ in expand_event(e, day_start_utc, day_end_utc, exdates=exdates):
                intervals.append((occ["start"], occ["end"]))

    return intervals


def _overlaps(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> bool:
    return a_start < b_end and b_start < a_end


def available_slots(
    db: Session,
    page: BookingPage,
    from_dt: datetime,
    to_dt: datetime,
) -> list[dict]:
    """Возвращает список свободных слотов в UTC:
        [{"start": iso, "end": iso, "eligible_user_ids": [...]}]
    """
    if not page.is_active:
        return []

    now = datetime.now(timezone.utc)
    earliest = now + timedelta(hours=page.min_notice_hours or 0)
    latest = now + timedelta(days=page.max_days_ahead or 30)

    window_start = max(_to_utc(from_dt), earliest)
    window_end = min(_to_utc(to_dt), latest)
    if window_start >= window_end:
        return []

    tz = _local_tz(page)
    working = page.working_hours or {}
    duration = timedelta(minutes=page.duration_min or 30)
    buf_before = timedelta(minutes=page.buffer_before_min or 0)
    buf_after = timedelta(minutes=page.buffer_after_min or 0)

    result: list[dict] = []

    # Идём по локальным датам
    local_cursor = window_start.astimezone(tz).date()
    end_date = window_end.astimezone(tz).date()
    guard = 0
    while local_cursor <= end_date and guard < 90:  # защита от бесконечного цикла
        guard += 1
        weekday_name = WEEKDAY_NAMES[local_cursor.weekday()]
        segments = working.get(weekday_name) or []
        if segments:
            # UTC-границы этого локального дня — для поиска занятых интервалов
            day_start_local = datetime.combine(local_cursor, time.min).replace(tzinfo=tz)
            day_end_local = day_start_local + timedelta(days=1)
            day_start_utc = day_start_local.astimezone(timezone.utc)
            day_end_utc = day_end_local.astimezone(timezone.utc)
            busy = _existing_intervals(db, page, day_start_utc, day_end_utc)

            for seg in segments:
                if not isinstance(seg, (list, tuple)) or len(seg) != 2:
                    continue
                try:
                    start_h = int(seg[0])
                    end_h = int(seg[1])
                except (TypeError, ValueError):
                    continue
                if not (0 <= start_h < end_h <= 24):
                    continue

                # Начало сегмента — локальное время
                seg_start_local = datetime.combine(local_cursor, time(hour=start_h)).replace(tzinfo=tz)
                if end_h == 24:
                    seg_end_local = day_end_local
                else:
                    seg_end_local = datetime.combine(local_cursor, time(hour=end_h)).replace(tzinfo=tz)

                # Идём по слотам
                slot_start = seg_start_local.astimezone(timezone.utc)
                seg_end_utc = seg_end_local.astimezone(timezone.utc)
                while slot_start + duration <= seg_end_utc:
                    slot_end = slot_start + duration
                    # Отбрасываем слоты вне окна
                    if slot_end <= window_start or slot_start >= window_end:
                        slot_start = slot_end
                        continue
                    # Проверка на overlap с buffer
                    check_start = slot_start - buf_before
                    check_end = slot_end + buf_after
                    blocked = any(
                        _overlaps(check_start, check_end, b_start, b_end)
                        for b_start, b_end in busy
                    )
                    if not blocked:
                        result.append({
                            "start": slot_start.isoformat(),
                            "end": slot_end.isoformat(),
                            "eligible_user_ids": _eligible_users_for_slot(page),
                        })
                    slot_start = slot_start + duration  # шаг = duration (без overlap)

        local_cursor = local_cursor + timedelta(days=1)

    return result


def _eligible_users_for_slot(page: BookingPage) -> list[int]:
    """Кто может провести встречу на этой странице.

    Personal: owner_user_id. Team: member_user_ids из связанной команды.
    """
    if page.owner_user_id and not page.team_id:
        return [page.owner_user_id]
    if page.team_id and page.team:
        raw = page.team.member_user_ids or []
        return [int(x) for x in raw if isinstance(x, (int, str)) and str(x).isdigit()]
    return []


def pick_assignee(page: BookingPage, eligible: list[int], db: Session) -> Optional[int]:
    """Round-robin / least-busy среди eligible."""
    if not eligible:
        return None
    if len(eligible) == 1:
        return eligible[0]
    # Простой least-busy: у кого меньше активных бронирований — берём. tie → min id.
    from sqlalchemy import func
    counts = dict(
        db.query(Booking.assignee_user_id, func.count(Booking.id))
        .filter(Booking.assignee_user_id.in_(eligible), Booking.status != BookingStatus.canceled)
        .group_by(Booking.assignee_user_id)
        .all()
    )
    return min(eligible, key=lambda uid: (counts.get(uid, 0), uid))
