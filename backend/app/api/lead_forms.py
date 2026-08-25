"""Формы захвата лидов (per-tenant) + публичный приём заявок + CRUD лидов.

Флоу:
  1. Owner/менеджер компании создаёт LeadForm через POST /api/lead-forms
  2. Получает embed-код (см. LF7) или прямую ссылку /f/{tenant_slug}/{form_id}
  3. Клиент компании заполняет форму → POST /api/f/{tenant_slug}/{form_id}
  4. Лид падает в TenantLead, показывается на странице /leads с воронкой
"""
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import desc, func, or_
from sqlalchemy.orm import Session

from slugify import slugify

from ..core.limiter import limiter
from ..core.ws_hub import publish_to_tenant
from ..database import get_db
from ..models import LeadForm, TenantLead, Tenant, Task, User
from ..models.task import TaskStatus, TaskPriority
from ..schemas.common import Message
from ..tasks.email import send_notification_email
from .deps import TenantContext, get_current_context, log_action, require

router = APIRouter(prefix="/api", tags=["lead-forms"])

ALLOWED_FIELD_TYPES = {"text", "email", "phone", "textarea", "select", "number"}
ALLOWED_LEAD_STATUSES = {"new", "contacted", "qualified", "converted", "rejected"}
HONEYPOT_FIELD = "website_url"  # не должно быть заполнено — бот заполнит любое


# =========================================================================
# Schemas
# =========================================================================


class FormField(BaseModel):
    key: str = Field(min_length=1, max_length=50, pattern=r"^[a-z][a-z0-9_]*$")
    label: str = Field(min_length=1, max_length=100)
    type: str
    required: bool = False
    placeholder: Optional[str] = Field(default=None, max_length=200)
    options: Optional[list[str]] = None

    @field_validator("type")
    @classmethod
    def _validate_type(cls, v: str) -> str:
        if v not in ALLOWED_FIELD_TYPES:
            raise ValueError(f"type must be one of {sorted(ALLOWED_FIELD_TYPES)}")
        return v


class LeadFormCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    slug: Optional[str] = Field(default=None, max_length=80)
    title: str = Field(default="Оставьте заявку", max_length=200)
    subtitle: Optional[str] = Field(default=None, max_length=300)
    submit_label: str = Field(default="Отправить", max_length=80)
    success_message: str = Field(default="Спасибо! Мы свяжемся с вами.", max_length=1000)
    brand_color: str = Field(default="#0f67fd", max_length=20)
    fields_config: list[FormField] = Field(default_factory=list)
    is_active: bool = True


class LeadFormUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    title: Optional[str] = Field(default=None, max_length=200)
    subtitle: Optional[str] = Field(default=None, max_length=300)
    submit_label: Optional[str] = Field(default=None, max_length=80)
    success_message: Optional[str] = Field(default=None, max_length=1000)
    brand_color: Optional[str] = Field(default=None, max_length=20)
    fields_config: Optional[list[FormField]] = None
    is_active: Optional[bool] = None


class LeadFormOut(BaseModel):
    id: int
    name: str
    slug: str
    title: str
    subtitle: Optional[str]
    submit_label: str
    success_message: str
    brand_color: str
    fields_config: Any
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class LeadFormPublic(BaseModel):
    """Публичный конфиг формы для рендера embed-виджета."""
    id: int
    slug: str
    title: str
    subtitle: Optional[str]
    submit_label: str
    success_message: str
    brand_color: str
    fields_config: Any
    tenant_name: str


MAX_PUBLIC_PAYLOAD_BYTES = 50 * 1024  # 50 KB — щедро для формы, отсекает бомбы


class PublicSubmit(BaseModel):
    payload: dict[str, Any]

    @field_validator("payload")
    @classmethod
    def _limit_payload_size(cls, v: dict[str, Any]) -> dict[str, Any]:
        import json
        # Быстрая оценка размера — сериализуем в JSON и меряем.
        raw = json.dumps(v, ensure_ascii=False)
        if len(raw.encode("utf-8")) > MAX_PUBLIC_PAYLOAD_BYTES:
            raise ValueError(f"payload слишком большой (макс {MAX_PUBLIC_PAYLOAD_BYTES // 1024} KB)")
        # Также ограничим глубину/ключи, чтобы не было {a: {b: {c: ...}}} с dev-инъекциями.
        for key, value in v.items():
            if len(str(key)) > 100:
                raise ValueError("слишком длинный ключ поля")
            if isinstance(value, str) and len(value) > 10_000:
                raise ValueError(f"поле '{key}' превышает 10 000 символов")
        return v


