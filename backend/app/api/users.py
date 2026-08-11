import os
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import User, Role, Department, TenantMembership
from ..core.security import hash_password, verify_password
from ..core.plans import check_user_limit
from ..schemas.user import UserOut, UserCreate, UserUpdate, MeUpdate, DepartmentOut, DepartmentCreate
from ..schemas.common import Message, Page, PageParams, page_params, paginate
from .deps import TenantContext, require, get_current_user, get_current_context, log_action

router = APIRouter(prefix="/api", tags=["users"])

AVATAR_URL_PREFIX_LEGACY = "/media/avatars/"
AVATAR_URL_MEDIA_ROOT = "/media/"
AVATAR_EXT_BY_MIME = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
AVATAR_CHUNK = 256 * 1024


def _avatar_file_path(avatar_url: Optional[str]) -> Optional[Path]:
    """Резолвит путь к файлу аватара из URL.
    - Новый формат: /media/{tenant_id}/avatars/{stored}.
    - Legacy: /media/avatars/{stored} (файлы до миграции per-tenant).
    """
    if not avatar_url:
        return None
    if avatar_url.startswith(AVATAR_URL_PREFIX_LEGACY):
        return Path(settings.UPLOAD_DIR) / "avatars" / avatar_url[len(AVATAR_URL_PREFIX_LEGACY):]
    if avatar_url.startswith(AVATAR_URL_MEDIA_ROOT):
        return Path(settings.UPLOAD_DIR) / avatar_url[len(AVATAR_URL_MEDIA_ROOT):]
    return None


def _load_tenant_user(db: Session, tenant_id: int, user_id: int) -> User:
    """Загружает пользователя и проверяет его членство в tenant'е.

    404 если пользователя нет или он не член tenant'а — чтобы не палить чужие id.
    """
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    is_member = (
        db.query(TenantMembership.id)
        .filter(TenantMembership.tenant_id == tenant_id, TenantMembership.user_id == user_id)
        .first()
    )
    if not is_member:
        raise HTTPException(404, "Пользователь не найден")
    return user


def _tenant_roles_query(db: Session, tenant_id: int, role_ids: list[int]):
    """Роли, доступные для назначения в tenant'е: собственные роли tenant'а
    плюс системные шаблоны (tenant_id IS NULL).
    """
    return (
        db.query(Role)
        .filter(
            Role.id.in_(role_ids),
            or_(Role.tenant_id == tenant_id, Role.tenant_id.is_(None)),
        )
    )


@router.get("/users", response_model=Page[UserOut])
def list_users(
    q: Optional[str] = None,
    role_id: Optional[int] = None,
    is_active: Optional[bool] = None,
    pagination: PageParams = Depends(page_params),
    ctx: TenantContext = Depends(require("users.view")),
    db: Session = Depends(get_db),
):
    # Показываем только тех, кто состоит в текущем tenant'е.
    query = (
        db.query(User)
        .join(TenantMembership, TenantMembership.user_id == User.id)
        .filter(TenantMembership.tenant_id == ctx.tenant.id)
    )
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(User.name.ilike(like), User.email.ilike(like)))
    if is_active is not None:
        query = query.filter(User.is_active == is_active)
    if role_id:
        query = query.join(User.roles).filter(Role.id == role_id)
    query = query.order_by(User.id)
    return paginate(query, pagination)


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(payload: UserCreate, ctx: TenantContext = Depends(require("users.create")), db: Session = Depends(get_db)):
    actor = ctx.user
    check_user_limit(db, ctx.tenant)
    email = payload.email.lower()
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        # Пользователь уже есть глобально. Проверим, не член ли он этой компании.
        already_member = (
            db.query(TenantMembership.id)
            .filter(TenantMembership.tenant_id == ctx.tenant.id, TenantMembership.user_id == existing.id)
            .first()
        )
        if already_member:
            raise HTTPException(400, "Пользователь с таким email уже в компании")
        raise HTTPException(400, "Пользователь с таким email уже существует")

    # Департамент должен принадлежать текущему tenant'у.
    if payload.department_id is not None:
        dep = db.get(Department, payload.department_id)
        if not dep or dep.tenant_id != ctx.tenant.id:
            raise HTTPException(400, "Отдел не найден в этой компании")

    user = User(
        email=email,
        name=payload.name,
        password_hash=hash_password(payload.password),
        is_active=payload.is_active,
        avatar_url=payload.avatar_url,
        department_id=payload.department_id,
    )
    if payload.role_ids:
        user.roles = _tenant_roles_query(db, ctx.tenant.id, payload.role_ids).all()
    db.add(user)
    db.flush()
    # Добавляем в текущий tenant.
    db.add(TenantMembership(tenant_id=ctx.tenant.id, user_id=user.id, is_owner=False))
    log_action(db, tenant_id=ctx.tenant.id, user_id=actor.id, action="create", entity="user", entity_id=user.id, detail=user.email)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/users/me", response_model=UserOut)
