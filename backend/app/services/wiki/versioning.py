"""Версионирование wiki-статей + перерасчёт ссылок.

При каждом сохранении контента:
1. Текущее содержимое (до изменения) уходит в ArticleVersion со старым `current_version`.
2. Article.content_md обновляется, current_version += 1.
3. Из нового контента извлекаются [[slug]] → пересобирается ArticleLink.

Revert: копирует контент из выбранной версии в Article, инкрементируя current_version.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from ...models import Article, ArticleLink, ArticleVersion
from .markdown import extract_wiki_links


def snapshot_current(
    db: Session, article: Article, editor_id: Optional[int], comment: Optional[str] = None,
) -> ArticleVersion:
    """Сохраняет актуальное содержимое как отдельную версию."""
    v = ArticleVersion(
        tenant_id=article.tenant_id,
        article_id=article.id,
        version=article.current_version,
        title=article.title,
        content_md=article.content_md or "",
        comment=comment,
        editor_id=editor_id,
    )
    db.add(v)
    db.flush()
    return v


def bump_version(article: Article) -> None:
    article.current_version = (article.current_version or 1) + 1


def rebuild_links(db: Session, article: Article) -> int:
    """Пересобирает ArticleLink из [[…]] в тексте статьи. Возвращает кол-во."""
    # Удаляем старые
    db.query(ArticleLink).filter(ArticleLink.source_article_id == article.id).delete(synchronize_session=False)

    links = extract_wiki_links(article.content_md or "")
    if not links:
        return 0

    # Резолвим slug'и в существующие статьи одним запросом
    slugs = [s for s, _ in links]
    from ...models import Article as ArticleModel
    existing = dict(
        db.query(ArticleModel.slug, ArticleModel.id)
        .filter(ArticleModel.tenant_id == article.tenant_id, ArticleModel.slug.in_(slugs))
        .all()
    )
    for slug, anchor in links:
        db.add(ArticleLink(
            tenant_id=article.tenant_id,
            source_article_id=article.id,
            target_slug=slug,
            target_article_id=existing.get(slug),
            anchor_text=anchor[:300] if anchor else None,
        ))
    return len(links)


def resolve_backlinks(db: Session, tenant_id: int, slug: str) -> list[dict]:
    """Возвращает список статей, ссылающихся на данный slug."""
    from ...models import Article as ArticleModel
    rows = (
        db.query(ArticleModel.id, ArticleModel.title, ArticleModel.slug)
        .join(ArticleLink, ArticleLink.source_article_id == ArticleModel.id)
        .filter(
            ArticleLink.tenant_id == tenant_id,
            ArticleLink.target_slug == slug.lower(),
        )
        .distinct()
        .all()
    )
    return [{"id": aid, "title": t, "slug": s} for aid, t, s in rows]
