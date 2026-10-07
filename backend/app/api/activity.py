from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session
from typing import List, Literal, Optional
from datetime import datetime, timedelta, timezone

from ..database import get_db
from ..models import ActivityLog, ActivityState, DeadlineRequest, Project, Task, TenantLead
from ..models.project import project_members
from ..models.task import task_assignees, task_auditors, task_participants
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


# ============================================================================
# Лента «Хроника»: события только по тому, где пользователь участвует
# ============================================================================

# Что показываем: изменения и обсуждения. Входы в систему, смена паролей и т.п. — не лента.
FEED_ACTIONS = (
    "create", "update", "comment", "archive", "unarchive", "upload", "lead_new", "lead_assigned",
    "deadline_request", "deadline_approved", "deadline_rejected",
)
FEED_WINDOW_DAYS = 30


class DeadlineRequestBrief(BaseModel):
    id: int
    status: str
    old_deadline: Optional[datetime] = None
    new_deadline: datetime
    reason: Optional[str] = None
    decision_note: Optional[str] = None
    # Решить запрос может постановщик/аудитор, пока он ожидает.
    can_decide: bool = False


class FeedItemOut(ActivityItemOut):
    deadline_request: Optional[DeadlineRequestBrief] = None
    # Подпись объекта (название задачи / проекта / имя лида) и проект задачи — чтобы не ходить за ними отдельно.
    target_title: Optional[str] = None
    project_id: Optional[int] = None
    project_name: Optional[str] = None
    is_read: bool = False
    liked: bool = False
    likes_count: int = 0


class FeedPage(BaseModel):
    items: List[FeedItemOut]
    total: int
    unread: int
    page: int
    per_page: int
    pages: int


def _my_project_ids(ctx: TenantContext):
    me = ctx.user.id
    return select(Project.id).where(
        Project.tenant_id == ctx.tenant.id,
        or_(
            Project.owner_id == me,
            Project.id.in_(select(project_members.c.project_id).where(project_members.c.user_id == me)),
        ),
    )


def _my_task_ids(ctx: TenantContext):
    me = ctx.user.id
    return select(Task.id).where(
        Task.tenant_id == ctx.tenant.id,
        or_(
            Task.author_id == me,
            Task.assignee_id == me,
            Task.id.in_(select(task_assignees.c.task_id).where(task_assignees.c.user_id == me)),
            Task.id.in_(select(task_auditors.c.task_id).where(task_auditors.c.user_id == me)),
            Task.id.in_(select(task_participants.c.task_id).where(task_participants.c.user_id == me)),
            Task.project_id.in_(_my_project_ids(ctx)),
        ),
    )


def _my_deadline_request_ids(ctx: TenantContext):
    """Запросы переноса срока, которые касаются меня: я автор запроса или решаю (постановщик/аудитор)."""
    me = ctx.user.id
    return select(DeadlineRequest.id).where(
        DeadlineRequest.tenant_id == ctx.tenant.id,
        or_(
            DeadlineRequest.requested_by_id == me,
            DeadlineRequest.task_id.in_(select(Task.id).where(Task.author_id == me)),
            DeadlineRequest.task_id.in_(select(task_auditors.c.task_id).where(task_auditors.c.user_id == me)),
        ),
    )


def _feed_query(db: Session, ctx: TenantContext):
    me = ctx.user.id
    since = datetime.now(timezone.utc) - timedelta(days=FEED_WINDOW_DAYS)
    my_leads = select(TenantLead.id).where(TenantLead.tenant_id == ctx.tenant.id, TenantLead.assignee_id == me)
    return (
        db.query(ActivityLog)
        .filter(
            ActivityLog.tenant_id == ctx.tenant.id,
            ActivityLog.created_at >= since,
            ActivityLog.action.in_(FEED_ACTIONS),
            # Свои действия в ленте не показываем.
            or_(ActivityLog.user_id.is_(None), ActivityLog.user_id != me),
            # События переноса срока — только тем, кого они касаются, а не всем участникам задачи.
            or_(
                ActivityLog.entity.is_(None),
                ActivityLog.entity != "deadline_request",
                ActivityLog.entity_id.in_(_my_deadline_request_ids(ctx)),
            ),
            or_(
                ActivityLog.task_id.in_(_my_task_ids(ctx)),
                and_(ActivityLog.entity == "project", ActivityLog.entity_id.in_(_my_project_ids(ctx))),
                and_(ActivityLog.entity == "lead", ActivityLog.entity_id.in_(my_leads)),
            ),
        )
    )


def _unread_filter(ctx: TenantContext):
    read_ids = select(ActivityState.activity_id).where(
        ActivityState.user_id == ctx.user.id, ActivityState.is_read.is_(True),
    )
    return ActivityLog.id.not_in(read_ids)


