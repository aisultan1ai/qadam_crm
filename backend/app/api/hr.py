"""API M11: HR-профили, скиллы, цели, 1-on-1, кудос, оргструктура."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, aliased

from ..database import get_db
from ..models import (
    Skill, UserSkill, Goal, OneOnOne, Kudos, GoalStatus, KudosBadge, SkillLevel,
    User, Department, TenantMembership,
)
from ..schemas.hr import (
    SkillOut, SkillCreate, SkillUpdate,
    UserSkillOut, UserSkillAssign,
    GoalOut, GoalCreate, GoalUpdate,
    OneOnOneOut, OneOnOneCreate, OneOnOneUpdate,
    KudosOut, KudosCreate,
    OrgChartOut, OrgChartUser, OrgChartDepartment,
    BirthdayUser,
)
from ..schemas.common import Message
from .deps import TenantContext, require, get_current_context, log_action

router = APIRouter(prefix="/api/hr", tags=["hr"])


# =========================================================================
# Helpers
# =========================================================================

def _assert_tenant_member(db: Session, tenant_id: int, user_id: int) -> User:
    """Проверяет, что user_id принадлежит tenant'у. Возвращает User или 404."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    is_member = (
        db.query(TenantMembership.id)
        .filter(TenantMembership.tenant_id == tenant_id, TenantMembership.user_id == user_id)
        .first()
    )
    if not is_member:
        raise HTTPException(404, "Пользователь не найден")
    return user


# =========================================================================
# SKILLS (справочник tenant-скиллов)
# =========================================================================

