from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from typing import Optional

from ..database import get_db
from ..models import Contact, Company
from ..core.tenant_refs import ensure_member, ensure_owned
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


def _clean_str(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    v = v.strip()
    return v or None


def _apply_counterparty_fields(db: Session, ctx: TenantContext, c: Company, data: dict) -> None:
    """Поля контрагента: страна, рег. номер, типы, ответственный, статус."""
    if "country" in data:
        c.country = _clean_str(data["country"])
    if "registration_number" in data:
        c.registration_number = _clean_str(data["registration_number"])
    if data.get("types") is not None:
        c.types = list(data["types"])
    if "responsible_user_id" in data:
        rid = data["responsible_user_id"] or None
        ensure_member(db, ctx.tenant.id, rid, "Ответственный")
        c.responsible_user_id = rid
    if data.get("status") is not None:
        c.status = data["status"]


@router.get("/companies", response_model=Page[CompanyOut])
def list_companies(
    q: Optional[str] = None,
    scope: Optional[str] = None,  # all | mine
    type: Optional[str] = None,  # buyer | epc | supplier | consultant | bank | government
    status: Optional[str] = None,  # potential | nda | active | blocked
    responsible_user_id: Optional[int] = None,
    pagination: PageParams = Depends(page_params),
    ctx: TenantContext = Depends(require("contacts.view")),
    db: Session = Depends(get_db),
):
    query = db.query(Company).filter(Company.tenant_id == ctx.tenant.id)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(
            Company.name.ilike(like),
            Company.industry.ilike(like),
            Company.tax_id.ilike(like),
            Company.registration_number.ilike(like),
        ))
    if scope == "mine":
        query = query.filter(or_(Company.owner_id == ctx.user.id, Company.responsible_user_id == ctx.user.id))
    if type:
        query = query.filter(Company.types.contains([type]))
    if status:
        query = query.filter(Company.status == status)
    if responsible_user_id is not None:
        query = query.filter(Company.responsible_user_id == responsible_user_id)
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
    ensure_member(db, ctx.tenant.id, payload.owner_id, "Ответственный")
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
        status=payload.status,
        types=list(payload.types or []),
    )
    _apply_counterparty_fields(db, ctx, company, payload.model_dump(include={"country", "registration_number", "responsible_user_id"}))
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
    ensure_member(db, ctx.tenant.id, payload.owner_id, "Ответственный")
    for field in ("name", "industry", "website", "phone", "email", "tax_id", "address", "note", "owner_id"):
        v = getattr(payload, field)
        if v is not None:
            setattr(c, field, v)
    _apply_counterparty_fields(
        db, ctx, c,
        payload.model_dump(exclude_unset=True, include={"country", "registration_number", "types", "responsible_user_id", "status"}),
    )
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

    ensure_member(db, ctx.tenant.id, payload.owner_id, "Ответственный")
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
    ensure_member(db, ctx.tenant.id, payload.owner_id, "Ответственный")
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
    ensure_member(db, ctx.tenant.id, payload.patch.owner_id, "Ответственный")
    ensure_owned(db, Company, payload.patch.company_id, ctx.tenant.id, "Компания")
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
    ensure_member(db, ctx.tenant.id, payload.owner_id, "Ответственный")
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


# =============================================================================
# Карточка контрагента: переписка и хроника
# =============================================================================

# Общие почтовые сервисы: по их домену нельзя понять, что письмо от этой компании.
PUBLIC_MAIL_DOMAINS = {
    "gmail.com", "googlemail.com", "mail.ru", "inbox.ru", "list.ru", "bk.ru", "yandex.ru", "yandex.kz",
    "ya.ru", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "rambler.ru",
    "proton.me", "protonmail.com", "aol.com", "gmx.com", "zoho.com",
}


def _domain_of_email(v: Optional[str]) -> Optional[str]:
    if not v or "@" not in v:
        return None
    return v.rsplit("@", 1)[1].strip().lower().rstrip(">").rstrip(".") or None


def _domain_of_site(v: Optional[str]) -> Optional[str]:
    if not v:
        return None
    s = v.strip().lower()
    for prefix in ("https://", "http://"):
        if s.startswith(prefix):
            s = s[len(prefix):]
    s = s.split("/", 1)[0].split("?", 1)[0].split(":", 1)[0]
    if s.startswith("www."):
        s = s[4:]
    return s if "." in s else None


def _addr_matches(addr: str, domains: set, emails: set) -> bool:
    a = (addr or "").strip().lower()
    if not a:
        return False
    if a in emails:
        return True
    d = _domain_of_email(a)
    return bool(d) and any(d == x or d.endswith("." + x) for x in domains)


