"""notifications.link — куда вести по клику (договор, письмо)

Revision ID: 0057_notification_link
Revises: 0056_contracts
"""
from alembic import op
import sqlalchemy as sa

revision = "0057_notification_link"
down_revision = "0056_contracts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("notifications", sa.Column("link", sa.String(300), nullable=True))
    # Уже отправленные напоминания о договорах: номер есть в заголовке, связи нет — оставляем без ссылки.


def downgrade() -> None:
    op.drop_column("notifications", "link")
