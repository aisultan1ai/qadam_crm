"""Публичный приём лидов с лендинга.

Форма на landing page → POST /api/leads без auth. Rate-limit по IP чтобы боты
не забивали таблицу. Платформенный админ может смотреть заявки в списке.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import desc
from sqlalchemy.orm import Session

from ..core.limiter import limiter
from ..database import get_db
from ..models import Lead, User
from .admin import require_platform_admin
from .deps import log_action

router = APIRouter(prefix="/api/leads", tags=["leads"])

ALLOWED_TEAM_SIZES = {"1-5", "5-20", "20-50", "50+"}
ALLOWED_STATUSES = {"new", "contacted", "qualified", "rejected"}


class LeadCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    company: Optional[str] = Field(default=None, max_length=200)
    contact: str = Field(min_length=3, max_length=255)
    team_size: Optional[str] = None
    note: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("team_size")
    @classmethod
    def _validate_team(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        if v not in ALLOWED_TEAM_SIZES:
            raise ValueError(f"team_size must be one of {sorted(ALLOWED_TEAM_SIZES)}")
        return v


class LeadOut(BaseModel):
    id: int
    name: str
    company: Optional[str]
    contact: str
    team_size: Optional[str]
    note: Optional[str]
    source: str
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class LeadUpdate(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def _validate_status(cls, v: str) -> str:
        if v not in ALLOWED_STATUSES:
            raise ValueError(f"status must be one of {sorted(ALLOWED_STATUSES)}")
        return v


@router.post("", response_model=LeadOut, status_code=201)
@limiter.limit("10/hour")
def create_lead(
    request: Request,
    payload: LeadCreate,
    db: Session = Depends(get_db),
):
    """Публичная заявка с лендинга. Без auth. Ограничено 10 заявок/час на IP."""
    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent", "")[:500] or None

    lead = Lead(
        name=payload.name.strip(),
        company=(payload.company or "").strip() or None,
        contact=payload.contact.strip(),
        team_size=payload.team_size,
        note=(payload.note or "").strip() or None,
        source="landing_form",
        status="new",
        ip_address=ip,
        user_agent=ua,
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return lead


@router.get("", response_model=list[LeadOut])
def list_leads(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """Список заявок для платформенного админа."""
    q = db.query(Lead)
    if status_filter:
        if status_filter not in ALLOWED_STATUSES:
            raise HTTPException(400, "unknown status")
        q = q.filter(Lead.status == status_filter)
    return q.order_by(desc(Lead.created_at)).offset(offset).limit(limit).all()


@router.patch("/{lead_id}", response_model=LeadOut)
def update_lead(
    lead_id: int,
    payload: LeadUpdate,
    actor: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Лид не найден")
    lead.status = payload.status
    db.commit()
    db.refresh(lead)
    log_action(
        db,
        tenant_id=None,
        user_id=actor.id,
        action="platform.lead.update_status",
        entity="lead",
        entity_id=lead.id,
        detail=payload.status,
    )
    db.commit()
    return lead
