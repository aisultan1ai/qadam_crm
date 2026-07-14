from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List

from ..database import get_db
from ..models import Role, Permission, User
from ..models.role import user_roles
from ..core.permissions import PERMISSIONS
from ..schemas.role import RoleOut, RoleCreate, RoleUpdate, PermissionGroupOut, PermissionOut
from ..schemas.common import Message
from .deps import require, get_current_user, log_action

router = APIRouter(prefix="/api", tags=["roles"])


def _role_out(db: Session, role: Role) -> RoleOut:
    users_count = db.query(func.count()).select_from(user_roles).filter(user_roles.c.role_id == role.id).scalar() or 0
    return RoleOut.model_validate(role).model_copy(update={"users_count": users_count})


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
def list_roles(_: User = Depends(require("roles.manage")), db: Session = Depends(get_db)):
    roles = db.query(Role).order_by(Role.id).all()
    return [_role_out(db, r) for r in roles]


@router.get("/roles/{role_id}", response_model=RoleOut)
def get_role(role_id: int, _: User = Depends(require("roles.manage")), db: Session = Depends(get_db)):
    role = db.get(Role, role_id)
    if not role:
        raise HTTPException(404, "Роль не найдена")
    return _role_out(db, role)


@router.post("/roles", response_model=RoleOut, status_code=201)
def create_role(payload: RoleCreate, user: User = Depends(require("roles.manage")), db: Session = Depends(get_db)):
    if db.query(Role).filter(Role.name == payload.name).first():
        raise HTTPException(400, "Роль с таким названием уже существует")
    role = Role(name=payload.name, description=payload.description)
    if payload.permission_codes:
        perms = db.query(Permission).filter(Permission.code.in_(payload.permission_codes)).all()
        role.permissions = perms
    db.add(role)
    db.flush()
    log_action(db, user_id=user.id, action="create", entity="role", entity_id=role.id, detail=role.name)
    db.commit()
    db.refresh(role)
    return _role_out(db, role)


@router.patch("/roles/{role_id}", response_model=RoleOut)
def update_role(role_id: int, payload: RoleUpdate, user: User = Depends(require("roles.manage")), db: Session = Depends(get_db)):
    role = db.get(Role, role_id)
    if not role:
        raise HTTPException(404, "Роль не найдена")
    if payload.name is not None and payload.name != role.name:
        if db.query(Role).filter(Role.name == payload.name).first():
            raise HTTPException(400, "Роль с таким названием уже существует")
        role.name = payload.name
    if payload.description is not None:
        role.description = payload.description
    if payload.permission_codes is not None:
        perms = db.query(Permission).filter(Permission.code.in_(payload.permission_codes)).all()
        role.permissions = perms
    log_action(db, user_id=user.id, action="update", entity="role", entity_id=role.id)
    db.commit()
    db.refresh(role)
    return _role_out(db, role)


@router.delete("/roles/{role_id}", response_model=Message)
def delete_role(role_id: int, user: User = Depends(require("roles.manage")), db: Session = Depends(get_db)):
    role = db.get(Role, role_id)
    if not role:
        raise HTTPException(404, "Роль не найдена")
    users_count = db.query(func.count()).select_from(user_roles).filter(user_roles.c.role_id == role.id).scalar() or 0
    if users_count > 0:
        raise HTTPException(400, "Нельзя удалить роль, назначенную пользователям")
    log_action(db, user_id=user.id, action="delete", entity="role", entity_id=role.id, detail=role.name)
    db.delete(role)
    db.commit()
    return Message(message="Роль удалена")


@router.post("/roles/{role_id}/copy", response_model=RoleOut, status_code=201)
def copy_role(role_id: int, user: User = Depends(require("roles.manage")), db: Session = Depends(get_db)):
    role = db.get(Role, role_id)
    if not role:
        raise HTTPException(404, "Роль не найдена")
    base_name = f"{role.name} (копия)"
    name = base_name
    i = 2
    while db.query(Role).filter(Role.name == name).first():
        name = f"{base_name} {i}"
        i += 1
    new_role = Role(name=name, description=role.description, permissions=list(role.permissions))
    db.add(new_role)
    db.flush()
    log_action(db, user_id=user.id, action="copy", entity="role", entity_id=new_role.id, detail=name)
    db.commit()
    db.refresh(new_role)
    return _role_out(db, new_role)
