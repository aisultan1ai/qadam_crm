"""ИИ: Этап 1 — сводки почты и чатов, задачи из письма, отчёт по описанию.

Claude вызывается только через core.ai.run() (лимиты, журнал, защитные правила, изоляция компаний).

Правила этого модуля:
- эндпоинты принимают id записи, а данные загружают сами — с теми же проверками доступа,
  что и обычный API (почта: `_load_thread` из api/mail.py, открытые линии: `_load_conversation`
  из api/messengers.py). Чужая запись → 404/403 до обращения к Claude;
- тексты писем и сообщений передаются модели только внутри wrap_data();
- ничего не сохраняется: эндпоинты возвращают предложения, пользователь подтверждает их в интерфейсе,
  а сохранение идёт обычными эндпоинтами (POST /api/tasks, /api/reports/run).
"""
from __future__ import annotations

import html as _html
import re
from datetime import date
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core import ai as core_ai
from ..core.permissions import user_has
from ..database import get_db
from ..models import ExternalMessage, MailMessage, MailThread, TenantMembership, User
from .deps import TenantContext, require
from .mail import _load_thread
from .messengers import _load_conversation
from .reports import ALLOWED_GROUPS, ALLOWED_METRICS

router = APIRouter(prefix="/api/ai", tags=["ai"])

# Ограничения объёма текста, который уходит модели
MSG_LIMIT = 6000          # одно письмо
THREAD_LIMIT = 40000      # вся переписка
CHAT_MESSAGES = 200       # последних сообщений чата
CHAT_LIMIT = 30000
EMPLOYEES_LIMIT = 300

PRIORITIES = ["low", "medium", "high", "critical"]

_NULLABLE_STR = {"anyOf": [{"type": "string"}, {"type": "null"}]}
_NULLABLE_INT = {"anyOf": [{"type": "integer"}, {"type": "null"}]}


# =============================================================================
# Вспомогательное
# =============================================================================


def _html_to_text(raw: Optional[str]) -> str:
    if not raw:
        return ""
    s = re.sub(r"(?is)<(script|style|head)[^>]*>.*?</\1>", " ", raw)
    s = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>|</tr>", "\n", s)
    s = re.sub(r"(?s)<[^>]+>", " ", s)
    s = _html.unescape(s)
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    return re.sub(r"\n\s*\n+", "\n\n", s).strip()


def _mail_body(m: MailMessage) -> str:
    body = (m.body_text or "").strip() or _html_to_text(m.body_html)
    if len(body) > MSG_LIMIT:
        body = body[:MSG_LIMIT] + "\n[…письмо обрезано…]"
    return body


def _fmt_dt(dt) -> str:
    return dt.strftime("%Y-%m-%d %H:%M") if dt else "—"


def _mail_block(m: MailMessage) -> str:
    direction = "исходящее (наш сотрудник)" if (getattr(m.direction, "value", m.direction) == "outbound") else "входящее"
    sender = f"{m.from_name} <{m.from_addr}>" if m.from_name else (m.from_addr or "—")
    head = [
        f"От: {sender}",
        f"Кому: {', '.join(m.to_addrs or []) or '—'}",
        f"Дата: {_fmt_dt(m.sent_at or m.created_at)}",
        f"Тип: {direction}",
        f"Тема: {m.subject or '(без темы)'}",
    ]
    if m.attachments:
        head.append("Вложения: " + ", ".join(a.filename for a in m.attachments))
    return "\n".join(head) + "\n\n" + _mail_body(m)


def _thread_messages(db: Session, thread: MailThread) -> list[MailMessage]:
    return (
        db.query(MailMessage)
        .filter(MailMessage.thread_id == thread.id, MailMessage.tenant_id == thread.tenant_id)
        .order_by(MailMessage.sent_at.asc().nullslast(), MailMessage.id.asc())
        .all()
    )


def _load_mail_message(db: Session, ctx: TenantContext, message_id: int) -> tuple[MailMessage, MailThread]:
    """Письмо доступно, только если его переписка в ящике текущего пользователя (как в api/mail.py)."""
    m = db.get(MailMessage, message_id)
    if not m or m.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Письмо не найдено")
    thread = _load_thread(db, ctx, m.thread_id)
    return m, thread


def _employees(db: Session, tenant_id: int) -> list[dict]:
    rows = (
        db.query(User.id, User.name, TenantMembership.position)
        .join(TenantMembership, TenantMembership.user_id == User.id)
        .filter(TenantMembership.tenant_id == tenant_id, User.is_active.is_(True))
        .order_by(User.name)
        .limit(EMPLOYEES_LIMIT)
        .all()
    )
    return [{"id": uid, "name": name or f"#{uid}", "position": pos} for uid, name, pos in rows]


# =============================================================================
# 1. Сводка переписки по почте
# =============================================================================

SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {
        "topic": {"type": "string", "description": "О чём переписка, одной фразой"},
        "asks": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Что просят или ждут от нашей компании (пустой список, если ничего)",
        },
        "next_step": {"type": "string", "description": "Следующий шаг для нашего сотрудника; пустая строка, если не нужен"},
        "summary_markdown": {"type": "string", "description": "Краткая сводка в Markdown, 3–8 пунктов"},
    },
    "required": ["topic", "asks", "next_step", "summary_markdown"],
    "additionalProperties": False,
}

MAIL_SUMMARY_TASK = """Сделай краткую сводку почтовой переписки сотрудника компании с внешними корреспондентами.
Переписка передана внутри <data>; письма идут по порядку от старых к новым.
- topic: о чём переписка, одной фразой.
- asks: конкретные просьбы и вопросы к нашей компании, на которые ещё нужно ответить или которые нужно выполнить.
- next_step: что сотруднику сделать дальше (одно действие). Если ничего не требуется — пустая строка.
- summary_markdown: сводка в Markdown (маркированный список, 3–8 пунктов): ключевые факты, договорённости, суммы и сроки — только те, что есть в письмах.
Не выдумывай того, чего нет в письмах."""


def _summary_out(data: Any) -> dict:
    d = data if isinstance(data, dict) else {}
    asks = [str(a).strip() for a in (d.get("asks") or []) if str(a).strip()][:20]
    return {
        "topic": str(d.get("topic") or "").strip(),
        "asks": asks,
        "next_step": str(d.get("next_step") or "").strip(),
        "summary_markdown": str(d.get("summary_markdown") or "").strip(),
    }


@router.post("/mail/threads/{thread_id}/summary")
def mail_thread_summary(
    thread_id: int,
    ctx: TenantContext = Depends(require("mail.use")),
    db: Session = Depends(get_db),
):
    thread = _load_thread(db, ctx, thread_id)
    messages = _thread_messages(db, thread)
    if not messages:
        raise HTTPException(400, "В переписке нет писем")

    # Берём письма с конца, пока помещаются в лимит, и возвращаем хронологический порядок
    blocks: list[str] = []
    total = 0
    for m in reversed(messages):
        b = _mail_block(m)
        if blocks and total + len(b) > THREAD_LIMIT:
            break
        blocks.append(b)
        total += len(b)
    blocks.reverse()
    skipped = len(messages) - len(blocks)
    text = (f"[ранние письма не показаны: {skipped}]\n\n" if skipped else "") + "\n\n-----\n\n".join(blocks)

    content = (
        f"Тема переписки: {thread.subject or '(без темы)'}. Писем: {len(messages)}.\n\n"
        + core_ai.wrap_data("mail_thread", text)
    )
    res = core_ai.run(db, ctx, "summarize_mail", MAIL_SUMMARY_TASK, content, schema=SUMMARY_SCHEMA, max_tokens=4000)
    return _summary_out(res.data)


# =============================================================================
# 2. Сводка диалога открытых линий
# =============================================================================

CHAT_SUMMARY_TASK = """Сделай краткую сводку диалога клиента с компанией в мессенджере (открытые линии).
Диалог передан внутри <data>; «Клиент» — внешний собеседник, «Сотрудник» — наша компания, «Автоответ» — автоматическое сообщение.
- topic: о чём диалог, одной фразой.
- asks: что клиент просит или спрашивает и что ещё не закрыто.
- next_step: что сотруднику сделать дальше (одно действие). Если ничего не требуется — пустая строка.
- summary_markdown: сводка в Markdown (маркированный список, 3–8 пунктов): ключевые факты, договорённости, суммы и сроки — только те, что есть в диалоге.
Не выдумывай того, чего нет в сообщениях."""


@router.post("/inbox/conversations/{conv_id}/summary")
def inbox_conversation_summary(
    conv_id: int,
    ctx: TenantContext = Depends(require("messengers.reply")),
    db: Session = Depends(get_db),
):
    conv = _load_conversation(db, ctx.tenant.id, conv_id)
    rows = (
        db.query(ExternalMessage)
        .filter(ExternalMessage.tenant_id == ctx.tenant.id, ExternalMessage.conversation_id == conv.id)
        .order_by(ExternalMessage.id.desc())
        .limit(CHAT_MESSAGES)
        .all()
    )
    rows.reverse()
    lines: list[str] = []
    for m in rows:
        body = (m.body or "").strip()
        if not body and m.media:
            body = "[вложение]"
        if not body:
            continue
        if m.is_auto:
            who = "Автоответ"
        elif getattr(m.direction, "value", m.direction) == "outbound":
            who = "Сотрудник"
        else:
            who = "Клиент"
        lines.append(f"[{_fmt_dt(m.created_at)}] {who}: {body[:2000]}")
    if not lines:
        raise HTTPException(400, "В диалоге нет сообщений")
    text = "\n".join(lines)
    if len(text) > CHAT_LIMIT:
        text = "[…начало диалога не показано…]\n" + text[-CHAT_LIMIT:]

    contact = conv.contact
    who = (contact.display_name or contact.username or "клиент") if contact else "клиент"
    kind = getattr(conv.channel.kind, "value", conv.channel.kind) if conv.channel else "мессенджер"
    content = (
        f"Канал: {kind}. Сообщений в выборке: {len(lines)}.\n\n"
        + core_ai.wrap_data("chat", f"Собеседник: {who}\n\n{text}")
    )
    res = core_ai.run(db, ctx, "summarize_chat", CHAT_SUMMARY_TASK, content, schema=SUMMARY_SCHEMA, max_tokens=4000)
    return _summary_out(res.data)


