"""ИИ-помощник: включение на уровне компании, лимит запросов в тарифе, журнал запросов

Revision ID: 0059_ai_foundation
Revises: 0058_document_card_versions
"""
from alembic import op
import sqlalchemy as sa

revision = "0059_ai_foundation"
down_revision = "0058_document_card_versions"
branch_labels = None
depends_on = None

AI_FEATURE_LINE = "ИИ-помощник: письма, договоры, вопросы по данным"


def upgrade() -> None:
    # По умолчанию выключено: тексты компании уходят во внешний API только после явного согласия владельца
    op.add_column("tenants", sa.Column("ai_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    # Запросов к ИИ в месяц на компанию; 0 — ИИ на тарифе недоступен. ИИ входит в Plan X и Enterprise.
    op.add_column("plans", sa.Column("ai_requests_per_month", sa.Integer(), nullable=False, server_default="0"))
    op.execute("UPDATE plans SET ai_requests_per_month = 300 WHERE key IN ('plan_x', 'enterprise')")
    # Строка в описании тарифа (лендинг показывает первые 4 строки — ставим второй), если её ещё нет
    conn = op.get_bind()
    for key, text in conn.execute(sa.text("SELECT key, marketing_features FROM plans WHERE key IN ('plan_x', 'enterprise')")):
        lines = [ln for ln in (text or "").split("\n") if ln.strip()]
        if any("ИИ" in ln for ln in lines):
            continue
        lines.insert(1 if lines else 0, AI_FEATURE_LINE)
        conn.execute(sa.text("UPDATE plans SET marketing_features = :t WHERE key = :k"), {"t": "\n".join(lines), "k": key})
    op.create_table(
        "ai_usage",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("feature", sa.String(50), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("model", sa.String(80), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_ai_usage_tenant_created", "ai_usage", ["tenant_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_ai_usage_tenant_created", table_name="ai_usage")
    op.drop_table("ai_usage")
    op.drop_column("plans", "ai_requests_per_month")
    op.drop_column("tenants", "ai_enabled")
