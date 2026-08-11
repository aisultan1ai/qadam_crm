"""Create tables (if missing), run migrations, seed baseline data.

Runs once on backend start via docker-compose command.
Idempotent.
"""
from __future__ import annotations

import secrets
import time
from pathlib import Path

from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

from .config import settings
from .database import Base, engine, SessionLocal
from . import models  # noqa: F401 -- register models
from .models import Role, Permission, User, Tenant, TenantMembership
from .core.security import hash_password
from .core.permissions import PERMISSIONS

DEFAULT_TENANT_ID = 1
DEFAULT_TENANT_SLUG = "default"


BACKEND_ROOT = Path(__file__).resolve().parent.parent
ALEMBIC_INI = BACKEND_ROOT / "alembic.ini"


def wait_for_db(retries: int = 30, delay: float = 1.0) -> None:
    for i in range(retries):
        try:
            with engine.connect() as conn:
                conn.execute(text("select 1"))
            return
        except OperationalError:
            print(f"[bootstrap] DB not ready, retry {i+1}/{retries}")
            time.sleep(delay)
    raise RuntimeError("Database is not reachable")


def _current_alembic_revision() -> str | None:
    with engine.connect() as conn:
        row = conn.execute(text("select version_num from alembic_version")).first()
        return row[0] if row else None


def run_migrations() -> None:
    """Гарантирует схему БД.

    Три ветки, идемпотентно:
    - Пустая БД → create_all + stamp head (миграции написаны как onboarding после MVP).
    - Существующая БД без alembic_version → stamp head (считаем, что схема уже актуальна).
    - Существующая БД с alembic_version → upgrade head (если ревизия уже head, alembic не сделает ничего).
    """
    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

    inspector = inspect(engine)
    has_alembic_table = inspector.has_table("alembic_version")
    has_any_domain_table = inspector.has_table("users")

    if not has_any_domain_table:
        print("[bootstrap] Пустая БД — create_all + stamp head")
        Base.metadata.create_all(bind=engine)
        command.stamp(cfg, "head")
        return

    if not has_alembic_table:
        print("[bootstrap] Схема есть, alembic_version отсутствует — stamp head")
        command.stamp(cfg, "head")
        return

    current = _current_alembic_revision()
    script = ScriptDirectory.from_config(cfg)
    head = script.get_current_head()
    if current == head:
        print(f"[bootstrap] alembic на head ({head}), апгрейд не требуется")
        return

    print(f"[bootstrap] alembic upgrade: {current} → {head}")
    command.upgrade(cfg, "head")


def sync_permissions(db) -> None:
    existing = {p.code: p for p in db.query(Permission).all()}
    for group, items in PERMISSIONS.items():
        for code, name in items:
            if code in existing:
                p = existing[code]
                if p.name != name or p.group != group:
                    p.name = name
                    p.group = group
            else:
                db.add(Permission(code=code, name=name, group=group))
    db.commit()


def seed_roles(db) -> None:
    """Создать системные роли-шаблоны (tenant_id=NULL, is_system=True).

    При создании нового tenant'а эти шаблоны копируются в per-tenant роли.
    """
    all_perms = {p.code: p for p in db.query(Permission).all()}

    def ensure_role(name: str, description: str, codes: list[str]) -> Role:
        role = db.query(Role).filter(Role.name == name, Role.tenant_id.is_(None)).first()
        if not role:
            role = Role(name=name, description=description, tenant_id=None, is_system=True)
            role.permissions = [all_perms[c] for c in codes if c in all_perms]
            db.add(role)
            db.flush()
        return role

    ensure_role(
        "Администратор", "Полный доступ ко всем функциям",
        list(all_perms.keys()),
    )
    ensure_role(
        "Менеджер", "Управление проектами и задачами",
        [
            "users.view",
            "projects.view", "projects.create", "projects.update", "projects.archive",
            "tasks.view_all", "tasks.create", "tasks.update", "tasks.assign",
            "tasks.change_status", "tasks.change_priority", "tasks.bulk_update",
            "comments.view", "comments.create", "comments.update_own",
            "files.upload", "files.download",
            "analytics.reports", "analytics.employees",
        ],
    )
    ensure_role(
        "Сотрудник", "Работа со своими задачами",
        [
            "projects.view",
            "tasks.view_own", "tasks.update", "tasks.change_status",
            "comments.view", "comments.create", "comments.update_own",
            "files.upload", "files.download",
        ],
    )
    db.commit()


