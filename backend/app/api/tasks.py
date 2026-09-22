from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, noload
from sqlalchemy import or_, and_
from typing import Optional
from datetime import datetime, timezone

from ..database import get_db
from ..models import Task, User, ChecklistItem, Notification, Project, TenantMembership
from ..models.task import (
    TaskStatus, TaskPriority, TaskReminder,
    task_assignees, task_auditors, task_participants,
)
from ..core.events import build_change_payload, fire_event, serialize_task
from ..core.permissions import user_has
from ..core.ws_hub import publish_to_user
from ..core.cache import invalidate_analytics
from ..schemas.task import (
    TaskOut, TaskListItem, TaskCreate, TaskUpdate, TaskBulkUpdate,
    ChecklistItemCreate, ChecklistItemOut,
    TaskUserRefs, TaskReminderCreate, TaskReminderOut,
)
from ..schemas.common import Message, Page, PageParams, page_params, paginate
from .deps import TenantContext, require, get_current_context, log_action

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _user_can_view_task(user: User, task: Task) -> bool:
    if user_has(user, ["tasks.view_all"], tenant_id=task.tenant_id):
        return True
    if user_has(user, ["tasks.view_own"], tenant_id=task.tenant_id):
        if task.assignee_id == user.id or task.author_id == user.id:
            return True
        # Множественные роли: assignees / auditors / participants
        uids = {u.id for u in (task.assignees or [])} \
            | {u.id for u in (task.auditors or [])} \
            | {u.id for u in (task.participants or [])}
        return user.id in uids
    return False


def _apply_view_scope(query, user: User, tenant_id: int):
    if user_has(user, ["tasks.view_all"], tenant_id=tenant_id):
        return query
    if user_has(user, ["tasks.view_own"], tenant_id=tenant_id):
        # Пользователь видит задачу, если он: author, legacy assignee_id,
        # либо состоит в assignees/auditors/participants.
        assignee_ids = db_subq(task_assignees, user.id)
        auditor_ids = db_subq(task_auditors, user.id)
        participant_ids = db_subq(task_participants, user.id)
        return query.filter(
            or_(
                Task.assignee_id == user.id,
                Task.author_id == user.id,
                Task.id.in_(assignee_ids),
                Task.id.in_(auditor_ids),
                Task.id.in_(participant_ids),
            )
        )
    return query.filter(Task.id == -1)


def db_subq(assoc_table, user_id: int):
    """SELECT task_id FROM <assoc> WHERE user_id = :uid — для .in_() в scope-фильтрах."""
    from sqlalchemy import select
    return select(assoc_table.c.task_id).where(assoc_table.c.user_id == user_id)


def _notify(db: Session, tenant_id: int, user_id: int, kind: str, title: str, body: str | None = None, task_id: int | None = None):
    if not user_id:
        return
    # Defense-in-depth: не создаём уведомление, если получатель больше не член
    # этого tenant'а (мог быть удалён после назначения задачи). Notification.user_id
    # ссылается на глобального User; без этой проверки старые задачи могли бы слать
    # уведомления бывшим сотрудникам.
    still_member = (
        db.query(TenantMembership.id)
        .filter(TenantMembership.tenant_id == tenant_id, TenantMembership.user_id == user_id)
        .first()
    )
    if not still_member:
        return
    db.add(Notification(tenant_id=tenant_id, user_id=user_id, kind=kind, title=title, body=body, task_id=task_id))


def _assert_user_in_tenant(db: Session, tenant_id: int, user_id: int, err: str = "Пользователь не в компании") -> None:
    exists = (
        db.query(TenantMembership.id)
        .filter(TenantMembership.tenant_id == tenant_id, TenantMembership.user_id == user_id)
        .first()
    )
    if not exists:
        raise HTTPException(400, err)


def _assert_project_in_tenant(db: Session, tenant_id: int, project_id: int | None) -> None:
    if project_id is None:
        return
    proj = db.get(Project, project_id)
    if not proj or proj.tenant_id != tenant_id:
        raise HTTPException(400, "Проект не найден в этой компании")


