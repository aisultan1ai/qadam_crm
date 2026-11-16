"""Отделы сотрудника в компании.

Человек может состоять в нескольких отделах (DepartmentMember). Основной отдел —
TenantMembership.department_id: по нему строится оргструктура и подписи. Эти функции
держат основной отдел согласованным со списком: он всегда один из отделов человека (или пусто).
"""
from __future__ import annotations

from typing import Iterable, Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Department, DepartmentMember, TenantMembership


def member_department_ids(db: Session, tenant_id: int, user_id: int) -> list[int]:
    return [d for (d,) in db.query(DepartmentMember.department_id).filter(
        DepartmentMember.tenant_id == tenant_id, DepartmentMember.user_id == user_id,
    ).order_by(DepartmentMember.department_id)]


def users_in_departments(tenant_id: int, department_ids: Iterable[int]):
    """Подзапрос user_id сотрудников, состоящих хотя бы в одном из отделов."""
    return select(DepartmentMember.user_id).where(
        DepartmentMember.tenant_id == tenant_id, DepartmentMember.department_id.in_(list(department_ids)),
    )


def _check_department(db: Session, tenant_id: int, department_id: int) -> Department:
    dep = db.get(Department, department_id)
    if not dep or dep.tenant_id != tenant_id:
        raise HTTPException(400, "Отдел не найден в этой компании")
    return dep


def sync_primary(db: Session, tenant_id: int, user_ids: Iterable[int]) -> None:
    """Основной отдел — один из отделов человека; если его убрали — берём другой (или пусто)."""
    ids = list(set(user_ids))
    if not ids:
        return
    db.flush()
    deps: dict[int, list[int]] = {}
    for uid, did in db.query(DepartmentMember.user_id, DepartmentMember.department_id).filter(
        DepartmentMember.tenant_id == tenant_id, DepartmentMember.user_id.in_(ids),
    ).order_by(DepartmentMember.id):
        deps.setdefault(uid, []).append(did)
    for m in db.query(TenantMembership).filter(
        TenantMembership.tenant_id == tenant_id, TenantMembership.user_id.in_(ids),
    ):
        mine = deps.get(m.user_id, [])
        if m.department_id not in mine:
            m.department_id = mine[0] if mine else None


def add_to_department(db: Session, tenant_id: int, user_id: int, department_id: Optional[int]) -> None:
    """Добавить в отдел (без дублей). Если основного отдела нет — этот станет основным."""
    if not department_id:
        return
    _check_department(db, tenant_id, department_id)
    exists = db.query(DepartmentMember.id).filter(
        DepartmentMember.department_id == department_id, DepartmentMember.user_id == user_id,
    ).first()
    if not exists:
        db.add(DepartmentMember(tenant_id=tenant_id, department_id=department_id, user_id=user_id))
    sync_primary(db, tenant_id, [user_id])


def set_primary_department(db: Session, tenant_id: int, user_id: int, department_id: Optional[int]) -> None:
    """Основной отдел из карточки сотрудника: он же добавляется в список отделов.
    Пусто — убираем человека из прежнего основного отдела."""
    m = db.query(TenantMembership).filter(
        TenantMembership.tenant_id == tenant_id, TenantMembership.user_id == user_id,
    ).first()
    if not m:
        return
    if department_id:
        add_to_department(db, tenant_id, user_id, department_id)
        m.department_id = department_id
    else:
        if m.department_id:
            db.query(DepartmentMember).filter(
                DepartmentMember.department_id == m.department_id, DepartmentMember.user_id == user_id,
            ).delete(synchronize_session=False)
        sync_primary(db, tenant_id, [user_id])


def set_department_members(db: Session, tenant_id: int, department_id: int, user_ids: Iterable[int]) -> None:
    """Состав отдела целиком (из раздела «Отделы»). Только сотрудники этой компании."""
    _check_department(db, tenant_id, department_id)
    wanted = set(user_ids)
    if wanted:
        members = {uid for (uid,) in db.query(TenantMembership.user_id).filter(
            TenantMembership.tenant_id == tenant_id, TenantMembership.user_id.in_(wanted),
        )}
        if members != wanted:
            raise HTTPException(400, "Некоторые сотрудники не состоят в этой компании")
    current = {uid for (uid,) in db.query(DepartmentMember.user_id).filter(DepartmentMember.department_id == department_id)}
    removed = current - wanted
    if removed:
        db.query(DepartmentMember).filter(
            DepartmentMember.department_id == department_id, DepartmentMember.user_id.in_(removed),
        ).delete(synchronize_session=False)
    for uid in wanted - current:
        db.add(DepartmentMember(tenant_id=tenant_id, department_id=department_id, user_id=uid))
    sync_primary(db, tenant_id, current | wanted)


def remove_member_everywhere(db: Session, tenant_id: int, user_id: int) -> None:
    """Человека убрали из компании — убираем и из её отделов."""
    db.query(DepartmentMember).filter(
        DepartmentMember.tenant_id == tenant_id, DepartmentMember.user_id == user_id,
    ).delete(synchronize_session=False)
