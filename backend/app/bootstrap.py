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
    Для существующих ролей (в т.ч. per-tenant с тем же именем) добавляем
    новые permissions из шаблона, чтобы фичи, добавленные после провижининга,
    становились доступны без ручной правки ролей.
    """
    all_perms = {p.code: p for p in db.query(Permission).all()}

    def ensure_role(name: str, description: str, codes: list[str]) -> Role:
        role = db.query(Role).filter(Role.name == name, Role.tenant_id.is_(None)).first()
        target_perms = [all_perms[c] for c in codes if c in all_perms]
        if not role:
            role = Role(name=name, description=description, tenant_id=None, is_system=True)
            role.permissions = target_perms
            db.add(role)
            db.flush()
        else:
            # Добавляем недостающие permissions — не убирая уже назначенные.
            existing = {p.code for p in role.permissions}
            missing = [p for p in target_perms if p.code not in existing]
            if missing:
                role.permissions = list(role.permissions) + missing

        # Также синхронизируем per-tenant копии с тем же именем.
        tenant_roles = db.query(Role).filter(Role.tenant_id.is_not(None), Role.name == name).all()
        for tr in tenant_roles:
            existing = {p.code for p in tr.permissions}
            missing = [p for p in target_perms if p.code not in existing]
            if missing:
                tr.permissions = list(tr.permissions) + missing
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
            "leads.view", "leads.create", "leads.update", "leads.convert", "leads.manage_forms",
            "messenger.use", "messenger.create_group",
            "automations.manage",
            "messengers.manage", "messengers.reply",
            "mail.use",
            "wiki.use", "wiki.publish",
            "calendar.use",
            "booking.use",
            "time.use", "time.approve",
            "hr.view_profiles", "hr.manage_goals", "hr.manage_one_on_ones",
            "kudos.give",
            "contacts.view", "contacts.create", "contacts.update", "contacts.delete",
            "deals.view", "deals.create", "deals.update", "deals.delete",
        ],
    )
    ensure_role(
        "Сотрудник", "Работа со своими задачами",
        [
            "projects.view",
            "tasks.view_own", "tasks.update", "tasks.change_status",
            "comments.view", "comments.create", "comments.update_own",
            "files.upload", "files.download",
            "messenger.use",
            "hr.view_profiles", "kudos.give",
            "contacts.view",
            "deals.view",
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
        if not admin.is_platform_admin:
            admin.is_platform_admin = True
            db.commit()
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
        is_platform_admin=True,
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


def migrate_uploads_to_tenant_dirs() -> None:
    """Одноразово (идемпотентно) переносит legacy файлы в per-tenant подпапки.

    Плоские `uploads/*.ext` и `uploads/avatars/*.ext`, оставшиеся от старых версий,
    переносятся в `uploads/{tenant_id}/attachments|avatars/`. Значения в БД
    (`Attachment.stored_name`, `User.avatar_url`) при этом ОСТАЮТСЯ старыми —
    резолверы путей в attachments/users.py умеют читать оба формата.
    Задача этой миграции — только выровнять disk layout, чтобы новые загрузки
    и legacy-файлы жили в одной иерархии.
    """
    from .models import Attachment, User

    root = Path(settings.UPLOAD_DIR)
    if not root.exists():
        return

    with SessionLocal() as db:
        # Attachments: если stored_name — плоское имя, физически перенесём в 1/attachments.
        atts = db.query(Attachment).all()
        for att in atts:
            if "/" in att.stored_name:
                continue  # уже в новом формате
            src = root / att.stored_name
            if not src.exists():
                continue
            target_dir = root / str(att.tenant_id) / "attachments"
            target_dir.mkdir(parents=True, exist_ok=True)
            dest = target_dir / att.stored_name
            try:
                src.rename(dest)
                att.stored_name = f"{att.tenant_id}/attachments/{att.stored_name}"
            except OSError as e:
                print(f"[bootstrap] cannot move {src}: {e}")
        db.commit()

        # Avatars: /media/avatars/{stored} → /media/{tenant_id}/avatars/{stored}
        users = db.query(User).filter(User.avatar_url.like("/media/avatars/%")).all()
        for u in users:
            stored = u.avatar_url.split("/media/avatars/", 1)[1]
            src = root / "avatars" / stored
            if not src.exists():
                continue
            # Определяем tenant по первому membership пользователя.
            from .models import TenantMembership
            m = db.query(TenantMembership).filter(TenantMembership.user_id == u.id).first()
            tenant_id = m.tenant_id if m else DEFAULT_TENANT_ID
            target_dir = root / str(tenant_id) / "avatars"
            target_dir.mkdir(parents=True, exist_ok=True)
            dest = target_dir / stored
            try:
                src.rename(dest)
                u.avatar_url = f"/media/{tenant_id}/avatars/{stored}"
            except OSError as e:
                print(f"[bootstrap] cannot move {src}: {e}")
        db.commit()


def seed_plans(db) -> None:
    """Тарифы Planfix-стиля (Free / Plan A / Plan B / Plan X). Обновляем идемпотентно."""
    from .models import Plan
    plans_data = [
        {
            "key": "free", "title": "Free", "tagline": "Бесплатно навсегда для маленьких команд",
            "price_month": 0, "currency": "USD", "max_users": 5, "max_projects": 10, "sort_order": 1,
            "feature_export": True, "feature_import": True, "feature_invitations": True,
            "feature_lead_forms": False, "feature_analytics_cache": False,
            "feature_branding": False, "feature_custom_subdomain": False, "feature_priority_support": False,
            "marketing_features": "До 5 пользователей;500 задач;10 проектов;Kanban/Таблица/Календарь;Мессенджер",
        },
        {
            "key": "plan_a", "title": "Plan A", "tagline": "Мощная система управления задачами и проектами",
            "price_month": 4, "currency": "USD", "max_users": 99, "max_projects": None, "sort_order": 2,
            "feature_export": True, "feature_import": True, "feature_invitations": True,
            "feature_lead_forms": True, "feature_analytics_cache": True,
            "feature_branding": False, "feature_custom_subdomain": False, "feature_priority_support": False,
            "marketing_features": (
                "1–99 пользователей;Неограниченно задач/проектов;"
                "Массовые операции;Связи и последовательные задачи;"
                "Диаграмма Ганта;Расписание;Отчёты и графики;Таймер учёта времени"
            ),
        },
        {
            "key": "plan_b", "title": "Plan B", "tagline": "Система управления бизнесом для всей компании",
            "price_month": 6, "currency": "USD", "max_users": 250, "max_projects": None, "sort_order": 3,
            "feature_export": True, "feature_import": True, "feature_invitations": True,
            "feature_lead_forms": True, "feature_analytics_cache": True,
            "feature_branding": True, "feature_custom_subdomain": False, "feature_priority_support": True,
            "marketing_features": (
                "Всё из Plan A + расширенная автоматизация;"
                "Вычисляемые поля, кнопки, группы кнопок;"
                "Кастомный интерфейс: логотип и корпоративные цвета;"
                "Доступ руководителя к задачам подчинённых;"
                "Логирование операций сотрудников;"
                "Автоматическая генерация отчётов по расписанию;"
                "Телефония с распознаванием разговоров"
            ),
        },
        {
            "key": "plan_x", "title": "Plan X", "tagline": "Корпоративный уровень: безопасность и контроль",
            "price_month": 8, "currency": "USD", "max_users": None, "max_projects": None, "sort_order": 4,
            "feature_export": True, "feature_import": True, "feature_invitations": True,
            "feature_lead_forms": True, "feature_analytics_cache": True,
            "feature_branding": True, "feature_custom_subdomain": True, "feature_priority_support": True,
            "marketing_features": (
                "Всё из Plan B + максимальная кастомизация;"
                "Технические администраторы без доступа к данным;"
                "SSO SAML 2.0;"
                "Ограничение доступа по IP;"
                "Парольные политики;"
                "Расширенное логирование просмотра и изменения данных"
            ),
        },
    ]
    for pd in plans_data:
        p = db.query(Plan).filter(Plan.key == pd["key"]).first()
        if not p:
            db.add(Plan(**pd))
        else:
            for k, v in pd.items():
                setattr(p, k, v)
    db.commit()


def seed_integration_providers(db) -> None:
    """Витрина возможных интеграций (глобальные, tenant_id=NULL)."""
    from .models import IntegrationProvider
    providers = [
        ("google_drive", "Google Drive", "storage", "available"),
        ("dropbox", "Dropbox", "storage", "available"),
        ("onedrive", "OneDrive", "storage", "coming_soon"),
        ("google_forms", "Google Forms", "marketing", "coming_soon"),
        ("mailchimp", "Mailchimp", "marketing", "coming_soon"),
        ("unisender", "Unisender", "marketing", "coming_soon"),
        ("viber", "Viber", "messenger", "coming_soon"),
        ("tiktok", "TikTok", "social", "coming_soon"),
        ("facebook_lead_ads", "Facebook Lead Ads", "marketing", "coming_soon"),
        ("google_maps", "Google Maps", "other", "coming_soon"),
        ("google_calendar", "Google Calendar", "storage", "available"),
        ("twilio", "Twilio", "telephony", "beta"),
    ]
    for code, label, cat, status in providers:
        p = db.query(IntegrationProvider).filter(IntegrationProvider.tenant_id.is_(None), IntegrationProvider.code == code).first()
        if not p:
            db.add(IntegrationProvider(tenant_id=None, code=code, label=label, category=cat, status=status))
        else:
            p.label = label
            p.category = cat
            p.status = status
    db.commit()


def main() -> None:
    wait_for_db()
    run_migrations()

    with SessionLocal() as db:
        sync_permissions(db)
        seed_roles(db)
        seed_plans(db)
        seed_integration_providers(db)
        tenant = seed_default_tenant(db)
        _ensure_tenant_roles(db, tenant.id)
        seed_admin(db, tenant)

    migrate_uploads_to_tenant_dirs()

    print("[bootstrap] Done.")


if __name__ == "__main__":
    main()
