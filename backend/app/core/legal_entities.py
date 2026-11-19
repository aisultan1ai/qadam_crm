"""Юрлица: юрлицо по умолчанию и проверка ссылок на юрлицо из запросов."""
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models import LegalEntity, Tenant


def get_default_legal_entity(db: Session, tenant_id: int, *, create: bool = True) -> Optional[LegalEntity]:
    """Юрлицо по умолчанию; если его почему-то нет — назначает первое активное или создаёт новое."""
    row = (
        db.query(LegalEntity)
        .filter(LegalEntity.tenant_id == tenant_id, LegalEntity.is_default.is_(True))
        .order_by(LegalEntity.id)
        .first()
    )
    if row or not create:
        return row
    row = (
        db.query(LegalEntity)
        .filter(LegalEntity.tenant_id == tenant_id, LegalEntity.is_active.is_(True))
        .order_by(LegalEntity.id)
        .first()
    )
    if row:
        row.is_default = True
        db.flush()
        return row
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        return None
    return ensure_default_legal_entity(db, tenant)


def ensure_default_legal_entity(db: Session, tenant: Tenant) -> LegalEntity:
    """Создаёт юрлицо по умолчанию с названием компании, если у неё ещё нет ни одного. Не коммитит."""
    existing = (
        db.query(LegalEntity)
        .filter(LegalEntity.tenant_id == tenant.id, LegalEntity.is_default.is_(True))
        .first()
    )
    if existing:
        return existing
    name = (getattr(tenant, "company_display_name", None) or tenant.name or "").strip() or "Основное юрлицо"
    row = LegalEntity(
        tenant_id=tenant.id,
        full_name=name[:300],
        short_name=name[:200],
        currency="KZT",
        is_default=True,
        is_active=True,
    )
    db.add(row)
    db.flush()
    return row


def resolve_legal_entity_id(
    db: Session,
    tenant_id: int,
    legal_entity_id: Optional[int],
    *,
    current_id: Optional[int] = None,
) -> Optional[int]:
    """Пусто → юрлицо по умолчанию. Иначе — юрлицо этой компании; неактивное допускается только если уже выбрано."""
    if not legal_entity_id:
        default = get_default_legal_entity(db, tenant_id)
        return default.id if default else None
    row = db.get(LegalEntity, legal_entity_id)
    if not row or row.tenant_id != tenant_id:
        raise HTTPException(400, "Юрлицо не найдено в этой компании")
    if not row.is_active and row.id != current_id:
        raise HTTPException(400, "Это юрлицо отключено — выберите другое")
    return row.id
