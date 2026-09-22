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
    is_pinned: bool = False
    is_hidden: bool = False
    is_draft: bool = False
    edit_count: int = 0
    edited_at: Optional[datetime] = None

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


class TaskReminderBase(BaseModel):
    # before_deadline | before_start
    kind: str = "before_deadline"
    offset_minutes: int


class TaskReminderCreate(TaskReminderBase):
    pass


class TaskReminderOut(TaskReminderBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    fired_at: Optional[datetime] = None
    created_at: datetime


class TaskBase(BaseModel):
    title: str
    description: Optional[str] = None
    status: TaskStatus = TaskStatus.new
    priority: TaskPriority = TaskPriority.medium
    project_id: Optional[int] = None
    assignee_id: Optional[int] = None
    start_date: Optional[datetime] = None
    deadline: Optional[datetime] = None


class TaskCreate(TaskBase):
    checklist: List[ChecklistItemCreate] = []
    parent_task_id: Optional[int] = None
    recurrence_rule: Optional[str] = None
    custom_status_id: Optional[int] = None
    custom_data: Optional[dict[str, Any]] = None
    # Planfix-роли (по желанию — при создании можно сразу назначить)
    assignee_ids: Optional[List[int]] = None
    auditor_ids: Optional[List[int]] = None
    participant_ids: Optional[List[int]] = None
    reminders: Optional[List[TaskReminderCreate]] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[TaskStatus] = None
    priority: Optional[TaskPriority] = None
    project_id: Optional[int] = None
    assignee_id: Optional[int] = None
    start_date: Optional[datetime] = None
    deadline: Optional[datetime] = None
    order_index: Optional[int] = None
    parent_task_id: Optional[int] = None
    recurrence_rule: Optional[str] = None
    recurrence_next_at: Optional[datetime] = None
    custom_status_id: Optional[int] = None
    custom_data: Optional[dict[str, Any]] = None


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
    start_date: Optional[datetime] = None
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
    # Planfix-style роли (множественные)
    assignees: List[UserBrief] = []
    auditors: List[UserBrief] = []
    participants: List[UserBrief] = []
    reminders: List[TaskReminderOut] = []
    updated_at: datetime
    parent_task_id: Optional[int] = None
    custom_status_id: Optional[int] = None
    recurrence_rule: Optional[str] = None
    recurrence_parent_id: Optional[int] = None
    recurrence_next_at: Optional[datetime] = None
    inbox_token: Optional[str] = None
    custom_data: dict[str, Any] = {}


class TaskUserRefs(BaseModel):
    """Массовая замена списков ролей для одной задачи."""
    user_ids: List[int]
