"""Offtake-воронка сделок (включается в настройках компании)

- tenants.offtake_enabled — переключатель «Продажи и offtake»;
- offtake_products — справочник продуктов компании (заполняет сама компания, без начальных строк);
- deals: pipeline (sales/offtake), offtake_stage, причины отказа, параметры offtake-контракта,
  probability_manual (вероятность задана вручную — смена стадии её не перезаписывает);
- documents: deal_id + doc_kind (NDA, LOI, MOU, Term Sheet, договор, другое) — документы сделки.

Revision ID: 0055_offtake
Revises: 0054_task_assignees_sync
Create Date: 2026-11-19
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0055_offtake"
down_revision: Union[str, None] = "0054_task_assignees_sync"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tenants", sa.Column("offtake_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))

    op.create_table(
        "offtake_products",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_offtake_products_tenant_id", "offtake_products", ["tenant_id"])

    op.add_column("deals", sa.Column("pipeline", sa.String(20), nullable=False, server_default="sales"))
    op.add_column("deals", sa.Column("offtake_stage", sa.String(30), nullable=True))
    op.add_column("deals", sa.Column("probability_manual", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("deals", sa.Column("loss_reason", sa.String(20), nullable=True))
    op.add_column("deals", sa.Column("loss_comment", sa.Text(), nullable=True))
    op.add_column(
        "deals",
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("offtake_products.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column("deals", sa.Column("volume_tpy", sa.Numeric(18, 3), nullable=True))
    op.add_column("deals", sa.Column("term_years", sa.Integer(), nullable=True))
    op.add_column("deals", sa.Column("start_year", sa.Integer(), nullable=True))
    op.add_column("deals", sa.Column("total_volume", sa.Numeric(20, 3), nullable=True))
    op.add_column("deals", sa.Column("price_type", sa.String(20), nullable=True))
    op.add_column("deals", sa.Column("price_value", sa.Numeric(18, 2), nullable=True))
    op.add_column("deals", sa.Column("index_name", sa.String(200), nullable=True))
    op.add_column("deals", sa.Column("discount_value", sa.Numeric(18, 2), nullable=True))
    op.add_column("deals", sa.Column("discount_unit", sa.String(10), nullable=True))
    op.add_column("deals", sa.Column("incoterms", sa.String(5), nullable=True))
    op.add_column("deals", sa.Column("delivery_point", sa.String(300), nullable=True))
    op.create_index("ix_deals_tenant_pipeline", "deals", ["tenant_id", "pipeline"])
    op.create_index("ix_deals_product_id", "deals", ["product_id"])

    op.add_column(
        "documents",
        sa.Column("deal_id", sa.Integer(), sa.ForeignKey("deals.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column("documents", sa.Column("doc_kind", sa.String(20), nullable=True))
    op.create_index("ix_documents_deal_id", "documents", ["deal_id"])


def downgrade() -> None:
    op.drop_index("ix_documents_deal_id", table_name="documents")
    op.drop_column("documents", "doc_kind")
    op.drop_column("documents", "deal_id")

    op.drop_index("ix_deals_product_id", table_name="deals")
    op.drop_index("ix_deals_tenant_pipeline", table_name="deals")
    for col in (
        "delivery_point", "incoterms", "discount_unit", "discount_value", "index_name", "price_value",
        "price_type", "total_volume", "start_year", "term_years", "volume_tpy", "product_id",
        "loss_comment", "loss_reason", "probability_manual", "offtake_stage", "pipeline",
    ):
        op.drop_column("deals", col)

    op.drop_index("ix_offtake_products_tenant_id", table_name="offtake_products")
    op.drop_table("offtake_products")
    op.drop_column("tenants", "offtake_enabled")