@router.get("/feed", response_model=FeedPage)
def feed(
    tab: Literal["unread", "all"] = "unread",
    pagination: PageParams = Depends(page_params),
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    base = _feed_query(db, ctx)
    unread = base.filter(_unread_filter(ctx)).count()
    q = base.filter(_unread_filter(ctx)) if tab == "unread" else base
    q = q.order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc())

    total = q.count()
    per_page = pagination.per_page
    page = pagination.page or 1
    rows = q.offset((page - 1) * per_page).limit(per_page).all()

    ids = [r.id for r in rows]
    states = {
        st.activity_id: st
        for st in db.query(ActivityState).filter(ActivityState.user_id == ctx.user.id, ActivityState.activity_id.in_(ids))
    } if ids else {}
    likes = dict(
        db.query(ActivityState.activity_id, func.count(ActivityState.id))
        .filter(ActivityState.activity_id.in_(ids), ActivityState.liked.is_(True))
        .group_by(ActivityState.activity_id)
        .all()
    ) if ids else {}

    task_ids = {r.task_id for r in rows if r.task_id}
    project_ids = {r.entity_id for r in rows if r.entity == "project" and r.entity_id}
    lead_ids = {r.entity_id for r in rows if r.entity == "lead" and r.entity_id}
    tasks = {
        t.id: t for t in db.query(Task).filter(Task.id.in_(task_ids)).all()
    } if task_ids else {}
    project_ids |= {t.project_id for t in tasks.values() if t.project_id}
    projects = {
        p.id: p for p in db.query(Project).filter(Project.id.in_(project_ids)).all()
    } if project_ids else {}
    leads = {
        l.id: l for l in db.query(TenantLead).filter(TenantLead.id.in_(lead_ids)).all()
    } if lead_ids else {}
    dr_ids = {r.entity_id for r in rows if r.entity == "deadline_request" and r.entity_id}
    dreqs = {
        d.id: d for d in db.query(DeadlineRequest).filter(DeadlineRequest.id.in_(dr_ids)).all()
    } if dr_ids else {}

    items: List[FeedItemOut] = []
    for r in rows:
        item = FeedItemOut.model_validate(r)
        title = project_id = project_name = None
        if r.task_id and r.task_id in tasks:
            t = tasks[r.task_id]
            title, project_id = t.title, t.project_id
            project_name = projects[t.project_id].name if t.project_id in projects else None
        elif r.entity == "project" and r.entity_id in projects:
            title, project_id, project_name = projects[r.entity_id].name, r.entity_id, projects[r.entity_id].name
        elif r.entity == "lead" and r.entity_id in leads:
            title = leads[r.entity_id].name
        dr = dreqs.get(r.entity_id) if r.entity == "deadline_request" else None
        dr_brief = None
        if dr:
            t = tasks.get(dr.task_id)
            can_decide = bool(
                dr.status == "pending" and t is not None and (
                    t.author_id == ctx.user.id or ctx.user.id in t.auditor_ids
                    or ctx.membership.is_owner or t.author_id is None
                )
            )
            dr_brief = DeadlineRequestBrief(
                id=dr.id, status=dr.status, old_deadline=dr.old_deadline, new_deadline=dr.new_deadline,
                reason=dr.reason, decision_note=dr.decision_note, can_decide=can_decide,
            )
        st = states.get(r.id)
        items.append(item.model_copy(update={
            "deadline_request": dr_brief,
            "target_title": title,
            "project_id": project_id,
            "project_name": project_name,
            "is_read": bool(st and st.is_read),
            "liked": bool(st and st.liked),
            "likes_count": int(likes.get(r.id, 0)),
        }))

    pages = (total + per_page - 1) // per_page if per_page else 1
    return FeedPage(items=items, total=total, unread=unread, page=page, per_page=per_page, pages=pages or 1)


@router.get("/feed/unread-count")
def feed_unread_count(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    return {"unread": _feed_query(db, ctx).filter(_unread_filter(ctx)).count()}


class FeedFlagIn(BaseModel):
    value: bool = True


def _state(db: Session, ctx: TenantContext, activity_id: int) -> ActivityState:
    # Нельзя отмечать чужие/недоступные события: проверяем, что оно входит в ленту пользователя.
    visible = _feed_query(db, ctx).filter(ActivityLog.id == activity_id).first()
    if not visible:
        raise HTTPException(404, "Событие не найдено")
    st = (
        db.query(ActivityState)
        .filter(ActivityState.activity_id == activity_id, ActivityState.user_id == ctx.user.id)
        .first()
    )
    if not st:
        st = ActivityState(activity_id=activity_id, user_id=ctx.user.id, is_read=False, liked=False)
        db.add(st)
    return st


@router.post("/feed/{activity_id}/read")
def feed_mark_read(
    activity_id: int,
    payload: FeedFlagIn,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    st = _state(db, ctx, activity_id)
    st.is_read = payload.value
    db.commit()
    return {"is_read": st.is_read}


@router.post("/feed/{activity_id}/like")
def feed_like(
    activity_id: int,
    payload: FeedFlagIn,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    st = _state(db, ctx, activity_id)
    st.liked = payload.value
    if payload.value:
        st.is_read = True  # лайкнул — значит, увидел
    db.commit()
    likes = db.query(func.count(ActivityState.id)).filter(
        ActivityState.activity_id == activity_id, ActivityState.liked.is_(True),
    ).scalar() or 0
    return {"liked": st.liked, "is_read": st.is_read, "likes_count": int(likes)}


@router.post("/feed/read-all")
def feed_read_all(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    ids = [i for (i,) in _feed_query(db, ctx).filter(_unread_filter(ctx)).with_entities(ActivityLog.id).all()]
    if ids:
        existing = {
            st.activity_id: st
            for st in db.query(ActivityState).filter(ActivityState.user_id == ctx.user.id, ActivityState.activity_id.in_(ids))
        }
        for aid in ids:
            st = existing.get(aid)
            if st:
                st.is_read = True
            else:
                db.add(ActivityState(activity_id=aid, user_id=ctx.user.id, is_read=True, liked=False))
        db.commit()
    return {"marked": len(ids)}
