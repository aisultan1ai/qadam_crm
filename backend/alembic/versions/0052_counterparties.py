"""Контрагенты: страна, рег. номер, типы, ответственный и статус у компаний;
привязка документов к контрагенту.

Revision ID: 0052_counterparties
Revises: 0051_legal_entities
Create Date: 2026-11-19
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0052_counterparties"
down_revision: Union[str, None] = "0051_legal_entities"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("companies", sa.Column("country", sa.String(100), nullable=True, server_default="Казахстан"))
    op.add_column("companies", sa.Column("registration_number", sa.String(100), nullable=True))
    op.add_column(
        "companies",
        sa.Column("types", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )
    op.add_column(
        "companies",
        sa.Column(
            "responsible_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_companies_responsible_user_id"),
            nullable=True,
        ),
    )
    op.create_index("ix_companies_responsible_user_id", "companies", ["responsible_user_id"])
    op.add_column("companies", sa.Column("status", sa.String(20), nullable=False, server_default="potential"))
    op.create_index("ix_companies_status", "companies", ["status"])

    op.add_column(
        "documents",
        sa.Column(
            "company_id",
            sa.Integer(),
            sa.ForeignKey("companies.id", ondelete="SET NULL", name="fk_documents_company_id"),
            nullable=True,
        ),
    )
    op.create_index("ix_documents_company_id", "documents", ["company_id"])


def downgrade() -> None:
    op.drop_index("ix_documents_company_id", table_name="documents")
    op.drop_constraint("fk_documents_company_id", "documents", type_="foreignkey")
    op.drop_column("documents", "company_id")
    op.drop_index("ix_companies_status", table_name="companies")
    op.drop_column("companies", "status")
    op.drop_index("ix_companies_responsible_user_id", table_name="companies")
    op.drop_constraint("fk_companies_responsible_user_id", "companies", type_="foreignkey")
    op.drop_column("companies", "responsible_user_id")
    op.drop_column("companies", "types")
    op.drop_column("companies", "registration_number")
    op.drop_column("companies", "country")
