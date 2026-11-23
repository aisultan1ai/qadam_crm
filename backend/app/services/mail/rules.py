"""Применение правил почты к входящему письму.

Условия (все должны совпасть):
  {"field": "from|to|subject|body", "op": "contains|not_contains|equals|starts_with", "value": "..."}
Действия:
  {"type": "mark_read"}                  — пометить прочитанным
  {"type": "archive"}                    — убрать переписку в архив
  {"type": "create_task", "params": {"project_id": int|None, "assignee_id": int|None}}
                                         — задача из письма, связывается с перепиской
  {"type": "notify"}                     — уведомление владельцу ящика
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

log = logging.getLogger("qadam.mail.rules")

FIELDS = {"from", "to", "subject", "body"}
OPS = {"contains", "not_contains", "equals", "starts_with"}
ACTIONS = {"mark_read", "archive", "create_task", "notify"}


def _field_value(field: str, msg) -> str:
    if field == "from":
        return f"{msg.from_name or ''} {msg.from_addr or ''}"
    if field == "to":
        return " ".join((msg.to_addrs or []) + (msg.cc_addrs or []))
    if field == "subject":
        return msg.subject or ""
    if field == "body":
        return msg.body_text or ""
    return ""


def condition_matches(cond: dict[str, Any], msg) -> bool:
    field, op = cond.get("field"), cond.get("op") or "contains"
    needle = str(cond.get("value") or "").strip().lower()
    if field not in FIELDS or op not in OPS or not needle:
        return False
    hay = _field_value(field, msg).lower()
    if op == "contains":
        return needle in hay
    if op == "not_contains":
        return needle not in hay
    if op == "equals":
        if field in ("from", "to"):
            return needle in {a.strip().lower() for a in hay.split()}
        return hay.strip() == needle
    return hay.strip().startswith(needle)


def rule_matches(rule, msg) -> bool:
    conds = [c for c in (rule.conditions or []) if isinstance(c, dict)]
    return bool(conds) and all(condition_matches(c, msg) for c in conds)


def _create_task(db: Session, mb, thread, msg, params: dict[str, Any]) -> None:
    from ...models import Project, Task, TaskStatus, User, TenantMembership
    from ...models.task import set_primary_assignee

    project_id = params.get("project_id")
    if isinstance(project_id, int):
        proj = db.get(Project, project_id)
        if not proj or proj.tenant_id != mb.tenant_id:
            project_id = None
    else:
        project_id = None

    assignee_id = params.get("assignee_id") if isinstance(params.get("assignee_id"), int) else mb.user_id
    member = (
        db.query(TenantMembership.id)
        .filter(TenantMembership.tenant_id == mb.tenant_id, TenantMembership.user_id == assignee_id)
        .first()
    )
    if not member:
        assignee_id = mb.user_id

    sender = f"{msg.from_name} <{msg.from_addr}>" if msg.from_name else msg.from_addr
    task = Task(
        tenant_id=mb.tenant_id,
        title=(msg.subject or f"Письмо от {msg.from_addr}")[:300],
        description=f"Письмо от {sender}\n\n{(msg.body_text or '').strip()[:5000]}",
        status=TaskStatus.new,
        project_id=project_id,
        author_id=mb.user_id,
    )
    db.add(task)
    db.flush()
    if assignee_id and db.get(User, assignee_id):
        set_primary_assignee(db, task, assignee_id)
    if not thread.linked_task_id:
        thread.linked_task_id = task.id


def _notify(db: Session, mb, thread, msg, rule) -> None:
    from ...models import Notification

    db.add(Notification(
        tenant_id=mb.tenant_id,
        user_id=mb.user_id,
        kind="mail_rule",
        title=f"Письмо по правилу «{rule.name}»"[:300],
        body=f"{msg.from_addr}: {msg.subject or '(без темы)'}"[:1000],
        link=f"/mail?thread={thread.id}",
    ))


def apply_rules(db: Session, mb, thread, msg) -> list[str]:
    """Применяет активные правила ящика к входящему письму. Возвращает имена сработавших правил.
    Ошибка одного правила не мешает сохранению письма."""
    from ...models import MailRule

    rules = (
        db.query(MailRule)
        .filter(MailRule.mailbox_id == mb.id, MailRule.tenant_id == mb.tenant_id, MailRule.is_active.is_(True))
        .order_by(MailRule.order_index, MailRule.id)
        .all()
    )
    fired: list[str] = []
    for rule in rules:
        if not rule_matches(rule, msg):
            continue
        try:
            with db.begin_nested():
                for act in rule.actions or []:
                    kind = act.get("type") if isinstance(act, dict) else None
                    params = act.get("params") or {} if isinstance(act, dict) else {}
                    if kind == "mark_read" and not msg.is_read:
                        msg.is_read = True
                        thread.unread_count = max(0, (thread.unread_count or 0) - 1)
                    elif kind == "archive":
                        thread.is_archived = True
                    elif kind == "create_task":
                        _create_task(db, mb, thread, msg, params)
                    elif kind == "notify":
                        _notify(db, mb, thread, msg, rule)
            fired.append(rule.name)
        except Exception:  # noqa: BLE001
            log.exception("mail rule %s failed for message %s", rule.id, msg.id)
            continue
        if rule.stop_on_match:
            break
    return fired
