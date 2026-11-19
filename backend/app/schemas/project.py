from pydantic import BaseModel, ConfigDict
from typing import List, Optional
from datetime import date, datetime

from .user import UserBrief
from .legal_entity import LegalEntityBrief


class ProjectBase(BaseModel):
    name: str
    description: Optional[str] = None
    color: Optional[str] = None
    start_date: Optional[date] = None


class ProjectCreate(ProjectBase):
    owner_id: Optional[int] = None
    member_ids: List[int] = []
    legal_entity_id: Optional[int] = None  # пусто — юрлицо по умолчанию


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    start_date: Optional[date] = None
    owner_id: Optional[int] = None
    member_ids: Optional[List[int]] = None
    is_archived: Optional[bool] = None
    legal_entity_id: Optional[int] = None


class ProjectOut(ProjectBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_archived: bool
    created_at: datetime
    owner: Optional[UserBrief] = None
    members: List[UserBrief] = []
    tasks_count: int = 0
    legal_entity_id: Optional[int] = None
    legal_entity: Optional[LegalEntityBrief] = None
