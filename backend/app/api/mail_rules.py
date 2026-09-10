"""Правила обработки почты + шаблоны писем."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, Any
from datetime import datetime
from pydantic import BaseModel, ConfigDict

from ..database import get_db
from ..models import MailRule, MailTemplate
from ..schemas.common import Message
from .deps import TenantContext, get_current_context, log_action


router = APIRouter(prefix="/api/mail", tags=["mail-rules"])


# --- Rules ---

class RuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    mailbox_id: int
    name: str
    is_active: bool
    order_index: int
    stop_on_match: bool
    conditions: list[dict[str, Any]] = []
    actions: list[dict[str, Any]] = []
    created_at: datetime


class RuleCreate(BaseModel):
    mailbox_id: int
    name: str
    is_active: bool = True
    order_index: int = 0
    stop_on_match: bool = False
    conditions: list[dict[str, Any]] = []
    actions: list[dict[str, Any]] = []


class RuleUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    order_index: Optional[int] = None
    stop_on_match: Optional[bool] = None
    conditions: Optional[list[dict[str, Any]]] = None
    actions: Optional[list[dict[str, Any]]] = None


@router.get("/rules", response_model=list[RuleOut])
def list_rules(mailbox_id: Optional[int] = None, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    q = db.query(MailRule).filter(MailRule.tenant_id == ctx.tenant.id)
    if mailbox_id is not None:
        q = q.filter(MailRule.mailbox_id == mailbox_id)
    return q.order_by(MailRule.mailbox_id, MailRule.order_index).all()


@router.post("/rules", response_model=RuleOut, status_code=201)
def create_rule(payload: RuleCreate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = MailRule(tenant_id=ctx.tenant.id, **payload.model_dump())
    db.add(row)
    db.flush()
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="create", entity="mail_rule", entity_id=row.id, detail=payload.name)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/rules/{rid}", response_model=RuleOut)
def update_rule(rid: int, payload: RuleUpdate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(MailRule, rid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Правило не найдено")
    for f in ("name", "is_active", "order_index", "stop_on_match", "conditions", "actions"):
        v = getattr(payload, f)
        if v is not None:
            setattr(row, f, v)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/rules/{rid}", response_model=Message)
def delete_rule(rid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(MailRule, rid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Правило не найдено")
    db.delete(row)
    db.commit()
    return Message(message="Удалено")


# --- Templates ---

class TemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    subject: str
    body: str
    variables: Optional[list[str]] = None
    created_at: datetime


class TemplateCreate(BaseModel):
    name: str
    subject: str
    body: str = ""
    variables: Optional[list[str]] = None


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    subject: Optional[str] = None
    body: Optional[str] = None
    variables: Optional[list[str]] = None


@router.get("/templates", response_model=list[TemplateOut])
def list_templates(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    return db.query(MailTemplate).filter(MailTemplate.tenant_id == ctx.tenant.id).order_by(MailTemplate.name).all()


@router.post("/templates", response_model=TemplateOut, status_code=201)
def create_template(payload: TemplateCreate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = MailTemplate(tenant_id=ctx.tenant.id, created_by=ctx.user.id, **payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/templates/{tid}", response_model=TemplateOut)
def update_template(tid: int, payload: TemplateUpdate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(MailTemplate, tid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Шаблон не найден")
    for f in ("name", "subject", "body", "variables"):
        v = getattr(payload, f)
        if v is not None:
            setattr(row, f, v)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/templates/{tid}", response_model=Message)
def delete_template(tid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(MailTemplate, tid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Шаблон не найден")
    db.delete(row)
    db.commit()
    return Message(message="Удалено")
