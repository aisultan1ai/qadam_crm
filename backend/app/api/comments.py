import re
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from ..database import get_db
from ..models import Task, Comment, User, Notification
from ..core.permissions import user_has
from ..schemas.task import CommentOut, CommentCreate
from ..schemas.common import Message
from .deps import require, get_current_user, log_action

router = APIRouter(prefix="/api/tasks/{task_id}/comments", tags=["comments"])


MENTION_RE = re.compile(r"@([A-Za-z0-9_.\-]+)")


@router.get("", response_model=List[CommentOut])
def list_comments(task_id: int, _: User = Depends(require("comments.view")), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Задача не найдена")
    return task.comments


@router.post("", response_model=CommentOut, status_code=201)
def create_comment(task_id: int, payload: CommentCreate, user: User = Depends(require("comments.create")), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Задача не найдена")
    comment = Comment(task_id=task.id, author_id=user.id, body=payload.body)
    db.add(comment)

    if task.assignee_id and task.assignee_id != user.id:
        db.add(Notification(user_id=task.assignee_id, kind="comment", title=f"Новый комментарий: {task.title}", body=payload.body[:200], task_id=task.id))

    handles = set(MENTION_RE.findall(payload.body))
    if handles:
        emails = [h.lower() for h in handles]
        mentioned = db.query(User).filter(User.email.in_(emails)).all()
        for m in mentioned:
            if m.id != user.id:
                db.add(Notification(user_id=m.id, kind="mention", title=f"Вас упомянули: {task.title}", body=payload.body[:200], task_id=task.id))

    log_action(db, user_id=user.id, action="comment", entity="task", entity_id=task.id, task_id=task.id)
    db.commit()
    db.refresh(comment)
    return comment


@router.patch("/{comment_id}", response_model=CommentOut)
def update_comment(task_id: int, comment_id: int, payload: CommentCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    comment = db.get(Comment, comment_id)
    if not comment or comment.task_id != task_id:
        raise HTTPException(404, "Комментарий не найден")
    is_own = comment.author_id == user.id
    if not (is_own and user_has(user, ["comments.update_own"])) and not user_has(user, ["comments.delete"]):
        raise HTTPException(403, "Нет права редактировать")
    comment.body = payload.body
    db.commit()
    db.refresh(comment)
    return comment


@router.delete("/{comment_id}", response_model=Message)
def delete_comment(task_id: int, comment_id: int, user: User = Depends(require("comments.delete")), db: Session = Depends(get_db)):
    comment = db.get(Comment, comment_id)
    if not comment or comment.task_id != task_id:
        raise HTTPException(404, "Комментарий не найден")
    db.delete(comment)
    db.commit()
    return Message(message="Комментарий удалён")
