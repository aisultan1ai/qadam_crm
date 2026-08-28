"""Plans table: тарифы вынесены в БД (управляются платформенным админом)

Revision ID: 0013_plans_table
Revises: 0012_trigram_search
Create Date: 2026-08-27
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0013_plans"
down_revision: Union[str, None] = "0012_trigram"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


DEFAULT_PLANS = [
    {
        "key": "free",
        "title": "Free",
        "tagline": "Для знакомства с CRM и небольших команд",
        "price_month": 0,
        "currency": "KZT",
        "max_users": 5,
        "max_projects": 3,
        "max_storage_bytes": 1 * 1024 * 1024 * 1024,
        "api_rate_per_min": 60,
        "feature_export": False,
        "feature_import": False,
        "feature_invitations": True,
        "feature_lead_forms": False,
        "feature_analytics_cache": False,
        "feature_branding": False,
        "feature_custom_subdomain": False,
        "feature_priority_support": False,
        "marketing_features": (
            "До 5 пользователей\n"
            "До 3 проектов\n"
            "1 ГБ файлов\n"
            "Kanban, чек-листы, комментарии\n"
            "Email-уведомления"
        ),
        "sort_order": 10,
    },
    {
        "key": "pro",
        "title": "Pro",
        "tagline": "Для растущих компаний, где CRM — рабочий инструмент",
        "price_month": 9990,
        "currency": "KZT",
        "max_users": 50,
        "max_projects": 50,
        "max_storage_bytes": 20 * 1024 * 1024 * 1024,
        "api_rate_per_min": 300,
        "feature_export": True,
        "feature_import": True,
        "feature_invitations": True,
        "feature_lead_forms": True,
        "feature_analytics_cache": True,
        "feature_branding": False,
        "feature_custom_subdomain": False,
        "feature_priority_support": True,
        "marketing_features": (
            "До 50 пользователей\n"
            "До 50 проектов\n"
            "20 ГБ файлов\n"
            "Экспорт задач в Excel и CSV-импорт\n"
            "Формы захвата лидов\n"
            "Redis-кэш аналитики\n"
            "Приоритетная поддержка"
        ),
        "sort_order": 20,
    },
    {
        "key": "enterprise",
        "title": "Enterprise",
        "tagline": "Для крупных компаний с особыми требованиями",
        "price_month": None,
        "currency": "KZT",
        "max_users": None,
        "max_projects": None,
        "max_storage_bytes": None,
        "api_rate_per_min": 1000,
        "feature_export": True,
        "feature_import": True,
        "feature_invitations": True,
        "feature_lead_forms": True,
        "feature_analytics_cache": True,
        "feature_branding": True,
        "feature_custom_subdomain": True,
        "feature_priority_support": True,
        "marketing_features": (
            "Без лимитов на пользователей, проекты и хранилище\n"
            "Кастомный поддомен (acme.qadam.kz)\n"
            "Брендирование: логотип и цвет\n"
            "SLA и приоритетная поддержка\n"
            "Индивидуальные интеграции"
        ),
        "sort_order": 30,
    },
]


def upgrade() -> None:
    op.create_table(
        "plans",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=100), nullable=False),
        sa.Column("tagline", sa.String(length=300), nullable=True),
        sa.Column("price_month", sa.Integer(), nullable=True),
        sa.Column("currency", sa.String(length=8), nullable=False, server_default="KZT"),
        sa.Column("max_users", sa.Integer(), nullable=True),
        sa.Column("max_projects", sa.Integer(), nullable=True),
        sa.Column("max_storage_bytes", sa.BigInteger(), nullable=True),
        sa.Column("api_rate_per_min", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("feature_export", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("feature_import", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("feature_invitations", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("feature_lead_forms", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("feature_analytics_cache", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("feature_branding", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("feature_custom_subdomain", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("feature_priority_support", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("marketing_features", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("key", name="uq_plans_key"),
    )
    op.create_index("ix_plans_key", "plans", ["key"], unique=True)

    plans_table = sa.table(
        "plans",
        sa.column("key", sa.String),
        sa.column("title", sa.String),
        sa.column("tagline", sa.String),
        sa.column("price_month", sa.Integer),
        sa.column("currency", sa.String),
        sa.column("max_users", sa.Integer),
        sa.column("max_projects", sa.Integer),
        sa.column("max_storage_bytes", sa.BigInteger),
        sa.column("api_rate_per_min", sa.Integer),
        sa.column("feature_export", sa.Boolean),
        sa.column("feature_import", sa.Boolean),
        sa.column("feature_invitations", sa.Boolean),
        sa.column("feature_lead_forms", sa.Boolean),
        sa.column("feature_analytics_cache", sa.Boolean),
        sa.column("feature_branding", sa.Boolean),
        sa.column("feature_custom_subdomain", sa.Boolean),
        sa.column("feature_priority_support", sa.Boolean),
        sa.column("marketing_features", sa.Text),
        sa.column("sort_order", sa.Integer),
    )
    op.bulk_insert(plans_table, DEFAULT_PLANS)


def downgrade() -> None:
    op.drop_index("ix_plans_key", table_name="plans")
    op.drop_table("plans")
