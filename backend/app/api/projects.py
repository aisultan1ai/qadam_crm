from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import List, Optional

from ..database import get_db
from ..models import Project, User, Task
from ..schemas.project import ProjectOut, ProjectCreate, ProjectUpdate
from ..schemas.common import Message
from .deps import require, log_action

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _counts_map(db: Session, project_ids: list[int]) -> dict[int, int]:
    if not project_ids:
        return {}
    rows = (
        db.query(Task.project_id, func.count(Task.id))
        .filter(Task.project_id.in_(project_ids))
        .group_by(Task.project_id)
        .all()
    )
    return {pid: c for pid, c in rows}


def _out(db: Session, project: Project, count: int | None = None) -> ProjectOut:
    if count is None:
        count = db.query(func.count(Task.id)).filter(Task.project_id == project.id).scalar() or 0
    return ProjectOut.model_validate(project).model_copy(update={"tasks_count": count})


@router.get("", response_model=List[ProjectOut])
def list_projects(
    q: Optional[str] = None,
    archived: Optional[bool] = None,
    _: User = Depends(require("projects.view")),
    db: Session = Depends(get_db),
):
    query = db.query(Project)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(Project.name.ilike(like), Project.description.ilike(like)))
    if archived is not None:
        query = query.filter(Project.is_archived == archived)
    projects = query.order_by(Project.created_at.desc()).all()
    counts = _counts_map(db, [p.id for p in projects])
    return [_out(db, p, counts.get(p.id, 0)) for p in projects]


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, _: User = Depends(require("projects.view")), db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Проект не найден")
    return _out(db, project)


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(payload: ProjectCreate, actor: User = Depends(require("projects.create")), db: Session = Depends(get_db)):
    project = Project(
        name=payload.name,
        description=payload.description,
        color=payload.color,
        start_date=payload.start_date,
        deadline=payload.deadline,
        owner_id=payload.owner_id or actor.id,
    )
    if payload.member_ids:
        project.members = db.query(User).filter(User.id.in_(payload.member_ids)).all()
    db.add(project)
    db.flush()
    log_action(db, user_id=actor.id, action="create", entity="project", entity_id=project.id, detail=project.name)
    db.commit()
    db.refresh(project)
    return _out(db, project)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(project_id: int, payload: ProjectUpdate, actor: User = Depends(require("projects.update")), db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Проект не найден")
    for field in ("name", "description", "color", "start_date", "deadline", "owner_id"):
        val = getattr(payload, field)
        if val is not None:
            setattr(project, field, val)
    if payload.member_ids is not None:
        project.members = db.query(User).filter(User.id.in_(payload.member_ids)).all()
    if payload.is_archived is not None:
        project.is_archived = payload.is_archived
    log_action(db, user_id=actor.id, action="update", entity="project", entity_id=project.id)
    db.commit()
    db.refresh(project)
    return _out(db, project)


@router.post("/{project_id}/archive", response_model=ProjectOut)
def archive_project(project_id: int, actor: User = Depends(require("projects.archive")), db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Проект не найден")
    project.is_archived = not project.is_archived
    log_action(db, user_id=actor.id, action="archive" if project.is_archived else "unarchive", entity="project", entity_id=project.id)
    db.commit()
    db.refresh(project)
    return _out(db, project)


@router.delete("/{project_id}", response_model=Message)
def delete_project(project_id: int, actor: User = Depends(require("projects.delete")), db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Проект не найден")
    log_action(db, user_id=actor.id, action="delete", entity="project", entity_id=project.id, detail=project.name)
    db.delete(project)
    db.commit()
    return Message(message="Проект удалён")
