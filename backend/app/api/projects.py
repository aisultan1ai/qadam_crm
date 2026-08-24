from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import List, Optional

from ..database import get_db
from ..models import Project, User, Task, TenantMembership
from ..core.plans import check_project_limit
from ..schemas.project import ProjectOut, ProjectCreate, ProjectUpdate
from ..schemas.common import Message, Page, PageParams, page_params
from .deps import TenantContext, require, log_action

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _counts_map(db: Session, tenant_id: int, project_ids: list[int]) -> dict[int, int]:
    if not project_ids:
        return {}
    rows = (
        db.query(Task.project_id, func.count(Task.id))
        .filter(Task.tenant_id == tenant_id, Task.project_id.in_(project_ids))
        .group_by(Task.project_id)
        .all()
    )
    return {pid: c for pid, c in rows}


def _out(db: Session, tenant_id: int, project: Project, count: int | None = None) -> ProjectOut:
    if count is None:
        count = (
            db.query(func.count(Task.id))
            .filter(Task.tenant_id == tenant_id, Task.project_id == project.id)
            .scalar() or 0
        )
    return ProjectOut.model_validate(project).model_copy(update={"tasks_count": count})


def _tenant_member_ids(db: Session, tenant_id: int, user_ids: list[int]) -> list[int]:
    """Пересечение переданных user_ids с членами tenant'а."""
    if not user_ids:
        return []
    rows = (
        db.query(TenantMembership.user_id)
        .filter(
            TenantMembership.tenant_id == tenant_id,
            TenantMembership.user_id.in_(user_ids),
        )
        .all()
    )
    return [r[0] for r in rows]


def _assert_user_in_tenant(db: Session, tenant_id: int, user_id: int, err: str = "Пользователь не в компании") -> None:
    exists = (
        db.query(TenantMembership.id)
        .filter(TenantMembership.tenant_id == tenant_id, TenantMembership.user_id == user_id)
        .first()
    )
    if not exists:
        raise HTTPException(400, err)


@router.get("", response_model=Page[ProjectOut])
def list_projects(
    q: Optional[str] = None,
    archived: Optional[bool] = None,
    pagination: PageParams = Depends(page_params),
    ctx: TenantContext = Depends(require("projects.view")),
    db: Session = Depends(get_db),
):
    query = db.query(Project).filter(Project.tenant_id == ctx.tenant.id)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(Project.name.ilike(like), Project.description.ilike(like)))
    if archived is not None:
        query = query.filter(Project.is_archived == archived)
    query = query.order_by(Project.created_at.desc())

    if pagination.page is None:
        MAX_UNPAGED = 500
        projects = query.limit(MAX_UNPAGED).all()
        total = len(projects)
        page = 1
        per_page = total or pagination.per_page
        pages = 1
    else:
        total = query.order_by(None).count()
        offset = (pagination.page - 1) * pagination.per_page
        projects = query.offset(offset).limit(pagination.per_page).all()
        page = pagination.page
        per_page = pagination.per_page
        pages = (total + per_page - 1) // per_page if per_page else 1
        pages = pages or 1

    counts = _counts_map(db, ctx.tenant.id, [p.id for p in projects])
    items = [_out(db, ctx.tenant.id, p, counts.get(p.id, 0)) for p in projects]
    return Page[ProjectOut](items=items, total=total, page=page, per_page=per_page, pages=pages)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, ctx: TenantContext = Depends(require("projects.view")), db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project or project.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Проект не найден")
    return _out(db, ctx.tenant.id, project)


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(payload: ProjectCreate, ctx: TenantContext = Depends(require("projects.create")), db: Session = Depends(get_db)):
    actor = ctx.user
    check_project_limit(db, ctx.tenant)
    owner_id = payload.owner_id or actor.id
    _assert_user_in_tenant(db, ctx.tenant.id, owner_id, "Владелец не является членом компании")

    project = Project(
        tenant_id=ctx.tenant.id,
        name=payload.name,
        description=payload.description,
        color=payload.color,
        start_date=payload.start_date,
        deadline=payload.deadline,
        owner_id=owner_id,
    )
    if payload.member_ids:
        allowed_ids = _tenant_member_ids(db, ctx.tenant.id, payload.member_ids)
        if allowed_ids:
            project.members = db.query(User).filter(User.id.in_(allowed_ids)).all()
    db.add(project)
    db.flush()

    _create_project_channel(db, project, owner_id, actor.id)

    log_action(db, tenant_id=ctx.tenant.id, user_id=actor.id, action="create", entity="project", entity_id=project.id, detail=project.name)
    db.commit()
    db.refresh(project)
    return _out(db, ctx.tenant.id, project)