@router.get("/skills", response_model=List[SkillOut])
def list_skills(
    q: Optional[str] = None,
    category: Optional[str] = None,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    query = db.query(Skill).filter(Skill.tenant_id == ctx.tenant.id)
    if q:
        query = query.filter(Skill.name.ilike(f"%{q.strip()}%"))
    if category:
        query = query.filter(Skill.category == category)
    return query.order_by(Skill.category.nullslast(), Skill.name).all()


@router.post("/skills", response_model=SkillOut, status_code=201)
def create_skill(
    payload: SkillCreate,
    ctx: TenantContext = Depends(require("hr.manage_skills")),
    db: Session = Depends(get_db),
):
    exists = (
        db.query(Skill)
        .filter(Skill.tenant_id == ctx.tenant.id, Skill.name == payload.name)
        .first()
    )
    if exists:
        raise HTTPException(400, "Скилл с таким названием уже существует")
    skill = Skill(tenant_id=ctx.tenant.id, name=payload.name, category=payload.category)
    db.add(skill)
    db.commit()
    db.refresh(skill)
    return skill


@router.patch("/skills/{skill_id}", response_model=SkillOut)
def update_skill(
    skill_id: int,
    payload: SkillUpdate,
    ctx: TenantContext = Depends(require("hr.manage_skills")),
    db: Session = Depends(get_db),
):
    skill = db.get(Skill, skill_id)
    if not skill or skill.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Скилл не найден")
    if payload.name is not None and payload.name != skill.name:
        conflict = (
            db.query(Skill.id)
            .filter(Skill.tenant_id == ctx.tenant.id, Skill.name == payload.name, Skill.id != skill_id)
            .first()
        )
        if conflict:
            raise HTTPException(400, "Скилл с таким названием уже существует")
        skill.name = payload.name
    if payload.category is not None:
        skill.category = payload.category or None
    db.commit()
    db.refresh(skill)
    return skill


@router.delete("/skills/{skill_id}", response_model=Message)
def delete_skill(
    skill_id: int,
    ctx: TenantContext = Depends(require("hr.manage_skills")),
    db: Session = Depends(get_db),
):
    skill = db.get(Skill, skill_id)
    if not skill or skill.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Скилл не найден")
    db.delete(skill)
    db.commit()
    return Message(message="Скилл удалён")


# =========================================================================
# USER SKILLS
# =========================================================================

@router.get("/users/{user_id}/skills", response_model=List[UserSkillOut])
def user_skills(
    user_id: int,
    ctx: TenantContext = Depends(require("hr.view_profiles")),
    db: Session = Depends(get_db),
):
    _assert_tenant_member(db, ctx.tenant.id, user_id)
    return (
        db.query(UserSkill)
        .filter(UserSkill.tenant_id == ctx.tenant.id, UserSkill.user_id == user_id)
        .all()
    )


@router.post("/users/{user_id}/skills", response_model=UserSkillOut, status_code=201)
def assign_user_skill(
    user_id: int,
    payload: UserSkillAssign,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    # Скиллы — персональные: только сам пользователь может их добавлять/менять.
    if user_id != ctx.user.id:
        raise HTTPException(403, "Скиллы может редактировать только владелец профиля")

    _assert_tenant_member(db, ctx.tenant.id, user_id)
    skill = db.get(Skill, payload.skill_id)
    if not skill or skill.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Скилл не найден")

    existing = (
        db.query(UserSkill)
        .filter(UserSkill.user_id == user_id, UserSkill.skill_id == payload.skill_id)
        .first()
    )
    if existing:
        existing.level = SkillLevel(payload.level)
        db.commit()
        db.refresh(existing)
        return existing

    us = UserSkill(
        tenant_id=ctx.tenant.id,
        user_id=user_id,
        skill_id=payload.skill_id,
        level=SkillLevel(payload.level),
    )
    db.add(us)
    db.commit()
    db.refresh(us)
    return us


@router.delete("/users/{user_id}/skills/{skill_id}", response_model=Message)
def remove_user_skill(
    user_id: int,
    skill_id: int,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    if user_id != ctx.user.id:
        raise HTTPException(403, "Скиллы может редактировать только владелец профиля")

    us = (
        db.query(UserSkill)
        .filter(
            UserSkill.tenant_id == ctx.tenant.id,
            UserSkill.user_id == user_id,
            UserSkill.skill_id == skill_id,
        )
        .first()
    )
    if not us:
        raise HTTPException(404, "Скилл не найден у пользователя")
    db.delete(us)
    db.commit()
    return Message(message="Скилл удалён")


# =========================================================================
# GOALS
# =========================================================================

@router.get("/goals", response_model=List[GoalOut])
def list_goals(
    user_id: Optional[int] = None,
    status: Optional[str] = None,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    query = db.query(Goal).filter(Goal.tenant_id == ctx.tenant.id)

    # По умолчанию — свои цели. Чужие — только с permission hr.view_profiles.
    if user_id is not None and user_id != ctx.user.id:
        from ..core.permissions import user_has
        if not user_has(ctx.user, ("hr.view_profiles",)):
            raise HTTPException(403, "Forbidden")
        query = query.filter(Goal.user_id == user_id)
    elif user_id == ctx.user.id or user_id is None:
        query = query.filter(Goal.user_id == ctx.user.id)

    if status:
        query = query.filter(Goal.status == GoalStatus(status))

    return query.order_by(Goal.deadline.nullslast(), Goal.id.desc()).all()


@router.post("/goals", response_model=GoalOut, status_code=201)
def create_goal(
    payload: GoalCreate,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    # Цели — персональные: только владелец создаёт свои.
    if payload.user_id != ctx.user.id:
        raise HTTPException(403, "Цели может создавать только сам сотрудник")
    _assert_tenant_member(db, ctx.tenant.id, payload.user_id)

    goal = Goal(
        tenant_id=ctx.tenant.id,
        user_id=payload.user_id,
        title=payload.title,
        description=payload.description,
        target_value=payload.target_value,
        current_value=payload.current_value,
        unit=payload.unit,
        deadline=payload.deadline,
        status=GoalStatus(payload.status),
        created_by_id=ctx.user.id,
        completed_at=datetime.now(timezone.utc) if payload.status == "completed" else None,
    )
    db.add(goal)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="create", entity="goal", entity_id=None, detail=payload.title)
    db.commit()
    db.refresh(goal)
    return goal


@router.patch("/goals/{goal_id}", response_model=GoalOut)
def update_goal(
    goal_id: int,
    payload: GoalUpdate,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    goal = db.get(Goal, goal_id)
    if not goal or goal.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Цель не найдена")

    # Цели — персональные: только сам владелец может их менять.
    if goal.user_id != ctx.user.id:
        raise HTTPException(403, "Цели может редактировать только владелец")

    if payload.title is not None:
        goal.title = payload.title
    if payload.description is not None:
        goal.description = payload.description or None
    if payload.target_value is not None:
        goal.target_value = payload.target_value
    if payload.current_value is not None:
        goal.current_value = payload.current_value
    if payload.unit is not None:
        goal.unit = payload.unit or None
    if payload.deadline is not None:
        goal.deadline = payload.deadline
    if payload.status is not None:
        new_status = GoalStatus(payload.status)
        if new_status == GoalStatus.completed and goal.status != GoalStatus.completed:
            goal.completed_at = datetime.now(timezone.utc)
        elif new_status != GoalStatus.completed:
            goal.completed_at = None
        goal.status = new_status

    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="goal", entity_id=goal.id)
    db.commit()
    db.refresh(goal)
    return goal


@router.delete("/goals/{goal_id}", response_model=Message)
def delete_goal(
    goal_id: int,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    goal = db.get(Goal, goal_id)
    if not goal or goal.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Цель не найдена")
    if goal.user_id != ctx.user.id:
        raise HTTPException(403, "Цели может удалять только владелец")
    db.delete(goal)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="delete", entity="goal", entity_id=goal_id)
    db.commit()
    return Message(message="Цель удалена")


# =========================================================================
# ONE-ON-ONES
# =========================================================================

@router.get("/one-on-ones", response_model=List[OneOnOneOut])
def list_one_on_ones(
    scope: str = Query("all", pattern="^(all|as_manager|as_report)$"),
    upcoming_only: bool = False,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    query = db.query(OneOnOne).filter(OneOnOne.tenant_id == ctx.tenant.id)
    if scope == "as_manager":
        query = query.filter(OneOnOne.manager_id == ctx.user.id)
    elif scope == "as_report":
        query = query.filter(OneOnOne.report_id == ctx.user.id)
    else:
        query = query.filter(
            or_(OneOnOne.manager_id == ctx.user.id, OneOnOne.report_id == ctx.user.id)
        )
    if upcoming_only:
        query = query.filter(OneOnOne.scheduled_at >= datetime.now(timezone.utc))
    return query.order_by(OneOnOne.scheduled_at.desc()).limit(200).all()


@router.post("/one-on-ones", response_model=OneOnOneOut, status_code=201)
def create_one_on_one(
    payload: OneOnOneCreate,
    ctx: TenantContext = Depends(require("hr.manage_one_on_ones")),
    db: Session = Depends(get_db),
):
    report = _assert_tenant_member(db, ctx.tenant.id, payload.report_id)
    if report.id == ctx.user.id:
        raise HTTPException(400, "Нельзя запланировать 1-on-1 с самим собой")

    meeting = OneOnOne(
        tenant_id=ctx.tenant.id,
        manager_id=ctx.user.id,
        report_id=payload.report_id,
        scheduled_at=payload.scheduled_at,
        duration_min=payload.duration_min,
        agenda=payload.agenda,
    )
    db.add(meeting)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="create", entity="one_on_one", entity_id=None, detail=f"with user {report.id}")
    db.commit()
    db.refresh(meeting)
    return meeting


@router.patch("/one-on-ones/{meeting_id}", response_model=OneOnOneOut)
def update_one_on_one(
    meeting_id: int,
    payload: OneOnOneUpdate,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    m = db.get(OneOnOne, meeting_id)
    if not m or m.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Встреча не найдена")
    is_manager = m.manager_id == ctx.user.id
    is_report = m.report_id == ctx.user.id
    if not (is_manager or is_report):
        raise HTTPException(403, "Forbidden")

    # Manager может менять расписание/agenda/notes_manager/completion.
    # Report — только свои notes_report.
    if is_manager:
        if payload.scheduled_at is not None:
            m.scheduled_at = payload.scheduled_at
        if payload.duration_min is not None:
            m.duration_min = payload.duration_min
        if payload.agenda is not None:
            m.agenda = payload.agenda or None
        if payload.notes_manager is not None:
            m.notes_manager = payload.notes_manager or None
        if payload.is_completed is not None:
            if payload.is_completed and not m.is_completed:
                m.completed_at = datetime.now(timezone.utc)
            elif not payload.is_completed:
                m.completed_at = None
            m.is_completed = payload.is_completed

    if payload.notes_report is not None:
        # Report пишет свои заметки; manager тоже может (для консистентности).
        m.notes_report = payload.notes_report or None

    db.commit()
    db.refresh(m)
    return m


@router.delete("/one-on-ones/{meeting_id}", response_model=Message)
def delete_one_on_one(
    meeting_id: int,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    m = db.get(OneOnOne, meeting_id)
    if not m or m.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Встреча не найдена")
    if m.manager_id != ctx.user.id:
        raise HTTPException(403, "Только организатор может удалить встречу")
    db.delete(m)
    db.commit()
    return Message(message="Встреча удалена")


# =========================================================================
# KUDOS
# =========================================================================

@router.get("/kudos", response_model=List[KudosOut])
def list_kudos(
    to_user_id: Optional[int] = None,
    from_user_id: Optional[int] = None,
    limit: int = Query(50, ge=1, le=200),
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    from_alias = aliased(User)
    to_alias = aliased(User)

    query = (
        db.query(Kudos, from_alias, to_alias)
        .join(from_alias, from_alias.id == Kudos.from_user_id)
        .join(to_alias, to_alias.id == Kudos.to_user_id)
        .filter(Kudos.tenant_id == ctx.tenant.id)
    )
    if to_user_id:
        query = query.filter(Kudos.to_user_id == to_user_id)
    if from_user_id:
        query = query.filter(Kudos.from_user_id == from_user_id)

    rows = query.order_by(Kudos.created_at.desc()).limit(limit).all()

    def _brief(u: User) -> dict:
        return {"id": u.id, "name": u.name, "email": u.email, "avatar_url": u.avatar_url}

    return [
        {
            "id": k.id,
            "from_user_id": k.from_user_id,
            "to_user_id": k.to_user_id,
            "from_user": _brief(fu),
            "to_user": _brief(tu),
            "message": k.message,
            "badge": k.badge.value if hasattr(k.badge, "value") else k.badge,
            "created_at": k.created_at,
        }
        for k, fu, tu in rows
    ]


@router.post("/kudos", response_model=KudosOut, status_code=201)
def give_kudos(
    payload: KudosCreate,
    ctx: TenantContext = Depends(require("kudos.give")),
    db: Session = Depends(get_db),
):
    if payload.to_user_id == ctx.user.id:
        raise HTTPException(400, "Нельзя дать кудос самому себе")
    _assert_tenant_member(db, ctx.tenant.id, payload.to_user_id)

    k = Kudos(
        tenant_id=ctx.tenant.id,
        from_user_id=ctx.user.id,
        to_user_id=payload.to_user_id,
        message=payload.message,
        badge=KudosBadge(payload.badge),
    )
    db.add(k)
    db.commit()
    db.refresh(k)

    from_u = ctx.user
    to_u = db.get(User, payload.to_user_id)
    return {
        "id": k.id,
        "from_user_id": k.from_user_id,
        "to_user_id": k.to_user_id,
        "from_user": {"id": from_u.id, "name": from_u.name, "email": from_u.email, "avatar_url": from_u.avatar_url},
        "to_user": {"id": to_u.id, "name": to_u.name, "email": to_u.email, "avatar_url": to_u.avatar_url},
        "message": k.message,
        "badge": k.badge.value if hasattr(k.badge, "value") else k.badge,
        "created_at": k.created_at,
    }


# =========================================================================
# ORG-CHART
# =========================================================================

@router.get("/org-chart", response_model=OrgChartOut)
def org_chart(
    ctx: TenantContext = Depends(require("hr.view_profiles")),
    db: Session = Depends(get_db),
):
    users = (
        db.query(User)
        .join(TenantMembership, TenantMembership.user_id == User.id)
        .filter(TenantMembership.tenant_id == ctx.tenant.id, User.is_active == True)  # noqa: E712
        .order_by(User.name)
        .all()
    )
    departments = (
        db.query(Department)
        .filter(Department.tenant_id == ctx.tenant.id)
        .order_by(Department.name)
        .all()
    )
    return OrgChartOut(
        users=[
            OrgChartUser(
                id=u.id, name=u.name, email=u.email, avatar_url=u.avatar_url,
                position=u.position, department_id=u.department_id, manager_id=u.manager_id,
            )
            for u in users
        ],
        departments=[
            OrgChartDepartment(id=d.id, name=d.name, parent_id=d.parent_id, head_user_id=d.head_user_id)
            for d in departments
        ],
    )


# =========================================================================
# BIRTHDAYS
# =========================================================================

@router.get("/birthdays", response_model=List[BirthdayUser])
def upcoming_birthdays(
    days_ahead: int = Query(30, ge=1, le=365),
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    today = date.today()
    horizon = today + timedelta(days=days_ahead)

    users = (
        db.query(User, Department.name.label("dep_name"))
        .join(TenantMembership, TenantMembership.user_id == User.id)
        .outerjoin(Department, Department.id == User.department_id)
        .filter(
            TenantMembership.tenant_id == ctx.tenant.id,
            User.is_active == True,  # noqa: E712
            User.birthday.is_not(None),
        )
        .all()
    )

    result: list[BirthdayUser] = []
    for u, dep_name in users:
        bday = u.birthday
        # Ближайший ДР в этом или следующем году.
        this_year = bday.replace(year=today.year)
        if this_year < today:
            this_year = bday.replace(year=today.year + 1)
        if this_year > horizon:
            continue
        days = (this_year - today).days
        result.append(
            BirthdayUser(
                id=u.id, name=u.name, avatar_url=u.avatar_url,
                position=u.position, department=dep_name,
                birthday=bday, days_until=days,
            )
        )

    result.sort(key=lambda x: x.days_until)
    return result