@router.get("", response_model=Page[TaskListItem])
def list_tasks(
    q: Optional[str] = None,
    project_id: Optional[int] = None,
    assignee_id: Optional[int] = None,
    status: Optional[TaskStatus] = None,
    priority: Optional[TaskPriority] = None,
    overdue: Optional[bool] = None,
    scope: Optional[str] = None,  # all | incoming | outgoing | audited
    pagination: PageParams = Depends(page_params),
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    user = ctx.user
    if not user_has(user, ["tasks.view_all", "tasks.view_own"], tenant_id=ctx.tenant.id):
        raise HTTPException(403, "Нет доступа к задачам")
    query = db.query(Task).filter(Task.tenant_id == ctx.tenant.id).options(
        noload(Task.checklist),
        noload(Task.comments),
        noload(Task.attachments),
        noload(Task.activities),
    )
    query = _apply_view_scope(query, user, ctx.tenant.id)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(Task.title.ilike(like), Task.description.ilike(like)))
    if project_id is not None:
        query = query.filter(Task.project_id == project_id)
    if assignee_id is not None:
        query = query.filter(Task.assignee_id == assignee_id)
    if status is not None:
        query = query.filter(Task.status == status)
    if priority is not None:
        query = query.filter(Task.priority == priority)
    if overdue:
        query = query.filter(and_(
            Task.deadline.is_not(None),
            Task.deadline < _now_utc(),
            Task.status.notin_([TaskStatus.done, TaskStatus.cancelled]),
        ))

    # Planfix-style scope:
    #  incoming = мне назначено (legacy assignee_id ИЛИ я в task_assignees)
    #  outgoing = я поставил (author_id)
    #  audited  = я аудитор (task_auditors)
    #  participating = я участник (task_participants)
    if scope == "incoming":
        assignee_ids = db_subq(task_assignees, user.id)
        query = query.filter(or_(Task.assignee_id == user.id, Task.id.in_(assignee_ids)))
    elif scope == "outgoing":
        query = query.filter(Task.author_id == user.id)
    elif scope == "audited":
        auditor_ids = db_subq(task_auditors, user.id)
        query = query.filter(Task.id.in_(auditor_ids))
    elif scope == "participating":
        participant_ids = db_subq(task_participants, user.id)
        query = query.filter(Task.id.in_(participant_ids))

    query = query.order_by(Task.order_index.asc(), Task.created_at.desc())
    return paginate(query, pagination)