def _create_project_channel(db: Session, project: Project, owner_id: int, actor_id: int) -> None:
    """Автоматически создаёт канал мессенджера для проекта и добавляет владельца/членов."""
    from ..models import Channel, ChannelMember

    existing = db.query(Channel).filter(
        Channel.tenant_id == project.tenant_id, Channel.project_id == project.id,
    ).first()
    if existing:
        return

    ch = Channel(
        tenant_id=project.tenant_id,
        kind="project",
        project_id=project.id,
        name=f"#{project.name}",
        created_by=actor_id,
    )
    db.add(ch)
    db.flush()

    seen: set[int] = set()
    def add(uid: int, role: str = "member") -> None:
        if uid in seen:
            return
        seen.add(uid)
        db.add(ChannelMember(channel_id=ch.id, user_id=uid, role=role))

    add(owner_id, "owner")
    add(actor_id)
    for u in (project.members or []):
        add(u.id)


def _sync_project_channel_members(db: Session, project: Project) -> None:
    """Синхронизирует channel_members с participants проекта. Owner всегда в канале."""
    from ..models import Channel, ChannelMember

    ch = db.query(Channel).filter(
        Channel.tenant_id == project.tenant_id, Channel.project_id == project.id,
    ).first()
    if not ch:
        return

    should_be = {u.id for u in (project.members or [])}
    if project.owner_id:
        should_be.add(project.owner_id)

    current_rows = db.query(ChannelMember).filter(ChannelMember.channel_id == ch.id).all()
    current_ids = {m.user_id for m in current_rows}

    for uid in should_be - current_ids:
        role = "owner" if uid == project.owner_id else "member"
        db.add(ChannelMember(channel_id=ch.id, user_id=uid, role=role))

    to_remove = current_ids - should_be
    if to_remove:
        db.query(ChannelMember).filter(
            ChannelMember.channel_id == ch.id,
            ChannelMember.user_id.in_(to_remove),
        ).delete(synchronize_session=False)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(project_id: int, payload: ProjectUpdate, ctx: TenantContext = Depends(require("projects.update")), db: Session = Depends(get_db)):
    actor = ctx.user
    project = db.get(Project, project_id)
    if not project or project.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Проект не найден")
    for field in ("name", "description", "color", "start_date", "deadline"):
        val = getattr(payload, field)
        if val is not None:
            setattr(project, field, val)
    if payload.owner_id is not None:
        _assert_user_in_tenant(db, ctx.tenant.id, payload.owner_id, "Владелец не является членом компании")
        project.owner_id = payload.owner_id
    if payload.member_ids is not None:
        allowed_ids = _tenant_member_ids(db, ctx.tenant.id, payload.member_ids)
        project.members = db.query(User).filter(User.id.in_(allowed_ids)).all() if allowed_ids else []
    if payload.is_archived is not None:
        project.is_archived = payload.is_archived
    _sync_project_channel_members(db, project)
    log_action(db, tenant_id=ctx.tenant.id, user_id=actor.id, action="update", entity="project", entity_id=project.id)
    db.commit()
    db.refresh(project)
    return _out(db, ctx.tenant.id, project)


@router.post("/{project_id}/archive", response_model=ProjectOut)
def archive_project(project_id: int, ctx: TenantContext = Depends(require("projects.archive")), db: Session = Depends(get_db)):
    actor = ctx.user
    project = db.get(Project, project_id)
    if not project or project.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Проект не найден")
    project.is_archived = not project.is_archived
    log_action(
        db,
        tenant_id=ctx.tenant.id,
        user_id=actor.id,
        action="archive" if project.is_archived else "unarchive",
        entity="project",
        entity_id=project.id,
    )
    db.commit()
    db.refresh(project)
    return _out(db, ctx.tenant.id, project)


@router.delete("/{project_id}", response_model=Message)
def delete_project(project_id: int, ctx: TenantContext = Depends(require("projects.delete")), db: Session = Depends(get_db)):
    actor = ctx.user
    project = db.get(Project, project_id)
    if not project or project.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Проект не найден")
    log_action(db, tenant_id=ctx.tenant.id, user_id=actor.id, action="delete", entity="project", entity_id=project.id, detail=project.name)
    db.delete(project)
    db.commit()
    return Message(message="Проект удалён")
