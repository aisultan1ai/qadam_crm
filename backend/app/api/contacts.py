from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from typing import Optional

from ..database import get_db
from ..models import Contact, Company
from ..schemas.contact import (
    ContactOut, ContactCreate, ContactUpdate,
    CompanyOut, CompanyCreate, CompanyUpdate,
)
from ..schemas.common import Message, Page, PageParams, page_params
from .deps import TenantContext, require, log_action

router = APIRouter(prefix="/api", tags=["contacts"])


# =============================================================================
# Companies
# =============================================================================

def _company_out(db: Session, tenant_id: int, c: Company) -> CompanyOut:
    contacts_count = (
        db.query(func.count(Contact.id))
        .filter(Contact.tenant_id == tenant_id, Contact.company_id == c.id)
        .scalar() or 0
    )
    return CompanyOut.model_validate(c).model_copy(update={"contacts_count": contacts_count})


@router.get("/companies", response_model=Page[CompanyOut])
def list_companies(
    q: Optional[str] = None,
    scope: Optional[str] = None,  # all | mine
    pagination: PageParams = Depends(page_params),
    ctx: TenantContext = Depends(require("contacts.view")),
    db: Session = Depends(get_db),
):
    query = db.query(Company).filter(Company.tenant_id == ctx.tenant.id)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(Company.name.ilike(like), Company.industry.ilike(like)))
    if scope == "mine":
        query = query.filter(Company.owner_id == ctx.user.id)
    query = query.order_by(Company.created_at.desc())

    if pagination.page is None:
        MAX_UNPAGED = 500
        rows = query.limit(MAX_UNPAGED).all()
        total = len(rows)
        page = 1
        per_page = total or pagination.per_page
        pages = 1
    else:
        total = query.order_by(None).count()
        offset = (pagination.page - 1) * pagination.per_page
        rows = query.offset(offset).limit(pagination.per_page).all()
        page = pagination.page
        per_page = pagination.per_page
        pages = (total + per_page - 1) // per_page if per_page else 1
        pages = pages or 1

    items = [_company_out(db, ctx.tenant.id, c) for c in rows]
    return Page[CompanyOut](items=items, total=total, page=page, per_page=per_page, pages=pages)


@router.post("/companies", response_model=CompanyOut, status_code=201)
def create_company(
    payload: CompanyCreate,
    ctx: TenantContext = Depends(require("contacts.create")),
    db: Session = Depends(get_db),
):
    company = Company(
        tenant_id=ctx.tenant.id,
        name=payload.name,
        industry=payload.industry,
        website=payload.website,
        phone=payload.phone,
        email=payload.email,
        tax_id=payload.tax_id,
        address=payload.address,
        note=payload.note,
        owner_id=payload.owner_id or ctx.user.id,
    )
    db.add(company)
    db.flush()
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="create", entity="company", entity_id=company.id, detail=company.name)
    db.commit()
    db.refresh(company)
    return _company_out(db, ctx.tenant.id, company)


@router.get("/companies/{company_id}", response_model=CompanyOut)
def get_company(company_id: int, ctx: TenantContext = Depends(require("contacts.view")), db: Session = Depends(get_db)):
    c = db.get(Company, company_id)
    if not c or c.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Компания не найдена")
    return _company_out(db, ctx.tenant.id, c)


@router.patch("/companies/{company_id}", response_model=CompanyOut)
def update_company(
    company_id: int,
    payload: CompanyUpdate,
    ctx: TenantContext = Depends(require("contacts.update")),
    db: Session = Depends(get_db),
):
    c = db.get(Company, company_id)
    if not c or c.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Компания не найдена")
    for field in ("name", "industry", "website", "phone", "email", "tax_id", "address", "note", "owner_id"):
        v = getattr(payload, field)
        if v is not None:
            setattr(c, field, v)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="company", entity_id=c.id)
    db.commit()
    db.refresh(c)
    return _company_out(db, ctx.tenant.id, c)


@router.delete("/companies/{company_id}", response_model=Message)
def delete_company(company_id: int, ctx: TenantContext = Depends(require("contacts.delete")), db: Session = Depends(get_db)):
    c = db.get(Company, company_id)
    if not c or c.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Компания не найдена")
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="delete", entity="company", entity_id=c.id, detail=c.name)
    db.delete(c)
    db.commit()
    return Message(message="Компания удалена")


# =============================================================================
# Contacts
# =============================================================================

@router.get("/contacts", response_model=Page[ContactOut])
def list_contacts(
    q: Optional[str] = None,
    company_id: Optional[int] = None,
    scope: Optional[str] = None,  # all | mine
    pagination: PageParams = Depends(page_params),
    ctx: TenantContext = Depends(require("contacts.view")),
    db: Session = Depends(get_db),
):
    query = db.query(Contact).filter(Contact.tenant_id == ctx.tenant.id)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(
            Contact.first_name.ilike(like),
            Contact.last_name.ilike(like),
            Contact.email.ilike(like),
            Contact.phone.ilike(like),
        ))
    if company_id is not None:
        query = query.filter(Contact.company_id == company_id)
    if scope == "mine":
        query = query.filter(Contact.owner_id == ctx.user.id)
    query = query.order_by(Contact.created_at.desc())

    if pagination.page is None:
        MAX_UNPAGED = 500
        rows = query.limit(MAX_UNPAGED).all()
        total = len(rows)
        page = 1
        per_page = total or pagination.per_page
        pages = 1
    else:
        total = query.order_by(None).count()
        offset = (pagination.page - 1) * pagination.per_page
        rows = query.offset(offset).limit(pagination.per_page).all()
        page = pagination.page
        per_page = pagination.per_page
        pages = (total + per_page - 1) // per_page if per_page else 1
        pages = pages or 1

    return Page[ContactOut](items=rows, total=total, page=page, per_page=per_page, pages=pages)


