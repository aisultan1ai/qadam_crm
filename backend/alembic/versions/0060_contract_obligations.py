"""Обязательства и сроки по договорам (contract_obligations)

Revision ID: 0060_contract_obligations
Revises: 0059_ai_foundation
"""
from alembic import op
import sqlalchemy as sa

revision = "0060_contract_obligations"
down_revision = "0059_ai_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "contract_obligations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("contract_id", sa.Integer(), sa.ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("party", sa.String(20), nullable=False, server_default="us"),
        sa.Column("status", sa.String(10), nullable=False, server_default="open"),
        sa.Column("source_quote", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_contract_obligations_tenant_id", "contract_obligations", ["tenant_id"])
    op.create_index("ix_contract_obligations_contract_id", "contract_obligations", ["contract_id"])
    op.create_index("ix_contract_obligations_tenant_due", "contract_obligations", ["tenant_id", "status", "due_date"])


def downgrade() -> None:
    op.drop_index("ix_contract_obligations_tenant_due", table_name="contract_obligations")
    op.drop_index("ix_contract_obligations_contract_id", table_name="contract_obligations")
    op.drop_index("ix_contract_obligations_tenant_id", table_name="contract_obligations")
    op.drop_table("contract_obligations")
