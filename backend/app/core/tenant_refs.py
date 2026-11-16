"""Проверка ссылок из запроса: связанный объект и человек — из ЭТОЙ компании.

Без неё по номеру можно привязать, например, сделку к контакту другой компании
и увидеть его данные. Используется везде, где ID приходит от клиента.
"""
from __future__ import annotations

from typing import Optional, Type

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models import TenantMembership


def ensure_member(db: Session, tenant_id: int, user_id: Optional[int], what: str = "Сотрудник") -> None:
    if not user_id:
        return
    ok = db.query(TenantMembership.id).filter(
        TenantMembership.tenant_id == tenant_id, TenantMembership.user_id == user_id,
    ).first()
    if not ok:
        raise HTTPException(400, f"{what} не состоит в этой компании")


def ensure_owned(db: Session, model: Type, obj_id: Optional[int], tenant_id: int, what: str) -> None:
    """obj_id пустой (0/None) — значит «без связи», это допустимо."""
    if not obj_id:
        return
    row = db.get(model, obj_id)
    if not row or getattr(row, "tenant_id", None) != tenant_id:
        raise HTTPException(400, f"{what} не найден(а) в этой компании")
