"""Wiki: folders + articles + versions + comments + links + permissions

Revision ID: 0018_wiki
Revises: 0017_mailboxes
Create Date: 2026-08-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0018_wiki"
down_revision: Union[str, None] = "0017_mailboxes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    target_type = sa.Enum("folder", "article", name="wiki_target_type")
    principal_type = sa.Enum("user", "role", name="wiki_principal_type")
    access_level = sa.Enum("view", "edit", "admin", name="wiki_access_level")

    op.create_table(
        "wiki_folders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("wiki_folders.id", ondelete="CASCADE"), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("slug", sa.String(length=200), nullable=False),
        sa.Column("path", sa.String(length=1000), nullable=False, server_default="/"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("icon", sa.String(length=60), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_wiki_folders_tenant_id", "wiki_folders", ["tenant_id"])
    op.create_index("ix_wiki_folders_parent_id", "wiki_folders", ["parent_id"])
    op.create_index("ix_wiki_folders_tenant_parent", "wiki_folders", ["tenant_id", "parent_id"])
    op.create_index("ix_wiki_folders_tenant_path", "wiki_folders", ["tenant_id", "path"])

    op.create_table(
        "wiki_articles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("folder_id", sa.Integer(), sa.ForeignKey("wiki_folders.id", ondelete="SET NULL"), nullable=True),
        sa.Column("slug", sa.String(length=200), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("summary", sa.String(length=500), nullable=True),
        sa.Column("content_md", sa.Text(), nullable=False, server_default=""),
        sa.Column("is_published", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("author_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("last_editor_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("current_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "slug", name="uq_wiki_articles_tenant_slug"),
    )
    op.create_index("ix_wiki_articles_tenant_id", "wiki_articles", ["tenant_id"])
    op.create_index("ix_wiki_articles_folder_id", "wiki_articles", ["folder_id"])
    op.create_index("ix_wiki_articles_tenant_folder", "wiki_articles", ["tenant_id", "folder_id"])

    # tsvector-колонка + GIN индекс (Postgres 'russian' конфигурация)
    op.execute(
        "ALTER TABLE wiki_articles ADD COLUMN content_tsv tsvector "
        "GENERATED ALWAYS AS ("
        "  setweight(to_tsvector('russian', coalesce(title, '')), 'A') || "
        "  setweight(to_tsvector('russian', coalesce(summary, '')), 'B') || "
        "  setweight(to_tsvector('russian', coalesce(content_md, '')), 'C')"
        ") STORED"
    )
    op.execute("CREATE INDEX ix_wiki_articles_content_tsv ON wiki_articles USING GIN (content_tsv)")

    op.create_table(
        "wiki_article_versions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("article_id", sa.Integer(), sa.ForeignKey("wiki_articles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("content_md", sa.Text(), nullable=False),
        sa.Column("comment", sa.String(length=500), nullable=True),
        sa.Column("editor_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("article_id", "version", name="uq_wiki_versions_article_ver"),
    )
    op.create_index("ix_wiki_article_versions_tenant_id", "wiki_article_versions", ["tenant_id"])
    op.create_index("ix_wiki_article_versions_article_id", "wiki_article_versions", ["article_id"])

    op.create_table(
        "wiki_article_comments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("article_id", sa.Integer(), sa.ForeignKey("wiki_articles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("wiki_article_comments.id", ondelete="CASCADE"), nullable=True),
        sa.Column("author_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_wiki_article_comments_tenant_id", "wiki_article_comments", ["tenant_id"])
    op.create_index("ix_wiki_article_comments_article_id", "wiki_article_comments", ["article_id"])
    op.create_index("ix_wiki_comments_article_created", "wiki_article_comments", ["article_id", "created_at"])

    op.create_table(
        "wiki_article_links",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_article_id", sa.Integer(), sa.ForeignKey("wiki_articles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_slug", sa.String(length=200), nullable=False),
        sa.Column("target_article_id", sa.Integer(), sa.ForeignKey("wiki_articles.id", ondelete="SET NULL"), nullable=True),
        sa.Column("anchor_text", sa.String(length=300), nullable=True),
    )
    op.create_index("ix_wiki_article_links_tenant_id", "wiki_article_links", ["tenant_id"])
    op.create_index("ix_wiki_links_source", "wiki_article_links", ["source_article_id"])
    op.create_index("ix_wiki_links_target", "wiki_article_links", ["target_article_id"])

    op.create_table(
        "wiki_permissions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_type", target_type, nullable=False),
        sa.Column("target_id", sa.Integer(), nullable=False),
        sa.Column("principal_type", principal_type, nullable=False),
        sa.Column("principal_id", sa.Integer(), nullable=False),
        sa.Column("level", access_level, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint(
            "target_type", "target_id", "principal_type", "principal_id",
            name="uq_wiki_perms_target_principal",
        ),
    )
    op.create_index("ix_wiki_permissions_tenant_id", "wiki_permissions", ["tenant_id"])
    op.create_index("ix_wiki_perms_target", "wiki_permissions", ["target_type", "target_id"])
    op.create_index("ix_wiki_perms_principal", "wiki_permissions", ["principal_type", "principal_id"])


def downgrade() -> None:
    for tbl in (
        "wiki_permissions",
        "wiki_article_links",
        "wiki_article_comments",
        "wiki_article_versions",
        "wiki_articles",
        "wiki_folders",
    ):
        op.drop_table(tbl)
    for enum_name in ("wiki_access_level", "wiki_principal_type", "wiki_target_type"):
        sa.Enum(name=enum_name).drop(op.get_bind(), checkfirst=True)
