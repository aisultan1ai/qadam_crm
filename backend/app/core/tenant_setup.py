"""Helpers для создания tenant'а и подготовки его окружения (роли, membership).

Используются в bootstrap, при регистрации новой компании (L3.1) и при
приёме приглашения новым пользователем (L3.2).
"""
from __future__ import annotations

from slugify import slugify
from sqlalchemy.orm import Session

from ..models import Role, Tenant, TenantMembership, User

RESERVED_SLUGS = {
    "www", "api", "admin", "app", "mail", "static", "media",
    "docs", "help", "support", "billing", "auth", "login", "register",
    "invite", "dashboard", "settings", "assets", "ws",
}


def _unique_slug(db: Session, base: str) -> str:
    """Генерирует свободный slug: `acme`, `acme-2`, `acme-3`..."""
    root = slugify(base) or "company"
    root = root[:64]
    if root in RESERVED_SLUGS:
        root = f"{root}-1"
    candidate = root
    n = 2
    while db.query(Tenant.id).filter(Tenant.slug == candidate).first():
        candidate = f"{root}-{n}"
        n += 1
    return candidate


def copy_system_roles_to_tenant(db: Session, tenant_id: int) -> None:
    """Копирует системные роли-шаблоны (tenant_id IS NULL, is_system=True) в tenant."""
    system_roles = db.query(Role).filter(Role.tenant_id.is_(None), Role.is_system.is_(True)).all()
    for sys_role in system_roles:
        exists = db.query(Role).filter(Role.tenant_id == tenant_id, Role.name == sys_role.name).first()
        if exists:
            continue
        tenant_role = Role(
            tenant_id=tenant_id,
            name=sys_role.name,
            description=sys_role.description,
            is_system=False,
        )
        tenant_role.permissions = list(sys_role.permissions)
        db.add(tenant_role)
    db.flush()


def create_tenant_with_owner(
    db: Session,
    *,
    company_name: str,
    owner: User,
    plan: str = "free",
) -> Tenant:
    """Создаёт tenant, копирует роли, добавляет owner'а в membership.

    НЕ коммитит — вызывающий должен сделать db.commit() (обычно в общей транзакции).
    """
    slug = _unique_slug(db, company_name)
    tenant = Tenant(
        name=company_name,
        slug=slug,
        plan=plan,
        is_active=True,
        owner_id=owner.id,
    )
    db.add(tenant)
    db.flush()

    copy_system_roles_to_tenant(db, tenant.id)

    admin_role = (
        db.query(Role)
        .filter(Role.tenant_id == tenant.id, Role.name == "Администратор")
        .first()
    )

    db.add(TenantMembership(
        tenant_id=tenant.id,
        user_id=owner.id,
        role_id=admin_role.id if admin_role else None,
        is_owner=True,
    ))

    if admin_role and admin_role not in owner.roles:
        owner.roles.append(admin_role)

    db.flush()
    return tenant
