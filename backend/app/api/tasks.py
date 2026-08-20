from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, noload
from sqlalchemy import or_, and_
from typing import Optional
from datetime import datetime, timezone

from ..database import get_db
from ..models import Task, User, ChecklistItem, Notification, Project, TenantMembership
from ..models.task import TaskStatus, TaskPriority
from ..core.permissions import user_has
from ..core.ws_hub import publish_to_user
from ..core.cache import invalidate_analytics
from ..schemas.task import (
    TaskOut, TaskListItem, TaskCreate, TaskUpdate, TaskBulkUpdate,
    ChecklistItemCreate, ChecklistItemOut,
)
from ..schemas.common import Message, Page, PageParams, page_params, paginate
from .deps import TenantContext, require, get_current_context, log_action

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _user_can_view_task(user: User, task: Task) -> bool:
    if user_has(user, ["tasks.view_all"]):
        return True
    if user_has(user, ["tasks.view_own"]):
        return task.assignee_id == user.id or task.author_id == user.id
    return False


def _apply_view_scope(query, user: User):
    if user_has(user, ["tasks.view_all"]):
        return query
    if user_has(user, ["tasks.view_own"]):
        return query.filter(or_(Task.assignee_id == user.id, Task.author_id == user.id))
    return query.filter(Task.id == -1)


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
    pagination: PageParams = Depends(page_params),
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    user = ctx.user
    if not user_has(user, ["tasks.view_all", "tasks.view_own"]):
        raise HTTPException(403, "Нет доступа к задачам")
    query = db.query(Task).filter(Task.tenant_id == ctx.tenant.id).options(
        noload(Task.checklist),
        noload(Task.comments),
        noload(Task.attachments),
        noload(Task.activities),
    )
    query = _apply_view_scope(query, user)
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
    if payload.assignee_id and not user_has(user, ["tasks.assign"]) and payload.assignee_id != user.id:
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
        deadline=payload.deadline,
        author_id=user.id,
    )
    for item in payload.checklist:
        task.checklist.append(ChecklistItem(text=item.text, done=item.done))
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
    return task


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, payload: TaskUpdate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    user = ctx.user
    task = db.get(Task, task_id)
    if not task or task.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Задача не найдена")
    if not user_has(user, ["tasks.update"]):
        raise HTTPException(403, "Нет права редактировать")

    changes: list[str] = []

    if payload.title is not None and payload.title != task.title:
        task.title = payload.title
        changes.append("название")
    if payload.description is not None and (payload.description or "") != (task.description or ""):
        task.description = payload.description
        changes.append("описание")
    if payload.status is not None and payload.status != task.status:
        if not user_has(user, ["tasks.change_status"]):
            raise HTTPException(403, "Нет права менять статус")
        old = task.status.value
        task.status = payload.status
        changes.append(f"статус {old} → {payload.status.value}")
        if task.assignee_id and task.assignee_id != user.id:
            _notify(db, ctx.tenant.id, task.assignee_id, "status", f"Статус изменён: {task.title}", f"{old} → {payload.status.value}", task.id)
    if payload.priority is not None and payload.priority != task.priority:
        if not user_has(user, ["tasks.change_priority"]):
            raise HTTPException(403, "Нет права менять приоритет")
        old = task.priority.value
        task.priority = payload.priority
        changes.append(f"приоритет {old} → {payload.priority.value}")
    if payload.project_id is not None:
        _assert_project_in_tenant(db, ctx.tenant.id, payload.project_id)
        task.project_id = payload.project_id
    if payload.assignee_id is not None and payload.assignee_id != task.assignee_id:
        if not user_has(user, ["tasks.assign"]):
            raise HTTPException(403, "Нет права назначать исполнителей")
        if payload.assignee_id:
            _assert_user_in_tenant(db, ctx.tenant.id, payload.assignee_id, "Исполнитель не является членом компании")
        task.assignee_id = payload.assignee_id
        changes.append("исполнитель")
        if task.assignee_id and task.assignee_id != user.id:
            _notify(db, ctx.tenant.id, task.assignee_id, "assigned", "Вам назначена задача", task.title, task.id)
    if payload.deadline is not None:
        task.deadline = payload.deadline
    if payload.order_index is not None:
        task.order_index = payload.order_index

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
