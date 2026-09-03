"""Celery-задачи календаря: напоминания."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from ..core.celery_app import celery_app
from ..core.ws_hub import publish_to_user
from ..database import SessionLocal
from ..models import CalendarEvent, EventException, EventParticipant, EventReminder, Notification, ReminderKind
from ..services.calendar.rrule import expand_event

log = logging.getLogger("qadam.calendar.tasks")


@celery_app.task(name="calendar.check_reminders")
def check_reminders() -> dict:
    """Раз в минуту находит due reminders и отправляет notification + email.

    Логика: для каждого EventReminder разворачиваем master event в диапазон
    [now, now + 24h], находим occurrence которое стартует через offset_minutes
    (± 1 минута), проверяем что не отправляли за последние 5 минут. Если ок —
    Notification + WS + optional email.
    """
    from ..tasks.email import send_notification_email

    now = datetime.now(timezone.utc)
    horizon = now + timedelta(days=1, hours=1)
    sent = 0

    with SessionLocal() as db:
        reminders = (
            db.query(EventReminder)
            .join(CalendarEvent, CalendarEvent.id == EventReminder.event_id)
            .all()
        )
        for r in reminders:
            event = db.get(CalendarEvent, r.event_id)
            if not event:
                continue
            exdates = [
                e.exdate for e in db.query(EventException).filter(
                    EventException.event_id == event.id,
                    EventException.is_cancelled.is_(True),
                    EventException.override_start.is_(None),
                ).all()
            ]
            occurrences = expand_event(event, now, horizon, exdates=exdates)
            for occ in occurrences:
                start = occ["start"]
                fire_at = start - timedelta(minutes=r.offset_minutes)
                # Окно ± 1 мин
                if not (now - timedelta(minutes=1) <= fire_at <= now + timedelta(minutes=1)):
                    continue
                # Cooldown 5 мин
                if r.last_fired_at and (now - r.last_fired_at).total_seconds() < 5 * 60:
                    continue
                _send_reminder(db, event, r, occ, send_notification_email)
                r.last_fired_at = now
                sent += 1
        db.commit()
    log.info("calendar.check_reminders: sent=%d", sent)
    return {"sent": sent}


def _send_reminder(db, event: CalendarEvent, reminder: EventReminder, occ: dict, email_task) -> None:
    from ..models import User
    # Все participants + creator
    participants = db.query(EventParticipant).filter(
        EventParticipant.event_id == event.id,
    ).all()
    user_ids = {p.user_id for p in participants}
    if event.creator_id:
        user_ids.add(event.creator_id)

    start_local = occ["start"].strftime("%Y-%m-%d %H:%M UTC")
    title = f"Через {reminder.offset_minutes} мин: {event.title}"
    body = f"Событие «{event.title}» начнётся в {start_local}."
    if event.location:
        body += f"\nМесто: {event.location}"
    if event.url:
        body += f"\nСсылка: {event.url}"

    for uid in user_ids:
        # Notification + WS (в реальном UI пользователь видит badge)
        db.add(Notification(
            tenant_id=event.tenant_id,
            user_id=uid,
            kind="calendar_reminder",
            title=title,
            body=body[:1000],
            task_id=None,
        ))
        publish_to_user(event.tenant_id, uid, "notification.new", {
            "kind": "calendar_reminder", "event_id": event.id,
        })

        if reminder.kind == ReminderKind.email:
            user = db.get(User, uid)
            if user and user.email:
                try:
                    email_task.delay(to=user.email, title=title, body=body, link_url=event.url)
                except Exception:
                    log.exception("calendar reminder email failed for user %s", uid)


@celery_app.task(name="calendar.sync_google_all")
def sync_google_all() -> dict:
    """Синхронизирует все включённые Google-аккаунты по всем тенантам. Раз в 15 минут.

    Пропускает аккаунты, чей tenant не сконфигурировал Google OAuth.
    """
    from ..models import GoogleCalendarAccount, Tenant
    from ..services import google_calendar as gcal

    stats = {"accounts": 0, "created": 0, "updated": 0, "deleted": 0, "failed": 0, "skipped": 0}
    with SessionLocal() as db:
        accs = (
            db.query(GoogleCalendarAccount)
            .filter(GoogleCalendarAccount.sync_enabled.is_(True))
            .all()
        )
        for acc in accs:
            tenant = db.get(Tenant, acc.tenant_id)
            if not tenant or not gcal.tenant_configured(tenant):
                stats["skipped"] += 1
                continue
            stats["accounts"] += 1
            try:
                c, u, d = gcal.sync_account(db, acc)
                stats["created"] += c
                stats["updated"] += u
                stats["deleted"] += d
                db.commit()
            except Exception as e:
                db.rollback()
                log.warning("google sync failed for acc %s: %s", acc.id, e)
                acc.last_sync_error = str(e)[:1000]
                db.commit()
                stats["failed"] += 1
    log.info("calendar.sync_google_all: %s", stats)
    return stats
