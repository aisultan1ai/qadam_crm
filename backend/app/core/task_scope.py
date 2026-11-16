"""Кто какие задачи видит — одно правило для списка, карточки, поиска, календаря, главной и ленты.

Уровни (берётся самый широкий из прав роли в текущей компании):
  all         — tasks.view_all (и владелец компании): все задачи компании;
  department  — tasks.view_department: свои + задачи, где исполнитель/автор из моего отдела;
  own         — tasks.view_own: где я исполнитель, автор, соисполнитель, наблюдатель или участник;
  none        — ничего.
Отделы — свои в каждой компании; человек может быть в нескольких (DepartmentMember).
"""
from __future__ import annotations

from typing import Literal, Optional

from sqlalchemy import false, or_, select
from sqlalchemy.orm import Session, object_session

from ..models import Task, TenantMembership, User
from ..models.task import task_assignees, task_auditors, task_participants
from .permissions import user_has

Scope = Literal["all", "department", "own", "none"]


def member_department_id(db: Session, tenant_id: int, user_id: int) -> Optional[int]:
    return db.query(TenantMembership.department_id).filter(
        TenantMembership.tenant_id == tenant_id, TenantMembership.user_id == user_id,
    ).scalar()


def _is_owner(db: Session, tenant_id: int, user_id: int) -> bool:
    return bool(db.query(TenantMembership.is_owner).filter(
        TenantMembership.tenant_id == tenant_id, TenantMembership.user_id == user_id,
    ).scalar())


def task_scope(db: Session, user: User, tenant_id: int) -> Scope:
    if user_has(user, ["tasks.view_all"], tenant_id=tenant_id) or _is_owner(db, tenant_id, user.id):
        return "all"
    if user_has(user, ["tasks.view_department"], tenant_id=tenant_id):
        return "department"
    if user_has(user, ["tasks.view_own"], tenant_id=tenant_id):
        return "own"
    return "none"


def can_list_tasks(db: Session, user: User, tenant_id: int) -> bool:
    return task_scope(db, user, tenant_id) != "none"


def _own_clause(uid: int):
    return or_(
        Task.assignee_id == uid,
        Task.author_id == uid,
        Task.id.in_(select(task_assignees.c.task_id).where(task_assignees.c.user_id == uid)),
        Task.id.in_(select(task_auditors.c.task_id).where(task_auditors.c.user_id == uid)),
        Task.id.in_(select(task_participants.c.task_id).where(task_participants.c.user_id == uid)),
    )


def visible_tasks_clause(db: Session, user: User, tenant_id: int):
    """SQL-условие на Task для текущего пользователя; None — без ограничений (видит все задачи компании)."""
    scope = task_scope(db, user, tenant_id)
    if scope == "all":
        return None
    if scope == "none":
        return false()
    own = _own_clause(user.id)
    if scope == "own":
        return own
    from .departments import member_department_ids, users_in_departments
    dep_ids = member_department_ids(db, tenant_id, user.id)
    if not dep_ids:
        # Не прикреплён к отделу — видит только своё (а не «отдел без отдела» = всех без отдела).
        return own
    dept_users = users_in_departments(tenant_id, dep_ids)
    return or_(
        own,
        Task.assignee_id.in_(dept_users),
        Task.author_id.in_(dept_users),
        Task.id.in_(select(task_assignees.c.task_id).where(task_assignees.c.user_id.in_(dept_users))),
    )


def apply_task_scope(query, db: Session, user: User, tenant_id: int):
    clause = visible_tasks_clause(db, user, tenant_id)
    return query if clause is None else query.filter(clause)


def can_view_task(user: User, task: Task, db: Optional[Session] = None) -> bool:
    db = db or object_session(task)
    clause = visible_tasks_clause(db, user, task.tenant_id)
    if clause is None:
        return True
    return db.query(Task.id).filter(Task.id == task.id, clause).first() is not None


def require_visible_task(db: Session, user: User, tenant_id: int, task_id: int) -> Task:
    """Задача этой компании, которую пользователь видит. Иначе 404 (не раскрываем, что она существует).
    Нужна везде, где к задаче обращаются по номеру: комментарии, файлы, чек-лист, роли, напоминания."""
    from fastapi import HTTPException
    task = db.get(Task, task_id)
    if not task or task.tenant_id != tenant_id or not can_view_task(user, task, db):
        raise HTTPException(404, "Задача не найдена")
    return task
