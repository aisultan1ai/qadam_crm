"""Запросы на перенос срока задачи.

Исполнитель/участник нажимает на срок, выбирает дату и отправляет запрос. Постановщику и аудиторам
приходит уведомление и событие в «Хронике»; они одобряют (срок меняется) или отклоняют.
"""

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core.task_access import can_set_deadline
from ..core.ws_hub import publish_to_user
from ..database import get_db
from ..models import DeadlineRequest, Task, User
from ..schemas.contact import UserBrief
from .deps import TenantContext, get_current_context, log_action
from .tasks import _notify, _user_can_view_task

router = APIRouter(prefix="/api", tags=["deadline-requests"])


class DeadlineRequestIn(BaseModel):
    deadline: datetime
    reason: Optional[str] = Field(default=None, max_length=500)


class DecisionIn(BaseModel):
    note: Optional[str] = Field(default=None, max_length=500)


class DeadlineRequestOut(BaseModel):
    id: int
    task_id: int
    requested_by: Optional[UserBrief] = None
    old_deadline: Optional[datetime] = None
    new_deadline: datetime
    reason: Optional[str] = None
    status: str
    decision_note: Optional[str] = None
    created_at: datetime
    can_decide: bool = False


def _fmt(d: Optional[datetime]) -> str:
    return d.astimezone(timezone.utc).strftime("%d.%m.%Y") if d else "без срока"


def _approver_ids(task: Task) -> set[int]:
    ids = set(task.auditor_ids)
    if task.author_id:
        ids.add(task.author_id)
    return ids


def _out(db: Session, req: DeadlineRequest, can_decide: bool) -> DeadlineRequestOut:
    user = db.get(User, req.requested_by_id)
    return DeadlineRequestOut(
        id=req.id, task_id=req.task_id,
        requested_by=UserBrief.model_validate(user) if user else None,
        old_deadline=req.old_deadline, new_deadline=req.new_deadline, reason=req.reason,
        status=req.status, decision_note=req.decision_note, created_at=req.created_at,
        can_decide=can_decide and req.status == "pending",
    )


def _load_task(db: Session, ctx: TenantContext, task_id: int) -> Task:
    task = db.get(Task, task_id)
    if not task or task.tenant_id != ctx.tenant.id or not _user_can_view_task(ctx.user, task):
        raise HTTPException(404, "Задача не найдена")
    return task


@router.post("/tasks/{task_id}/deadline-request", response_model=DeadlineRequestOut, status_code=201)
def create_request(
    task_id: int,
    payload: DeadlineRequestIn,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    task = _load_task(db, ctx, task_id)
    user = ctx.user
    if can_set_deadline(user, ctx.membership, task):
        raise HTTPException(400, "Вы можете изменить срок сами — запрос не нужен")
    if task.deadline is not None and payload.deadline == task.deadline:
        raise HTTPException(400, "Это уже текущий срок задачи")

    # Один активный запрос от человека на задачу: новый заменяет прежний.
    for old in db.query(DeadlineRequest).filter(
        DeadlineRequest.task_id == task.id,
        DeadlineRequest.requested_by_id == user.id,
        DeadlineRequest.status == "pending",
    ):
        old.status = "cancelled"

    req = DeadlineRequest(
        tenant_id=ctx.tenant.id, task_id=task.id, requested_by_id=user.id,
        old_deadline=task.deadline, new_deadline=payload.deadline,
        reason=(payload.reason or "").strip() or None, status="pending",
    )
    db.add(req)
    db.flush()

    approvers = _approver_ids(task) - {user.id}
    body = f"{user.name}: {_fmt(task.deadline)} → {_fmt(payload.deadline)}"
    if req.reason:
        body += f". {req.reason}"
    for uid in approvers:
        _notify(db, ctx.tenant.id, uid, "deadline_request", f"Просят перенести срок: {task.title}", body[:1000], task.id)
    log_action(
        db, tenant_id=ctx.tenant.id, user_id=user.id, action="deadline_request",
        entity="deadline_request", entity_id=req.id, task_id=task.id, detail=body[:500],
    )
    db.commit()
    db.refresh(req)
    for uid in approvers:
        publish_to_user(ctx.tenant.id, uid, "notification.new", {"task_id": task.id})
        publish_to_user(ctx.tenant.id, uid, "task.deadline_request", {"task_id": task.id, "request_id": req.id})
    return _out(db, req, can_decide=False)


@router.get("/tasks/{task_id}/deadline-requests", response_model=List[DeadlineRequestOut])
def list_requests(
    task_id: int,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    """Активные запросы: решающий видит все, остальные — только свои."""
    task = _load_task(db, ctx, task_id)
    decider = can_set_deadline(ctx.user, ctx.membership, task)
    q = db.query(DeadlineRequest).filter(DeadlineRequest.task_id == task.id, DeadlineRequest.status == "pending")
    if not decider:
        q = q.filter(DeadlineRequest.requested_by_id == ctx.user.id)
    return [_out(db, r, decider) for r in q.order_by(DeadlineRequest.created_at.asc()).all()]


def _decide(db: Session, ctx: TenantContext, request_id: int, approve: bool, note: Optional[str]) -> DeadlineRequestOut:
    req = db.get(DeadlineRequest, request_id)
    if not req or req.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Запрос не найден")
    task = db.get(Task, req.task_id)
    if not task:
        raise HTTPException(404, "Задача не найдена")
    if not can_set_deadline(ctx.user, ctx.membership, task):
        raise HTTPException(403, "Решение принимает постановщик или аудитор задачи")
    if req.status != "pending":
        raise HTTPException(409, "Запрос уже обработан")

    now = datetime.now(timezone.utc)
    req.status = "approved" if approve else "rejected"
    req.decided_by_id = ctx.user.id
    req.decided_at = now
    req.decision_note = (note or "").strip() or None

    if approve:
        task.deadline = req.new_deadline
        # Остальные ожидающие запросы по этой задаче устарели — их база (старый срок) изменилась.
        for other in db.query(DeadlineRequest).filter(
            DeadlineRequest.task_id == task.id, DeadlineRequest.status == "pending", DeadlineRequest.id != req.id,
        ):
            other.status = "cancelled"
        log_action(
            db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="task",
            entity_id=task.id, task_id=task.id, detail="срок",
        )

    verdict = "одобрил(а)" if approve else "отклонил(а)"
    detail = f"{_fmt(req.old_deadline)} → {_fmt(req.new_deadline)}"
    if req.decision_note:
        detail += f". {req.decision_note}"
    log_action(
        db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
        action="deadline_approved" if approve else "deadline_rejected",
        entity="deadline_request", entity_id=req.id, task_id=task.id, detail=detail[:500],
    )
    _notify(
        db, ctx.tenant.id, req.requested_by_id, "deadline_decision",
        f"Перенос срока {'одобрен' if approve else 'отклонён'}: {task.title}",
        f"{ctx.user.name} {verdict} запрос. {detail}"[:1000], task.id,
    )
    db.commit()
    db.refresh(req)
    publish_to_user(ctx.tenant.id, req.requested_by_id, "notification.new", {"task_id": task.id})
    return _out(db, req, can_decide=False)


@router.post("/deadline-requests/{request_id}/approve", response_model=DeadlineRequestOut)
def approve(request_id: int, payload: DecisionIn, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    return _decide(db, ctx, request_id, True, payload.note)


@router.post("/deadline-requests/{request_id}/reject", response_model=DeadlineRequestOut)
def reject(request_id: int, payload: DecisionIn, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    return _decide(db, ctx, request_id, False, payload.note)
