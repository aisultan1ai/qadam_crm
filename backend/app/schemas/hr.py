"""Pydantic-схемы для M11 (HR-профили + оргструктура)."""
from datetime import date, datetime
from decimal import Decimal
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from .user import UserBrief


# ==================== Skills ====================

class SkillOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    category: Optional[str] = None


class SkillCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    category: Optional[str] = Field(default=None, max_length=50)


class SkillUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    category: Optional[str] = Field(default=None, max_length=50)


class UserSkillOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    skill_id: int
    skill: SkillOut
    level: Literal["novice", "intermediate", "expert"]


class UserSkillAssign(BaseModel):
    skill_id: int
    level: Literal["novice", "intermediate", "expert"] = "intermediate"


# ==================== Goals ====================

class GoalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    title: str
    description: Optional[str] = None
    target_value: Optional[Decimal] = None
    current_value: Optional[Decimal] = None
    unit: Optional[str] = None
    deadline: Optional[date] = None
    status: Literal["not_started", "in_progress", "completed", "cancelled"]
    created_by_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None


class GoalCreate(BaseModel):
    user_id: int
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    target_value: Optional[Decimal] = None
    current_value: Optional[Decimal] = None
    unit: Optional[str] = Field(default=None, max_length=30)
    deadline: Optional[date] = None
    status: Literal["not_started", "in_progress", "completed", "cancelled"] = "not_started"


class GoalUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    target_value: Optional[Decimal] = None
    current_value: Optional[Decimal] = None
    unit: Optional[str] = Field(default=None, max_length=30)
    deadline: Optional[date] = None
    status: Optional[Literal["not_started", "in_progress", "completed", "cancelled"]] = None


# ==================== One-on-Ones ====================

class OneOnOneOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    manager_id: int
    report_id: int
    scheduled_at: datetime
    duration_min: int
    agenda: Optional[str] = None
    notes_manager: Optional[str] = None
    notes_report: Optional[str] = None
    is_completed: bool
    completed_at: Optional[datetime] = None
    created_at: datetime


class OneOnOneCreate(BaseModel):
    report_id: int
    scheduled_at: datetime
    duration_min: int = Field(default=30, ge=5, le=480)
    agenda: Optional[str] = None


class OneOnOneUpdate(BaseModel):
    scheduled_at: Optional[datetime] = None
    duration_min: Optional[int] = Field(default=None, ge=5, le=480)
    agenda: Optional[str] = None
    notes_manager: Optional[str] = None
    notes_report: Optional[str] = None
    is_completed: Optional[bool] = None


# ==================== Kudos ====================

class KudosOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    from_user_id: int
    to_user_id: int
    from_user: Optional[UserBrief] = None
    to_user: Optional[UserBrief] = None
    message: str
    badge: Literal["teamwork", "innovation", "help_other", "excellence"]
    created_at: datetime


class KudosCreate(BaseModel):
    to_user_id: int
    message: str = Field(..., min_length=1, max_length=500)
    badge: Literal["teamwork", "innovation", "help_other", "excellence"] = "teamwork"


# ==================== Org-chart + birthdays ====================

class OrgChartUser(BaseModel):
    id: int
    name: str
    email: str
    avatar_url: Optional[str] = None
    position: Optional[str] = None
    department_id: Optional[int] = None
    manager_id: Optional[int] = None


class OrgChartDepartment(BaseModel):
    id: int
    name: str
    parent_id: Optional[int] = None
    head_user_id: Optional[int] = None


class OrgChartOut(BaseModel):
    users: List[OrgChartUser]
    departments: List[OrgChartDepartment]


class BirthdayUser(BaseModel):
    id: int
    name: str
    avatar_url: Optional[str] = None
    position: Optional[str] = None
    department: Optional[str] = None
    birthday: date  # без года — но храним как date, отдаём как есть
    days_until: int