def seed_default_tenant(db) -> Tenant:
    """Создать default tenant (id=1) если ни одного нет.

    Для fresh БД (create_all + stamp) — миграция 0004 не запускалась, tenants пуст.
    Для существующих БД миграция уже создала tenant id=1 — здесь идемпотентно.
    """
    tenant = db.get(Tenant, DEFAULT_TENANT_ID)
    if tenant:
        return tenant

    tenant = Tenant(
        id=DEFAULT_TENANT_ID,
        name="Default",
        slug=DEFAULT_TENANT_SLUG,
        plan="enterprise",
        is_active=True,
    )
    db.add(tenant)
    db.commit()

    # На postgres нужно синхронизировать sequence, иначе следующий insert упадёт с dup key.
    from sqlalchemy import text as _text
    try:
        db.execute(_text(
            "SELECT setval('tenants_id_seq', GREATEST((SELECT MAX(id) FROM tenants), 1))"
        ))
        db.commit()
    except Exception:
        pass

    return tenant


def _ensure_tenant_roles(db, tenant_id: int) -> None:
    """Скопировать системные шаблоны ролей в per-tenant роли для указанного tenant'а."""
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
    db.commit()


def seed_admin(db, tenant: Tenant) -> None:
    email = settings.ADMIN_EMAIL.lower().strip()
    admin = db.query(User).filter(User.email == email).first()

    if admin:
        _ensure_admin_membership(db, admin, tenant)
        return

    password = settings.ADMIN_PASSWORD
    generated = False
    if not password:
        password = secrets.token_urlsafe(16)
        generated = True

    role_admin = (
        db.query(Role)
        .filter(Role.tenant_id == tenant.id, Role.name == "Администратор")
        .first()
    ) or db.query(Role).filter(Role.tenant_id.is_(None), Role.name == "Администратор").first()

    admin = User(
        email=email,
        name="Администратор",
        password_hash=hash_password(password),
        is_active=True,
        is_superuser=True,
        roles=[role_admin] if role_admin else [],
    )
    db.add(admin)
    db.commit()

    _ensure_admin_membership(db, admin, tenant)

    if generated:
        print("=" * 70)
        print("[bootstrap] Создан администратор. Сохраните эти данные:")
        print(f"[bootstrap]   email:    {email}")
        print(f"[bootstrap]   password: {password}")
        print("[bootstrap] Пароль показан один раз, сменить его можно в профиле.")
        print("=" * 70)
    else:
        print(f"[bootstrap] Создан администратор {email} (пароль из ADMIN_PASSWORD)")


def _ensure_admin_membership(db, admin: User, tenant: Tenant) -> None:
    membership = (
        db.query(TenantMembership)
        .filter(TenantMembership.tenant_id == tenant.id, TenantMembership.user_id == admin.id)
        .first()
    )
    role_admin = (
        db.query(Role)
        .filter(Role.tenant_id == tenant.id, Role.name == "Администратор")
        .first()
    )
    if not membership:
        db.add(TenantMembership(
            tenant_id=tenant.id,
            user_id=admin.id,
            role_id=role_admin.id if role_admin else None,
            is_owner=True,
        ))
    elif not membership.is_owner:
        membership.is_owner = True

    if tenant.owner_id is None:
        tenant.owner_id = admin.id

    db.commit()


def main() -> None:
    wait_for_db()
    run_migrations()

    with SessionLocal() as db:
        sync_permissions(db)
        seed_roles(db)
        tenant = seed_default_tenant(db)
        _ensure_tenant_roles(db, tenant.id)
        seed_admin(db, tenant)

    print("[bootstrap] Done.")


if __name__ == "__main__":
    main()