class TenantLeadOut(BaseModel):
    id: int
    tenant_id: int
    form_id: Optional[int]
    form_name: Optional[str] = None
    name: str
    contact: str
    custom_fields: Any
    note: Optional[str]
    status: str
    source: str
    assignee_id: Optional[int]
    converted_task_id: Optional[int]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class LeadUpdate(BaseModel):
    status: Optional[str] = None
    note: Optional[str] = Field(default=None, max_length=5000)
    assignee_id: Optional[int] = None

    @field_validator("status")
    @classmethod
    def _validate_status(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if v not in ALLOWED_LEAD_STATUSES:
            raise ValueError(f"status must be one of {sorted(ALLOWED_LEAD_STATUSES)}")
        return v


class LeadCreate(BaseModel):
    """Ручное создание лида менеджером."""
    name: str = Field(min_length=1, max_length=200)
    contact: str = Field(min_length=1, max_length=255)
    note: Optional[str] = Field(default=None, max_length=5000)
    status: str = "new"
    source: str = Field(default="manual", max_length=50)
    assignee_id: Optional[int] = None
    custom_fields: Optional[dict[str, Any]] = None

    @field_validator("status")
    @classmethod
    def _validate_status(cls, v: str) -> str:
        if v not in ALLOWED_LEAD_STATUSES:
            raise ValueError(f"status must be one of {sorted(ALLOWED_LEAD_STATUSES)}")
        return v


class ConvertRequest(BaseModel):
    project_id: Optional[int] = None
    title: Optional[str] = None
    description: Optional[str] = None


# =========================================================================
# Helpers
# =========================================================================


def _unique_form_slug(db: Session, tenant_id: int, base: str) -> str:
    root = (slugify(base) or "form")[:60]
    candidate = root
    n = 2
    while db.query(LeadForm.id).filter(LeadForm.tenant_id == tenant_id, LeadForm.slug == candidate).first():
        candidate = f"{root}-{n}"
        n += 1
    return candidate


def _serialize_lead(lead: TenantLead) -> TenantLeadOut:
    return TenantLeadOut(
        id=lead.id,
        tenant_id=lead.tenant_id,
        form_id=lead.form_id,
        form_name=lead.form.name if lead.form else None,
        name=lead.name,
        contact=lead.contact,
        custom_fields=lead.custom_fields or {},
        note=lead.note,
        status=lead.status,
        source=lead.source,
        assignee_id=lead.assignee_id,
        converted_task_id=lead.converted_task_id,
        created_at=lead.created_at,
        updated_at=lead.updated_at,
    )


def _extract_field(payload: dict[str, Any], keys: list[str]) -> Optional[str]:
    for k in keys:
        if k in payload and isinstance(payload[k], str) and payload[k].strip():
            return payload[k].strip()
    return None


# =========================================================================
# LF3: CRUD форм (защищённые)
# =========================================================================


@router.get("/lead-forms", response_model=list[LeadFormOut])
def list_forms(
    ctx: TenantContext = Depends(require("leads.manage_forms")),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(LeadForm)
        .filter(LeadForm.tenant_id == ctx.tenant.id)
        .order_by(desc(LeadForm.created_at))
        .all()
    )
    return rows


@router.post("/lead-forms", response_model=LeadFormOut, status_code=201)
def create_form(
    payload: LeadFormCreate,
    ctx: TenantContext = Depends(require("leads.manage_forms")),
    db: Session = Depends(get_db),
):
    slug = payload.slug.strip() if payload.slug else payload.name
    slug = _unique_form_slug(db, ctx.tenant.id, slug)
    form = LeadForm(
        tenant_id=ctx.tenant.id,
        name=payload.name.strip(),
        slug=slug,
        title=payload.title.strip() or "Оставьте заявку",
        subtitle=(payload.subtitle or "").strip() or None,
        submit_label=payload.submit_label.strip() or "Отправить",
        success_message=payload.success_message.strip() or "Спасибо! Мы свяжемся с вами.",
        brand_color=payload.brand_color.strip() or "#0f67fd",
        fields_config=[f.model_dump() for f in payload.fields_config],
        is_active=payload.is_active,
        created_by=ctx.user.id,
    )
    db.add(form)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="create", entity="lead_form", detail=form.name)
    db.commit()
    db.refresh(form)
    return form


