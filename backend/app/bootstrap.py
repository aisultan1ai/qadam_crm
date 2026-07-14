"""Create tables (if missing) and seed baseline data.

Runs once on backend start via docker-compose command.
Idempotent.
"""
from __future__ import annotations

import time
from sqlalchemy import inspect
from sqlalchemy.exc import OperationalError

from .database import Base, engine, SessionLocal
from . import models  # noqa: F401 -- register models
from .models import Role, Permission, User, Project, Task
from .models.task import TaskStatus, TaskPriority
from .core.security import hash_password
from .core.permissions import PERMISSIONS


def wait_for_db(retries: int = 30, delay: float = 1.0) -> None:
    for i in range(retries):
        try:
            with engine.connect() as conn:
                conn.execute(__import__("sqlalchemy").text("select 1"))
            return
        except OperationalError:
            print(f"[bootstrap] DB not ready, retry {i+1}/{retries}")
            time.sleep(delay)
    raise RuntimeError("Database is not reachable")


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
    all_perms = {p.code: p for p in db.query(Permission).all()}

    def ensure_role(name: str, description: str, codes: list[str]) -> Role:
        role = db.query(Role).filter(Role.name == name).first()
        if not role:
            role = Role(name=name, description=description)
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


def seed_admin(db) -> User:
    admin = db.query(User).filter(User.email == "admin@qadam.local").first()
    if admin:
        return admin
    role_admin = db.query(Role).filter(Role.name == "Администратор").first()
    admin = User(
        email="admin@qadam.local",
        name="Администратор",
        password_hash=hash_password("admin123"),
        is_active=True,
        is_superuser=True,
        roles=[role_admin] if role_admin else [],
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def seed_demo(db, admin: User) -> None:
    if db.query(User).count() > 1:
        return

    role_manager = db.query(Role).filter(Role.name == "Менеджер").first()
    role_employee = db.query(Role).filter(Role.name == "Сотрудник").first()

    manager = User(
        email="manager@qadam.local",
        name="Мария Менеджер",
        password_hash=hash_password("manager123"),
        is_active=True,
        roles=[role_manager] if role_manager else [],
    )
    employee = User(
        email="employee@qadam.local",
        name="Иван Сотрудник",
        password_hash=hash_password("employee123"),
        is_active=True,
        roles=[role_employee] if role_employee else [],
    )
    db.add_all([manager, employee])
    db.flush()

    project = Project(
        name="Запуск нового сайта",
        description="Ребрендинг корпоративного сайта: дизайн, разработка, тестирование.",
        color="#6366f1",
        owner_id=manager.id,
        members=[admin, manager, employee],
    )
    db.add(project)
    db.flush()

    demo_tasks = [
        ("Собрать требования", TaskStatus.done, TaskPriority.high, employee.id),
        ("Разработать макеты", TaskStatus.review, TaskPriority.high, manager.id),
        ("Свёрстка главной страницы", TaskStatus.in_progress, TaskPriority.medium, employee.id),
        ("Настроить CI/CD", TaskStatus.new, TaskPriority.medium, employee.id),
        ("Провести нагрузочное тестирование", TaskStatus.new, TaskPriority.critical, manager.id),
    ]
    for i, (title, status, priority, assignee_id) in enumerate(demo_tasks):
        db.add(Task(
            title=title,
            description=f"Демо-задача: {title}",
            status=status,
            priority=priority,
            project_id=project.id,
            assignee_id=assignee_id,
            author_id=admin.id,
            order_index=i,
        ))
    db.commit()


def main() -> None:
    wait_for_db()

    # Create tables that do not yet exist. For real deployments consider Alembic.
    inspector = inspect(engine)
    if not inspector.has_table("users"):
        print("[bootstrap] Creating database schema")
    Base.metadata.create_all(bind=engine)

    with SessionLocal() as db:
        sync_permissions(db)
        seed_roles(db)
        admin = seed_admin(db)
        seed_demo(db, admin)

    print("[bootstrap] Done. Login: admin@qadam.local / admin123")


if __name__ == "__main__":
    main()
