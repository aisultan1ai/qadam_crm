"""Email-задачи: приглашения, уведомления, сброс пароля.

Отправка идёт синхронно через smtplib внутри Celery worker'а — этого достаточно,
задачи ретраятся при ошибке SMTP. Если SMTP_HOST не задан — письма только логируются.
"""
from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage
from typing import Optional

from ..config import settings
from ..core.celery_app import celery_app

logger = logging.getLogger("qadam.email")


def _send_via_smtp(to: str, subject: str, html: str, text: str) -> None:
    msg = EmailMessage()
    msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM}>"
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")

    if not settings.SMTP_HOST or settings.SMTP_DRY_RUN:
        logger.info("[email:dry-run] to=%s subj=%s", to, subject)
        return

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=30) as smtp:
        if settings.SMTP_USE_TLS:
            smtp.starttls()
        if settings.SMTP_USER and settings.SMTP_PASSWORD:
            smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        smtp.send_message(msg)


@celery_app.task(
    name="email.send",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    autoretry_for=(smtplib.SMTPException, ConnectionError, TimeoutError),
    retry_backoff=True,
)
def send_email(self, to: str, subject: str, html: str, text: Optional[str] = None) -> str:
    """Универсальная задача отправки письма."""
    body_text = text or _strip_html(html)
    _send_via_smtp(to, subject, html, body_text)
    return f"sent:{to}"


@celery_app.task(name="email.invitation")
def send_invitation_email(to: str, tenant_name: str, invite_url: str, inviter_name: str) -> str:
    subject = f"Приглашение в {tenant_name} — Qadam CRM"
    html = f"""
      <p>Здравствуйте!</p>
      <p><b>{inviter_name}</b> приглашает вас присоединиться к компании <b>{tenant_name}</b> в Qadam CRM.</p>
      <p><a href="{invite_url}">Принять приглашение</a></p>
      <p>Если ссылка не открывается, скопируйте её вручную:<br>{invite_url}</p>
      <p>Ссылка действует 7 дней.</p>
    """
    return send_email.run(to=to, subject=subject, html=html)


@celery_app.task(name="email.verification")
def send_email_verification(to: str, verify_url: str, full_name: str) -> str:
    subject = "Подтвердите ваш email — Qadam CRM"
    html = f"""
      <p>Здравствуйте, {full_name}!</p>
      <p>Спасибо за регистрацию в Qadam CRM. Пожалуйста, подтвердите email,
      чтобы разблокировать все возможности:</p>
      <p><a href="{verify_url}">Подтвердить email</a></p>
      <p>Если ссылка не открывается, скопируйте её вручную:<br>{verify_url}</p>
      <p>Ссылка действует 3 дня. Если вы не регистрировались — просто проигнорируйте это письмо.</p>
    """
    return send_email.run(to=to, subject=subject, html=html)


@celery_app.task(name="email.password_reset")
def send_password_reset_email(to: str, reset_url: str) -> str:
    subject = "Сброс пароля — Qadam CRM"
    html = f"""
      <p>Вы запросили сброс пароля.</p>
      <p><a href="{reset_url}">Установить новый пароль</a></p>
      <p>Если это были не вы — просто проигнорируйте это письмо.</p>
      <p>Ссылка действует 1 час.</p>
    """
    return send_email.run(to=to, subject=subject, html=html)


@celery_app.task(name="email.notification")
def send_notification_email(to: str, title: str, body: str, link_url: Optional[str] = None) -> str:
    subject = title
    html = f"<p>{body}</p>"
    if link_url:
        html += f'<p><a href="{link_url}">Открыть в Qadam CRM</a></p>'
    return send_email.run(to=to, subject=subject, html=html)


@celery_app.task(name="email.smoke")
def smoke(text: str = "hello") -> str:
    """Проверочная задача — просто возвращает строку."""
    return f"celery ok: {text}"


def _strip_html(html: str) -> str:
    """Простой fallback text/plain из html: убираем теги."""
    import re
    text = re.sub(r"<[^>]+>", "", html)
    return re.sub(r"\s+", " ", text).strip()