@router.get("/lead-forms/{form_id}", response_model=LeadFormOut)
def get_form(
    form_id: int,
    ctx: TenantContext = Depends(require("leads.manage_forms")),
    db: Session = Depends(get_db),
):
    form = db.get(LeadForm, form_id)
    if not form or form.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Форма не найдена")
    return form


@router.patch("/lead-forms/{form_id}", response_model=LeadFormOut)
def update_form(
    form_id: int,
    payload: LeadFormUpdate,
    ctx: TenantContext = Depends(require("leads.manage_forms")),
    db: Session = Depends(get_db),
):
    form = db.get(LeadForm, form_id)
    if not form or form.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Форма не найдена")

    data = payload.model_dump(exclude_unset=True)
    if "fields_config" in data and data["fields_config"] is not None:
        data["fields_config"] = [f if isinstance(f, dict) else f.model_dump() for f in data["fields_config"]]
    for k, v in data.items():
        setattr(form, k, v)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="lead_form", entity_id=form.id)
    db.commit()
    db.refresh(form)
    return form


@router.delete("/lead-forms/{form_id}", response_model=Message)
def delete_form(
    form_id: int,
    ctx: TenantContext = Depends(require("leads.manage_forms")),
    db: Session = Depends(get_db),
):
    form = db.get(LeadForm, form_id)
    if not form or form.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Форма не найдена")
    db.delete(form)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="delete", entity="lead_form", entity_id=form_id)
    db.commit()
    return Message(message="Форма удалена")


# =========================================================================
# LF2: Публичный endpoint (без auth) + public config
# =========================================================================


@router.get("/f/{tenant_slug}/{form_id}/config", response_model=LeadFormPublic)
def public_form_config(tenant_slug: str, form_id: int, db: Session = Depends(get_db)):
    tenant = db.query(Tenant).filter(Tenant.slug == tenant_slug, Tenant.is_active.is_(True)).first()
    if not tenant:
        raise HTTPException(404, "Компания не найдена")
    form = db.get(LeadForm, form_id)
    if not form or form.tenant_id != tenant.id or not form.is_active:
        raise HTTPException(404, "Форма не найдена или отключена")
    return LeadFormPublic(
        id=form.id,
        slug=form.slug,
        title=form.title,
        subtitle=form.subtitle,
        submit_label=form.submit_label,
        success_message=form.success_message,
        brand_color=form.brand_color,
        fields_config=form.fields_config or [],
        tenant_name=tenant.company_display_name or tenant.name,
    )


@router.post("/f/{tenant_slug}/{form_id}", response_model=Message, status_code=201)
@limiter.limit("20/hour")
def public_submit(
    request: Request,
    tenant_slug: str,
    form_id: int,
    payload: PublicSubmit,
    db: Session = Depends(get_db),
):
    tenant = db.query(Tenant).filter(Tenant.slug == tenant_slug, Tenant.is_active.is_(True)).first()
    if not tenant:
        raise HTTPException(404, "Компания не найдена")
    form = db.get(LeadForm, form_id)
    if not form or form.tenant_id != tenant.id or not form.is_active:
        raise HTTPException(404, "Форма не найдена или отключена")

    data = payload.payload or {}

    # Honeypot: если ЛЮБОЙ бот заполнил скрытое поле — тихо принимаем 201, но не пишем.
    if isinstance(data.get(HONEYPOT_FIELD), str) and data.get(HONEYPOT_FIELD).strip():
        return Message(message=form.success_message)

    # Проверка required полей из конфига
    for f in form.fields_config or []:
        if not isinstance(f, dict):
            continue
        if f.get("required") and not str(data.get(f.get("key"), "") or "").strip():
            raise HTTPException(400, f"Поле «{f.get('label') or f.get('key')}» обязательно")

    # Стандартные поля
    name = _extract_field(data, ["name", "full_name", "имя"]) or "Без имени"
    contact = _extract_field(data, ["contact", "email", "phone", "телефон"])
    if not contact:
        raise HTTPException(400, "Укажите email или телефон для связи")

    # custom_fields = всё что пришло, кроме honeypot и служебных
    custom = {k: v for k, v in data.items() if k != HONEYPOT_FIELD}

    lead = TenantLead(
        tenant_id=tenant.id,
        form_id=form.id,
        name=name[:200],
        contact=contact[:255],
        custom_fields=custom,
        note=None,
        status="new",
        source="form",
        ip_address=(request.client.host if request.client else None),
        user_agent=(request.headers.get("user-agent") or "")[:500] or None,
        referer=(request.headers.get("referer") or "")[:500] or None,
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)

    # Realtime + email owner'у
    publish_to_tenant(tenant.id, "lead.new", {"id": lead.id, "name": lead.name, "contact": lead.contact, "form_id": form.id})
    _notify_owner_of_lead(db, tenant, lead)

    return Message(message=form.success_message)