@router.get("/companies/{company_id}/mail")
def company_mail(
    company_id: int,
    ctx: TenantContext = Depends(require("contacts.view")),
    db: Session = Depends(get_db),
):
    """Переписка с контрагентом из ЛИЧНОГО ящика текущего сотрудника.

    Почта в системе — ящик на сотрудника, чужие ящики не видны никому (как в разделе «Почта»),
    поэтому здесь только письма из своего ящика, где отправитель или получатель — с домена
    компании (по email или сайту) или один из её контактов.
    """
    from datetime import datetime, timezone
    from sqlalchemy import String, cast
    from ..core.permissions import user_has
    from ..models import Mailbox, MailMessage, MailThread

    c = db.get(Company, company_id)
    if not c or c.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Компания не найдена")

    if not ctx.membership.is_owner and not user_has(ctx.user, ["mail.use"], tenant_id=ctx.tenant.id):
        return {"items": [], "reason": "no_access", "domains": []}
    mb = (
        db.query(Mailbox)
        .filter(Mailbox.tenant_id == ctx.tenant.id, Mailbox.user_id == ctx.user.id)
        .first()
    )
    if not mb:
        return {"items": [], "reason": "no_mailbox", "domains": []}

    domains: set = set()
    emails: set = set()
    for d in (_domain_of_email(c.email), _domain_of_site(c.website)):
        if d and d not in PUBLIC_MAIL_DOMAINS:
            domains.add(d)
    if c.email and _domain_of_email(c.email) in PUBLIC_MAIL_DOMAINS:
        emails.add(c.email.strip().lower())
    contact_emails = (
        db.query(Contact.email)
        .filter(Contact.tenant_id == ctx.tenant.id, Contact.company_id == c.id, Contact.email.isnot(None))
        .all()
    )
    for (e,) in contact_emails:
        if e and "@" in e:
            emails.add(e.strip().lower())
    if not domains and not emails:
        return {"items": [], "reason": "no_domain", "domains": []}

    # Грубый отбор в базе, точная проверка адресов — ниже.
    conds = []
    for d in domains:
        conds.append(func.lower(MailMessage.from_addr).like(f"%{d}"))
        conds.append(func.lower(cast(MailMessage.to_addrs, String)).like(f"%{d}%"))
        conds.append(func.lower(cast(MailMessage.cc_addrs, String)).like(f"%{d}%"))
    for e in emails:
        conds.append(func.lower(MailMessage.from_addr) == e)
        conds.append(func.lower(cast(MailMessage.to_addrs, String)).like(f"%{e}%"))
        conds.append(func.lower(cast(MailMessage.cc_addrs, String)).like(f"%{e}%"))

    rows = (
        db.query(MailMessage)
        .filter(
            MailMessage.tenant_id == ctx.tenant.id,
            MailMessage.mailbox_id == mb.id,
            or_(*conds),
        )
        .order_by(MailMessage.created_at.desc())
        .limit(500)
        .all()
    )

    own = (mb.email or "").strip().lower()
    threads: dict = {}
    for m in rows:
        addrs = [m.from_addr or ""] + list(m.to_addrs or []) + list(m.cc_addrs or [])
        addrs = [a if isinstance(a, str) else str(a) for a in addrs]
        if not any(_addr_matches(a, domains, emails) for a in addrs):
            continue
        when = m.sent_at or m.created_at
        t = threads.get(m.thread_id)
        if t is None:
            t = threads[m.thread_id] = {
                "thread_id": m.thread_id,
                "subject": m.subject,
                "last_at": when,
                "messages": 0,
                "participants": [],
            }
        t["messages"] += 1
        if when and (t["last_at"] is None or when > t["last_at"]):
            t["last_at"] = when
        for a in addrs:
            a = a.strip().lower()
            if a and a != own and a not in t["participants"]:
                t["participants"].append(a)

    if threads:
        subjects = dict(
            db.query(MailThread.id, MailThread.subject)
            .filter(
                MailThread.tenant_id == ctx.tenant.id,
                MailThread.mailbox_id == mb.id,
                MailThread.id.in_(list(threads.keys())),
            )
            .all()
        )
        for tid, t in threads.items():
            t["subject"] = subjects.get(tid) or t["subject"]

    floor = datetime.min.replace(tzinfo=timezone.utc)
    items = sorted(threads.values(), key=lambda t: t["last_at"] or floor, reverse=True)[:100]
    for t in items:
        t["last_at"] = t["last_at"].isoformat() if t["last_at"] else None
        t["participants"] = t["participants"][:10]
    return {"items": items, "reason": None, "domains": sorted(domains)}


@router.get("/companies/{company_id}/timeline")
def company_timeline(
    company_id: int,
    limit: int = 200,
    ctx: TenantContext = Depends(require("contacts.view")),
    db: Session = Depends(get_db),
):
    """Хроника: события по самой компании, её контактам и сделкам — новые сверху."""
    from sqlalchemy import and_
    from ..core.permissions import user_has
    from ..models import ActivityLog, Deal

    c = db.get(Company, company_id)
    if not c or c.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Компания не найдена")

    contact_ids = [
        r[0] for r in db.query(Contact.id).filter(Contact.tenant_id == ctx.tenant.id, Contact.company_id == c.id).all()
    ]
    see_deals = ctx.membership.is_owner or user_has(ctx.user, ["deals.view"], tenant_id=ctx.tenant.id)
    deal_ids = (
        [r[0] for r in db.query(Deal.id).filter(Deal.tenant_id == ctx.tenant.id, Deal.company_id == c.id).all()]
        if see_deals else []
    )

    conds = [and_(ActivityLog.entity == "company", ActivityLog.entity_id == c.id)]
    if contact_ids:
        conds.append(and_(ActivityLog.entity == "contact", ActivityLog.entity_id.in_(contact_ids)))
    if deal_ids:
        conds.append(and_(ActivityLog.entity == "deal", ActivityLog.entity_id.in_(deal_ids)))

    rows = (
        db.query(ActivityLog)
        .filter(ActivityLog.tenant_id == ctx.tenant.id, or_(*conds))
        .order_by(ActivityLog.created_at.desc())
        .limit(max(1, min(limit, 500)))
        .all()
    )
    return [
        {
            "id": r.id,
            "action": r.action,
            "entity": r.entity,
            "entity_id": r.entity_id,
            "detail": r.detail,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "user": {"id": r.user.id, "name": r.user.name, "avatar_url": getattr(r.user, "avatar_url", None)} if r.user else None,
        }
        for r in rows
    ]
