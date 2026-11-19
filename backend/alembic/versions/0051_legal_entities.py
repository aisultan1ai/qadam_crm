"""Юрлица компании: таблица legal_entities, юрлицо по умолчанию для каждой компании,
ссылка legal_entity_id у сделок, проектов и документов.

Revision ID: 0051_legal_entities
Revises: 0050_plan_requests
Create Date: 2026-11-19
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0051_legal_entities"
down_revision: Union[str, None] = "0050_plan_requests"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


REF_TABLES = ("deals", "projects", "documents")


def upgrade() -> None:
    op.create_table(
        "legal_entities",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("full_name", sa.String(300), nullable=False),
        sa.Column("short_name", sa.String(200), nullable=False),
        sa.Column("bin", sa.String(12), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("director_name", sa.String(200), nullable=True),
        sa.Column("director_position", sa.String(200), nullable=True),
        sa.Column("logo_url", sa.String(500), nullable=True),
        sa.Column("currency", sa.String(3), nullable=False, server_default="KZT"),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_legal_entities_tenant_default", "legal_entities", ["tenant_id", "is_default"])

    # Каждой существующей компании — юрлицо по умолчанию с её названием.
    op.execute(
        """
        INSERT INTO legal_entities (tenant_id, full_name, short_name, currency, is_default, is_active)
        SELECT t.id,
               LEFT(COALESCE(NULLIF(TRIM(t.company_display_name), ''), t.name), 300),
               LEFT(COALESCE(NULLIF(TRIM(t.company_display_name), ''), t.name), 200),
               'KZT', TRUE, TRUE
        FROM tenants t
        """
    )

    for table in REF_TABLES:
        op.add_column(
            table,
            sa.Column(
                "legal_entity_id",
                sa.Integer(),
                sa.ForeignKey("legal_entities.id", ondelete="SET NULL", name=f"fk_{table}_legal_entity_id"),
                nullable=True,
            ),
        )
        op.create_index(f"ix_{table}_legal_entity_id", table, ["legal_entity_id"])
        op.execute(
            f"""
            UPDATE {table} AS x
            SET legal_entity_id = le.id
            FROM legal_entities le
            WHERE le.tenant_id = x.tenant_id AND le.is_default = TRUE
              AND x.legal_entity_id IS NULL
            """
        )


def downgrade() -> None:
    for table in REF_TABLES:
        op.drop_index(f"ix_{table}_legal_entity_id", table_name=table)
        op.drop_constraint(f"fk_{table}_legal_entity_id", table, type_="foreignkey")
        op.drop_column(table, "legal_entity_id")
    op.drop_index("ix_legal_entities_tenant_default", table_name="legal_entities")
    op.drop_table("legal_entities")
