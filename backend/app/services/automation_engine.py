"""Rule engine автоматизаций.

Триггер (fire_event) → Celery task `automation.dispatch` → находит подходящие
Automation с matching trigger_event → для каждой запускает execute_automation.

execute_automation:
  1. Создаёт AutomationRun (status=running)
  2. Начинает с trigger-node в graph, идёт по edges
  3. Для каждой посещённой node создаёт AutomationAction с результатом
  4. Condition → выбирает ветку yes/no по результату
  5. Delay → сохраняет action.scheduled_for + ставит celery-task с ETA, останавливает обход;
     Celery-task потом снова вызовет _continue_after_delay для этой node
  6. По завершении обновляет AutomationRun.status

Template substitution: `{{event.entity.title}}` → dot-path lookup в context dict.
Context = {"event": trigger_payload, "created": {node_id: {"task_id": 42}, ...}}
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models import (
    Automation, AutomationAction, AutomationActionStatus, AutomationRun,
    AutomationRunStatus, Channel, ChannelMember, Message, Notification, Task, TenantLead, User,
)
from ..models.task import TaskPriority, TaskStatus
from ..core.ws_hub import publish_to_channel, publish_to_tenant, publish_to_user

log = logging.getLogger("qadam.automation")

TEMPLATE_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_\.]+)\s*\}\}")

# Максимум nodes которые можно посетить в одном run — защита от бесконечных циклов
MAX_NODES_PER_RUN = 100


def _now() -> datetime:
    return datetime.now(timezone.utc)


# =============================================================================
# Template rendering: {{event.entity.title}} → lookup by dot-path
# =============================================================================


def _lookup(context: dict, path: str) -> Any:
    parts = path.split(".")
    cur: Any = context
    for p in parts:
        if isinstance(cur, dict):
            cur = cur.get(p)
        elif isinstance(cur, list):
            try:
                cur = cur[int(p)]
            except (ValueError, IndexError):
                return None
        else:
            cur = getattr(cur, p, None)
        if cur is None:
            return None
    return cur


def render_template(text: Optional[str], context: dict) -> Optional[str]:
    """Заменяет {{path.to.value}} на реальные значения из context."""
    if not text:
        return text

    def _replace(m: re.Match) -> str:
        value = _lookup(context, m.group(1))
        return "" if value is None else str(value)

    return TEMPLATE_RE.sub(_replace, text)


def render_value(value: Any, context: dict) -> Any:
    """Аналог render_template но для произвольного JSON-значения (dict/list/str)."""
    if isinstance(value, str):
        return render_template(value, context)
    if isinstance(value, dict):
        return {k: render_value(v, context) for k, v in value.items()}
    if isinstance(value, list):
        return [render_value(v, context) for v in value]
    return value


# =============================================================================
# Graph traversal
# =============================================================================


def _find_node(graph: dict, node_id: str) -> Optional[dict]:
    for n in graph.get("nodes") or []:
        if n.get("id") == node_id:
            return n
    return None


def _find_trigger_node(graph: dict) -> Optional[dict]:
    for n in graph.get("nodes") or []:
        if n.get("type") == "trigger":
            return n
    return None


def _outgoing_edges(graph: dict, node_id: str, source_handle: Optional[str] = None) -> list[dict]:
    result = []
    for e in graph.get("edges") or []:
        if e.get("source") != node_id:
            continue
        if source_handle is not None and e.get("sourceHandle") not in (source_handle, None):
            continue
        result.append(e)
    return result


# =============================================================================
# Conditions
# =============================================================================

CONDITION_OPS = {
    "==": lambda a, b: str(a) == str(b),
    "!=": lambda a, b: str(a) != str(b),
    ">": lambda a, b: (_to_num(a) or 0) > (_to_num(b) or 0),
    "<": lambda a, b: (_to_num(a) or 0) < (_to_num(b) or 0),
    ">=": lambda a, b: (_to_num(a) or 0) >= (_to_num(b) or 0),
    "<=": lambda a, b: (_to_num(a) or 0) <= (_to_num(b) or 0),
    "contains": lambda a, b: str(b).lower() in str(a).lower(),
    "startswith": lambda a, b: str(a).lower().startswith(str(b).lower()),
    "empty": lambda a, _b: a in (None, "", [], {}),
    "not_empty": lambda a, _b: a not in (None, "", [], {}),
}


def _to_num(v: Any) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _evaluate_condition(node: dict, context: dict) -> bool:
    data = node.get("data") or {}
    expr = data.get("expr")   # dot-path, например event.entity.status
    op = data.get("op", "==")
    value = data.get("value")

    if not expr:
        return True   # empty condition → always yes

    left = _lookup(context, expr)
    rendered_right = render_value(value, context) if isinstance(value, (str, dict, list)) else value
    fn = CONDITION_OPS.get(op)
    if not fn:
        log.warning("automation: unknown condition op %r", op)
        return False
    try:
        return bool(fn(left, rendered_right))
    except Exception as exc:
        log.warning("automation: condition eval failed: %s", exc)
        return False


# =============================================================================
# Actions
# =============================================================================


class ActionError(Exception):
    """Ошибка исполнения action — фиксируется в AutomationAction.error."""


def _action_create_task(db: Session, tenant_id: int, config: dict, context: dict) -> dict:
    rendered = render_value(config, context)
    title = (rendered.get("title") or "Задача от автоматизации")[:300]
    description = rendered.get("description") or None
    project_id = rendered.get("project_id")
    assignee_id = rendered.get("assignee_id")
    priority_raw = rendered.get("priority") or "medium"
    try:
        priority = TaskPriority(priority_raw)
    except ValueError:
        priority = TaskPriority.medium
    deadline_offset_h = rendered.get("deadline_hours_from_now")
    deadline = None
    if deadline_offset_h:
        try:
            deadline = _now() + timedelta(hours=int(deadline_offset_h))
        except (TypeError, ValueError):
            pass

    task = Task(
        tenant_id=tenant_id,
        title=title,
        description=description,
        status=TaskStatus.new,
        priority=priority,
        project_id=project_id if isinstance(project_id, int) else None,
        assignee_id=assignee_id if isinstance(assignee_id, int) else None,
        deadline=deadline,
        author_id=None,
    )
    db.add(task)
    db.flush()
    if task.assignee_id:
        publish_to_user(tenant_id, task.assignee_id, "task.assigned", {"task_id": task.id})
    return {"task_id": task.id, "title": title}


def _action_send_email(config: dict, context: dict) -> dict:
    """Постановка email в очередь через Celery. Собственно рассылка — в email.py."""
    from ..tasks.email import send_notification_email

    rendered = render_value(config, context)
    to = rendered.get("to")
    if not to:
        raise ActionError("send_email: не указан адрес получателя (to)")
    title = rendered.get("subject") or "Уведомление"
    body = rendered.get("body") or ""
    link_url = rendered.get("link_url") or None

    try:
        send_notification_email.delay(to=to, title=title, body=body, link_url=link_url)
    except Exception as exc:
        raise ActionError(f"send_email: не удалось поставить в очередь: {exc}") from exc
    return {"queued_to": to}


def _action_send_notification(db: Session, tenant_id: int, config: dict, context: dict) -> dict:
    rendered = render_value(config, context)
    user_id = rendered.get("user_id")
    title = (rendered.get("title") or "Уведомление")[:300]
    body = (rendered.get("body") or "")[:1000]
    kind = rendered.get("kind") or "automation"

    if not isinstance(user_id, int):
        # Пробуем взять из event.entity.assignee_id как fallback
        user_id = _lookup(context, "event.entity.assignee_id")
    if not isinstance(user_id, int):
        raise ActionError("send_notification: не указан user_id")

    # task_id заполняем только для task.* событий — иначе FK на несуществующую задачу
    event_type_val = context.get("event_type", "")
    task_id_val = None
    if event_type_val.startswith("task."):
        candidate = _lookup(context, "event.entity.id")
        if isinstance(candidate, int):
            task_id_val = candidate

    notif = Notification(
        tenant_id=tenant_id,
        user_id=user_id,
        kind=kind,
        title=title,
        body=body or None,
        task_id=task_id_val,
    )
    db.add(notif)
    db.flush()
    publish_to_user(tenant_id, user_id, "notification.new", {"kind": kind})
    return {"user_id": user_id, "notification_id": notif.id}


def _action_add_to_channel(db: Session, tenant_id: int, config: dict, context: dict) -> dict:
    rendered = render_value(config, context)
    channel_id = rendered.get("channel_id")
    text = rendered.get("text") or ""
    if not isinstance(channel_id, int):
        raise ActionError("add_to_channel: не указан channel_id")
    channel = db.get(Channel, channel_id)
    if not channel or channel.tenant_id != tenant_id:
        raise ActionError("add_to_channel: канал не найден в компании")

    msg = Message(
        tenant_id=tenant_id,
        channel_id=channel_id,
        author_id=None,   # системное сообщение
        body=text[:4000] or "(пусто)",
    )
    db.add(msg)
    db.flush()
    publish_to_channel(
        tenant_id, channel_id, "message.new",
        {"id": msg.id, "channel_id": channel_id, "body": msg.body, "author_id": None},
    )
    return {"channel_id": channel_id, "message_id": msg.id}


def _action_change_status(db: Session, tenant_id: int, config: dict, context: dict) -> dict:
    """Меняет статус триггерящей сущности (task/lead) — по контексту event."""
    rendered = render_value(config, context)
    new_status = rendered.get("status")
    if not new_status:
        raise ActionError("change_status: не указан status")

    entity_id = _lookup(context, "event.entity.id")
    if not isinstance(entity_id, int):
        raise ActionError("change_status: не могу определить id объекта в контексте")

    event_type = context.get("event_type", "")
    if event_type.startswith("task."):
        task = db.get(Task, entity_id)
        if not task or task.tenant_id != tenant_id:
            raise ActionError("change_status: задача не найдена")
        try:
            task.status = TaskStatus(new_status)
        except ValueError:
            raise ActionError(f"change_status: неизвестный статус задачи {new_status!r}")
        db.flush()
        return {"task_id": entity_id, "new_status": new_status}
    elif event_type.startswith("lead."):
        lead = db.get(TenantLead, entity_id)
        if not lead or lead.tenant_id != tenant_id:
            raise ActionError("change_status: лид не найден")
        lead.status = str(new_status)[:50]
        db.flush()
        return {"lead_id": entity_id, "new_status": new_status}
    raise ActionError(f"change_status: не поддерживается для события {event_type!r}")


def _action_assign_user(db: Session, tenant_id: int, config: dict, context: dict) -> dict:
    rendered = render_value(config, context)
    user_id = rendered.get("user_id")
    if not isinstance(user_id, int):
        raise ActionError("assign_user: не указан user_id")

    entity_id = _lookup(context, "event.entity.id")
    if not isinstance(entity_id, int):
        raise ActionError("assign_user: не могу определить id объекта")

    event_type = context.get("event_type", "")
    if event_type.startswith("task."):
        task = db.get(Task, entity_id)
        if not task or task.tenant_id != tenant_id:
            raise ActionError("assign_user: задача не найдена")
        task.assignee_id = user_id
        db.flush()
        publish_to_user(tenant_id, user_id, "task.assigned", {"task_id": entity_id})
        return {"task_id": entity_id, "assignee_id": user_id}
    if event_type.startswith("lead."):
        lead = db.get(TenantLead, entity_id)
        if not lead or lead.tenant_id != tenant_id:
            raise ActionError("assign_user: лид не найден")
        lead.assignee_id = user_id
        db.flush()
        return {"lead_id": entity_id, "assignee_id": user_id}
    raise ActionError(f"assign_user: не поддерживается для события {event_type!r}")


def _action_add_comment(db: Session, tenant_id: int, config: dict, context: dict) -> dict:
    """Добавляет комментарий к задаче из контекста (или к явному task_id)."""
    from ..models import Comment

    rendered = render_value(config, context)
    body = rendered.get("body")
    if not body:
        raise ActionError("add_comment: пустой текст комментария")
    task_id = rendered.get("task_id") or _lookup(context, "event.entity.id")
    if not isinstance(task_id, int):
        raise ActionError("add_comment: не могу определить task_id")

    task = db.get(Task, task_id)
    if not task or task.tenant_id != tenant_id:
        raise ActionError("add_comment: задача не найдена")

    comment = Comment(
        tenant_id=tenant_id,
        task_id=task_id,
        author_id=None,
        body=body[:5000],
    )
    db.add(comment)
    db.flush()
    return {"task_id": task_id, "comment_id": comment.id}


def _action_webhook(config: dict, context: dict) -> dict:
    """HTTP POST на внешний URL. HMAC-подпись body по секрету из config."""
    rendered = render_value(config, context)
    url = rendered.get("url")
    if not url or not isinstance(url, str) or not url.startswith(("http://", "https://")):
        raise ActionError("webhook: некорректный url")
    method = (rendered.get("method") or "POST").upper()
    if method not in ("POST", "PUT", "PATCH"):
        raise ActionError("webhook: поддерживаются только POST/PUT/PATCH")

    body_data = rendered.get("body") or {"event": context.get("event_type"), "payload": context.get("event")}
    body_bytes = json.dumps(body_data, ensure_ascii=False, default=str).encode("utf-8")

    headers = {"Content-Type": "application/json"}
    secret = rendered.get("hmac_secret")
    if secret:
        sig = hmac.new(str(secret).encode(), body_bytes, hashlib.sha256).hexdigest()
        headers["X-Signature"] = f"sha256={sig}"

    try:
        resp = httpx.request(method, url, content=body_bytes, headers=headers, timeout=15.0)
    except httpx.HTTPError as exc:
        raise ActionError(f"webhook: сетевая ошибка: {exc}") from exc
    return {"url": url, "status_code": resp.status_code}


# Реестр action-исполнителей. Каждый принимает разный набор аргументов —
# _execute_action ниже маршрутизирует по action_type.
def _execute_action(
    action_type: str,
    node_config: dict,
    context: dict,
    db: Session,
    tenant_id: int,
) -> dict:
    if action_type == "create_task":
        return _action_create_task(db, tenant_id, node_config, context)
    if action_type == "send_email":
        return _action_send_email(node_config, context)
    if action_type == "send_notification":
        return _action_send_notification(db, tenant_id, node_config, context)
    if action_type == "add_to_channel":
        return _action_add_to_channel(db, tenant_id, node_config, context)
    if action_type == "change_status":
        return _action_change_status(db, tenant_id, node_config, context)
    if action_type == "assign_user":
        return _action_assign_user(db, tenant_id, node_config, context)
    if action_type == "add_comment":
        return _action_add_comment(db, tenant_id, node_config, context)
    if action_type == "webhook":
        return _action_webhook(node_config, context)
    raise ActionError(f"неизвестный action_type: {action_type}")


# =============================================================================
# Orchestration: dispatch, execute, walk graph
# =============================================================================


def dispatch_event(event_type: str, tenant_id: int, payload: dict) -> dict:
    """Находит активные автоматизации для события и запускает их (по одной, синхронно)."""
    with SessionLocal() as db:
        automations = (
            db.query(Automation)
            .filter(
                Automation.tenant_id == tenant_id,
                Automation.is_active.is_(True),
                Automation.trigger_event == event_type,
            )
            .all()
        )
        run_ids = []
        for a in automations:
            try:
                run = execute_automation(db, a, event_type, payload)
                run_ids.append(run.id)
            except Exception:
                log.exception("execute_automation failed: automation=%s tenant=%s", a.id, tenant_id)
        return {"tenant_id": tenant_id, "event": event_type, "runs": run_ids}


def execute_automation(
    db: Session,
    automation: Automation,
    event_type: str,
    event_payload: dict,
    dry_run: bool = False,
) -> AutomationRun:
    """Создаёт AutomationRun и обходит граф."""
    run = AutomationRun(
        automation_id=automation.id,
        tenant_id=automation.tenant_id,
        status=AutomationRunStatus.running,
        trigger_payload=event_payload,
        is_dry_run=dry_run,
    )
    db.add(run)
    db.flush()

    context = {
        "event_type": event_type,
        "event": event_payload,
        "results": {},
    }

    trigger = _find_trigger_node(automation.graph or {})
    if not trigger:
        run.status = AutomationRunStatus.failed
        run.error = "В графе нет trigger-node"
        run.finished_at = _now()
        db.commit()
        return run

    _walk(db, automation, run, trigger["id"], context, dry_run=dry_run)

    # Финализация. Если в графе есть delay-nodes, часть actions осталась scheduled —
    # тогда run пока в running; когда worker обработает delay, вызовет continue_after_delay.
    still_pending = any(
        a.status in (AutomationActionStatus.pending, AutomationActionStatus.scheduled, AutomationActionStatus.running)
        for a in run.actions
    )
    if not still_pending:
        _finalize_run(run)
    db.commit()
    db.refresh(run)
    return run


def continue_after_delay(action_id: int) -> None:
    """Celery-задача при истечении ETA у delay-node. Продолжает обход графа с этой node."""
    with SessionLocal() as db:
        action = db.get(AutomationAction, action_id)
        if not action:
            return
        if action.status != AutomationActionStatus.scheduled:
            log.info("continue_after_delay: action %s already %s, skip", action_id, action.status)
            return
        run = db.get(AutomationRun, action.run_id)
        if not run:
            return
        automation = db.get(Automation, run.automation_id)
        if not automation:
            return

        action.status = AutomationActionStatus.succeeded
        action.executed_at = _now()
        action.result = {"resumed": True}
        db.flush()

        context = {
            "event_type": run.trigger_payload.get("event_type") or "",
            "event": run.trigger_payload,
            "results": {a.node_id: a.result for a in run.actions if a.result},
        }
        _walk(db, automation, run, action.node_id, context, dry_run=run.is_dry_run, from_delay=True)
        _finalize_run(run)
        db.commit()


def _walk(
    db: Session,
    automation: Automation,
    run: AutomationRun,
    start_node_id: str,
    context: dict,
    dry_run: bool,
    from_delay: bool = False,
) -> None:
    """Обход графа. Не вызывает commit — вызывающая сторона отвечает."""
    graph = automation.graph or {}
    # Стек: (node_id, source_handle_of_incoming_edge). Handle нужен только для branch/condition.
    visited = 0

    # Если пришли из delay — начнём обход с исходящих edges этой node, а не с самой node.
    if from_delay:
        edges = _outgoing_edges(graph, start_node_id)
        stack: list[str] = [e["target"] for e in edges]
    else:
        # Если это trigger — идём по edges. Trigger-node не создаёт AutomationAction.
        start = _find_node(graph, start_node_id)
        if not start:
            return
        if start.get("type") == "trigger":
            edges = _outgoing_edges(graph, start_node_id)
            stack = [e["target"] for e in edges]
        else:
            stack = [start_node_id]

    while stack:
        if visited >= MAX_NODES_PER_RUN:
            log.warning("automation %s: hit MAX_NODES_PER_RUN limit", automation.id)
            break
        visited += 1
        node_id = stack.pop(0)
        node = _find_node(graph, node_id)
        if not node:
            continue
        ntype = node.get("type")
        ndata = node.get("data") or {}

        if ntype == "condition":
            result = _evaluate_condition(node, context)
            action = AutomationAction(
                run_id=run.id,
                tenant_id=run.tenant_id,
                node_id=node_id,
                action_type="condition",
                node_config=ndata,
                status=AutomationActionStatus.succeeded,
                executed_at=_now(),
                result={"matched": result},
            )
            db.add(action)
            db.flush()
            handle = "yes" if result else "no"
            next_edges = _outgoing_edges(graph, node_id, source_handle=handle)
            # Если у edge нет sourceHandle, всё равно берём (только для yes-ветки)
            if not next_edges and result:
                next_edges = [e for e in _outgoing_edges(graph, node_id) if not e.get("sourceHandle")]
            stack.extend(e["target"] for e in next_edges)

        elif ntype == "delay":
            seconds = int(ndata.get("seconds") or 0)
            if seconds <= 0:
                # Delay без задержки — просто идём дальше
                stack.extend(e["target"] for e in _outgoing_edges(graph, node_id))
                continue
            action = AutomationAction(
                run_id=run.id,
                tenant_id=run.tenant_id,
                node_id=node_id,
                action_type="delay",
                node_config=ndata,
                status=AutomationActionStatus.scheduled if not dry_run else AutomationActionStatus.skipped,
                scheduled_for=_now() + timedelta(seconds=seconds),
            )
            db.add(action)
            db.flush()
            if not dry_run:
                _schedule_delayed(action.id, seconds)
            # Обход останавливается: продолжится через continue_after_delay

        elif ntype == "action":
            action_type = ndata.get("action_type") or "unknown"
            node_config = ndata.get("config") or {}
            action = AutomationAction(
                run_id=run.id,
                tenant_id=run.tenant_id,
                node_id=node_id,
                action_type=action_type,
                node_config=node_config,
                status=AutomationActionStatus.running,
            )
            db.add(action)
            db.flush()
            try:
                if dry_run:
                    action.status = AutomationActionStatus.skipped
                    action.result = {"dry_run": True}
                else:
                    result = _execute_action(
                        action_type, node_config, context, db=db, tenant_id=run.tenant_id
                    )
                    action.status = AutomationActionStatus.succeeded
                    action.result = result
                    context["results"][node_id] = result
                action.executed_at = _now()
            except ActionError as exc:
                action.status = AutomationActionStatus.failed
                action.error = str(exc)
                action.executed_at = _now()
                log.warning("automation %s action %s failed: %s", automation.id, node_id, exc)
                # Обработка failure: не идём дальше по этой ветке
                continue
            except Exception as exc:
                action.status = AutomationActionStatus.failed
                action.error = f"internal: {exc}"
                action.executed_at = _now()
                log.exception("automation %s action %s crashed", automation.id, node_id)
                continue
            db.flush()
            stack.extend(e["target"] for e in _outgoing_edges(graph, node_id))

        elif ntype == "branch":
            # Явные yes/no ветки — по dot-path из context
            handle = "yes" if _evaluate_condition(node, context) else "no"
            next_edges = _outgoing_edges(graph, node_id, source_handle=handle)
            stack.extend(e["target"] for e in next_edges)

        else:
            # Неизвестный тип — пропустить и идти дальше
            log.warning("automation %s: unknown node type %r", automation.id, ntype)
            stack.extend(e["target"] for e in _outgoing_edges(graph, node_id))


def _finalize_run(run: AutomationRun) -> None:
    """Считает итоговый статус run по статусам actions."""
    still_running = any(
        a.status in (AutomationActionStatus.pending, AutomationActionStatus.scheduled, AutomationActionStatus.running)
        for a in run.actions
    )
    if still_running:
        run.status = AutomationRunStatus.running
        return
    any_failed = any(a.status == AutomationActionStatus.failed for a in run.actions)
    any_succeeded = any(a.status == AutomationActionStatus.succeeded for a in run.actions)
    if any_failed and any_succeeded:
        run.status = AutomationRunStatus.partial
    elif any_failed:
        run.status = AutomationRunStatus.failed
    else:
        run.status = AutomationRunStatus.succeeded
    run.finished_at = _now()


def _schedule_delayed(action_id: int, seconds: int) -> None:
    """Ставит Celery-задачу execute_scheduled_action с ETA. Circular-import-safe."""
    from ..core.celery_app import celery_app
    try:
        celery_app.send_task(
            "automation.execute_scheduled_action",
            kwargs={"action_id": action_id},
            countdown=seconds,
        )
    except Exception:
        log.exception("failed to schedule delayed action %s", action_id)
