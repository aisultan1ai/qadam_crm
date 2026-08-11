import re
from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from ..database import get_db
from ..models import Task, Comment, User, Notification, CommentReaction, TenantMembership
from ..core.permissions import user_has
from ..core.ws_hub import publish_to_user
from ..schemas.task import CommentOut, CommentCreate
from ..schemas.common import Message
from .deps import TenantContext, require, get_current_context, log_action

router = APIRouter(prefix="/api/tasks/{task_id}/comments", tags=["comments"])

ALLOWED_EMOJIS = {"👍", "❤️", "🎉", "🚀", "😂", "🔥", "👀", "🙏", "✅", "❌"}
MAX_EMOJI_LEN = 8


MENTION_RE = re.compile(r"@([A-Za-z0-9_.\-]+)")


def _load_task_in_tenant(db: Session, task_id: int, tenant_id: int) -> Task:
    task = db.get(Task, task_id)
    if not task or task.tenant_id != tenant_id:
        raise HTTPException(404, "Задача не найдена")
    return task


@router.get("", response_model=List[CommentOut])
def list_comments(task_id: int, ctx: TenantContext = Depends(require("comments.view")), db: Session = Depends(get_db)):
    task = _load_task_in_tenant(db, task_id, ctx.tenant.id)
    # comments уже загружены через relationship; фильтр по task достаточен,
    # т.к. tenant проверен на task.
    return task.comments


@router.post("", response_model=CommentOut, status_code=201)
def create_comment(task_id: int, payload: CommentCreate, ctx: TenantContext = Depends(require("comments.create")), db: Session = Depends(get_db)):
    user = ctx.user
    task = _load_task_in_tenant(db, task_id, ctx.tenant.id)
    comment = Comment(tenant_id=ctx.tenant.id, task_id=task.id, author_id=user.id, body=payload.body)
    db.add(comment)

    notify_user_ids: set[int] = set()
    if task.assignee_id and task.assignee_id != user.id:
        db.add(Notification(
            tenant_id=ctx.tenant.id,
            user_id=task.assignee_id,
            kind="comment",
            title=f"Новый комментарий: {task.title}",
            body=payload.body[:200],
            task_id=task.id,
        ))
        notify_user_ids.add(task.assignee_id)

    handles = set(MENTION_RE.findall(payload.body))
    if handles:
        emails = [h.lower() for h in handles]
        # Только пользователи, состоящие в текущем tenant'е
        mentioned = (
            db.query(User)
            .join(TenantMembership, TenantMembership.user_id == User.id)
            .filter(
                TenantMembership.tenant_id == ctx.tenant.id,
                User.email.in_(emails),
            )
            .all()
        )
        for m in mentioned:
            if m.id != user.id:
                db.add(Notification(
                    tenant_id=ctx.tenant.id,
                    user_id=m.id,
                    kind="mention",
                    title=f"Вас упомянули: {task.title}",
                    body=payload.body[:200],
                    task_id=task.id,
                ))
                notify_user_ids.add(m.id)

    log_action(db, tenant_id=ctx.tenant.id, user_id=user.id, action="comment", entity="task", entity_id=task.id, task_id=task.id)
    db.commit()
    db.refresh(comment)

    for uid in notify_user_ids:
        publish_to_user(uid, "notification.new", {"task_id": task.id})
    # уведомим всех подписчиков задачи о новом комментарии
    if task.assignee_id:
        publish_to_user(task.assignee_id, "task.comment", {"task_id": task.id, "comment_id": comment.id})
    if task.author_id and task.author_id != user.id:
        publish_to_user(task.author_id, "task.comment", {"task_id": task.id, "comment_id": comment.id})

    return comment


@router.patch("/{comment_id}", response_model=CommentOut)
def update_comment(task_id: int, comment_id: int, payload: CommentCreate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    user = ctx.user
    comment = db.get(Comment, comment_id)
    if not comment or comment.tenant_id != ctx.tenant.id or comment.task_id != task_id:
        raise HTTPException(404, "Комментарий не найден")
    is_own = comment.author_id == user.id
    if not (is_own and user_has(user, ["comments.update_own"])) and not user_has(user, ["comments.delete"]):
        raise HTTPException(403, "Нет права редактировать")
    comment.body = payload.body
    db.commit()
    db.refresh(comment)
    return comment


@router.delete("/{comment_id}", response_model=Message)
def delete_comment(task_id: int, comment_id: int, ctx: TenantContext = Depends(require("comments.delete")), db: Session = Depends(get_db)):
    comment = db.get(Comment, comment_id)
    if not comment or comment.tenant_id != ctx.tenant.id or comment.task_id != task_id:
        raise HTTPException(404, "Комментарий не найден")
    db.delete(comment)
    db.commit()
    return Message(message="Комментарий удалён")


def _validate_emoji(emoji: str) -> str:
    e = (emoji or "").strip()
    if not e or len(e) > MAX_EMOJI_LEN:
        raise HTTPException(400, "Некорректный emoji")
    if e not in ALLOWED_EMOJIS:
        raise HTTPException(400, "Такой emoji не разрешён")
    return e


@router.post("/{comment_id}/reactions", response_model=CommentOut)
def toggle_reaction(
    task_id: int,
    comment_id: int,
    emoji: str = Body(..., embed=True),
    ctx: TenantContext = Depends(require("comments.create")),
    db: Session = Depends(get_db),
):
    user = ctx.user
    comment = db.get(Comment, comment_id)
    if not comment or comment.tenant_id != ctx.tenant.id or comment.task_id != task_id:
        raise HTTPException(404, "Комментарий не найден")
    e = _validate_emoji(emoji)

    existing = db.query(CommentReaction).filter(
        CommentReaction.comment_id == comment_id,
        CommentReaction.user_id == user.id,
        CommentReaction.emoji == e,
    ).first()
    if existing:
        db.delete(existing)
    else:
        db.add(CommentReaction(comment_id=comment_id, user_id=user.id, emoji=e))
    db.commit()
    db.refresh(comment)

    # WS: пушим автору и участникам треда
    for uid in {comment.author_id, comment.task.assignee_id, comment.task.author_id}:
        if uid and uid != user.id:
            publish_to_user(uid, "task.comment", {"task_id": task_id, "comment_id": comment_id})
    return comment