def _notify_owner_of_lead(db: Session, tenant: Tenant, lead: TenantLead) -> None:
    if not tenant.owner_id:
        return
    owner = db.get(User, tenant.owner_id)
    if not owner or not owner.email:
        return
    try:
        send_notification_email.delay(
            to=owner.email,
            title=f"Новый лид: {lead.name}",
            body=f"Контакт: {lead.contact}\nФорма: {lead.form.name if lead.form else '—'}",
            link_url=None,
        )
    except Exception:
        pass


# =========================================================================
# LF4: CRUD лидов (защищённые) + convert-to-task
# =========================================================================


@router.get("/tenant-leads", response_model=dict)
def list_leads(
    q: Optional[str] = Query(default=None),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    form_id: Optional[int] = Query(default=None),
    assignee_id: Optional[int] = Query(default=None),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    ctx: TenantContext = Depends(require("leads.view")),
    db: Session = Depends(get_db),
):
    qy = db.query(TenantLead).filter(TenantLead.tenant_id == ctx.tenant.id)
    if status_filter:
        if status_filter not in ALLOWED_LEAD_STATUSES:
            raise HTTPException(400, "unknown status")
        qy = qy.filter(TenantLead.status == status_filter)
    if form_id:
        qy = qy.filter(TenantLead.form_id == form_id)
    if assignee_id:
        qy = qy.filter(TenantLead.assignee_id == assignee_id)
    if q:
        like = f"%{q.strip().lower()}%"
        qy = qy.filter(or_(func.lower(TenantLead.name).like(like), func.lower(TenantLead.contact).like(like)))

    total = qy.with_entities(func.count(TenantLead.id)).scalar() or 0
    rows = qy.order_by(desc(TenantLead.created_at)).offset((page - 1) * per_page).limit(per_page).all()
    return {
        "items": [_serialize_lead(r) for r in rows],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page if per_page else 1,
    }


@router.post("/tenant-leads", response_model=TenantLeadOut, status_code=201)
def create_lead(
    payload: LeadCreate,
    ctx: TenantContext = Depends(require("leads.create")),
    db: Session = Depends(get_db),
):
    """Ручное создание лида менеджером (без формы)."""
    # Валидируем assignee_id — должен состоять в этом tenant'е
    if payload.assignee_id is not None:
        from ..models import TenantMembership
        active = (
            db.query(TenantMembership.id)
            .join(User, User.id == TenantMembership.user_id)
            .filter(
                TenantMembership.tenant_id == ctx.tenant.id,
                TenantMembership.user_id == payload.assignee_id,
                User.is_active.is_(True),
            )
            .first()
        )
        if not active:
            raise HTTPException(400, "Исполнитель не найден в этой компании")

    lead = TenantLead(
        tenant_id=ctx.tenant.id,
        form_id=None,
        name=payload.name.strip()[:200],
        contact=payload.contact.strip()[:255],
        custom_fields=payload.custom_fields or {},
        note=(payload.note or "").strip() or None,
        status=payload.status,
        source=(payload.source or "manual").strip()[:50],
        assignee_id=payload.assignee_id,
    )
    db.add(lead)
    log_action(
        db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
        action="create", entity="lead", detail=lead.name,
    )
    db.commit()
    db.refresh(lead)
    publish_to_tenant(ctx.tenant.id, "lead.new", {
        "id": lead.id, "name": lead.name, "contact": lead.contact, "form_id": None,
    })
    return _serialize_lead(lead)


