"""Карточка документа (номер, дата, статус, связи с записями) и версии (имя файла, тип, SHA-256)

Revision ID: 0058_document_card_versions
Revises: 0057_notification_link
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0058_document_card_versions"
down_revision = "0057_notification_link"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("doc_number", sa.String(100), nullable=True))
    op.add_column("documents", sa.Column("doc_date", sa.Date(), nullable=True))
    op.add_column("documents", sa.Column("doc_status", sa.String(20), nullable=True))
    op.add_column("documents", sa.Column("links", JSONB(), nullable=False, server_default="[]"))
    op.add_column("document_versions", sa.Column("filename", sa.String(300), nullable=True))
    op.add_column("document_versions", sa.Column("mime", sa.String(150), nullable=True))
    op.add_column("document_versions", sa.Column("sha256", sa.String(64), nullable=True))
    # У уже загруженных версий — имя и тип из документа (хэш посчитается при следующей загрузке/выгрузке)
    op.execute(
        "UPDATE document_versions v SET filename = d.name, mime = d.mime FROM documents d WHERE d.id = v.document_id"
    )


def downgrade() -> None:
    for col in ("sha256", "mime", "filename"):
        op.drop_column("document_versions", col)
    for col in ("links", "doc_status", "doc_date", "doc_number"):
        op.drop_column("documents", col)
