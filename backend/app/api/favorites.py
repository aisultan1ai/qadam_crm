"""Избранное пользователя: проекты, задачи и статьи базы знаний в сайдбаре.

Список всегда фильтруется по текущему доступу: если пользователь потерял доступ
к задаче/статье или объект удалён, он просто не показывается (запись чистится).
"""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.permissions import user_has
from ..database import get_db
from ..models import Article, Favorite, Project, Task
from ..schemas.common import Message
from ..services.wiki.access import can_view as wiki_can_view
from .deps import TenantContext, get_current_context
from .tasks import _user_can_view_task

router = APIRouter(prefix="/api/favorites", tags=["favorites"])

Entity = Literal["project", "task", "wiki"]
MAX_FAVORITES = 50


class FavoriteIn(BaseModel):
    entity: Entity
    entity_id: int


class FavoriteOut(BaseModel):
    entity: Entity
    entity_id: int
    title: str
    url: str
    color: Optional[str] = None


def _resolve(db: Session, ctx: TenantContext, entity: str, entity_id: int) -> Optional[FavoriteOut]:
    """Объект своей компании, который пользователь сейчас может открыть, иначе None."""
    tid = ctx.tenant.id
    owner = ctx.membership.is_owner
    if entity == "project":
        if not (owner or user_has(ctx.user, ["projects.view"], tenant_id=tid)):
            return None
        p = db.get(Project, entity_id)
        if not p or p.tenant_id != tid:
            return None
        return FavoriteOut(entity="project", entity_id=p.id, title=p.name, url=f"/projects/{p.id}", color=p.color)
    if entity == "task":
        t = db.get(Task, entity_id)
        if not t or t.tenant_id != tid or not (owner or _user_can_view_task(ctx.user, t)):
            return None
        return FavoriteOut(entity="task", entity_id=t.id, title=t.title, url=f"/tasks/{t.id}")
    if entity == "wiki":
        if not (owner or user_has(ctx.user, ["wiki.use"], tenant_id=tid)):
            return None
        a = db.get(Article, entity_id)
        if not a or a.tenant_id != tid or not wiki_can_view(db, tid, ctx.user, a):
            return None
        return FavoriteOut(entity="wiki", entity_id=a.id, title=a.title, url=f"/wiki/{a.slug}")
    return None


@router.get("", response_model=list[FavoriteOut])
def list_favorites(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    rows = (
        db.query(Favorite)
        .filter(Favorite.tenant_id == ctx.tenant.id, Favorite.user_id == ctx.user.id)
        .order_by(Favorite.order_index.asc(), Favorite.id.asc())
        .all()
    )
    out: list[FavoriteOut] = []
    stale = False
    for r in rows:
        item = _resolve(db, ctx, r.entity, r.entity_id)
        if item is None:
            # Объект удалён — запись больше не нужна. Нет доступа — не показываем, но храним (доступ могут вернуть).
            if not _exists(db, ctx.tenant.id, r.entity, r.entity_id):
                db.delete(r)
                stale = True
            continue
        out.append(item)
    if stale:
        db.commit()
    return out


def _exists(db: Session, tid: int, entity: str, entity_id: int) -> bool:
    model = {"project": Project, "task": Task, "wiki": Article}.get(entity)
    obj = db.get(model, entity_id) if model else None
    return bool(obj and obj.tenant_id == tid)


@router.post("", response_model=FavoriteOut, status_code=201)
def add_favorite(payload: FavoriteIn, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    item = _resolve(db, ctx, payload.entity, payload.entity_id)
    if item is None:
        raise HTTPException(404, "Объект не найден")
    q = db.query(Favorite).filter(Favorite.tenant_id == ctx.tenant.id, Favorite.user_id == ctx.user.id)
    if q.filter(Favorite.entity == payload.entity, Favorite.entity_id == payload.entity_id).first():
        return item
    if q.count() >= MAX_FAVORITES:
        raise HTTPException(400, f"В избранном может быть не больше {MAX_FAVORITES} элементов")
    last = q.order_by(Favorite.order_index.desc()).first()
    db.add(Favorite(
        tenant_id=ctx.tenant.id, user_id=ctx.user.id,
        entity=payload.entity, entity_id=payload.entity_id,
        order_index=(last.order_index + 10) if last else 0,
    ))
    db.commit()
    return item


@router.delete("/{entity}/{entity_id}", response_model=Message)
def remove_favorite(entity: Entity, entity_id: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    db.query(Favorite).filter(
        Favorite.tenant_id == ctx.tenant.id,
        Favorite.user_id == ctx.user.id,
        Favorite.entity == entity,
        Favorite.entity_id == entity_id,
    ).delete(synchronize_session=False)
    db.commit()
    return Message(message="Удалено из избранного")