@router.post("/contacts", response_model=ContactOut, status_code=201)
def create_contact(
    payload: ContactCreate,
    ctx: TenantContext = Depends(require("contacts.create")),
    db: Session = Depends(get_db),
):
    if payload.company_id is not None:
        cp = db.get(Company, payload.company_id)
        if not cp or cp.tenant_id != ctx.tenant.id:
            raise HTTPException(400, "Компания не найдена")

    contact = Contact(
        tenant_id=ctx.tenant.id,
        first_name=payload.first_name,
        last_name=payload.last_name,
        email=payload.email,
        phone=payload.phone,
        position=payload.position,
        note=payload.note,
        source=payload.source,
        company_id=payload.company_id,
        owner_id=payload.owner_id or ctx.user.id,
    )
    db.add(contact)
    db.flush()
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="create", entity="contact", entity_id=contact.id, detail=f"{contact.first_name} {contact.last_name or ''}")
    db.commit()
    db.refresh(contact)
    return contact


@router.get("/contacts/{contact_id}", response_model=ContactOut)
def get_contact(contact_id: int, ctx: TenantContext = Depends(require("contacts.view")), db: Session = Depends(get_db)):
    c = db.get(Contact, contact_id)
    if not c or c.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Контакт не найден")
    return c


@router.patch("/contacts/{contact_id}", response_model=ContactOut)
def update_contact(
    contact_id: int,
    payload: ContactUpdate,
    ctx: TenantContext = Depends(require("contacts.update")),
    db: Session = Depends(get_db),
):
    c = db.get(Contact, contact_id)
    if not c or c.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Контакт не найден")
    if payload.company_id is not None and payload.company_id != c.company_id:
        cp = db.get(Company, payload.company_id)
        if not cp or cp.tenant_id != ctx.tenant.id:
            raise HTTPException(400, "Компания не найдена")
    for field in ("first_name", "last_name", "email", "phone", "position", "note", "source", "company_id", "owner_id"):
        v = getattr(payload, field)
        if v is not None:
            setattr(c, field, v)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="contact", entity_id=c.id)
    db.commit()
    db.refresh(c)
    return c


@router.delete("/contacts/{contact_id}", response_model=Message)
def delete_contact(contact_id: int, ctx: TenantContext = Depends(require("contacts.delete")), db: Session = Depends(get_db)):
    c = db.get(Contact, contact_id)
    if not c or c.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Контакт не найден")
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="delete", entity="contact", entity_id=c.id)
    db.delete(c)
    db.commit()
    return Message(message="Контакт удалён")


# =============================================================================
# Bulk operations (P3.8)
# =============================================================================

from pydantic import BaseModel


class ContactBulkPatch(BaseModel):
    owner_id: Optional[int] = None
    company_id: Optional[int] = None


class ContactBulk(BaseModel):
    ids: list[int]
    patch: ContactBulkPatch


@router.post("/contacts/bulk", response_model=Message)
def bulk_update_contacts(
    payload: ContactBulk,
    ctx: TenantContext = Depends(require("contacts.update")),
    db: Session = Depends(get_db),
):
    if not payload.ids:
        return Message(message="Нет контактов")
    rows = db.query(Contact).filter(Contact.tenant_id == ctx.tenant.id, Contact.id.in_(payload.ids)).all()
    for r in rows:
        if payload.patch.owner_id is not None:
            r.owner_id = payload.patch.owner_id
        if payload.patch.company_id is not None:
            r.company_id = payload.patch.company_id or None
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="bulk_update", entity="contact", detail=f"{len(rows)}")
    db.commit()
    return Message(message=f"Обновлено контактов: {len(rows)}")


@router.post("/contacts/bulk-delete", response_model=Message)
def bulk_delete_contacts(
    payload: ContactBulk,
    ctx: TenantContext = Depends(require("contacts.delete")),
    db: Session = Depends(get_db),
):
    q = db.query(Contact).filter(Contact.tenant_id == ctx.tenant.id, Contact.id.in_(payload.ids))
    n = q.count()
    q.delete(synchronize_session=False)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="bulk_delete", entity="contact", detail=f"{n}")
    db.commit()
    return Message(message=f"Удалено контактов: {n}")


class CompanyBulk(BaseModel):
    ids: list[int]
    owner_id: Optional[int] = None
    industry: Optional[str] = None


@router.post("/companies/bulk", response_model=Message)
def bulk_update_companies(
    payload: CompanyBulk,
    ctx: TenantContext = Depends(require("contacts.update")),
    db: Session = Depends(get_db),
):
    rows = db.query(Company).filter(Company.tenant_id == ctx.tenant.id, Company.id.in_(payload.ids)).all()
    for r in rows:
        if payload.owner_id is not None:
            r.owner_id = payload.owner_id
        if payload.industry is not None:
            r.industry = payload.industry
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="bulk_update", entity="company", detail=f"{len(rows)}")
    db.commit()
    return Message(message=f"Обновлено компаний: {len(rows)}")


@router.post("/companies/bulk-delete", response_model=Message)
def bulk_delete_companies(
    payload: CompanyBulk,
    ctx: TenantContext = Depends(require("contacts.delete")),
    db: Session = Depends(get_db),
):
    q = db.query(Company).filter(Company.tenant_id == ctx.tenant.id, Company.id.in_(payload.ids))
    n = q.count()
    q.delete(synchronize_session=False)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="bulk_delete", entity="company", detail=f"{n}")
    db.commit()
    return Message(message=f"Удалено компаний: {n}")
