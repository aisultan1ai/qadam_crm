import os
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import User, Role, Department
from ..core.security import hash_password
from ..schemas.user import UserOut, UserCreate, UserUpdate, DepartmentOut, DepartmentCreate
from ..schemas.common import Message
from .deps import require, get_current_user, log_action

router = APIRouter(prefix="/api", tags=["users"])

AVATAR_URL_PREFIX = "/media/avatars/"
AVATAR_MAX_BYTES = 5 * 1024 * 1024
AVATAR_EXT_BY_MIME = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def _avatar_file_path(avatar_url: Optional[str]) -> Optional[Path]:
    if not avatar_url or not avatar_url.startswith(AVATAR_URL_PREFIX):
        return None
    return Path(settings.UPLOAD_DIR) / "avatars" / avatar_url[len(AVATAR_URL_PREFIX):]


@router.get("/users", response_model=List[UserOut])
def list_users(
    q: Optional[str] = None,
    role_id: Optional[int] = None,
    is_active: Optional[bool] = None,
    _: User = Depends(require("users.view")),
    db: Session = Depends(get_db),
):
    query = db.query(User)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(User.name.ilike(like), User.email.ilike(like)))
    if is_active is not None:
        query = query.filter(User.is_active == is_active)
    users = query.order_by(User.id).all()
    if role_id:
        users = [u for u in users if any(r.id == role_id for r in u.roles)]
    return users


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(payload: UserCreate, actor: User = Depends(require("users.create")), db: Session = Depends(get_db)):
    email = payload.email.lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(400, "Пользователь с таким email уже существует")
    user = User(
        email=email,
        name=payload.name,
        password_hash=hash_password(payload.password),
        is_active=payload.is_active,
        avatar_url=payload.avatar_url,
        department_id=payload.department_id,
    )
    if payload.role_ids:
        user.roles = db.query(Role).filter(Role.id.in_(payload.role_ids)).all()
    db.add(user)
    db.flush()
    log_action(db, user_id=actor.id, action="create", entity="user", entity_id=user.id, detail=user.email)
    db.commit()
    db.refresh(user)
    return user


@router.post("/users/me/avatar", response_model=UserOut)
def upload_my_avatar(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Требуется файл-изображение")

    content = file.file.read()
    if len(content) > AVATAR_MAX_BYTES:
        raise HTTPException(400, "Файл слишком большой (макс 5 МБ)")

    ext = AVATAR_EXT_BY_MIME.get(file.content_type) or Path(file.filename or "").suffix or ".bin"

    avatars_dir = Path(settings.UPLOAD_DIR) / "avatars"
    avatars_dir.mkdir(parents=True, exist_ok=True)

    old = _avatar_file_path(user.avatar_url)
    if old and old.exists():
        try:
            os.remove(old)
        except OSError:
            pass

    stored = f"{uuid.uuid4().hex}{ext}"
    (avatars_dir / stored).write_bytes(content)

    user.avatar_url = f"{AVATAR_URL_PREFIX}{stored}"
    log_action(db, user_id=user.id, action="update", entity="user", entity_id=user.id, detail="avatar")
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/me/avatar", response_model=UserOut)
def delete_my_avatar(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    old = _avatar_file_path(user.avatar_url)
    if old and old.exists():
        try:
            os.remove(old)
        except OSError:
            pass
    user.avatar_url = None
    log_action(db, user_id=user.id, action="update", entity="user", entity_id=user.id, detail="avatar_removed")
    db.commit()
    db.refresh(user)
    return user


@router.get("/users/{user_id}", response_model=UserOut)
def get_user(user_id: int, _: User = Depends(require("users.view")), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    return user


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(user_id: int, payload: UserUpdate, actor: User = Depends(require("users.update")), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Пользователь не найден")
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
        user.department_id = payload.department_id or None
    if payload.role_ids is not None:
        user.roles = db.query(Role).filter(Role.id.in_(payload.role_ids)).all()
    log_action(db, user_id=actor.id, action="update", entity="user", entity_id=user.id)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}", response_model=Message)
def delete_user(user_id: int, actor: User = Depends(require("users.delete")), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    if user.id == actor.id:
        raise HTTPException(400, "Нельзя удалить самого себя")
    if user.is_superuser:
        raise HTTPException(400, "Нельзя удалить суперпользователя")
    log_action(db, user_id=actor.id, action="delete", entity="user", entity_id=user.id, detail=user.email)
    db.delete(user)
    db.commit()
    return Message(message="Пользователь удалён")


@router.get("/departments", response_model=List[DepartmentOut])
def list_departments(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Department).order_by(Department.name).all()


@router.post("/departments", response_model=DepartmentOut, status_code=201)
def create_department(payload: DepartmentCreate, _: User = Depends(require("settings.dictionaries")), db: Session = Depends(get_db)):
    if db.query(Department).filter(Department.name == payload.name).first():
        raise HTTPException(400, "Отдел с таким названием уже существует")
    dep = Department(name=payload.name)
    db.add(dep)
    db.commit()
    db.refresh(dep)
    return dep


@router.delete("/departments/{department_id}", response_model=Message)
def delete_department(department_id: int, _: User = Depends(require("settings.dictionaries")), db: Session = Depends(get_db)):
    dep = db.get(Department, department_id)
    if not dep:
        raise HTTPException(404, "Отдел не найден")
    db.delete(dep)
    db.commit()
    return Message(message="Отдел удалён")
