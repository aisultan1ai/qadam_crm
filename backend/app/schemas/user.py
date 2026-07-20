import re
from pydantic import BaseModel, ConfigDict, Field, field_validator
EmailStr = str  # relaxed: avoid rejecting .local / internal TLDs
from typing import List, Optional
from datetime import datetime

from .role import RoleOut


PASSWORD_MIN_LEN = 8
PASSWORD_MAX_LEN = 128


def _validate_password(value: str) -> str:
    if len(value) < PASSWORD_MIN_LEN:
        raise ValueError(f"Пароль должен содержать не менее {PASSWORD_MIN_LEN} символов")
    if len(value) > PASSWORD_MAX_LEN:
        raise ValueError(f"Пароль слишком длинный (макс {PASSWORD_MAX_LEN} символов)")
    if not re.search(r"[A-Za-zА-Яа-яЁё]", value):
        raise ValueError("Пароль должен содержать хотя бы одну букву")
    if not re.search(r"\d", value):
        raise ValueError("Пароль должен содержать хотя бы одну цифру")
    if value.strip() != value:
        raise ValueError("Пароль не должен начинаться или заканчиваться пробелом")
    return value


class DepartmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class DepartmentCreate(BaseModel):
    name: str


class UserBase(BaseModel):
    email: EmailStr
    name: str
    is_active: bool = True
    department_id: Optional[int] = None
    avatar_url: Optional[str] = None


class UserCreate(UserBase):
    password: str = Field(..., min_length=PASSWORD_MIN_LEN, max_length=PASSWORD_MAX_LEN)
    role_ids: List[int] = []

    @field_validator("password")
    @classmethod
    def _password_strength(cls, v: str) -> str:
        return _validate_password(v)


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    name: Optional[str] = None
    password: Optional[str] = Field(default=None, min_length=PASSWORD_MIN_LEN, max_length=PASSWORD_MAX_LEN)
    is_active: Optional[bool] = None
    department_id: Optional[int] = None
    avatar_url: Optional[str] = None
    role_ids: Optional[List[int]] = None

    @field_validator("password")
    @classmethod
    def _password_strength(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        return _validate_password(v)


class MeUpdate(BaseModel):
    email: Optional[EmailStr] = None
    name: Optional[str] = None
    new_password: Optional[str] = Field(default=None, min_length=PASSWORD_MIN_LEN, max_length=PASSWORD_MAX_LEN)
    current_password: Optional[str] = None

    @field_validator("new_password")
    @classmethod
    def _password_strength(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        return _validate_password(v)


class UserOut(UserBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_superuser: bool
    roles: List[RoleOut] = []
    department: Optional[DepartmentOut] = None
    last_login_at: Optional[datetime] = None
    created_at: datetime


class UserBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: EmailStr
    avatar_url: Optional[str] = None


class MeOut(UserOut):
    permissions: List[str] = []
