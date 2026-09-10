from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime

from ..database import get_db
from ..models import ActivityLog
from ..schemas.common import Page, PageParams, page_params, paginate
from .deps import TenantContext, get_current_context
from pydantic import BaseModel, ConfigDict


router = APIRouter(prefix="/api/activity", tags=["activity"])


class ActorBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    avatar_url: Optional[str] = None


class ActivityItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    action: str
    entity: Optional[str]
    entity_id: Optional[int]
    task_id: Optional[int]
    detail: Optional[str]
    created_at: datetime
    user: Optional[ActorBrief] = None


@router.get("", response_model=Page[ActivityItemOut])
def list_activity(
    entity: Optional[str] = None,
    user_id: Optional[int] = None,
    action: Optional[str] = None,
    pagination: PageParams = Depends(page_params),
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    q = db.query(ActivityLog).filter(ActivityLog.tenant_id == ctx.tenant.id)
    if entity:
        q = q.filter(ActivityLog.entity == entity)
    if user_id is not None:
        q = q.filter(ActivityLog.user_id == user_id)
    if action:
        q = q.filter(ActivityLog.action == action)
    q = q.order_by(ActivityLog.created_at.desc())
    return paginate(q, pagination)
