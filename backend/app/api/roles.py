from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import List

from ..database import get_db
from ..models import Role, Permission, User
from ..models.role import user_roles
from ..core.permissions import PERMISSIONS
from ..schemas.role import RoleOut, RoleCreate, RoleUpdate, PermissionGroupOut, PermissionOut
from ..schemas.common import Message
from .deps import TenantContext, require, get_current_user, log_action

router = APIRouter(prefix="/api", tags=["roles"])


def _role_out(db: Session, role: Role) -> RoleOut:
    users_count = db.query(func.count()).select_from(user_roles).filter(user_roles.c.role_id == role.id).scalar() or 0
    return RoleOut.model_validate(role).model_copy(update={"users_count": users_count})


def _load_editable_role(db: Session, tenant_id: int, role_id: int) -> Role:
    """Загружает роль, редактируемую в текущем tenant'е.

    Системные (tenant_id IS NULL) — read-only, 403.
    Роли других tenant'ов — 404 (не палим).
    """
    role = db.get(Role, role_id)
    if not role:
        raise HTTPException(404, "Роль не найдена")
    if role.tenant_id is None:
        raise HTTPException(403, "Системная роль недоступна для изменения")
    if role.tenant_id != tenant_id:
        raise HTTPException(404, "Роль не найдена")
    return role


def _load_visible_role(db: Session, tenant_id: int, role_id: int) -> Role:
    """Загружает роль, видимую в tenant'е: собственную либо системную."""
    role = db.get(Role, role_id)
    if not role:
        raise HTTPException(404, "Роль не найдена")
    if role.tenant_id is not None and role.tenant_id != tenant_id:
        raise HTTPException(404, "Роль не найдена")
    return role


@router.get("/permissions", response_model=List[PermissionGroupOut])
def list_permissions(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    all_perms = db.query(Permission).all()
    by_group: dict[str, list[Permission]] = {}
    for p in all_perms:
        by_group.setdefault(p.group, []).append(p)
    ordered_groups = list(PERMISSIONS.keys())
    result = []
    for g in ordered_groups:
        if g in by_group:
            items = [PermissionOut.model_validate(p) for p in by_group[g]]
            result.append(PermissionGroupOut(group=g, items=items))
    return result


@router.get("/roles", response_model=List[RoleOut])
def list_roles(ctx: TenantContext = Depends(require("roles.manage")), db: Session = Depends(get_db)):
    # Свои роли tenant'а + системные шаблоны (tenant_id IS NULL) как read-only.
    roles = (
        db.query(Role)
        .filter(or_(Role.tenant_id == ctx.tenant.id, Role.tenant_id.is_(None)))
        .order_by(Role.tenant_id.is_(None).desc(), Role.id)
        .all()
    )
    return [_role_out(db, r) for r in roles]


@router.get("/roles/{role_id}", response_model=RoleOut)
def get_role(role_id: int, ctx: TenantContext = Depends(require("roles.manage")), db: Session = Depends(get_db)):
    role = _load_visible_role(db, ctx.tenant.id, role_id)
    return _role_out(db, role)


@router.post("/roles", response_model=RoleOut, status_code=201)
def create_role(payload: RoleCreate, ctx: TenantContext = Depends(require("roles.manage")), db: Session = Depends(get_db)):
    user = ctx.user
    # Уникальность имени per-tenant (унесено на UniqueConstraint, но проверим для юзерского сообщения)
    exists = (
        db.query(Role)
        .filter(Role.tenant_id == ctx.tenant.id, Role.name == payload.name)
        .first()
    )
    if exists:
        raise HTTPException(400, "Роль с таким названием уже существует")
    role = Role(
        tenant_id=ctx.tenant.id,
        is_system=False,
        name=payload.name,
        description=payload.description,
    )
    if payload.permission_codes:
        perms = db.query(Permission).filter(Permission.code.in_(payload.permission_codes)).all()
        role.permissions = perms
    db.add(role)
    db.flush()
    log_action(db, tenant_id=ctx.tenant.id, user_id=user.id, action="create", entity="role", entity_id=role.id, detail=role.name)
    db.commit()
    db.refresh(role)
    return _role_out(db, role)


@router.patch("/roles/{role_id}", response_model=RoleOut)
def update_role(role_id: int, payload: RoleUpdate, ctx: TenantContext = Depends(require("roles.manage")), db: Session = Depends(get_db)):
    user = ctx.user
    role = _load_editable_role(db, ctx.tenant.id, role_id)
    if payload.name is not None and payload.name != role.name:
        clash = (
            db.query(Role)
            .filter(Role.tenant_id == ctx.tenant.id, Role.name == payload.name, Role.id != role.id)
            .first()
        )
        if clash:
            raise HTTPException(400, "Роль с таким названием уже существует")
        role.name = payload.name
    if payload.description is not None:
        role.description = payload.description
    if payload.permission_codes is not None:
        perms = db.query(Permission).filter(Permission.code.in_(payload.permission_codes)).all()
        role.permissions = perms
    log_action(db, tenant_id=ctx.tenant.id, user_id=user.id, action="update", entity="role", entity_id=role.id)
    db.commit()
    db.refresh(role)
    return _role_out(db, role)


@router.delete("/roles/{role_id}", response_model=Message)
def delete_role(role_id: int, ctx: TenantContext = Depends(require("roles.manage")), db: Session = Depends(get_db)):
    user = ctx.user
    role = _load_editable_role(db, ctx.tenant.id, role_id)
    users_count = db.query(func.count()).select_from(user_roles).filter(user_roles.c.role_id == role.id).scalar() or 0
    if users_count > 0:
        raise HTTPException(400, "Нельзя удалить роль, назначенную пользователям")
    log_action(db, tenant_id=ctx.tenant.id, user_id=user.id, action="delete", entity="role", entity_id=role.id, detail=role.name)
    db.delete(role)
    db.commit()
    return Message(message="Роль удалена")


@router.post("/roles/{role_id}/copy", response_model=RoleOut, status_code=201)
def copy_role(role_id: int, ctx: TenantContext = Depends(require("roles.manage")), db: Session = Depends(get_db)):
    user = ctx.user
    # Копировать можно любую видимую роль (свою или системный шаблон); копия — уже per-tenant.
    role = _load_visible_role(db, ctx.tenant.id, role_id)
    base_name = f"{role.name} (копия)"
    name = base_name
    i = 2
    while (
        db.query(Role)
        .filter(Role.tenant_id == ctx.tenant.id, Role.name == name)
        .first()
    ):
        name = f"{base_name} {i}"
        i += 1
    new_role = Role(
        tenant_id=ctx.tenant.id,
        is_system=False,
        name=name,
        description=role.description,
        permissions=list(role.permissions),
    )
    db.add(new_role)
    db.flush()
    log_action(db, tenant_id=ctx.tenant.id, user_id=user.id, action="copy", entity="role", entity_id=new_role.id, detail=name)
    db.commit()
    db.refresh(new_role)
    return _role_out(db, new_role)
