from pydantic import BaseModel, ConfigDict, field_validator
from typing import Any, List, Optional
from datetime import datetime

from ..models.task import TaskStatus, TaskPriority
from .user import UserBrief


class ChecklistItemBase(BaseModel):
    text: str
    done: bool = False


class ChecklistItemCreate(ChecklistItemBase):
    pass


class ChecklistItemOut(ChecklistItemBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


class ReactionSummary(BaseModel):
    emoji: str
    count: int
    users: List[UserBrief] = []


class CommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    body: str
    created_at: datetime
    updated_at: datetime
    author: Optional[UserBrief] = None
    reactions: List[ReactionSummary] = []

    @field_validator("reactions", mode="before")
    @classmethod
    def _group_reactions(cls, v: Any) -> Any:
        if not v:
            return []
        # Уже сгруппированы в ReactionSummary
        if isinstance(v, list) and v and isinstance(v[0], dict) and "emoji" in v[0] and "count" in v[0]:
            return v
        buckets: dict[str, dict[str, Any]] = {}
        for r in v:
            emoji = getattr(r, "emoji", None) if not isinstance(r, dict) else r.get("emoji")
            if not emoji:
                continue
            user = getattr(r, "user", None) if not isinstance(r, dict) else r.get("user")
            b = buckets.setdefault(emoji, {"emoji": emoji, "count": 0, "users": []})
            b["count"] += 1
            if user is not None:
                b["users"].append(user)
        return list(buckets.values())


class CommentCreate(BaseModel):
    body: str


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    filename: str
    content_type: Optional[str] = None
    size: int
    created_at: datetime


class ActivityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    action: str
    detail: Optional[str] = None
    created_at: datetime
    user: Optional[UserBrief] = None


class TaskBase(BaseModel):
    title: str
    description: Optional[str] = None
    status: TaskStatus = TaskStatus.new
    priority: TaskPriority = TaskPriority.medium
    project_id: Optional[int] = None
    assignee_id: Optional[int] = None
    deadline: Optional[datetime] = None


class TaskCreate(TaskBase):
    checklist: List[ChecklistItemCreate] = []


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[TaskStatus] = None
    priority: Optional[TaskPriority] = None
    project_id: Optional[int] = None
    assignee_id: Optional[int] = None
    deadline: Optional[datetime] = None
    order_index: Optional[int] = None


class TaskBulkUpdate(BaseModel):
    ids: List[int]
    patch: TaskUpdate


class TaskListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    status: TaskStatus
    priority: TaskPriority
    project_id: Optional[int] = None
    assignee: Optional[UserBrief] = None
    deadline: Optional[datetime] = None
    created_at: datetime
    order_index: int


class TaskOut(TaskListItem):
    description: Optional[str] = None
    author: Optional[UserBrief] = None
    checklist: List[ChecklistItemOut] = []
    comments: List[CommentOut] = []
    attachments: List[AttachmentOut] = []
    activities: List[ActivityOut] = []
    updated_at: datetime
