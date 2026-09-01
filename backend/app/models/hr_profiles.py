"""M11 — HR-профили: скиллы, цели, 1-on-1, кудос.

Skill — справочник tenant-скиллов. UserSkill — M2M юзер↔скилл + уровень.
Goal — KPI/цель сотрудника (target_value/current_value + deadline).
OneOnOne — планируемая 1-on-1 встреча (manager↔report + заметки обеих сторон).
Kudos — благодарности между сотрудниками.
"""
from datetime import date, datetime
from enum import Enum
from typing import Optional

from sqlalchemy import (
    Boolean, Date, DateTime, Enum as SAEnum, ForeignKey, Index, Integer, Numeric, String, Text,
    UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class SkillLevel(str, Enum):
    novice = "novice"
    intermediate = "intermediate"
    expert = "expert"


class GoalStatus(str, Enum):
    not_started = "not_started"
    in_progress = "in_progress"
    completed = "completed"
    cancelled = "cancelled"


class KudosBadge(str, Enum):
    teamwork = "teamwork"
    innovation = "innovation"
    help_other = "help_other"
    excellence = "excellence"


class Skill(Base):
    __tablename__ = "skills"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_skills_tenant_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    category: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class UserSkill(Base):
    __tablename__ = "user_skills"
    __table_args__ = (
        UniqueConstraint("user_id", "skill_id", name="uq_user_skills_user_skill"),
        Index("ix_user_skills_skill", "skill_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    skill_id: Mapped[int] = mapped_column(ForeignKey("skills.id", ondelete="CASCADE"))
    level: Mapped[SkillLevel] = mapped_column(
        SAEnum(SkillLevel, name="skill_level"),
        default=SkillLevel.intermediate,
        server_default="intermediate",
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    skill: Mapped["Skill"] = relationship("Skill", lazy="joined")


class Goal(Base):
    __tablename__ = "goals"
    __table_args__ = (
        Index("ix_goals_user_deadline", "user_id", "deadline"),
        Index("ix_goals_tenant_status", "tenant_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    target_value: Mapped[Optional[float]] = mapped_column(Numeric(15, 2), nullable=True)
    current_value: Mapped[Optional[float]] = mapped_column(Numeric(15, 2), nullable=True)
    unit: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)

    deadline: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    status: Mapped[GoalStatus] = mapped_column(
        SAEnum(GoalStatus, name="goal_status"),
        default=GoalStatus.not_started,
        server_default="not_started",
    )

    created_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class OneOnOne(Base):
    __tablename__ = "one_on_ones"
    __table_args__ = (
        Index("ix_one_on_ones_manager", "manager_id", "scheduled_at"),
        Index("ix_one_on_ones_report", "report_id", "scheduled_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)

    manager_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration_min: Mapped[int] = mapped_column(Integer, default=30, server_default="30")

    agenda: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes_manager: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes_report: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    is_completed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )


class Kudos(Base):
    __tablename__ = "kudos"
    __table_args__ = (
        Index("ix_kudos_to_user", "to_user_id", "created_at"),
        Index("ix_kudos_from_user", "from_user_id", "created_at"),
        Index("ix_kudos_tenant_created", "tenant_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)

    from_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    to_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    message: Mapped[str] = mapped_column(String(500))
    badge: Mapped[KudosBadge] = mapped_column(
        SAEnum(KudosBadge, name="kudos_badge"),
        default=KudosBadge.teamwork,
        server_default="teamwork",
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
