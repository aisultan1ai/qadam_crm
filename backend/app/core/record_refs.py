"""Ссылки между записями: «любая запись может ссылаться на любую другую».

Цель ссылки (target):
  contact, company, deal, project, task, user, contract — системные сущности;
  object:<code> — запись пользовательской сущности (Объекты).

Одна точка для: поиска при выборе (lookup), подписи для отображения (labels), превью
по наведению (preview) и проверки, что ссылка указывает на запись своей компании.
Права учитываются: нет права на раздел — нет ни поиска, ни подписи (только «#id»).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Optional

from fastapi import HTTPException
from sqlalchemy import or_, String, cast
from sqlalchemy.orm import Session

from ..models import (
    Company, Contact, Contract, CustomObjectRecord, CustomObjectSchema, Deal, Project, Task,
    TenantMembership, User,
)
from .permissions import user_has
from .task_scope import apply_task_scope

SYSTEM_TARGETS = {
    "contact": "Контакт",
    "company": "Компания",
    "deal": "Сделка",
    "project": "Проект",
    "task": "Задача",
    "user": "Сотрудник",
    "contract": "Договор",
}
_PERM = {
    "contact": "contacts.view",
    "company": "contacts.view",
    "deal": "deals.view",
    "project": "projects.view",
    "contract": "contracts.view",
}


@dataclass
class Ref:
    id: int
    label: str
    subtitle: Optional[str] = None
    url: Optional[str] = None
    details: list[tuple[str, str]] = field(default_factory=list)

    def brief(self) -> dict:
        return {"id": self.id, "label": self.label, "subtitle": self.subtitle, "url": self.url}


def target_label(db: Session, tenant_id: int, target: str) -> str:
    if target in SYSTEM_TARGETS:
        return SYSTEM_TARGETS[target]
    schema = _object_schema(db, tenant_id, target)
    return schema.label if schema else target


def _object_schema(db: Session, tenant_id: int, target: str) -> Optional[CustomObjectSchema]:
    if not target.startswith("object:"):
        return None
    return db.query(CustomObjectSchema).filter(
        CustomObjectSchema.tenant_id == tenant_id, CustomObjectSchema.code == target[7:],
    ).first()


def validate_target(db: Session, tenant_id: int, target: Optional[str]) -> str:
    if not target:
        raise HTTPException(400, "Для поля-связи выберите, с чем связывать")
    if target in SYSTEM_TARGETS:
        return target
    if target.startswith("object:") and _object_schema(db, tenant_id, target):
        return target
    raise HTTPException(400, "Связь указывает на сущность, которой нет в компании")


def can_access(db: Session, user: User, tenant_id: int, is_owner: bool, target: str) -> bool:
    perm = _PERM.get(target)
    if perm is None:  # task — по правилу видимости задач; user/object — все сотрудники компании
        return True
    return is_owner or user_has(user, [perm], tenant_id=tenant_id)


_DEAL_STAGE = {"new": "Новый", "qualified": "Квалифицирован", "proposal": "Предложение",
               "negotiation": "Переговоры", "won": "Успех", "lost": "Провал"}
_DEAL_STATUS = {"open": "В работе", "won": "Выиграна", "lost": "Проиграна"}
_TASK_STATUS = {"new": "Новая", "in_progress": "В работе", "review": "На проверке", "done": "Готово", "cancelled": "Отменена"}


def _money(cents: Optional[int]) -> str:
    return f"{(cents or 0) / 100:,.0f} ₸".replace(",", " ")


def _query(db: Session, user: User, tenant_id: int, target: str):
    """(query, to_ref) для цели; query уже ограничен компанией и правами пользователя."""
    if target == "contact":
        q = db.query(Contact).filter(Contact.tenant_id == tenant_id)
        def to_ref(c: Contact) -> Ref:
            name = " ".join(x for x in (c.first_name, c.last_name) if x)
            return Ref(c.id, name or f"#{c.id}", c.position or c.email or c.phone, f"/contacts?contact={c.id}",
                       [(k, v) for k, v in (("Должность", c.position), ("Email", c.email), ("Телефон", c.phone)) if v])
        search = lambda s: or_(Contact.first_name.ilike(s), Contact.last_name.ilike(s), Contact.email.ilike(s), Contact.phone.ilike(s))
        return q, to_ref, search, Contact
    if target == "company":
        q = db.query(Company).filter(Company.tenant_id == tenant_id)
        def to_ref(c: Company) -> Ref:
            return Ref(c.id, c.name, f"БИН {c.tax_id}" if c.tax_id else (c.email or c.phone), f"/contacts/companies/{c.id}",
                       [(k, v) for k, v in (("БИН/ИИН", c.tax_id), ("Телефон", c.phone), ("Email", c.email)) if v])
        search = lambda s: or_(Company.name.ilike(s), Company.email.ilike(s), Company.tax_id.ilike(s))
        return q, to_ref, search, Company
    if target == "deal":
        q = db.query(Deal).filter(Deal.tenant_id == tenant_id)
        def to_ref(d: Deal) -> Ref:
            stage = _DEAL_STAGE.get(d.stage, d.stage)
            return Ref(d.id, d.title, f"{_money(d.amount_cents)} · {stage}", f"/deals?deal={d.id}",
                       [("Сумма", _money(d.amount_cents)), ("Стадия", stage), ("Статус", _DEAL_STATUS.get(d.status, d.status))])
        return q, to_ref, (lambda s: Deal.title.ilike(s)), Deal
    if target == "project":
        q = db.query(Project).filter(Project.tenant_id == tenant_id)
        def to_ref(p: Project) -> Ref:
            return Ref(p.id, p.name, "В архиве" if p.is_archived else None, f"/projects/{p.id}",
                       [("Статус", "В архиве" if p.is_archived else "Активный")])
        return q, to_ref, (lambda s: Project.name.ilike(s)), Project
    if target == "contract":
        from ..models.contract import CONTRACT_STATUSES
        q = db.query(Contract).filter(Contract.tenant_id == tenant_id)
        def to_ref(c: Contract) -> Ref:
            cp = c.company.name if c.company else None
            label = f"№ {c.number}" + (f" · {cp}" if cp else "")
            status = CONTRACT_STATUSES.get(c.status, c.status)
            until = c.valid_until.strftime("%d.%m.%Y") if c.valid_until else None
            return Ref(c.id, label, status, f"/contracts/{c.id}",
                       [(k, v) for k, v in (("Контрагент", cp), ("Статус", status), ("Действует до", until)) if v])
        search = lambda s: or_(Contract.number.ilike(s), Contract.subject.ilike(s))
        return q, to_ref, search, Contract
    if target == "task":
        q = apply_task_scope(db.query(Task).filter(Task.tenant_id == tenant_id), db, user, tenant_id)
        def to_ref(t: Task) -> Ref:
            status = _TASK_STATUS.get(getattr(t.status, "value", t.status), getattr(t.status, "value", t.status))
            dl = t.deadline.strftime("%d.%m.%Y") if getattr(t, "deadline", None) else None
            return Ref(t.id, t.title, f"#{t.id} · {status}", f"/tasks/{t.id}",
                       [(k, v) for k, v in (("Статус", str(status)), ("Срок", dl)) if v])
        return q, to_ref, (lambda s: Task.title.ilike(s)), Task
    if target == "user":
        q = (
            db.query(User, TenantMembership.position)
            .join(TenantMembership, TenantMembership.user_id == User.id)
            .filter(TenantMembership.tenant_id == tenant_id, User.is_active.is_(True))
        )
        def to_ref(row) -> Ref:
            u, position = row
            return Ref(u.id, u.name, position or u.email, f"/people/{u.id}",
                       [(k, v) for k, v in (("Должность", position), ("Email", u.email)) if v])
        return q, to_ref, (lambda s: or_(User.name.ilike(s), User.email.ilike(s))), User
    schema = _object_schema(db, tenant_id, target)
    if not schema:
        raise HTTPException(404, "Сущность не найдена")
    q = db.query(CustomObjectRecord).filter(
        CustomObjectRecord.tenant_id == tenant_id, CustomObjectRecord.schema_id == schema.id,
    )
    shown = [f for f in (schema.fields or []) if f.get("type") not in ("relation", "textarea")][:4]
    def to_ref(r: CustomObjectRecord) -> Ref:
        data = r.data or {}
        details = [(f.get("label", f["name"]), str(data[f["name"]])) for f in shown if data.get(f["name"]) not in (None, "")]
        return Ref(r.id, r.title or f"{schema.label} #{r.id}", schema.label, f"/objects?code={schema.code}&record={r.id}", details)
    search = lambda s: or_(CustomObjectRecord.title.ilike(s), cast(CustomObjectRecord.data, String).ilike(s))
    return q, to_ref, search, CustomObjectRecord


def lookup(db: Session, user: User, tenant_id: int, is_owner: bool, target: str,
           q: Optional[str] = None, limit: int = 20) -> list[Ref]:
    if not can_access(db, user, tenant_id, is_owner, target):
        return []
    query, to_ref, search, model = _query(db, user, tenant_id, target)
    if q and q.strip():
        term = q.strip()
        cond = search(f"%{term}%")
        if term.lstrip("#").isdigit():
            cond = or_(cond, model.id == int(term.lstrip("#")))
        query = query.filter(cond)
    return [to_ref(r) for r in query.order_by(model.id.desc()).limit(min(limit, 50)).all()]


def resolve(db: Session, user: User, tenant_id: int, is_owner: bool, target: str,
            ids: Iterable[int]) -> dict[int, Ref]:
    """Подписи для набора id. Невидимые/чужие записи в ответ не попадают."""
    ids = {int(i) for i in ids if isinstance(i, int) or (isinstance(i, str) and i.isdigit())}
    if not ids or not can_access(db, user, tenant_id, is_owner, target):
        return {}
    query, to_ref, _search, model = _query(db, user, tenant_id, target)
    return {ref.id: ref for ref in (to_ref(r) for r in query.filter(model.id.in_(ids)).all())}


def ensure_exists(db: Session, tenant_id: int, target: str, ref_id: int) -> None:
    """Ссылка обязана указывать на запись этой компании (права не проверяем — проверка
    целостности, а не видимости: сотрудник может сослаться на задачу коллеги из своего отдела)."""
    model = {"contact": Contact, "company": Company, "deal": Deal, "project": Project, "task": Task,
             "contract": Contract}.get(target)
    if model is not None:
        row = db.get(model, ref_id)
        ok = row is not None and row.tenant_id == tenant_id
    elif target == "user":
        ok = db.query(TenantMembership.id).filter(
            TenantMembership.tenant_id == tenant_id, TenantMembership.user_id == ref_id,
        ).first() is not None
    else:
        schema = _object_schema(db, tenant_id, target)
        row = db.get(CustomObjectRecord, ref_id)
        ok = bool(schema and row and row.tenant_id == tenant_id and row.schema_id == schema.id)
    if not ok:
        raise HTTPException(400, "Связанная запись не найдена")