# =============================================================================
# 3. Задачи из письма
# =============================================================================

TASKS_SCHEMA = {
    "type": "object",
    "properties": {
        "tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Короткое название задачи, начинается с глагола"},
                    "description": {"type": "string", "description": "Что нужно сделать, детали из письма"},
                    "priority": {"type": "string", "enum": PRIORITIES},
                    "due_date": {**_NULLABLE_STR, "description": "Срок в формате YYYY-MM-DD или null"},
                    "assignee_id": {**_NULLABLE_INT, "description": "id сотрудника из списка или null"},
                    "assignee_hint": {**_NULLABLE_STR, "description": "Кто, судя по письму, должен выполнить, если сотрудника нет в списке; иначе null"},
                },
                "required": ["title", "description", "priority", "due_date", "assignee_id", "assignee_hint"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["tasks"],
    "additionalProperties": False,
}


def _tasks_task(today: date, employees: list[dict]) -> str:
    emp = "\n".join(
        f"- id={e['id']}: {e['name']}" + (f" ({e['position']})" if e.get("position") else "") for e in employees
    ) or "- (список пуст)"
    return f"""Выдели из письма задачи для сотрудников нашей компании: конкретные действия, которые нужно сделать по этому письму.
Письмо передано внутри <data>.
- Не больше 7 задач; если в письме нечего делать — верни пустой список.
- title: коротко, с глагола («Отправить…», «Подготовить…»), до 120 символов.
- description: что именно сделать и важные детали из письма (суммы, номера, адреса), 1–4 предложения.
- priority: low, medium, high или critical — по срочности из письма; по умолчанию medium.
- due_date: срок в формате YYYY-MM-DD, только если он есть в письме или однозначно следует из него («до пятницы», «завтра»). Сегодня {today.isoformat()} ({_WEEKDAYS[today.weekday()]}). Иначе null.
- assignee_id: id сотрудника из списка ниже, только если письмо явно указывает на него (по имени или роли). Иначе null. Не придумывай id, которых нет в списке.
- assignee_hint: если исполнитель упомянут, но его нет в списке, — как он назван в письме; иначе null.

Сотрудники компании:
{emp}"""


_WEEKDAYS = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]


def _clean_tasks(data: Any, allowed_ids: set[int]) -> list[dict]:
    items = (data or {}).get("tasks") if isinstance(data, dict) else None
    out: list[dict] = []
    for t in items or []:
        if not isinstance(t, dict):
            continue
        title = str(t.get("title") or "").strip()[:300]
        if not title:
            continue
        priority = t.get("priority") if t.get("priority") in PRIORITIES else "medium"
        due = t.get("due_date")
        try:
            due = date.fromisoformat(str(due)).isoformat() if due else None
        except ValueError:
            due = None
        aid = t.get("assignee_id")
        # Исполнитель — только сотрудник этой компании
        if not isinstance(aid, int) or isinstance(aid, bool) or aid not in allowed_ids:
            aid = None
        hint = t.get("assignee_hint")
        hint = str(hint).strip()[:200] if hint else None
        out.append({
            "title": title,
            "description": str(t.get("description") or "").strip()[:5000],
            "priority": priority,
            "due_date": due,
            "assignee_id": aid,
            "assignee_hint": hint or None,
        })
        if len(out) >= 10:
            break
    return out


@router.post("/mail/messages/{message_id}/tasks")
def mail_message_tasks(
    message_id: int,
    ctx: TenantContext = Depends(require("mail.use")),
    db: Session = Depends(get_db),
):
    if not ctx.membership.is_owner and not user_has(ctx.user, ["tasks.create"], tenant_id=ctx.tenant.id):
        raise HTTPException(403, "Нет права создавать задачи")
    msg, thread = _load_mail_message(db, ctx, message_id)
    employees = _employees(db, ctx.tenant.id)
    today = date.today()
    content = core_ai.wrap_data("mail_message", _mail_block(msg))
    res = core_ai.run(db, ctx, "tasks_from_text", _tasks_task(today, employees), content,
                      schema=TASKS_SCHEMA, max_tokens=4000)
    return {
        "message_id": msg.id,
        "thread_id": thread.id,
        "thread_linked_task_id": thread.linked_task_id,
        "tasks": _clean_tasks(res.data, {e["id"] for e in employees}),
    }


