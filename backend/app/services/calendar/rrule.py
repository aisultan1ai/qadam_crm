"""Expand recurring events в диапазон дат через python-dateutil.rrule.

Master-event хранит start_at, end_at и rrule ("FREQ=DAILY;COUNT=5" и т.п.).
Функция expand возвращает список occurrence dict с полями:
    {"start": dt, "end": dt, "is_master": bool, "occurrence_id": str}

occurrence_id = "{event.id}:{iso_start}" — стабильный идентификатор для UI и exdates.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from dateutil import rrule as dateutil_rrule


MAX_OCCURRENCES = 1000  # защита от бесконечного расширения


def _to_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def expand_event(
    event,
    range_start: datetime,
    range_end: datetime,
    exdates: Optional[Iterable[datetime]] = None,
) -> list[dict]:
    """Возвращает список occurrence в диапазоне [range_start, range_end)."""
    duration = event.end_at - event.start_at
    exset = {_to_utc(d).replace(microsecond=0) for d in (exdates or [])}
    rs = _to_utc(range_start)
    re = _to_utc(range_end)

    if not event.rrule:
        # Единичное событие — попадает если пересекается с диапазоном
        s = _to_utc(event.start_at)
        e = _to_utc(event.end_at)
        if e >= rs and s < re and s.replace(microsecond=0) not in exset:
            return [_occ(event, s, e, is_master=True)]
        return []

    try:
        rule = dateutil_rrule.rrulestr(event.rrule, dtstart=_to_utc(event.start_at))
    except Exception:
        return []

    # dateutil rrule between включает границы если inc=True
    starts = rule.between(rs - duration, re, inc=True)
    result: list[dict] = []
    for i, s in enumerate(starts):
        if i >= MAX_OCCURRENCES:
            break
        s_utc = _to_utc(s).replace(microsecond=0)
        if s_utc in exset:
            continue
        e_utc = s_utc + duration
        if e_utc < rs or s_utc >= re:
            continue
        result.append(_occ(event, s_utc, e_utc, is_master=(i == 0)))
    return result


def _occ(event, start: datetime, end: datetime, is_master: bool) -> dict:
    return {
        "event_id": event.id,
        "occurrence_id": f"{event.id}:{start.isoformat()}",
        "start": start,
        "end": end,
        "is_master": is_master,
        "is_recurring": bool(event.rrule),
    }
