from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import or_

from ..database import get_db
from ..models import Task, Project, User, Comment
from ..core.permissions import user_has
from .deps import get_current_user

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("")
def search(q: str, user=Depends(get_current_user), db: Session = Depends(get_db)):
    q = q.strip()
    if not q:
        return {"tasks": [], "projects": [], "users": [], "comments": []}
    like = f"%{q}%"

    tasks: list = []
    if user_has(user, ["tasks.view_all", "tasks.view_own"]):
        tq = db.query(Task).filter(or_(Task.title.ilike(like), Task.description.ilike(like)))
        if not user_has(user, ["tasks.view_all"]):
            tq = tq.filter(or_(Task.assignee_id == user.id, Task.author_id == user.id))
        tasks = [{"id": t.id, "title": t.title, "status": t.status.value, "project_id": t.project_id} for t in tq.limit(20).all()]

    projects: list = []
    if user_has(user, ["projects.view"]):
        pq = db.query(Project).filter(or_(Project.name.ilike(like), Project.description.ilike(like)))
        projects = [{"id": p.id, "name": p.name, "is_archived": p.is_archived} for p in pq.limit(20).all()]

    users: list = []
    if user_has(user, ["users.view"]):
        uq = db.query(User).filter(or_(User.name.ilike(like), User.email.ilike(like)))
        users = [{"id": u.id, "name": u.name, "email": u.email} for u in uq.limit(20).all()]

    comments: list = []
    if user_has(user, ["comments.view"]):
        cq = db.query(Comment).filter(Comment.body.ilike(like))
        comments = [{"id": c.id, "task_id": c.task_id, "body": c.body[:200]} for c in cq.limit(20).all()]

    return {"tasks": tasks, "projects": projects, "users": users, "comments": comments}