# =============================================================================
# 4. Отчёт по описанию
# =============================================================================

TASK_GROUPS = ["assignee", "project", "status", "priority", "day", "week", "month"]
# Какие группировки поддерживает каждая метрика (как в compute_report в api/reports.py)
VALID_GROUPS: dict[str, list[str]] = {
    "tasks_count": TASK_GROUPS,
    "tasks_completed": TASK_GROUPS,
    "tasks_overdue": TASK_GROUPS,
    "hours_logged": ["assignee", "project", "day", "week", "month"],
    "deals_amount": ["stage", "owner", "day", "week", "month"],
    "deals_weighted": ["stage", "owner", "day", "week", "month"],
    "deals_count": ["stage", "owner", "day", "week", "month"],
}

REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "supported": {"type": "boolean", "description": "false, если такой отчёт нельзя собрать из доступных метрик"},
        "metric": {"type": "string", "enum": list(ALLOWED_METRICS)},
        "group_by": {"type": "string", "enum": list(ALLOWED_GROUPS)},
        "from_date": {**_NULLABLE_STR, "description": "Начало периода YYYY-MM-DD или null"},
        "to_date": {**_NULLABLE_STR, "description": "Конец периода YYYY-MM-DD или null"},
        "explanation": {"type": "string", "description": "Одно предложение: что покажет отчёт, или почему его нельзя собрать"},
    },
    "required": ["supported", "metric", "group_by", "from_date", "to_date", "explanation"],
    "additionalProperties": False,
}


def _report_task(today: date) -> str:
    metrics = "\n".join(f"- {k}: {v}" for k, v in ALLOWED_METRICS.items())
    groups = "\n".join(f"- {k}: {v}" for k, v in ALLOWED_GROUPS.items())
    combos = "\n".join(f"- {m}: {', '.join(g)}" for m, g in VALID_GROUPS.items())
    return f"""Пользователь описывает словами отчёт, который хочет увидеть в конструкторе отчётов Qadam CRM. Подбери настройки конструктора.
Метрики:
{metrics}
Группировки:
{groups}
Допустимые группировки для каждой метрики:
{combos}
Период (from_date, to_date) — по дате создания задачи/сделки или дате записи времени; формат YYYY-MM-DD, null — без ограничения. Сегодня {today.isoformat()}. «За прошлый месяц», «в этом квартале» и т.п. переводи в конкретные даты.
Сделки считаются только по воронке «Продажи».
Если описанный отчёт нельзя собрать из этих метрик и группировок — supported=false, в explanation кратко объясни почему и что можно построить вместо; metric и group_by тогда заполни ближайшим вариантом.
explanation — одно предложение по-русски."""


class ReportSuggestIn(BaseModel):
    description: str = Field(min_length=3, max_length=500)


def _parse_date(v: Any) -> Optional[str]:
    if not v:
        return None
    try:
        return date.fromisoformat(str(v)).isoformat()
    except ValueError:
        raise HTTPException(502, "ИИ-помощник вернул некорректную дату. Попробуйте переформулировать")


def _validate_report(data: Any) -> dict:
    d = data if isinstance(data, dict) else {}
    metric, group_by = d.get("metric"), d.get("group_by")
    explanation = str(d.get("explanation") or "").strip()
    if not d.get("supported", False):
        return {"supported": False, "explanation": explanation or "Такой отчёт пока нельзя собрать в конструкторе"}
    if metric not in ALLOWED_METRICS or group_by not in ALLOWED_GROUPS or group_by not in VALID_GROUPS.get(metric, []):
        raise HTTPException(502, "ИИ-помощник предложил недопустимые настройки отчёта. Попробуйте переформулировать")
    from_date, to_date = _parse_date(d.get("from_date")), _parse_date(d.get("to_date"))
    if from_date and to_date and from_date > to_date:
        from_date, to_date = to_date, from_date
    return {
        "supported": True,
        "metric": metric,
        "group_by": group_by,
        "from_date": from_date,
        "to_date": to_date,
        "explanation": explanation,
    }


@router.post("/reports/suggest")
def report_suggest(
    payload: ReportSuggestIn,
    ctx: TenantContext = Depends(require("analytics.reports")),
    db: Session = Depends(get_db),
):
    today = date.today()
    res = core_ai.run(db, ctx, "report_suggest", _report_task(today), f"Описание отчёта: {payload.description.strip()}",
                      schema=REPORT_SCHEMA, max_tokens=2000)
    return _validate_report(res.data)