@router.get("/tenant-leads/{lead_id}", response_model=TenantLeadOut)
def get_lead(
    lead_id: int,
    ctx: TenantContext = Depends(require("leads.view")),
    db: Session = Depends(get_db),
):
    lead = db.get(TenantLead, lead_id)
    if not lead or lead.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Лид не найден")
    return _serialize_lead(lead)


@router.patch("/tenant-leads/{lead_id}", response_model=TenantLeadOut)
def update_lead(
    lead_id: int,
    payload: LeadUpdate,
    ctx: TenantContext = Depends(require("leads.update")),
    db: Session = Depends(get_db),
):
    lead = db.get(TenantLead, lead_id)
    if not lead or lead.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Лид не найден")

    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(lead, k, v)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="lead", entity_id=lead.id, detail=str(data.get("status") or ""))
    db.commit()
    db.refresh(lead)
    publish_to_tenant(ctx.tenant.id, "lead.update", {"id": lead.id, "status": lead.status})
    return _serialize_lead(lead)


@router.delete("/tenant-leads/{lead_id}", response_model=Message)
def delete_lead(
    lead_id: int,
    ctx: TenantContext = Depends(require("leads.delete")),
    db: Session = Depends(get_db),
):
    lead = db.get(TenantLead, lead_id)
    if not lead or lead.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Лид не найден")
    db.delete(lead)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="delete", entity="lead", entity_id=lead_id)
    db.commit()
    return Message(message="Лид удалён")


@router.post("/tenant-leads/{lead_id}/convert", response_model=dict, status_code=201)
def convert_lead_to_task(
    lead_id: int,
    payload: ConvertRequest,
    ctx: TenantContext = Depends(require("leads.convert")),
    db: Session = Depends(get_db),
):
    lead = db.get(TenantLead, lead_id)
    if not lead or lead.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Лид не найден")

    title = (payload.title or f"Лид: {lead.name}").strip()[:300]
    custom_lines = "\n".join(f"{k}: {v}" for k, v in (lead.custom_fields or {}).items() if v)
    default_desc = f"Контакт: {lead.contact}\n{custom_lines}\n\n{lead.note or ''}".strip()
    description = (payload.description or default_desc)[:5000]

    # Assignee: если у лида уже назначен — проверяем что он всё ещё в этом tenant'е
    # и активен; иначе — назначаем текущего юзера.
    from ..models import TenantMembership
    assignee_id = lead.assignee_id or ctx.user.id
    if assignee_id != ctx.user.id:
        active = (
            db.query(TenantMembership.id)
            .join(User, User.id == TenantMembership.user_id)
            .filter(
                TenantMembership.tenant_id == ctx.tenant.id,
                TenantMembership.user_id == assignee_id,
                User.is_active.is_(True),
            )
            .first()
        )
        if not active:
            assignee_id = ctx.user.id

    # project_id — тоже валидируем что принадлежит tenant'у
    if payload.project_id:
        from ..models import Project
        proj = db.get(Project, payload.project_id)
        if not proj or proj.tenant_id != ctx.tenant.id:
            raise HTTPException(400, "Проект не найден в этой компании")

    task = Task(
        tenant_id=ctx.tenant.id,
        title=title,
        description=description,
        status=TaskStatus.new,
        priority=TaskPriority.medium,
        project_id=payload.project_id,
        assignee_id=assignee_id,
        author_id=ctx.user.id,
    )
    db.add(task)
    db.flush()

    lead.converted_task_id = task.id
    lead.status = "converted"
    log_action(
        db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
        action="convert", entity="lead", entity_id=lead.id, task_id=task.id, detail=title,
    )
    db.commit()
    db.refresh(lead)
    return {"task_id": task.id, "lead": _serialize_lead(lead).model_dump()}