@router.get("/{task_id}", response_model=TaskOut)
def get_task(task_id: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    user = ctx.user
    task = db.get(Task, task_id)
    if not task or task.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Задача не найдена")
    if not _user_can_view_task(user, task):
        raise HTTPException(403, "Нет доступа")
    return task


@router.post("", response_model=TaskOut, status_code=201)
def create_task(payload: TaskCreate, ctx: TenantContext = Depends(require("tasks.create")), db: Session = Depends(get_db)):
    user = ctx.user
    if payload.assignee_id and not user_has(user, ["tasks.assign"], tenant_id=ctx.tenant.id) and payload.assignee_id != user.id:
        raise HTTPException(403, "Нет права назначать исполнителей")
    if payload.assignee_id:
        _assert_user_in_tenant(db, ctx.tenant.id, payload.assignee_id, "Исполнитель не является членом компании")
    _assert_project_in_tenant(db, ctx.tenant.id, payload.project_id)

    task = Task(
        tenant_id=ctx.tenant.id,
        title=payload.title,
        description=payload.description,
        status=payload.status,
        priority=payload.priority,
        project_id=payload.project_id,
        assignee_id=payload.assignee_id,
        start_date=payload.start_date,
        deadline=payload.deadline,
        author_id=user.id,
        parent_task_id=payload.parent_task_id,
        recurrence_rule=payload.recurrence_rule,
        recurrence_next_at=payload.deadline if payload.recurrence_rule else None,
        custom_status_id=payload.custom_status_id,
        custom_data=payload.custom_data or {},
    )
    for item in payload.checklist:
        task.checklist.append(ChecklistItem(text=item.text, done=item.done))

    # Planfix-роли: если переданы — сразу привяжем (при этом валидируем tenant).
    def _valid_users(ids: list[int] | None) -> list[User]:
        if not ids:
            return []
        for uid in ids:
            _assert_user_in_tenant(db, ctx.tenant.id, uid, "Пользователь не в компании")
        return db.query(User).filter(User.id.in_(ids)).all()

    task.assignees = _valid_users(payload.assignee_ids)
    task.auditors = _valid_users(payload.auditor_ids)
    task.participants = _valid_users(payload.participant_ids)
    # Если legacy assignee_id есть, но нет в assignees — добавим (primary всегда среди назначенных).
    if task.assignee_id and not any(u.id == task.assignee_id for u in task.assignees):
        primary = db.get(User, task.assignee_id)
        if primary:
            task.assignees.append(primary)

    if payload.reminders:
        for r in payload.reminders:
            task.reminders.append(TaskReminder(kind=r.kind, offset_minutes=r.offset_minutes))

    db.add(task)
    db.flush()
    log_action(db, tenant_id=ctx.tenant.id, user_id=user.id, action="create", entity="task", entity_id=task.id, task_id=task.id, detail=task.title)
    if task.assignee_id and task.assignee_id != user.id:
        _notify(db, ctx.tenant.id, task.assignee_id, "assigned", "Новая задача", task.title, task.id)
    db.commit()
    db.refresh(task)
    invalidate_analytics(ctx.tenant.id)
    if task.assignee_id and task.assignee_id != user.id:
        publish_to_user(ctx.tenant.id, task.assignee_id, "notification.new", {"task_id": task.id})
        publish_to_user(ctx.tenant.id, task.assignee_id, "task.assigned", {"task_id": task.id})
    fire_event("task.created", ctx.tenant.id, {"entity": serialize_task(task), "actor_id": user.id})
    return task


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, payload: TaskUpdate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    user = ctx.user
    task = db.get(Task, task_id)
    if not task or task.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Задача не найдена")
    if not user_has(user, ["tasks.update"], tenant_id=ctx.tenant.id):
        raise HTTPException(403, "Нет права редактировать")

    changes: list[str] = []
    field_changes: dict[str, tuple] = {}   # {field: (old, new)} для fire_event
    old_status: Optional[str] = None

    if payload.title is not None and payload.title != task.title:
        field_changes["title"] = (task.title, payload.title)
        task.title = payload.title
        changes.append("название")
    if payload.description is not None and (payload.description or "") != (task.description or ""):
        field_changes["description"] = (task.description, payload.description)
        task.description = payload.description
        changes.append("описание")
    if payload.status is not None and payload.status != task.status:
        if not user_has(user, ["tasks.change_status"], tenant_id=ctx.tenant.id):
            raise HTTPException(403, "Нет права менять статус")
        old = task.status.value
        old_status = old
        field_changes["status"] = (old, payload.status.value)
        task.status = payload.status
        changes.append(f"статус {old} → {payload.status.value}")
        if task.assignee_id and task.assignee_id != user.id:
            _notify(db, ctx.tenant.id, task.assignee_id, "status", f"Статус изменён: {task.title}", f"{old} → {payload.status.value}", task.id)
    if payload.priority is not None and payload.priority != task.priority:
        if not user_has(user, ["tasks.change_priority"], tenant_id=ctx.tenant.id):
            raise HTTPException(403, "Нет права менять приоритет")
        old = task.priority.value
        task.priority = payload.priority
        changes.append(f"приоритет {old} → {payload.priority.value}")
    if payload.project_id is not None:
        _assert_project_in_tenant(db, ctx.tenant.id, payload.project_id)
        task.project_id = payload.project_id
    if payload.assignee_id is not None and payload.assignee_id != task.assignee_id:
        if not user_has(user, ["tasks.assign"], tenant_id=ctx.tenant.id):
            raise HTTPException(403, "Нет права назначать исполнителей")
        if payload.assignee_id:
            _assert_user_in_tenant(db, ctx.tenant.id, payload.assignee_id, "Исполнитель не является членом компании")
        task.assignee_id = payload.assignee_id
        changes.append("исполнитель")
        if task.assignee_id and task.assignee_id != user.id:
            _notify(db, ctx.tenant.id, task.assignee_id, "assigned", "Вам назначена задача", task.title, task.id)
    if payload.start_date is not None:
        task.start_date = payload.start_date
    if payload.deadline is not None:
        task.deadline = payload.deadline
    if payload.order_index is not None:
        task.order_index = payload.order_index
    if payload.parent_task_id is not None:
        task.parent_task_id = payload.parent_task_id or None
    if payload.recurrence_rule is not None:
        task.recurrence_rule = payload.recurrence_rule or None
        # если правило снято — сбрасываем next_at, иначе выставляем на deadline (если он есть)
        if not payload.recurrence_rule:
            task.recurrence_next_at = None
        elif task.recurrence_next_at is None:
            task.recurrence_next_at = task.deadline
    if payload.recurrence_next_at is not None:
        task.recurrence_next_at = payload.recurrence_next_at
    if payload.custom_status_id is not None:
        task.custom_status_id = payload.custom_status_id or None
    if payload.custom_data is not None:
        # merge — не затираем целиком
        merged = dict(task.custom_data or {})
        merged.update(payload.custom_data)
        task.custom_data = merged

    if changes:
        log_action(db, tenant_id=ctx.tenant.id, user_id=user.id, action="update", entity="task", entity_id=task.id, task_id=task.id, detail=", ".join(changes))
    db.commit()
    db.refresh(task)
    if changes:
        invalidate_analytics(ctx.tenant.id)

    if changes:
        subscribers = {uid for uid in (task.assignee_id, task.author_id) if uid and uid != user.id}
        for uid in subscribers:
            publish_to_user(ctx.tenant.id, uid, "task.updated", {"task_id": task.id, "changes": changes})
            if any(c.startswith("статус") for c in changes) or any(c == "исполнитель" for c in changes):
                publish_to_user(ctx.tenant.id, uid, "notification.new", {"task_id": task.id})

        entity_snapshot = serialize_task(task)
        base = {**build_change_payload(entity_snapshot, field_changes), "actor_id": user.id}
        fire_event("task.updated", ctx.tenant.id, base)
        if old_status is not None:
            fire_event("task.status_changed", ctx.tenant.id, base)
            if task.status.value == "done":
                fire_event("task.completed", ctx.tenant.id, base)

    return task


@router.post("/bulk", response_model=Message)
def bulk_update(payload: TaskBulkUpdate, ctx: TenantContext = Depends(require("tasks.bulk_update")), db: Session = Depends(get_db)):
    user = ctx.user
    tasks = db.query(Task).filter(Task.tenant_id == ctx.tenant.id, Task.id.in_(payload.ids)).all()
    p = payload.patch
    ws_events: list[tuple[int, str, dict]] = []

    if p.project_id is not None:
        _assert_project_in_tenant(db, ctx.tenant.id, p.project_id)
    if p.assignee_id:
        _assert_user_in_tenant(db, ctx.tenant.id, p.assignee_id, "Исполнитель не является членом компании")

    for t in tasks:
        changes: list[str] = []

        if p.status is not None and p.status != t.status:
            old = t.status.value
            t.status = p.status
            changes.append(f"статус {old} → {p.status.value}")
            if t.assignee_id and t.assignee_id != user.id:
                _notify(db, ctx.tenant.id, t.assignee_id, "status", f"Статус изменён: {t.title}", f"{old} → {p.status.value}", t.id)
        if p.priority is not None and p.priority != t.priority:
            old = t.priority.value
            t.priority = p.priority
            changes.append(f"приоритет {old} → {p.priority.value}")
        if p.assignee_id is not None and p.assignee_id != t.assignee_id:
            t.assignee_id = p.assignee_id
            changes.append("исполнитель")
            if t.assignee_id and t.assignee_id != user.id:
                _notify(db, ctx.tenant.id, t.assignee_id, "assigned", "Вам назначена задача", t.title, t.id)
        if p.project_id is not None and p.project_id != t.project_id:
            t.project_id = p.project_id
            changes.append("проект")
        if p.deadline is not None and p.deadline != t.deadline:
            t.deadline = p.deadline
            changes.append("дедлайн")

        if changes:
            log_action(db, tenant_id=ctx.tenant.id, user_id=user.id, action="update", entity="task", entity_id=t.id, task_id=t.id, detail=", ".join(changes))
            for uid in {u for u in (t.assignee_id, t.author_id) if u and u != user.id}:
                ws_events.append((uid, "task.updated", {"task_id": t.id, "changes": changes}))
                if any(c.startswith("статус") for c in changes) or "исполнитель" in changes:
                    ws_events.append((uid, "notification.new", {"task_id": t.id}))

    log_action(db, tenant_id=ctx.tenant.id, user_id=user.id, action="bulk_update", entity="task", detail=f"{len(tasks)} задач")
    db.commit()
    invalidate_analytics(ctx.tenant.id)

    for uid, ev, payload_ in ws_events:
        publish_to_user(ctx.tenant.id, uid, ev, payload_)

    return Message(message=f"Обновлено задач: {len(tasks)}")


@router.delete("/{task_id}", response_model=Message)
def delete_task(task_id: int, ctx: TenantContext = Depends(require("tasks.delete")), db: Session = Depends(get_db)):
    user = ctx.user
    task = db.get(Task, task_id)
    if not task or task.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Задача не найдена")
    log_action(db, tenant_id=ctx.tenant.id, user_id=user.id, action="delete", entity="task", entity_id=task.id, detail=task.title)
    db.delete(task)
    db.commit()
    invalidate_analytics(ctx.tenant.id)
    return Message(message="Задача удалена")


# --- Checklist ---

@router.post("/{task_id}/checklist", response_model=ChecklistItemOut, status_code=201)
def add_checklist(task_id: int, payload: ChecklistItemCreate, ctx: TenantContext = Depends(require("tasks.update")), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task or task.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Задача не найдена")
    item = ChecklistItem(task_id=task.id, text=payload.text, done=payload.done)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{task_id}/checklist/{item_id}", response_model=ChecklistItemOut)
def update_checklist(task_id: int, item_id: int, payload: ChecklistItemCreate, ctx: TenantContext = Depends(require("tasks.update")), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task or task.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Задача не найдена")
    item = db.get(ChecklistItem, item_id)
    if not item or item.task_id != task_id:
        raise HTTPException(404, "Пункт не найден")
    item.text = payload.text
    item.done = payload.done
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{task_id}/checklist/{item_id}", response_model=Message)
def delete_checklist(task_id: int, item_id: int, ctx: TenantContext = Depends(require("tasks.update")), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task or task.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Задача не найдена")
    item = db.get(ChecklistItem, item_id)
    if not item or item.task_id != task_id:
        raise HTTPException(404, "Пункт не найден")
    db.delete(item)
    db.commit()
    return Message(message="Пункт удалён")


# ---------------------------------------------------------------------------
# Planfix-роли: исполнители / аудиторы / участники (bulk replace)
# ---------------------------------------------------------------------------

def _get_task_or_404(db: Session, tenant_id: int, task_id: int) -> Task:
    task = db.get(Task, task_id)
    if not task or task.tenant_id != tenant_id:
        raise HTTPException(404, "Задача не найдена")
    return task


def _load_users_or_400(db: Session, tenant_id: int, user_ids: list[int]) -> list[User]:
    if not user_ids:
        return []
    for uid in user_ids:
        _assert_user_in_tenant(db, tenant_id, uid, f"Пользователь #{uid} не в компании")
    return db.query(User).filter(User.id.in_(user_ids)).all()


def _replace_role(
    role: str,
    task_id: int,
    payload: TaskUserRefs,
    ctx: TenantContext,
    db: Session,
) -> Task:
    """role ∈ {'assignees','auditors','participants'}"""
    user = ctx.user
    if not user_has(user, ["tasks.assign"], tenant_id=ctx.tenant.id):
        raise HTTPException(403, "Нет права управлять ролями задачи")
    task = _get_task_or_404(db, ctx.tenant.id, task_id)
    users = _load_users_or_400(db, ctx.tenant.id, payload.user_ids)

    before = {u.id for u in getattr(task, role)}
    setattr(task, role, users)
    after = {u.id for u in users}

    if role == "assignees":
        # primary assignee остаётся среди assignees; если primary был удалён —
        # выберем нового primary (первый из списка) или очистим.
        if task.assignee_id and task.assignee_id not in after:
            task.assignee_id = users[0].id if users else None
        elif not task.assignee_id and users:
            task.assignee_id = users[0].id

    added = after - before
    removed = before - after
    if added or removed:
        detail_parts = []
        if added:
            detail_parts.append(f"+{len(added)}")
        if removed:
            detail_parts.append(f"-{len(removed)}")
        log_action(
            db, tenant_id=ctx.tenant.id, user_id=user.id,
            action="update", entity="task", entity_id=task.id, task_id=task.id,
            detail=f"{role}: {', '.join(detail_parts)}",
        )
        # уведомляем добавленных
        for uid in added:
            if uid == user.id:
                continue
            _notify(
                db, ctx.tenant.id, uid,
                kind=role,
                title=(
                    "Вам назначена задача" if role == "assignees" else
                    "Вы добавлены наблюдателем" if role == "auditors" else
                    "Вы добавлены участником"
                ),
                body=task.title,
                task_id=task.id,
            )
    db.commit()
    db.refresh(task)
    if added or removed:
        for uid in added | removed:
            if uid != user.id:
                publish_to_user(ctx.tenant.id, uid, "task.updated", {"task_id": task.id, "changes": [role]})
    return task


@router.put("/{task_id}/assignees", response_model=TaskOut)
def set_assignees(task_id: int, payload: TaskUserRefs, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    return _replace_role("assignees", task_id, payload, ctx, db)


@router.put("/{task_id}/auditors", response_model=TaskOut)
def set_auditors(task_id: int, payload: TaskUserRefs, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    return _replace_role("auditors", task_id, payload, ctx, db)


@router.put("/{task_id}/participants", response_model=TaskOut)
def set_participants(task_id: int, payload: TaskUserRefs, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    return _replace_role("participants", task_id, payload, ctx, db)


# ---------------------------------------------------------------------------
# Напоминания
# ---------------------------------------------------------------------------

@router.get("/{task_id}/reminders", response_model=list[TaskReminderOut])
def list_reminders(task_id: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    task = _get_task_or_404(db, ctx.tenant.id, task_id)
    if not _user_can_view_task(ctx.user, task):
        raise HTTPException(403, "Нет доступа")
    return task.reminders


@router.post("/{task_id}/reminders", response_model=TaskReminderOut, status_code=201)
def add_reminder(
    task_id: int,
    payload: TaskReminderCreate,
    ctx: TenantContext = Depends(require("tasks.update")),
    db: Session = Depends(get_db),
):
    if payload.kind not in ("before_deadline", "before_start"):
        raise HTTPException(400, "kind должен быть before_deadline или before_start")
    if payload.offset_minutes < 0 or payload.offset_minutes > 60 * 24 * 365:
        raise HTTPException(400, "offset_minutes должен быть 0..525600 (год)")
    task = _get_task_or_404(db, ctx.tenant.id, task_id)
    # Уникальность (task_id, kind, offset_minutes) обеспечивает индекс — обрабатываем IntegrityError.
    existing = next(
        (r for r in task.reminders if r.kind == payload.kind and r.offset_minutes == payload.offset_minutes),
        None,
    )
    if existing:
        return existing
    r = TaskReminder(task_id=task.id, kind=payload.kind, offset_minutes=payload.offset_minutes)
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@router.delete("/{task_id}/reminders/{reminder_id}", response_model=Message)
def delete_reminder(
    task_id: int,
    reminder_id: int,
    ctx: TenantContext = Depends(require("tasks.update")),
    db: Session = Depends(get_db),
):
    task = _get_task_or_404(db, ctx.tenant.id, task_id)
    r = db.get(TaskReminder, reminder_id)
    if not r or r.task_id != task.id:
        raise HTTPException(404, "Напоминание не найдено")
    db.delete(r)
    db.commit()
    return Message(message="Напоминание удалено")
