"""Пользовательские поля для tasks/projects/contacts/companies/deals.

Значения хранятся в JSONB-колонке custom_data на самой сущности.
Здесь — только schema (определения полей) + upsert values через generic endpoint.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, Any
from datetime import datetime
import re
from pydantic import BaseModel, ConfigDict, field_validator

from ..database import get_db
from ..models import CustomFieldDef, CUSTOM_FIELD_ENTITY_TYPES, CUSTOM_FIELD_TYPES
from ..models import Task, Project, Contact, Company, Deal
from ..schemas.common import Message
from .deps import TenantContext, get_current_context, log_action


router = APIRouter(prefix="/api/custom-fields", tags=["custom-fields"])

CODE_RE = re.compile(r"^[a-z][a-z0-9_]{1,49}$")

ENTITY_MODELS = {
    "task": Task,
    "project": Project,
    "contact": Contact,
    "company": Company,
    "deal": Deal,
}


class FieldOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    entity_type: str
    code: str
    label: str
    field_type: str
    options: Optional[list[str]] = None
    required: bool
    order_index: int


class FieldCreate(BaseModel):
    entity_type: str
    code: str
    label: str
    field_type: str
    options: Optional[list[str]] = None
    required: bool = False
    order_index: int = 0

    @field_validator("entity_type")
    @classmethod
    def _et(cls, v: str) -> str:
        if v not in CUSTOM_FIELD_ENTITY_TYPES:
            raise ValueError(f"entity_type must be one of {CUSTOM_FIELD_ENTITY_TYPES}")
        return v

    @field_validator("field_type")
    @classmethod
    def _ft(cls, v: str) -> str:
        if v not in CUSTOM_FIELD_TYPES:
            raise ValueError(f"field_type must be one of {CUSTOM_FIELD_TYPES}")
        return v

    @field_validator("code")
    @classmethod
    def _code(cls, v: str) -> str:
        if not CODE_RE.match(v):
            raise ValueError("code must be snake_case")
        return v


class FieldUpdate(BaseModel):
    label: Optional[str] = None
    options: Optional[list[str]] = None
    required: Optional[bool] = None
    order_index: Optional[int] = None


class ValuesPatch(BaseModel):
    custom_data: dict[str, Any]


@router.get("", response_model=list[FieldOut])
def list_fields(
    entity_type: Optional[str] = None,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    q = db.query(CustomFieldDef).filter(CustomFieldDef.tenant_id == ctx.tenant.id)
    if entity_type:
        q = q.filter(CustomFieldDef.entity_type == entity_type)
    return q.order_by(CustomFieldDef.entity_type, CustomFieldDef.order_index).all()


@router.post("", response_model=FieldOut, status_code=201)
def create_field(payload: FieldCreate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    exists = (
        db.query(CustomFieldDef)
        .filter(CustomFieldDef.tenant_id == ctx.tenant.id, CustomFieldDef.entity_type == payload.entity_type, CustomFieldDef.code == payload.code)
        .first()
    )
    if exists:
        raise HTTPException(409, f"Поле {payload.entity_type}.{payload.code} уже существует")
    row = CustomFieldDef(tenant_id=ctx.tenant.id, **payload.model_dump())
    db.add(row)
    db.flush()
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="create", entity="custom_field", entity_id=row.id, detail=f"{payload.entity_type}.{payload.code}")
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{fid}", response_model=FieldOut)
def update_field(fid: int, payload: FieldUpdate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(CustomFieldDef, fid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Поле не найдено")
    for f in ("label", "options", "required", "order_index"):
        v = getattr(payload, f)
        if v is not None:
            setattr(row, f, v)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{fid}", response_model=Message)
def delete_field(fid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(CustomFieldDef, fid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Поле не найдено")
    db.delete(row)
    db.commit()
    return Message(message="Поле удалено")


@router.patch("/values/{entity_type}/{entity_id}", response_model=Message)
def update_values(
    entity_type: str,
    entity_id: int,
    payload: ValuesPatch,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    Model = ENTITY_MODELS.get(entity_type)
    if not Model:
        raise HTTPException(400, f"Unknown entity_type: {entity_type}")
    row = db.get(Model, entity_id)
    if not row or getattr(row, "tenant_id", None) != ctx.tenant.id:
        raise HTTPException(404, f"{entity_type}#{entity_id} not found")

    # Мержим custom_data — не затираем целиком.
    current = dict(row.custom_data or {})
    current.update(payload.custom_data or {})

    # Отсекаем ключи, для которых нет определений
    defs = {
        d.code
        for d in db.query(CustomFieldDef).filter(
            CustomFieldDef.tenant_id == ctx.tenant.id,
            CustomFieldDef.entity_type == entity_type,
        ).all()
    }
    filtered = {k: v for k, v in current.items() if k in defs}
    row.custom_data = filtered
    db.commit()
    return Message(message="Значения сохранены")
