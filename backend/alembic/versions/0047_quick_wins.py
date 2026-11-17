"""Быстрые улучшения: заявки на интеграции, API-токены, отрасль и мастер запуска, язык интерфейса

Revision ID: 0047_quick_wins
Revises: 0046_department_members
Create Date: 2026-11-17
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0047_quick_wins"
down_revision: Union[str, None] = "0046_department_members"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # «Хочу эту интеграцию» — сбор спроса
    op.create_table(
        "integration_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code", sa.String(50), nullable=False, index=True),
        sa.Column("comment", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "user_id", "code", name="uq_integration_request"),
    )
    # Сервисные API-токены компании
    op.create_table(
        "api_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("token_prefix", sa.String(16), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("permission_codes", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    # Мастер первого запуска
    op.add_column("tenants", sa.Column("industry", sa.String(50), nullable=True))
    op.add_column("tenants", sa.Column("onboarding_completed_at", sa.DateTime(timezone=True), nullable=True))
    # Уже работающие компании мастер не показывает
    op.execute("UPDATE tenants SET onboarding_completed_at = now()")
    # Лимит API-запросов по тарифу (было 60/мин у всех). Меняем только нетронутое значение по умолчанию.
    for key, rate in (("plan_a", 120), ("plan_b", 300), ("plan_x", 600)):
        op.execute(f"UPDATE plans SET api_rate_per_min = {rate} WHERE key = '{key}' AND api_rate_per_min = 60")
    # Язык интерфейса
    op.add_column("users", sa.Column("language", sa.String(5), nullable=False, server_default="ru"))


def downgrade() -> None:
    op.drop_column("users", "language")
    op.drop_column("tenants", "onboarding_completed_at")
    op.drop_column("tenants", "industry")
    op.drop_table("api_tokens")
    op.drop_table("integration_requests")
