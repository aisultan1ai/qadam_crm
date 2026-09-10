"""P3+P4 Celery-задачи: recurring tasks, reminders, scheduled reports, log retention purge."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from celery import shared_task

from ..database import SessionLocal
from ..models import Task, Reminder, Notification, SavedReport, TenantLogRetention, ActivityLog

log = logging.getLogger(__name__)


# =============================================================================
# 1) Recurring tasks — генерируем следующий экземпляр по RRULE
# =============================================================================

def _next_by_rrule(rule: str, after: datetime) -> Optional[datetime]:
    """Простой парсер RRULE. Поддержим FREQ=DAILY|WEEKLY|MONTHLY[;INTERVAL=N].

    Полноценный dateutil.rrule есть в requirements через python-dateutil.
    """
    try:
        from dateutil.rrule import rrulestr
        # rrulestr требует DTSTART для многих правил → добавим искусственный из after
        rr = rrulestr(rule, dtstart=after)
        nxt = rr.after(after, inc=False)
        return nxt
    except Exception as e:
        log.warning("RRULE parse failed: %s (%s)", rule, e)
        return None


@shared_task(name="p3.generate_recurring_tasks")
def generate_recurring_tasks() -> dict:
    """Ищем задачи с recurrence_rule и recurrence_next_at <= now → создаём копию + сдвигаем next_at."""
    db = SessionLocal()
    created = 0
    updated = 0
    try:
        now = datetime.now(timezone.utc)
        # мастер-задачи с настроенным RRULE
        masters = (
            db.query(Task)
            .filter(
                Task.recurrence_rule.isnot(None),
                Task.recurrence_next_at.isnot(None),
                Task.recurrence_next_at <= now,
                Task.recurrence_parent_id.is_(None),  # только мастера, не экземпляры
            )
            .limit(500)
            .all()
        )
        for master in masters:
            # Создаём копию
            inst = Task(
                tenant_id=master.tenant_id,
                title=master.title,
                description=master.description,
                priority=master.priority,
                project_id=master.project_id,
                assignee_id=master.assignee_id,
                author_id=master.author_id,
                deadline=master.recurrence_next_at,
                recurrence_parent_id=master.id,
            )
            db.add(inst)
            created += 1

            # Считаем следующее событие
            nxt = _next_by_rrule(master.recurrence_rule, master.recurrence_next_at)
            if nxt is None:
                # больше срабатываний нет — отключаем rule
                master.recurrence_rule = None
                master.recurrence_next_at = None
            else:
                master.recurrence_next_at = nxt
            updated += 1

        db.commit()
    except Exception as e:
        db.rollback()
        log.exception("generate_recurring_tasks failed: %s", e)
    finally:
        db.close()
    return {"created": created, "updated_masters": updated}


# =============================================================================
# 2) Reminders — доставка (Notification в БД + WS)
# =============================================================================

@shared_task(name="p3.fire_reminders")
def fire_reminders() -> dict:
    db = SessionLocal()
    fired = 0
    try:
        from ..core.ws_hub import publish_to_user
        now = datetime.now(timezone.utc)
        due = (
            db.query(Reminder)
            .filter(Reminder.is_active == True, Reminder.next_at <= now)  # noqa: E712
            .limit(500)
            .all()
        )
        for r in due:
            notif = Notification(
                tenant_id=r.tenant_id,
                user_id=r.user_id,
                kind="reminder",
                title="Напоминание",
                body=r.message,
                task_id=r.target_id if r.target_type == "task" else None,
            )
            db.add(notif)
            r.fired_count += 1
            r.last_fired_at = now

            # Recurrence
            if r.recurrence_rule:
                nxt = _next_by_rrule(r.recurrence_rule, now)
                if nxt:
                    r.next_at = nxt
                else:
                    r.is_active = False
            else:
                r.is_active = False

            try:
                publish_to_user(r.tenant_id, r.user_id, "notification.new", {"reminder_id": r.id})
            except Exception:
                pass
            fired += 1

        db.commit()
    except Exception as e:
        db.rollback()
        log.exception("fire_reminders failed: %s", e)
    finally:
        db.close()
    return {"fired": fired}


# =============================================================================
# 3) Scheduled reports — запускаем сохранённые отчёты по cron и шлём email
# =============================================================================

def _cron_due(cron_str: str, last_run: Optional[datetime], now: datetime) -> bool:
    """Простая проверка: если в последнюю минуту cron сработал бы — да."""
    try:
        from croniter import croniter
    except ImportError:
        return False
    base = last_run or (now - timedelta(hours=1))
    try:
        it = croniter(cron_str, base)
        nxt = it.get_next(datetime)
        if nxt.tzinfo is None:
            nxt = nxt.replace(tzinfo=timezone.utc)
        return nxt <= now
    except Exception:
        return False


@shared_task(name="p3.run_scheduled_reports")
def run_scheduled_reports() -> dict:
    """Проходим по SavedReport с непустым schedule_cron и email_to → генерим CSV и отправляем email."""
    db = SessionLocal()
    executed = 0
    try:
        now = datetime.now(timezone.utc)
        reports = (
            db.query(SavedReport)
            .filter(SavedReport.schedule_cron.isnot(None), SavedReport.email_to.isnot(None))
            .all()
        )
        for r in reports:
            if not _cron_due(r.schedule_cron, r.last_run_at, now):
                continue
            r.last_run_at = now
            executed += 1
            # Enqueue email task (best-effort — не критично если провалится)
            try:
                from .email import send_report_email
                send_report_email.delay(r.id)
            except Exception as e:
                log.warning("send_report_email enqueue failed for #%s: %s", r.id, e)
        db.commit()
    except Exception as e:
        db.rollback()
        log.exception("run_scheduled_reports failed: %s", e)
    finally:
        db.close()
    return {"executed": executed}


# =============================================================================
# 4) P4: Log retention purge — раз в сутки
# =============================================================================

@shared_task(name="p4.purge_old_logs")
def purge_old_logs() -> dict:
    """Удаляем ActivityLog старше retention_days для каждой пары (tenant, entity_type)."""
    db = SessionLocal()
    purged = 0
    try:
        now = datetime.now(timezone.utc)
        rules = db.query(TenantLogRetention).filter(TenantLogRetention.retention_days.isnot(None)).all()
        for rule in rules:
            cutoff = now - timedelta(days=rule.retention_days)
            q = (
                db.query(ActivityLog)
                .filter(
                    ActivityLog.tenant_id == rule.tenant_id,
                    ActivityLog.entity == rule.entity_type,
                    ActivityLog.created_at < cutoff,
                )
            )
            n = q.count()
            if n:
                q.delete(synchronize_session=False)
                purged += n
        db.commit()
    except Exception as e:
        db.rollback()
        log.exception("purge_old_logs failed: %s", e)
    finally:
        db.close()
    return {"purged": purged}
