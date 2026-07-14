from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: str
    title: str
    body: Optional[str] = None
    task_id: Optional[int] = None
    is_read: bool
    created_at: datetime
