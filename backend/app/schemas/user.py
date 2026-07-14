from pydantic import BaseModel, ConfigDict
EmailStr = str  # relaxed: avoid rejecting .local / internal TLDs
from typing import List, Optional
from datetime import datetime

from .role import RoleOut


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
    password: str
    role_ids: List[int] = []


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    name: Optional[str] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None
    department_id: Optional[int] = None
    avatar_url: Optional[str] = None
    role_ids: Optional[List[int]] = None


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
