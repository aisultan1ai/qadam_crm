"""База знаний / вики: папки, статьи, версии, ссылки, комментарии, права.

Ключевые решения:
- Article.content_md — актуальная версия (для быстрого чтения). ArticleVersion
  хранит историю, куда попадает предыдущее содержимое при save.
- `path` в WikiFolder — materialized path вида "/root/subfolder/leaf" для быстрого
  подсчёта детей + инвалидации при переносе (batch UPDATE .. LIKE 'oldpath/%').
- Wiki-links: при save сканируем content_md на `[[Slug]]`, обновляем ArticleLink.
- Права: ArticlePermission (target_type + target_id), inheritance по цепочке
  parent folder. Если статья опубликована — доступ у всех с permission wiki.use.
- Полнотекст: колонка content_tsv (tsvector, `russian`) с GIN-индексом, обновляется
  триггером в миграции.
"""
from datetime import datetime
from enum import Enum
from typing import Any, List, Optional

from sqlalchemy import (
    Boolean, DateTime, Enum as SAEnum, ForeignKey, Index, Integer, String, Text, UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class WikiTargetType(str, Enum):
    folder = "folder"
    article = "article"


class WikiAccessLevel(str, Enum):
    view = "view"
    edit = "edit"
    admin = "admin"


class WikiPrincipalType(str, Enum):
    user = "user"
    role = "role"


class WikiFolder(Base):
    __tablename__ = "wiki_folders"
    __table_args__ = (
        Index("ix_wiki_folders_tenant_parent", "tenant_id", "parent_id"),
        Index("ix_wiki_folders_tenant_path", "tenant_id", "path"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("wiki_folders.id", ondelete="CASCADE"), nullable=True, index=True,
    )
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(200))
    # Материализованный путь: /root/section/leaf (без имени самой папки — см. update-хуки)
    path: Mapped[str] = mapped_column(String(1000), default="/", server_default="/")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    icon: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)

    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Article(Base):
    __tablename__ = "wiki_articles"
    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_wiki_articles_tenant_slug"),
        Index("ix_wiki_articles_tenant_folder", "tenant_id", "folder_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    folder_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("wiki_folders.id", ondelete="SET NULL"), nullable=True, index=True,
    )

    slug: Mapped[str] = mapped_column(String(200))
    title: Mapped[str] = mapped_column(String(300))
    summary: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    content_md: Mapped[str] = mapped_column(Text, default="", server_default="")

    is_published: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    view_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    author_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    last_editor_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    current_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    versions: Mapped[List["ArticleVersion"]] = relationship(
        "ArticleVersion", back_populates="article", cascade="all, delete-orphan",
        lazy="selectin", order_by="ArticleVersion.version.desc()",
    )
    comments: Mapped[List["ArticleComment"]] = relationship(
        "ArticleComment", back_populates="article", cascade="all, delete-orphan",
        lazy="selectin", order_by="ArticleComment.created_at.asc()",
    )


class ArticleVersion(Base):
    __tablename__ = "wiki_article_versions"
    __table_args__ = (
        UniqueConstraint("article_id", "version", name="uq_wiki_versions_article_ver"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    article_id: Mapped[int] = mapped_column(ForeignKey("wiki_articles.id", ondelete="CASCADE"), index=True)

    version: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(300))
    content_md: Mapped[str] = mapped_column(Text)
    comment: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    editor_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    article: Mapped[Article] = relationship("Article", back_populates="versions")


class ArticleComment(Base):
    __tablename__ = "wiki_article_comments"
    __table_args__ = (
        Index("ix_wiki_comments_article_created", "article_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    article_id: Mapped[int] = mapped_column(ForeignKey("wiki_articles.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("wiki_article_comments.id", ondelete="CASCADE"), nullable=True,
    )
    author_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    body: Mapped[str] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    article: Mapped[Article] = relationship("Article", back_populates="comments")


class ArticleLink(Base):
    """Граф wiki-ссылок [[Slug]] между статьями. Обновляется при save."""
    __tablename__ = "wiki_article_links"
    __table_args__ = (
        Index("ix_wiki_links_source", "source_article_id"),
        Index("ix_wiki_links_target", "target_article_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    source_article_id: Mapped[int] = mapped_column(ForeignKey("wiki_articles.id", ondelete="CASCADE"))
    target_slug: Mapped[str] = mapped_column(String(200))
    # target_article_id может быть NULL если [[Slug]] указывает на несуществующую статью
    target_article_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("wiki_articles.id", ondelete="SET NULL"), nullable=True,
    )
    anchor_text: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)


class ArticlePermission(Base):
    """Права на папку или статью для конкретного principal (user или role).

    Наследование: если target_type=folder → распространяется на всех потомков.
    Если target_type=article → только на конкретную статью.
    """
    __tablename__ = "wiki_permissions"
    __table_args__ = (
        Index("ix_wiki_perms_target", "target_type", "target_id"),
        Index("ix_wiki_perms_principal", "principal_type", "principal_id"),
        UniqueConstraint(
            "target_type", "target_id", "principal_type", "principal_id",
            name="uq_wiki_perms_target_principal",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)

    target_type: Mapped[WikiTargetType] = mapped_column(SAEnum(WikiTargetType, name="wiki_target_type"))
    target_id: Mapped[int] = mapped_column(Integer)

    principal_type: Mapped[WikiPrincipalType] = mapped_column(SAEnum(WikiPrincipalType, name="wiki_principal_type"))
    principal_id: Mapped[int] = mapped_column(Integer)

    level: Mapped[WikiAccessLevel] = mapped_column(SAEnum(WikiAccessLevel, name="wiki_access_level"))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
