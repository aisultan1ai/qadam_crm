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
