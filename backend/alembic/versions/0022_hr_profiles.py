"""M11 HR-профили: skills, user_skills, goals, one_on_ones, kudos + расширение users/departments

Revision ID: 0022_hr_profiles
Revises: 0021_time_tracking
Create Date: 2026-09-01
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0022_hr_profiles"
down_revision: Union[str, None] = "0021_time_tracking"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # === Enums ===
    skill_level = sa.Enum("novice", "intermediate", "expert", name="skill_level")
    goal_status = sa.Enum(
        "not_started", "in_progress", "completed", "cancelled", name="goal_status",
    )
    kudos_badge = sa.Enum(
        "teamwork", "innovation", "help_other", "excellence", name="kudos_badge",
    )

    # === ALTER users: HR-профиль ===
    op.add_column("users", sa.Column("manager_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_users_manager_id", "users", "users", ["manager_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_users_manager_id", "users", ["manager_id"])
    op.add_column("users", sa.Column("position", sa.String(length=150), nullable=True))
    op.add_column("users", sa.Column("phone", sa.String(length=30), nullable=True))
    op.add_column("users", sa.Column("bio", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("birthday", sa.Date(), nullable=True))
    op.add_column("users", sa.Column("hire_date", sa.Date(), nullable=True))

    # === ALTER departments: иерархия + глава ===
    op.add_column("departments", sa.Column("parent_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_departments_parent_id", "departments", "departments",
        ["parent_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_departments_parent_id", "departments", ["parent_id"])
    op.add_column("departments", sa.Column("head_user_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_departments_head_user_id", "departments", "users",
        ["head_user_id"], ["id"], ondelete="SET NULL",
    )

    # === skills ===
    op.create_table(
        "skills",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("category", sa.String(length=50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "name", name="uq_skills_tenant_name"),
    )
    op.create_index("ix_skills_tenant_id", "skills", ["tenant_id"])

    # === user_skills (M2M + level) ===
    op.create_table(
        "user_skills",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("skill_id", sa.Integer(), sa.ForeignKey("skills.id", ondelete="CASCADE"), nullable=False),
        sa.Column("level", skill_level, nullable=False, server_default="intermediate"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "skill_id", name="uq_user_skills_user_skill"),
    )
    op.create_index("ix_user_skills_tenant_id", "user_skills", ["tenant_id"])
    op.create_index("ix_user_skills_user_id", "user_skills", ["user_id"])
    op.create_index("ix_user_skills_skill", "user_skills", ["skill_id"])

    # === goals ===
    op.create_table(
        "goals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("target_value", sa.Numeric(15, 2), nullable=True),
        sa.Column("current_value", sa.Numeric(15, 2), nullable=True),
        sa.Column("unit", sa.String(length=30), nullable=True),
        sa.Column("deadline", sa.Date(), nullable=True),
        sa.Column("status", goal_status, nullable=False, server_default="not_started"),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_goals_tenant_id", "goals", ["tenant_id"])
    op.create_index("ix_goals_user_id", "goals", ["user_id"])
    op.create_index("ix_goals_user_deadline", "goals", ["user_id", "deadline"])
    op.create_index("ix_goals_tenant_status", "goals", ["tenant_id", "status"])

    # === one_on_ones ===
    op.create_table(
        "one_on_ones",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("manager_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("report_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_min", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("agenda", sa.Text(), nullable=True),
        sa.Column("notes_manager", sa.Text(), nullable=True),
        sa.Column("notes_report", sa.Text(), nullable=True),
        sa.Column("is_completed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_one_on_ones_tenant_id", "one_on_ones", ["tenant_id"])
    op.create_index("ix_one_on_ones_manager_id", "one_on_ones", ["manager_id"])
    op.create_index("ix_one_on_ones_report_id", "one_on_ones", ["report_id"])
    op.create_index("ix_one_on_ones_manager", "one_on_ones", ["manager_id", "scheduled_at"])
    op.create_index("ix_one_on_ones_report", "one_on_ones", ["report_id", "scheduled_at"])

    # === kudos ===
    op.create_table(
        "kudos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("to_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("message", sa.String(length=500), nullable=False),
        sa.Column("badge", kudos_badge, nullable=False, server_default="teamwork"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_kudos_tenant_id", "kudos", ["tenant_id"])
    op.create_index("ix_kudos_from_user_id", "kudos", ["from_user_id"])
    op.create_index("ix_kudos_to_user_id", "kudos", ["to_user_id"])
    op.create_index("ix_kudos_to_user", "kudos", ["to_user_id", "created_at"])
    op.create_index("ix_kudos_from_user", "kudos", ["from_user_id", "created_at"])
    op.create_index("ix_kudos_tenant_created", "kudos", ["tenant_id", "created_at"])


def downgrade() -> None:
    for tbl in ("kudos", "one_on_ones", "goals", "user_skills", "skills"):
        op.drop_table(tbl)

    op.drop_constraint("fk_departments_head_user_id", "departments", type_="foreignkey")
    op.drop_column("departments", "head_user_id")
    op.drop_index("ix_departments_parent_id", table_name="departments")
    op.drop_constraint("fk_departments_parent_id", "departments", type_="foreignkey")
    op.drop_column("departments", "parent_id")

    for col in ("hire_date", "birthday", "bio", "phone", "position"):
        op.drop_column("users", col)
    op.drop_index("ix_users_manager_id", table_name="users")
    op.drop_constraint("fk_users_manager_id", "users", type_="foreignkey")
    op.drop_column("users", "manager_id")

    for enum_name in ("kudos_badge", "goal_status", "skill_level"):
        sa.Enum(name=enum_name).drop(op.get_bind(), checkfirst=True)
