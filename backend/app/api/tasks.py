from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from typing import List, Optional
from datetime import datetime

from ..database import get_db
from ..models import Task, User, ChecklistItem, Notification
from ..models.task import TaskStatus, TaskPriority
from ..core.permissions import user_has
from ..core.ws_hub import publish_to_user
from ..schemas.task import (
    TaskOut, TaskListItem, TaskCreate, TaskUpdate, TaskBulkUpdate,
    ChecklistItemCreate, ChecklistItemOut,
)
from ..schemas.common import Message, Page, PageParams, page_params, paginate
from .deps import require, get_current_user, log_action

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _apply_view_scope(query, user: User):
    if user_has(user, ["tasks.view_all"]):
        return query
    if user_has(user, ["tasks.view_own"]):
        return query.filter(or_(Task.assignee_id == user.id, Task.author_id == user.id))
    return query.filter(Task.id == -1)


def _notify(db: Session, user_id: int, kind: str, title: str, body: str | None = None, task_id: int | None = None):
    if not user_id:
        return
    db.add(Notification(user_id=user_id, kind=kind, title=title, body=body, task_id=task_id))


@router.get("", response_model=Page[TaskListItem])
def list_tasks(
    q: Optional[str] = None,
    project_id: Optional[int] = None,
    assignee_id: Optional[int] = None,
    status: Optional[TaskStatus] = None,
    priority: Optional[TaskPriority] = None,
    overdue: Optional[bool] = None,
    pagination: PageParams = Depends(page_params),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not user_has(user, ["tasks.view_all", "tasks.view_own"]):
        raise HTTPException(403, "Нет доступа к задачам")
    query = db.query(Task)
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
        query = query.filter(and_(Task.deadline.is_not(None), Task.deadline < datetime.utcnow(), Task.status.notin_([TaskStatus.done, TaskStatus.cancelled])))
    query = query.order_by(Task.order_index.asc(), Task.created_at.desc())
    return paginate(query, pagination)


@router.get("/{task_id}", response_model=TaskOut)
def get_task(task_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Задача не найдена")
    if not user_has(user, ["tasks.view_all"]) and not (user_has(user, ["tasks.view_own"]) and (task.assignee_id == user.id or task.author_id == user.id)):
        raise HTTPException(403, "Нет доступа")
    return task


@router.post("", response_model=TaskOut, status_code=201)
def create_task(payload: TaskCreate, user: User = Depends(require("tasks.create")), db: Session = Depends(get_db)):
    if payload.assignee_id and not user_has(user, ["tasks.assign"]) and payload.assignee_id != user.id:
        raise HTTPException(403, "Нет права назначать исполнителей")
    task = Task(
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
    log_action(db, user_id=user.id, action="create", entity="task", entity_id=task.id, task_id=task.id, detail=task.title)
    if task.assignee_id and task.assignee_id != user.id:
        _notify(db, task.assignee_id, "assigned", "Новая задача", task.title, task.id)
    db.commit()
    db.refresh(task)
    if task.assignee_id and task.assignee_id != user.id:
        publish_to_user(task.assignee_id, "notification.new", {"task_id": task.id})
        publish_to_user(task.assignee_id, "task.assigned", {"task_id": task.id})
    return task


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, payload: TaskUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Задача не найдена")
    if not user_has(user, ["tasks.update"]):
        raise HTTPException(403, "Нет права редактировать")

    changes: list[str] = []

    if payload.title is not None and payload.title != task.title:
        task.title = payload.title
        changes.append("название")
    if payload.description is not None:
        task.description = payload.description
    if payload.status is not None and payload.status != task.status:
        if not user_has(user, ["tasks.change_status"]):
            raise HTTPException(403, "Нет права менять статус")
        old = task.status.value
        task.status = payload.status
        changes.append(f"статус {old} → {payload.status.value}")
        if task.assignee_id and task.assignee_id != user.id:
            _notify(db, task.assignee_id, "status", f"Статус изменён: {task.title}", f"{old} → {payload.status.value}", task.id)
    if payload.priority is not None and payload.priority != task.priority:
        if not user_has(user, ["tasks.change_priority"]):
            raise HTTPException(403, "Нет права менять приоритет")
        old = task.priority.value
        task.priority = payload.priority
        changes.append(f"приоритет {old} → {payload.priority.value}")
    if payload.project_id is not None:
        task.project_id = payload.project_id
    if payload.assignee_id is not None and payload.assignee_id != task.assignee_id:
        if not user_has(user, ["tasks.assign"]):
            raise HTTPException(403, "Нет права назначать исполнителей")
        task.assignee_id = payload.assignee_id
        changes.append("исполнитель")
        if task.assignee_id and task.assignee_id != user.id:
            _notify(db, task.assignee_id, "assigned", "Вам назначена задача", task.title, task.id)
    if payload.deadline is not None:
        task.deadline = payload.deadline
    if payload.order_index is not None:
        task.order_index = payload.order_index

    if changes:
        log_action(db, user_id=user.id, action="update", entity="task", entity_id=task.id, task_id=task.id, detail=", ".join(changes))
    db.commit()
    db.refresh(task)

    if changes:
        subscribers = {uid for uid in (task.assignee_id, task.author_id) if uid and uid != user.id}
        for uid in subscribers:
            publish_to_user(uid, "task.updated", {"task_id": task.id, "changes": changes})
            if any(c.startswith("статус") for c in changes) or any(c == "исполнитель" for c in changes):
                publish_to_user(uid, "notification.new", {"task_id": task.id})

    return task


@router.post("/bulk", response_model=Message)
def bulk_update(payload: TaskBulkUpdate, user: User = Depends(require("tasks.bulk_update")), db: Session = Depends(get_db)):
    tasks = db.query(Task).filter(Task.id.in_(payload.ids)).all()
    for t in tasks:
        p = payload.patch
        if p.status is not None:
            t.status = p.status
        if p.priority is not None:
            t.priority = p.priority
        if p.assignee_id is not None:
            t.assignee_id = p.assignee_id
        if p.project_id is not None:
            t.project_id = p.project_id
        if p.deadline is not None:
            t.deadline = p.deadline
    log_action(db, user_id=user.id, action="bulk_update", entity="task", detail=f"{len(tasks)} задач")
    db.commit()
    return Message(message=f"Обновлено задач: {len(tasks)}")


@router.delete("/{task_id}", response_model=Message)
def delete_task(task_id: int, user: User = Depends(require("tasks.delete")), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Задача не найдена")
    log_action(db, user_id=user.id, action="delete", entity="task", entity_id=task.id, detail=task.title)
    db.delete(task)
    db.commit()
    return Message(message="Задача удалена")


# --- Checklist ---

@router.post("/{task_id}/checklist", response_model=ChecklistItemOut, status_code=201)
def add_checklist(task_id: int, payload: ChecklistItemCreate, user: User = Depends(require("tasks.update")), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Задача не найдена")
    item = ChecklistItem(task_id=task.id, text=payload.text, done=payload.done)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{task_id}/checklist/{item_id}", response_model=ChecklistItemOut)
def update_checklist(task_id: int, item_id: int, payload: ChecklistItemCreate, user: User = Depends(require("tasks.update")), db: Session = Depends(get_db)):
    item = db.get(ChecklistItem, item_id)
    if not item or item.task_id != task_id:
        raise HTTPException(404, "Пункт не найден")
    item.text = payload.text
    item.done = payload.done
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{task_id}/checklist/{item_id}", response_model=Message)
def delete_checklist(task_id: int, item_id: int, user: User = Depends(require("tasks.update")), db: Session = Depends(get_db)):
    item = db.get(ChecklistItem, item_id)
    if not item or item.task_id != task_id:
        raise HTTPException(404, "Пункт не найден")
    db.delete(item)
    db.commit()
    return Message(message="Пункт удалён")
