from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Any, Optional
from datetime import datetime
from pydantic import BaseModel, ConfigDict

from ..database import get_db
from ..models import Whiteboard
from ..schemas.common import Message
from .deps import TenantContext, get_current_context, log_action


router = APIRouter(prefix="/api/whiteboards", tags=["whiteboards"])


class WhiteboardBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    created_at: datetime
    updated_at: datetime


class WhiteboardOut(WhiteboardBrief):
    data: dict[str, Any] = {}


class WhiteboardCreate(BaseModel):
    title: str = "Новая доска"
    data: dict[str, Any] = {}


class WhiteboardUpdate(BaseModel):
    title: Optional[str] = None
    data: Optional[dict[str, Any]] = None


@router.get("", response_model=list[WhiteboardBrief])
def list_boards(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    rows = (
        db.query(Whiteboard)
        .filter(Whiteboard.tenant_id == ctx.tenant.id)
        .order_by(Whiteboard.updated_at.desc())
        .limit(200)
        .all()
    )
    return rows


@router.get("/{wid}", response_model=WhiteboardOut)
def get_board(wid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(Whiteboard, wid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Доска не найдена")
    return row


@router.post("", response_model=WhiteboardOut, status_code=201)
def create_board(payload: WhiteboardCreate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = Whiteboard(
        tenant_id=ctx.tenant.id,
        title=payload.title,
        data=payload.data or {},
        created_by=ctx.user.id,
        updated_by=ctx.user.id,
    )
    db.add(row)
    db.flush()
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="create", entity="whiteboard", entity_id=row.id, detail=row.title)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{wid}", response_model=WhiteboardOut)
def update_board(wid: int, payload: WhiteboardUpdate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(Whiteboard, wid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Доска не найдена")
    if payload.title is not None:
        row.title = payload.title
    if payload.data is not None:
        row.data = payload.data
    row.updated_by = ctx.user.id
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{wid}", response_model=Message)
def delete_board(wid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(Whiteboard, wid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Доска не найдена")
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="delete", entity="whiteboard", entity_id=row.id, detail=row.title)
    db.delete(row)
    db.commit()
    return Message(message="Доска удалена")
