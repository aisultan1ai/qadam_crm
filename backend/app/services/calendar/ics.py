"""ICS (RFC 5545) export для календарей и событий.

Минимальный VCALENDAR с VEVENT[+RRULE][+EXDATE]. Достаточно для Google Calendar
subscribe by URL и импорта в Outlook / Apple Calendar.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Iterable

from ...models import Calendar, CalendarEvent, EventException


CRLF = "\r\n"


def _fmt_dt(dt: datetime, all_day: bool = False) -> str:
    if all_day:
        return dt.strftime("%Y%m%d")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _escape(value: str) -> str:
    if not value:
        return ""
    # RFC 5545: escape \ , ; \n
    v = value.replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;")
    v = v.replace("\r\n", "\\n").replace("\n", "\\n").replace("\r", "\\n")
    return v


def _fold(line: str) -> str:
    """Wrap lines to 75 chars per RFC 5545."""
    if len(line) <= 75:
        return line
    parts = [line[:75]]
    rest = line[75:]
    while rest:
        parts.append(" " + rest[:74])
        rest = rest[74:]
    return CRLF.join(parts)


def event_to_vevent(event: CalendarEvent, exceptions: Iterable[EventException] = ()) -> list[str]:
    lines: list[str] = ["BEGIN:VEVENT"]
    dtstamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines.append(f"UID:evt-{event.id}@qadam-crm")
    lines.append(f"DTSTAMP:{dtstamp}")
    if event.all_day:
        lines.append(f"DTSTART;VALUE=DATE:{_fmt_dt(event.start_at, True)}")
        lines.append(f"DTEND;VALUE=DATE:{_fmt_dt(event.end_at, True)}")
    else:
        lines.append(f"DTSTART:{_fmt_dt(event.start_at)}")
        lines.append(f"DTEND:{_fmt_dt(event.end_at)}")
    lines.append(f"SUMMARY:{_escape(event.title)}")
    if event.description:
        lines.append(f"DESCRIPTION:{_escape(event.description)}")
    if event.location:
        lines.append(f"LOCATION:{_escape(event.location)}")
    if event.url:
        lines.append(f"URL:{_escape(event.url)}")
    if event.rrule:
        # RRULE:FREQ=DAILY;... (уже в правильном формате)
        lines.append(f"RRULE:{event.rrule}")
    for exc in exceptions:
        if exc.is_cancelled and exc.override_start is None:
            lines.append(f"EXDATE:{_fmt_dt(exc.exdate)}")
    lines.append("END:VEVENT")
    return [_fold(l) for l in lines]


def calendar_to_ics(calendar: Calendar, events_with_exceptions: Iterable[tuple[CalendarEvent, list[EventException]]]) -> str:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Qadam CRM//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_escape(calendar.name)}",
        f"X-WR-TIMEZONE:UTC",
    ]
    for event, exceptions in events_with_exceptions:
        lines.extend(event_to_vevent(event, exceptions))
    lines.append("END:VCALENDAR")
    return CRLF.join(lines) + CRLF
