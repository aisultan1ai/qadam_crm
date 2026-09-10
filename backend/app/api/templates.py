"""Шаблоны сущностей (task/project/contact/company/deal/document)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, Any
from datetime import datetime
from pydantic import BaseModel, ConfigDict, field_validator

from ..database import get_db
from ..models import EntityTemplate, TEMPLATE_ENTITY_TYPES
from ..schemas.common import Message
from .deps import TenantContext, get_current_context, log_action


router = APIRouter(prefix="/api/templates", tags=["templates"])


class TemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    entity_type: str
    name: str
    description: Optional[str] = None
    payload: dict[str, Any] = {}
    created_at: datetime


class TemplateCreate(BaseModel):
    entity_type: str
    name: str
    description: Optional[str] = None
    payload: dict[str, Any] = {}

    @field_validator("entity_type")
    @classmethod
    def _valid(cls, v: str) -> str:
        if v not in TEMPLATE_ENTITY_TYPES:
            raise ValueError(f"entity_type must be one of {TEMPLATE_ENTITY_TYPES}")
        return v


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    payload: Optional[dict[str, Any]] = None


@router.get("", response_model=list[TemplateOut])
def list_templates(
    entity_type: Optional[str] = None,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    q = db.query(EntityTemplate).filter(EntityTemplate.tenant_id == ctx.tenant.id)
    if entity_type:
        q = q.filter(EntityTemplate.entity_type == entity_type)
    return q.order_by(EntityTemplate.entity_type, EntityTemplate.name).all()


@router.post("", response_model=TemplateOut, status_code=201)
def create_template(
    payload: TemplateCreate,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    row = EntityTemplate(
        tenant_id=ctx.tenant.id,
        entity_type=payload.entity_type,
        name=payload.name,
        description=payload.description,
        payload=payload.payload,
        created_by=ctx.user.id,
    )
    db.add(row)
    db.flush()
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="create", entity="template", entity_id=row.id, detail=f"{payload.entity_type}:{payload.name}")
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{tid}", response_model=TemplateOut)
def update_template(tid: int, payload: TemplateUpdate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(EntityTemplate, tid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Шаблон не найден")
    for f in ("name", "description", "payload"):
        v = getattr(payload, f)
        if v is not None:
            setattr(row, f, v)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{tid}", response_model=Message)
def delete_template(tid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(EntityTemplate, tid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Шаблон не найден")
    db.delete(row)
    db.commit()
    return Message(message="Шаблон удалён")
