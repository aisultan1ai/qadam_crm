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


def _my_mailbox_ids(db: Session, ctx: TenantContext) -> set[int]:
    from ..models import Mailbox
    return {m for (m,) in db.query(Mailbox.id).filter(Mailbox.tenant_id == ctx.tenant.id, Mailbox.user_id == ctx.user.id)}


def _own_rule(db: Session, ctx: TenantContext, rid: int) -> MailRule:
    row = db.get(MailRule, rid)
    if not row or row.tenant_id != ctx.tenant.id or row.mailbox_id not in _my_mailbox_ids(db, ctx):
        raise HTTPException(404, "Правило не найдено")
    return row


def _clean_rule(conditions: Optional[list[dict[str, Any]]], actions: Optional[list[dict[str, Any]]]):
    """Оставляем только то, что движок умеет применять (services/mail/rules.py)."""
    from ..services.mail.rules import ACTIONS, FIELDS, OPS
    if conditions is not None:
        conditions = [
            {"field": c.get("field"), "op": c.get("op") or "contains", "value": str(c.get("value") or "").strip()[:500]}
            for c in conditions
            if isinstance(c, dict) and c.get("field") in FIELDS and (c.get("op") or "contains") in OPS and str(c.get("value") or "").strip()
        ]
        if not conditions:
            raise HTTPException(400, "Добавьте хотя бы одно условие")
    if actions is not None:
        cleaned = []
        for a in actions:
            if not isinstance(a, dict) or a.get("type") not in ACTIONS:
                continue
            params = a.get("params") if isinstance(a.get("params"), dict) else {}
            if a["type"] == "create_task":
                params = {k: params[k] for k in ("project_id", "assignee_id") if isinstance(params.get(k), int)}
            else:
                params = {}
            cleaned.append({"type": a["type"], "params": params})
        if not cleaned:
            raise HTTPException(400, "Добавьте хотя бы одно действие")
        actions = cleaned
    return conditions, actions


def _template_editor(ctx: TenantContext, row) -> None:
    from ..core.permissions import user_has
    if row.created_by == ctx.user.id or ctx.membership.is_owner:
        return
    if not user_has(ctx.user, ["settings.dictionaries"], tenant_id=ctx.tenant.id):
        raise HTTPException(403, "Шаблон меняет автор или администратор")


@router.get("/rules", response_model=list[RuleOut])
def list_rules(mailbox_id: Optional[int] = None, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    q = db.query(MailRule).filter(MailRule.tenant_id == ctx.tenant.id, MailRule.mailbox_id.in_(_my_mailbox_ids(db, ctx)))
    if mailbox_id is not None:
        q = q.filter(MailRule.mailbox_id == mailbox_id)
    return q.order_by(MailRule.mailbox_id, MailRule.order_index).all()


@router.post("/rules", response_model=RuleOut, status_code=201)
def create_rule(payload: RuleCreate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    if payload.mailbox_id not in _my_mailbox_ids(db, ctx):
        raise HTTPException(400, "Правила настраиваются только для своего почтового ящика")
    data = payload.model_dump()
    data["conditions"], data["actions"] = _clean_rule(payload.conditions, payload.actions)
    row = MailRule(tenant_id=ctx.tenant.id, **data)
    db.add(row)
    db.flush()
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="create", entity="mail_rule", entity_id=row.id, detail=payload.name)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/rules/{rid}", response_model=RuleOut)
def update_rule(rid: int, payload: RuleUpdate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = _own_rule(db, ctx, rid)
    payload.conditions, payload.actions = _clean_rule(payload.conditions, payload.actions)
    for f in ("name", "is_active", "order_index", "stop_on_match", "conditions", "actions"):
        v = getattr(payload, f)
        if v is not None:
            setattr(row, f, v)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/rules/{rid}", response_model=Message)
def delete_rule(rid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = _own_rule(db, ctx, rid)
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
    created_by: Optional[int] = None
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
    _template_editor(ctx, row)
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
    _template_editor(ctx, row)
    db.delete(row)
    db.commit()
    return Message(message="Удалено")
