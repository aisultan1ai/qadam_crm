"""Helpers для создания tenant'а и подготовки его окружения (роли, membership).

Используются в bootstrap, при регистрации новой компании (L3.1) и при
приёме приглашения новым пользователем (L3.2).
"""
from __future__ import annotations

from slugify import slugify
from sqlalchemy.orm import Session

from ..models import Project, Role, Task, Tenant, TenantMembership, User
from ..models.task import TaskPriority, TaskStatus

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


SAMPLE_PROJECT_NAME = "Пример проекта"
SAMPLE_TASKS: list[dict] = [
    {
        "title": "Пригласите первых сотрудников",
        "status": TaskStatus.new,
        "priority": TaskPriority.high,
        "description": "Настройки → Команда → отправьте инвайт по email. Каждому можно выдать роль (Администратор/Менеджер/Сотрудник).",
    },
    {
        "title": "Создайте свой первый настоящий проект",
        "status": TaskStatus.new,
        "priority": TaskPriority.medium,
        "description": "Проекты объединяют задачи и участников. Раздел «Проекты» → «Новый проект».",
    },
    {
        "title": "Перетащите эту задачу в колонку «В работе»",
        "status": TaskStatus.new,
        "priority": TaskPriority.low,
        "description": "На доске Kanban можно менять статусы drag-and-drop. Попробуйте прямо сейчас.",
    },
    {
        "title": "Готово — можно удалять пример",
        "status": TaskStatus.done,
        "priority": TaskPriority.low,
        "description": "Когда разберётесь с интерфейсом — удалите этот проект (Проекты → «...» → Удалить).",
    },
]


def create_sample_project(db: Session, *, tenant: Tenant, owner: User) -> Project:
    """Создать образцовый проект с 4 задачами для нового tenant'а.

    Идемпотентно: если проект с таким именем уже есть в tenant — возвращает его.
    """
    existing = (
        db.query(Project)
        .filter(Project.tenant_id == tenant.id, Project.name == SAMPLE_PROJECT_NAME)
        .first()
    )
    if existing:
        return existing

    project = Project(
        tenant_id=tenant.id,
        name=SAMPLE_PROJECT_NAME,
        description="Проект-пример. Разберитесь с задачами и удалите — или используйте как шаблон.",
        color="#0f67fd",
        owner_id=owner.id,
    )
    db.add(project)
    db.flush()

    for i, t in enumerate(SAMPLE_TASKS):
        db.add(Task(
            tenant_id=tenant.id,
            project_id=project.id,
            title=t["title"],
            description=t["description"],
            status=t["status"],
            priority=t["priority"],
            author_id=owner.id,
            assignee_id=owner.id,
            order_index=i,
        ))
    db.flush()
    return project