def update_me(payload: MeUpdate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    user = ctx.user
    changes: list[str] = []
    email_changing = payload.email is not None and payload.email.lower() != user.email
    password_changing = payload.new_password is not None

    if email_changing or password_changing:
        if not payload.current_password or not verify_password(payload.current_password, user.password_hash):
            raise HTTPException(400, "Неверный текущий пароль")

    if email_changing:
        new_email = payload.email.lower()
        if db.query(User).filter(User.email == new_email, User.id != user.id).first():
            raise HTTPException(400, "Email уже используется")
        user.email = new_email
        changes.append("email")

    if payload.name is not None and payload.name != user.name:
        user.name = payload.name
        changes.append("имя")

    if password_changing:
        user.password_hash = hash_password(payload.new_password)
        changes.append("пароль")

    if changes:
        log_action(db, tenant_id=ctx.tenant.id, user_id=user.id, action="update", entity="user", entity_id=user.id, detail=", ".join(changes))
    db.commit()
    db.refresh(user)
    return user


@router.post("/users/me/avatar", response_model=UserOut)
def upload_my_avatar(
    file: UploadFile = File(...),
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    user = ctx.user
    if not file.content_type or file.content_type not in AVATAR_EXT_BY_MIME:
        raise HTTPException(400, "Разрешены только JPEG, PNG, WebP или GIF")

    ext = AVATAR_EXT_BY_MIME[file.content_type]

    avatars_dir = Path(settings.UPLOAD_DIR) / str(ctx.tenant.id) / "avatars"
    avatars_dir.mkdir(parents=True, exist_ok=True)

    stored = f"{uuid.uuid4().hex}{ext}"
    dest = avatars_dir / stored

    written = 0
    try:
        with dest.open("wb") as out:
            while True:
                chunk = file.file.read(AVATAR_CHUNK)
                if not chunk:
                    break
                written += len(chunk)
                if written > settings.MAX_AVATAR_BYTES:
                    out.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(413, f"Файл слишком большой (макс {settings.MAX_AVATAR_BYTES // (1024 * 1024)} МБ)")
                out.write(chunk)
    except HTTPException:
        raise
    except Exception:
        dest.unlink(missing_ok=True)
        raise HTTPException(500, "Не удалось сохранить файл")

    if written == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, "Пустой файл")

    old = _avatar_file_path(user.avatar_url)
    if old and old.exists():
        try:
            os.remove(old)
        except OSError:
            pass

    user.avatar_url = f"{AVATAR_URL_MEDIA_ROOT}{ctx.tenant.id}/avatars/{stored}"
    log_action(db, tenant_id=ctx.tenant.id, user_id=user.id, action="update", entity="user", entity_id=user.id, detail="avatar")
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/me/avatar", response_model=UserOut)
def delete_my_avatar(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    user = ctx.user
    old = _avatar_file_path(user.avatar_url)
    if old and old.exists():
        try:
            os.remove(old)
        except OSError:
            pass
    user.avatar_url = None
    log_action(db, tenant_id=ctx.tenant.id, user_id=user.id, action="update", entity="user", entity_id=user.id, detail="avatar_removed")
    db.commit()
    db.refresh(user)
    return user


@router.get("/users/{user_id}", response_model=UserOut)
def get_user(user_id: int, ctx: TenantContext = Depends(require("users.view")), db: Session = Depends(get_db)):
    return _load_tenant_user(db, ctx.tenant.id, user_id)


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(user_id: int, payload: UserUpdate, ctx: TenantContext = Depends(require("users.update")), db: Session = Depends(get_db)):
    actor = ctx.user
    user = _load_tenant_user(db, ctx.tenant.id, user_id)
    if payload.email is not None:
        new_email = payload.email.lower()
        if new_email != user.email and db.query(User).filter(User.email == new_email).first():
            raise HTTPException(400, "Email уже используется")
        user.email = new_email
    if payload.name is not None:
        user.name = payload.name
    if payload.password:
        user.password_hash = hash_password(payload.password)
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.avatar_url is not None:
        user.avatar_url = payload.avatar_url
    if payload.department_id is not None:
        if payload.department_id:
            dep = db.get(Department, payload.department_id)
            if not dep or dep.tenant_id != ctx.tenant.id:
                raise HTTPException(400, "Отдел не найден в этой компании")
            user.department_id = payload.department_id
        else:
            user.department_id = None
    if payload.role_ids is not None:
        user.roles = _tenant_roles_query(db, ctx.tenant.id, payload.role_ids).all()
    log_action(db, tenant_id=ctx.tenant.id, user_id=actor.id, action="update", entity="user", entity_id=user.id)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}", response_model=Message)
def delete_user(user_id: int, ctx: TenantContext = Depends(require("users.delete")), db: Session = Depends(get_db)):
    actor = ctx.user
    user = _load_tenant_user(db, ctx.tenant.id, user_id)
    if user.id == actor.id:
        raise HTTPException(400, "Нельзя удалить самого себя")
    if user.is_superuser:
        raise HTTPException(400, "Нельзя удалить суперпользователя")
    # Удаляем только членство в текущем tenant'е (юзер глобальный, может состоять в других).
    db.query(TenantMembership).filter(
        TenantMembership.tenant_id == ctx.tenant.id,
        TenantMembership.user_id == user.id,
    ).delete(synchronize_session=False)
    log_action(db, tenant_id=ctx.tenant.id, user_id=actor.id, action="delete", entity="user", entity_id=user.id, detail=user.email)
    db.commit()
    return Message(message="Пользователь удалён из компании")


@router.get("/departments", response_model=List[DepartmentOut])
def list_departments(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    return (
        db.query(Department)
        .filter(Department.tenant_id == ctx.tenant.id)
        .order_by(Department.name)
        .all()
    )


@router.post("/departments", response_model=DepartmentOut, status_code=201)
def create_department(payload: DepartmentCreate, ctx: TenantContext = Depends(require("settings.dictionaries")), db: Session = Depends(get_db)):
    exists = (
        db.query(Department)
        .filter(Department.tenant_id == ctx.tenant.id, Department.name == payload.name)
        .first()
    )
    if exists:
        raise HTTPException(400, "Отдел с таким названием уже существует")
    dep = Department(tenant_id=ctx.tenant.id, name=payload.name)
    db.add(dep)
    db.commit()
    db.refresh(dep)
    return dep


@router.delete("/departments/{department_id}", response_model=Message)
def delete_department(department_id: int, ctx: TenantContext = Depends(require("settings.dictionaries")), db: Session = Depends(get_db)):
    dep = db.get(Department, department_id)
    if not dep or dep.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Отдел не найден")
    db.delete(dep)
    db.commit()
    return Message(message="Отдел удалён")