@celery_app.task(name="email.send_report")
def send_report_email(saved_report_id: int) -> str:
    """P4t.3: генерирует xlsx (или CSV) отчёта через compute_report и шлёт на email_to с attach."""
    import csv
    import io
    import re
    from datetime import date as _date
    from email.message import EmailMessage
    from ..database import SessionLocal
    from ..models import SavedReport
    from ..api.reports import compute_report
    from ..config import settings

    db = SessionLocal()
    try:
        r = db.get(SavedReport, saved_report_id)
        if not r or not r.email_to:
            return "no report or no email"

        cfg = r.config or {}

        def _pdate(v):
            if v is None:
                return None
            if isinstance(v, _date):
                return v
            return _date.fromisoformat(str(v))

        try:
            result = compute_report(
                db,
                tenant_id=r.tenant_id,
                metric=cfg.get("metric", "tasks_count"),
                group_by=cfg.get("group_by", "assignee"),
                from_date=_pdate(cfg.get("from_date")),
                to_date=_pdate(cfg.get("to_date")),
                project_id=cfg.get("project_id"),
                formulas=cfg.get("formulas") or [],
            )
        except Exception as e:
            return send_email.run(
                to=r.email_to,
                subject=f"[Qadam] Отчёт '{r.name}' — ошибка расчёта",
                html=f"<p>Не удалось построить отчёт: {e}</p>",
            )

        # xlsx via openpyxl; fallback → CSV
        safe = (re.sub(r"[^\w.\-]", "_", (r.name or "report").strip()) or "report")[:80]
        attach_name = f"{safe}.xlsx"
        try:
            from openpyxl import Workbook
            wb = Workbook()
            ws = wb.active
            ws.title = "Report"[:31]
            ws.append([f"Отчёт: {r.name}"])
            ws.append([f"Метрика: {result.metric} · Группировка: {result.group_by} · Ед: {result.meta.get('unit','')}"])
            ws.append([])
            formula_names = list((result.formula_totals or {}).keys())
            headers = ["Группа", "Значение", "Кол-во"] + formula_names
            ws.append(headers)
            for row in result.rows:
                extras = [(row.computed or {}).get(fn, "") for fn in formula_names]
                ws.append([row.group or "—", row.value, row.count] + extras)
            ws.append([])
            ws.append(["Итого:", result.total, ""] + [result.formula_totals.get(fn, "") for fn in formula_names])
            buf = io.BytesIO()
            wb.save(buf)
            attach_bytes = buf.getvalue()
            maintype, subtype = "application", "vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        except Exception:
            attach_name = f"{safe}.csv"
            b = io.StringIO()
            w = csv.writer(b)
            formula_names = list((result.formula_totals or {}).keys())
            w.writerow(["Группа", "Значение", "Кол-во"] + formula_names)
            for row in result.rows:
                extras = [(row.computed or {}).get(fn, "") for fn in formula_names]
                w.writerow([row.group or "—", row.value, row.count] + extras)
            w.writerow([])
            w.writerow(["Итого:", result.total, ""] + [result.formula_totals.get(fn, "") for fn in formula_names])
            attach_bytes = b.getvalue().encode("utf-8-sig")
            maintype, subtype = "text", "csv"

        subject = f"[Qadam] Отчёт: {r.name}"
        html = (
            f"<p>Здравствуйте!</p>"
            f"<p>Ваш сохранённый отчёт <b>{r.name}</b> во вложении.</p>"
            f"<p>Метрика: <code>{result.metric}</code> · группировка: <code>{result.group_by}</code></p>"
            f"<p>Строк: <b>{len(result.rows)}</b> · итого: <b>{result.total}</b> {result.meta.get('unit','')}</p>"
        )

        if not settings.SMTP_HOST or settings.SMTP_DRY_RUN:
            log.info("[dry-run] send_report to %s (%s, %d bytes)", r.email_to, attach_name, len(attach_bytes))
            return "dry-run"

        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = f'{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM}>'
        msg["To"] = r.email_to
        msg.set_content(_strip_html(html))
        msg.add_alternative(html, subtype="html")
        msg.add_attachment(attach_bytes, maintype=maintype, subtype=subtype, filename=attach_name)

        import smtplib
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as s:
            if settings.SMTP_USE_TLS:
                s.starttls()
            if settings.SMTP_USER and settings.SMTP_PASSWORD:
                s.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            s.send_message(msg)
        return f"sent to {r.email_to}"
    finally:
        db.close()
