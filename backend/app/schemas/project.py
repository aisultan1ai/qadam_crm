from pydantic import BaseModel, ConfigDict
from typing import List, Optional
from datetime import date, datetime

from .user import UserBrief


class ProjectBase(BaseModel):
    name: str
    description: Optional[str] = None
    color: Optional[str] = None
    start_date: Optional[date] = None
    deadline: Optional[date] = None


class ProjectCreate(ProjectBase):
    owner_id: Optional[int] = None
    member_ids: List[int] = []


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    start_date: Optional[date] = None
    deadline: Optional[date] = None
    owner_id: Optional[int] = None
    member_ids: Optional[List[int]] = None
    is_archived: Optional[bool] = None


class ProjectOut(ProjectBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_archived: bool
    created_at: datetime
    owner: Optional[UserBrief] = None
    members: List[UserBrief] = []
    tasks_count: int = 0
