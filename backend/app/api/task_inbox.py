"""E-mail адрес задачи/проекта — inbox endpoint.

Endpoint: POST /api/inbox/email
Тело: {"to": "task-{id}-{token}@inbox.domain", "from": "...", "subject": "...", "body": "..."}
Роутер разбирает адрес и:
- task-{id}-{token} → добавляет комментарий к задаче
- project-{id}-{token} → создаёт задачу в проекте

Ожидается что перед этим MX/SMTP роутер (Postfix, SES-inbound, Mailgun) POST-ит нам письмо.
"""
import re
import secrets
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel

from ..database import get_db
from ..config import settings
from ..models import Task, Project, Comment
from ..schemas.common import Message
from .deps import TenantContext, get_current_context, log_action


router = APIRouter(prefix="/api/inbox", tags=["task-inbox"])


TASK_ADDR = re.compile(r"^task-(\d+)-([a-zA-Z0-9]{16,32})@")
PROJECT_ADDR = re.compile(r"^project-(\d+)-([a-zA-Z0-9]{16,32})@")


class InboundEmail(BaseModel):
    to: str
    sender: str
    subject: Optional[str] = ""
    body: Optional[str] = ""


@router.post("/email", response_model=Message)
def receive_email(
    payload: InboundEmail,
    x_inbox_secret: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Приём входящего письма от внешнего SMTP-роутера.

    Аутентификация — shared secret в заголовке X-Inbox-Secret.
    Если INBOX_SECRET не задан в env — эндпоинт отключён.
    """
    inbox_secret = getattr(settings, "INBOX_SECRET", None) or ""
    if not inbox_secret:
        raise HTTPException(503, "Inbox отключён: INBOX_SECRET не задан")
    if x_inbox_secret != inbox_secret:
        raise HTTPException(401, "Неверный inbox secret")

    to = (payload.to or "").strip().lower()

    # Task inbox
    m = TASK_ADDR.match(to)
    if m:
        task_id, token = int(m.group(1)), m.group(2)
        task = db.get(Task, task_id)
        if not task or (task.inbox_token or "") != token:
            raise HTTPException(404, "Task inbox not found")
        author_id = task.author_id  # пометим автора задачи как автора комментария (fallback)
        comment_body = f"**От {payload.sender}:** {payload.subject or ''}\n\n{payload.body or ''}"
        comment = Comment(
            tenant_id=task.tenant_id,
            task_id=task.id,
            author_id=author_id,
            body=comment_body,
        )
        db.add(comment)
        log_action(db, tenant_id=task.tenant_id, user_id=None, action="email_in", entity="task", entity_id=task.id, task_id=task.id, detail=f"from {payload.sender}")
        db.commit()
        return Message(message=f"Comment added to task {task.id}")

    # Project inbox
    m = PROJECT_ADDR.match(to)
    if m:
        proj_id, token = int(m.group(1)), m.group(2)
        proj = db.get(Project, proj_id)
        if not proj or (proj.inbox_token or "") != token:
            raise HTTPException(404, "Project inbox not found")
        task = Task(
            tenant_id=proj.tenant_id,
            project_id=proj.id,
            title=(payload.subject or f"Email от {payload.sender}")[:300],
            description=payload.body or "",
        )
        db.add(task)
        db.flush()
        log_action(db, tenant_id=proj.tenant_id, user_id=None, action="email_in", entity="project", entity_id=proj.id, detail=f"created task {task.id}")
        db.commit()
        return Message(message=f"Task created: {task.id}")

    raise HTTPException(400, f"Unknown inbox address: {to}")


# =============================================================================
# Endpoints для получения адреса задачи/проекта (authenticated)
# =============================================================================

class InboxAddress(BaseModel):
    address: str
    domain: str


def _inbox_domain() -> str:
    return getattr(settings, "INBOX_DOMAIN", None) or "inbox.qadam.local"


@router.post("/task/{task_id}/enable", response_model=InboxAddress)
def enable_task_inbox(task_id: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task or task.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Задача не найдена")
    if not task.inbox_token:
        task.inbox_token = secrets.token_urlsafe(18)[:24]
        db.commit()
    domain = _inbox_domain()
    return InboxAddress(address=f"task-{task.id}-{task.inbox_token}@{domain}", domain=domain)


@router.post("/project/{project_id}/enable", response_model=InboxAddress)
def enable_project_inbox(project_id: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    proj = db.get(Project, project_id)
    if not proj or proj.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Проект не найден")
    if not proj.inbox_token:
        proj.inbox_token = secrets.token_urlsafe(18)[:24]
        db.commit()
    domain = _inbox_domain()
    return InboxAddress(address=f"project-{proj.id}-{proj.inbox_token}@{domain}", domain=domain)


@router.delete("/task/{task_id}/disable", response_model=Message)
def disable_task_inbox(task_id: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task or task.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Задача не найдена")
    task.inbox_token = None
    db.commit()
    return Message(message="Inbox отключён")
