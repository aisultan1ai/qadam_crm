from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from typing import Any, Optional
from datetime import datetime, timezone
from pydantic import BaseModel, ConfigDict

from ..database import get_db
from ..models import Call, Contact
from ..schemas.common import Message, Page, PageParams, page_params, paginate
from .deps import TenantContext, get_current_context, log_action


router = APIRouter(prefix="/api/calls", tags=["telephony"])
webhook_router = APIRouter(prefix="/api/webhooks/telephony", tags=["telephony-webhooks"])


class UserBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    avatar_url: Optional[str] = None


class ContactBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    first_name: str
    last_name: Optional[str] = None


class CallOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    provider: str
    direction: str
    status: str
    from_number: Optional[str] = None
    to_number: Optional[str] = None
    duration_sec: int
    recording_url: Optional[str] = None
    note: Optional[str] = None
    started_at: datetime
    ended_at: Optional[datetime] = None
    user: Optional[UserBrief] = None
    contact: Optional[ContactBrief] = None


class CallCreate(BaseModel):
    direction: str = "outbound"  # inbound / outbound
    from_number: Optional[str] = None
    to_number: Optional[str] = None
    duration_sec: int = 0
    note: Optional[str] = None
    contact_id: Optional[int] = None
    deal_id: Optional[int] = None
    status: str = "completed"


@router.get("", response_model=Page[CallOut])
def list_calls(
    direction: Optional[str] = None,
    contact_id: Optional[int] = None,
    pagination: PageParams = Depends(page_params),
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    q = db.query(Call).filter(Call.tenant_id == ctx.tenant.id)
    if direction:
        q = q.filter(Call.direction == direction)
    if contact_id:
        q = q.filter(Call.contact_id == contact_id)
    q = q.order_by(Call.started_at.desc())
    return paginate(q, pagination)


@router.post("", response_model=CallOut, status_code=201)
def create_call(
    payload: CallCreate,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    row = Call(
        tenant_id=ctx.tenant.id,
        provider="manual",
        direction=payload.direction,
        status=payload.status,
        from_number=payload.from_number,
        to_number=payload.to_number,
        duration_sec=payload.duration_sec,
        note=payload.note,
        contact_id=payload.contact_id,
        deal_id=payload.deal_id,
        user_id=ctx.user.id,
        started_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.flush()
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="create", entity="call", entity_id=row.id)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{cid}", response_model=Message)
def delete_call(cid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(Call, cid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Звонок не найден")
    db.delete(row)
    db.commit()
    return Message(message="Звонок удалён")


# ============================================================================
# Webhook: Twilio / Voximplant (принимает уведомления от провайдера)
# ============================================================================

@webhook_router.post("/twilio")
async def twilio_webhook(request: Request, db: Session = Depends(get_db)):
    """Заглушка Twilio webhook. В prod — валидировать X-Twilio-Signature.

    Минимальный маппинг Twilio VoiceStatusCallback → Call.
    Требует явного tenant_id (?tenant_id=N) — Twilio не знает про наши тенанты.
    """
    tenant_id = request.query_params.get("tenant_id")
    if not tenant_id:
        raise HTTPException(400, "tenant_id required in query")

    try:
        form = await request.form()
        payload: dict[str, Any] = {k: v for k, v in form.items()}
    except Exception:
        payload = await request.json()

    external_id = payload.get("CallSid") or payload.get("id")
    direction = "inbound" if (payload.get("Direction") or "").lower() == "inbound" else "outbound"

    row = None
    if external_id:
        row = db.query(Call).filter(Call.external_id == external_id, Call.tenant_id == int(tenant_id)).first()
    if not row:
        row = Call(
            tenant_id=int(tenant_id),
            provider="twilio",
            external_id=external_id,
            direction=direction,
            status=payload.get("CallStatus", "in_progress"),
            from_number=payload.get("From"),
            to_number=payload.get("To"),
            duration_sec=int(payload.get("CallDuration") or 0),
            recording_url=payload.get("RecordingUrl"),
            raw=payload,
        )
        db.add(row)
    else:
        row.status = payload.get("CallStatus", row.status)
        row.duration_sec = int(payload.get("CallDuration") or row.duration_sec)
        if payload.get("RecordingUrl"):
            row.recording_url = payload.get("RecordingUrl")
        row.raw = payload

    db.commit()
    return {"ok": True}
