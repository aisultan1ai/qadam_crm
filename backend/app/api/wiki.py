"""API базы знаний: папки, статьи, версии, ссылки, комментарии, права, поиск."""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from slugify import slugify
from sqlalchemy import desc, func, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.permissions import user_has
from ..database import get_db
from ..models import (
    Article, ArticleComment, ArticleLink, ArticlePermission, ArticleVersion, Role, User,
    WikiAccessLevel, WikiFolder, WikiPrincipalType, WikiTargetType,
)
from ..schemas.common import Message
from ..services.wiki.access import (
    can_admin, can_edit, can_view, effective_level, has_at_least, LEVEL_BY_STR,
)
from ..services.wiki.markdown import extract_wiki_links, render_markdown
from ..services.wiki.versioning import bump_version, rebuild_links, resolve_backlinks, snapshot_current
from .deps import TenantContext, get_current_context, log_action, require

log = logging.getLogger("qadam.wiki.api")

router = APIRouter(prefix="/api/wiki", tags=["wiki"])

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,199}$")


# =============================================================================
# Schemas
# =============================================================================


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    parent_id: Optional[int] = None
    slug: Optional[str] = Field(default=None, max_length=200)
    icon: Optional[str] = Field(default=None, max_length=60)
    sort_order: int = 0


class FolderPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    parent_id: Optional[int] = None
    icon: Optional[str] = Field(default=None, max_length=60)
    sort_order: Optional[int] = None


class ArticleCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    slug: Optional[str] = Field(default=None, max_length=200)
    folder_id: Optional[int] = None
    summary: Optional[str] = Field(default=None, max_length=500)
    content_md: str = ""
    is_published: bool = False


class ArticlePatch(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=300)
    folder_id: Optional[int] = None
    summary: Optional[str] = Field(default=None, max_length=500)
    content_md: Optional[str] = None
    is_published: Optional[bool] = None
    commit_message: Optional[str] = Field(default=None, max_length=500)


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=5000)
    parent_id: Optional[int] = None


class PermissionCreate(BaseModel):
    target_type: str
    target_id: int
    principal_type: str
    principal_id: int
    level: str


# =============================================================================
# Helpers
# =============================================================================


def _make_slug(db: Session, tenant_id: int, base: str, existing_id: Optional[int] = None) -> str:
    """Возвращает уникальный slug для tenant. Если base занят — добавляет суффикс -2, -3..."""
    root = slugify(base or "article")[:190] or "article"
    slug = root
    n = 2
    while True:
        q = db.query(Article.id).filter(Article.tenant_id == tenant_id, Article.slug == slug)
        if existing_id:
            q = q.filter(Article.id != existing_id)
        if not q.first():
            return slug
        slug = f"{root}-{n}"[:200]
        n += 1


def _make_folder_slug(db: Session, tenant_id: int, parent_id: Optional[int], base: str, existing_id: Optional[int] = None) -> str:
    root = slugify(base or "folder")[:190] or "folder"
    slug = root
    n = 2
    while True:
        q = db.query(WikiFolder.id).filter(
            WikiFolder.tenant_id == tenant_id,
            WikiFolder.parent_id.is_(None) if parent_id is None else WikiFolder.parent_id == parent_id,
            WikiFolder.slug == slug,
        )
        if existing_id:
            q = q.filter(WikiFolder.id != existing_id)
        if not q.first():
            return slug
        slug = f"{root}-{n}"[:200]
        n += 1


def _compute_path(db: Session, parent_id: Optional[int]) -> str:
    if parent_id is None:
        return "/"
    parts: list[str] = []
    guard = 0
    cur = db.get(WikiFolder, parent_id)
    while cur and guard < 20:
        guard += 1
        parts.append(cur.slug)
        cur = db.get(WikiFolder, cur.parent_id) if cur.parent_id else None
    return "/" + "/".join(reversed(parts)) + "/"


def _folder_out(f: WikiFolder) -> dict:
    return {
        "id": f.id,
        "parent_id": f.parent_id,
        "name": f.name,
        "slug": f.slug,
        "path": f.path,
        "icon": f.icon,
        "sort_order": f.sort_order,
    }


def _article_out(a: Article, include_content: bool = False, html: Optional[str] = None, level: Optional[WikiAccessLevel] = None) -> dict:
    out = {
        "id": a.id,
        "folder_id": a.folder_id,
        "slug": a.slug,
        "title": a.title,
        "summary": a.summary,
        "is_published": a.is_published,
        "view_count": a.view_count,
        "author_id": a.author_id,
        "last_editor_id": a.last_editor_id,
        "current_version": a.current_version,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
        "access_level": (level.value if hasattr(level, "value") else level) if level else None,
    }
    if include_content:
        out["content_md"] = a.content_md
    if html is not None:
        out["content_html"] = html
    return out


def _slug_resolver(db: Session, tenant_id: int):
    def resolve(slug: str) -> dict:
        row = db.query(Article.title).filter(
            Article.tenant_id == tenant_id, Article.slug == slug,
        ).first()
        if row:
            return {"exists": True, "title": row[0]}
        return {"exists": False, "title": None}
    return resolve


def _load_article(db: Session, tenant_id: int, article_id_or_slug: str) -> Article:
    if str(article_id_or_slug).isdigit():
        a = db.get(Article, int(article_id_or_slug))
    else:
        a = db.query(Article).filter(
            Article.tenant_id == tenant_id, Article.slug == str(article_id_or_slug),
        ).first()
    if not a or a.tenant_id != tenant_id:
        raise HTTPException(404, "Статья не найдена")
    return a


# =============================================================================
# Meta
# =============================================================================


@router.get("/meta")
def meta(ctx: TenantContext = Depends(require("wiki.use"))):
    return {
        "levels": [l.value for l in WikiAccessLevel],
        "target_types": [t.value for t in WikiTargetType],
        "principal_types": [p.value for p in WikiPrincipalType],
    }


# =============================================================================
# Folders
# =============================================================================


@router.get("/tree")
def get_tree(
    ctx: TenantContext = Depends(require("wiki.use")),
    db: Session = Depends(get_db),
):
    """Возвращает всё дерево: список папок + список статей (только доступные)."""
    folders = (
        db.query(WikiFolder)
        .filter(WikiFolder.tenant_id == ctx.tenant.id)
        .order_by(WikiFolder.parent_id.nullsfirst(), WikiFolder.sort_order, WikiFolder.name)
        .all()
    )
    articles = (
        db.query(Article)
        .filter(Article.tenant_id == ctx.tenant.id)
        .order_by(Article.folder_id.nullsfirst(), Article.title)
        .all()
    )
    is_admin = user_has(ctx.user, ["wiki.admin"]) or ctx.membership.is_owner
    visible_articles = []
    for a in articles:
        if is_admin or can_view(db, ctx.tenant.id, ctx.user, a):
            visible_articles.append({
                "id": a.id,
                "slug": a.slug,
                "title": a.title,
                "folder_id": a.folder_id,
                "is_published": a.is_published,
            })
    return {
        "folders": [_folder_out(f) for f in folders],
        "articles": visible_articles,
    }


@router.post("/folders", status_code=201)
def create_folder(
    payload: FolderCreate,
    ctx: TenantContext = Depends(require("wiki.publish")),
    db: Session = Depends(get_db),
):
    if payload.parent_id is not None:
        parent = db.get(WikiFolder, payload.parent_id)
        if not parent or parent.tenant_id != ctx.tenant.id:
            raise HTTPException(404, "Родительская папка не найдена")
    slug = payload.slug or payload.name
    slug = _make_folder_slug(db, ctx.tenant.id, payload.parent_id, slug)
    path = _compute_path(db, payload.parent_id)

    f = WikiFolder(
        tenant_id=ctx.tenant.id,
        parent_id=payload.parent_id,
        name=payload.name.strip(),
        slug=slug,
        path=path,
        icon=payload.icon,
        sort_order=payload.sort_order or 0,
        created_by=ctx.user.id,
    )
    db.add(f)
    db.commit()
    db.refresh(f)
    return _folder_out(f)


@router.patch("/folders/{folder_id}")
def patch_folder(
    folder_id: int,
    payload: FolderPatch,
    ctx: TenantContext = Depends(require("wiki.publish")),
    db: Session = Depends(get_db),
):
    f = db.get(WikiFolder, folder_id)
    if not f or f.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Папка не найдена")
    if payload.name is not None:
        f.name = payload.name.strip()
    if payload.icon is not None:
        f.icon = payload.icon or None
    if payload.sort_order is not None:
        f.sort_order = payload.sort_order
    if payload.parent_id is not None and payload.parent_id != f.parent_id:
        if payload.parent_id == folder_id:
            raise HTTPException(400, "Нельзя сделать папку родителем самой себя")
        if payload.parent_id != 0:
            new_parent = db.get(WikiFolder, payload.parent_id)
            if not new_parent or new_parent.tenant_id != ctx.tenant.id:
                raise HTTPException(404, "Новая родительская папка не найдена")
        f.parent_id = payload.parent_id if payload.parent_id != 0 else None
        f.path = _compute_path(db, f.parent_id)
    db.commit()
    db.refresh(f)
    return _folder_out(f)


@router.delete("/folders/{folder_id}", response_model=Message)
def delete_folder(
    folder_id: int,
    ctx: TenantContext = Depends(require("wiki.admin")),
    db: Session = Depends(get_db),
):
    f = db.get(WikiFolder, folder_id)
    if not f or f.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Папка не найдена")
    name = f.name
    db.delete(f)
    db.commit()
    return Message(message=f"Папка «{name}» удалена")


# =============================================================================
# Articles
# =============================================================================


@router.get("/articles")
def list_articles(
    folder_id: Optional[int] = None,
    only_published: Optional[bool] = None,
    ctx: TenantContext = Depends(require("wiki.use")),
    db: Session = Depends(get_db),
):
    q = db.query(Article).filter(Article.tenant_id == ctx.tenant.id)
    if folder_id is not None:
        if folder_id == 0:
            q = q.filter(Article.folder_id.is_(None))
        else:
            q = q.filter(Article.folder_id == folder_id)
    if only_published:
        q = q.filter(Article.is_published.is_(True))
    rows = q.order_by(Article.title).all()
    is_admin = user_has(ctx.user, ["wiki.admin"]) or ctx.membership.is_owner
    result = []
    for a in rows:
        if is_admin or can_view(db, ctx.tenant.id, ctx.user, a):
            result.append(_article_out(a))
    return result


@router.get("/articles/{article_id_or_slug}")
def get_article(
    article_id_or_slug: str,
    ctx: TenantContext = Depends(require("wiki.use")),
    db: Session = Depends(get_db),
):
    a = _load_article(db, ctx.tenant.id, article_id_or_slug)
    level = effective_level(db, ctx.tenant.id, ctx.user, a)
    if not has_at_least(level, WikiAccessLevel.view):
        raise HTTPException(403, "Нет доступа к статье")
    html = render_markdown(a.content_md or "", resolve_slug=_slug_resolver(db, ctx.tenant.id))
    # Не увеличиваем счётчик если это правка (edit) — только для чтения
    a.view_count = (a.view_count or 0) + 1
    db.commit()
    return _article_out(a, include_content=True, html=html, level=level)


@router.post("/articles", status_code=201)
def create_article(
    payload: ArticleCreate,
    ctx: TenantContext = Depends(require("wiki.publish")),
    db: Session = Depends(get_db),
):
    if payload.folder_id:
        folder = db.get(WikiFolder, payload.folder_id)
        if not folder or folder.tenant_id != ctx.tenant.id:
            raise HTTPException(404, "Папка не найдена")

    slug_base = payload.slug or payload.title
    slug = _make_slug(db, ctx.tenant.id, slug_base)

    a = Article(
        tenant_id=ctx.tenant.id,
        folder_id=payload.folder_id,
        slug=slug,
        title=payload.title.strip(),
        summary=(payload.summary or "").strip() or None,
        content_md=payload.content_md or "",
        is_published=payload.is_published,
        author_id=ctx.user.id,
        last_editor_id=ctx.user.id,
        current_version=1,
    )
    db.add(a)
    db.flush()
    # History начинается с v1 = «создание». При PATCH:
    # snapshot текущей current_version → bump → новая. Так у нас всегда:
    # history: v1, v2, ...  и article.current_version = последняя.
    snapshot_current(db, a, ctx.user.id, comment="создание")
    rebuild_links(db, a)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
               action="create", entity="wiki_article", entity_id=a.id, detail=a.title)
    db.commit()
    db.refresh(a)
    return _article_out(a, include_content=True)


@router.patch("/articles/{article_id}")
def patch_article(
    article_id: int,
    payload: ArticlePatch,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    a = _load_article(db, ctx.tenant.id, str(article_id))
    if not can_edit(db, ctx.tenant.id, ctx.user, a):
        raise HTTPException(403, "Нет прав на редактирование")

    changes: list[str] = []
    content_changed = False

    if payload.title is not None and payload.title.strip() != a.title:
        a.title = payload.title.strip()
        changes.append("title")
    if payload.summary is not None:
        new_v = (payload.summary or "").strip() or None
        if new_v != a.summary:
            a.summary = new_v
            changes.append("summary")
    if payload.folder_id is not None and payload.folder_id != a.folder_id:
        if payload.folder_id == 0:
            a.folder_id = None
        else:
            folder = db.get(WikiFolder, payload.folder_id)
            if not folder or folder.tenant_id != ctx.tenant.id:
                raise HTTPException(404, "Папка не найдена")
            a.folder_id = folder.id
        changes.append("folder")
    if payload.is_published is not None and payload.is_published != a.is_published:
        if payload.is_published and not user_has(ctx.user, ["wiki.publish", "wiki.admin"]):
            raise HTTPException(403, "Нет права публиковать")
        a.is_published = payload.is_published
        changes.append("publish" if payload.is_published else "unpublish")
    if payload.content_md is not None and payload.content_md != a.content_md:
        # Bump сначала — новая версия для нового содержимого.
        # snapshot берёт эту новую версию, но с ещё СТАРЫМ content_md, потом обновляем.
        # Правильнее: snapshot текущего (до правки) как current_version, потом bump, потом set new content.
        # Но snapshot использует article.current_version — если она была уже засейвлена,
        # UNIQUE упадёт. Поэтому bump ПЕРЕД snapshot.
        bump_version(a)
        # Сохраняем в history СТАРЫЙ content с НОВОЙ версией — так следующий revert покажет
        # то что было. При v1→v2: snapshot v2 содержит старый (v1) content. Не идеально,
        # но история пригодна для diff, а revert берёт версию явно.
        # Альтернатива: сначала set new content потом snapshot — тогда snapshot=новое, а current=новое.
        # Проще: сохранить старое как отдельный snapshot версии которая раньше была current.
        # Здесь просто: обновляем content, потом snapshot новой версии.
        a.content_md = payload.content_md
        snapshot_current(db, a, ctx.user.id, comment=payload.commit_message)
        content_changed = True
        changes.append("content")

    a.last_editor_id = ctx.user.id
    if content_changed:
        rebuild_links(db, a)
    if changes:
        log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
                   action="update", entity="wiki_article", entity_id=a.id, detail=", ".join(changes))
    db.commit()
    db.refresh(a)
    return _article_out(a, include_content=True)


@router.delete("/articles/{article_id}", response_model=Message)
def delete_article(
    article_id: int,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    a = _load_article(db, ctx.tenant.id, str(article_id))
    if not can_admin(db, ctx.tenant.id, ctx.user, a):
        raise HTTPException(403, "Нет прав на удаление")
    title = a.title
    db.delete(a)
    db.commit()
    return Message(message=f"Статья «{title}» удалена")


# =============================================================================
# Versions
# =============================================================================


@router.get("/articles/{article_id}/versions")
def list_versions(
    article_id: int,
    ctx: TenantContext = Depends(require("wiki.use")),
    db: Session = Depends(get_db),
):
    a = _load_article(db, ctx.tenant.id, str(article_id))
    if not can_view(db, ctx.tenant.id, ctx.user, a):
        raise HTTPException(403, "Нет доступа")
    rows = (
        db.query(ArticleVersion)
        .filter(ArticleVersion.article_id == a.id)
        .order_by(desc(ArticleVersion.version))
        .all()
    )
    return [
        {
            "id": v.id,
            "version": v.version,
            "title": v.title,
            "comment": v.comment,
            "editor_id": v.editor_id,
            "created_at": v.created_at.isoformat() if v.created_at else None,
        }
        for v in rows
    ]


@router.get("/articles/{article_id}/versions/{version}")
def get_version(
    article_id: int,
    version: int,
    ctx: TenantContext = Depends(require("wiki.use")),
    db: Session = Depends(get_db),
):
    a = _load_article(db, ctx.tenant.id, str(article_id))
    if not can_view(db, ctx.tenant.id, ctx.user, a):
        raise HTTPException(403, "Нет доступа")
    v = db.query(ArticleVersion).filter(
        ArticleVersion.article_id == a.id, ArticleVersion.version == version,
    ).first()
    if not v:
        raise HTTPException(404, "Версия не найдена")
    html = render_markdown(v.content_md, resolve_slug=_slug_resolver(db, ctx.tenant.id))
    return {
        "id": v.id, "version": v.version, "title": v.title, "content_md": v.content_md,
        "content_html": html, "editor_id": v.editor_id,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


@router.post("/articles/{article_id}/revert/{version}", status_code=201)
def revert_to_version(
    article_id: int,
    version: int,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    a = _load_article(db, ctx.tenant.id, str(article_id))
    if not can_edit(db, ctx.tenant.id, ctx.user, a):
        raise HTTPException(403, "Нет прав на редактирование")
    v = db.query(ArticleVersion).filter(
        ArticleVersion.article_id == a.id, ArticleVersion.version == version,
    ).first()
    if not v:
        raise HTTPException(404, "Версия не найдена")
    # Bump сначала → snapshot новой версии → set content из выбранной старой.
    # Не пытаемся снапшотить current_version — она уже в history.
    bump_version(a)
    a.title = v.title
    a.content_md = v.content_md
    a.last_editor_id = ctx.user.id
    snapshot_current(db, a, ctx.user.id, comment=f"revert → v{version}")
    rebuild_links(db, a)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
               action="revert", entity="wiki_article", entity_id=a.id, detail=f"→ v{version}")
    db.commit()
    db.refresh(a)
    return _article_out(a, include_content=True)


# =============================================================================
# Backlinks
# =============================================================================


@router.get("/articles/{article_id_or_slug}/backlinks")
def get_backlinks(
    article_id_or_slug: str,
    ctx: TenantContext = Depends(require("wiki.use")),
    db: Session = Depends(get_db),
):
    a = _load_article(db, ctx.tenant.id, article_id_or_slug)
    return resolve_backlinks(db, ctx.tenant.id, a.slug)


# =============================================================================
# Comments
# =============================================================================


@router.get("/articles/{article_id}/comments")
def list_comments(
    article_id: int,
    ctx: TenantContext = Depends(require("wiki.use")),
    db: Session = Depends(get_db),
):
    a = _load_article(db, ctx.tenant.id, str(article_id))
    if not can_view(db, ctx.tenant.id, ctx.user, a):
        raise HTTPException(403, "Нет доступа")
    rows = (
        db.query(ArticleComment)
        .filter(ArticleComment.article_id == a.id)
        .order_by(ArticleComment.created_at.asc())
        .all()
    )
    return [
        {
            "id": c.id, "parent_id": c.parent_id, "author_id": c.author_id, "body": c.body,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "updated_at": c.updated_at.isoformat() if c.updated_at else None,
        }
        for c in rows
    ]


@router.post("/articles/{article_id}/comments", status_code=201)
def create_comment(
    article_id: int,
    payload: CommentCreate,
    ctx: TenantContext = Depends(require("wiki.use")),
    db: Session = Depends(get_db),
):
    a = _load_article(db, ctx.tenant.id, str(article_id))
    if not can_view(db, ctx.tenant.id, ctx.user, a):
        raise HTTPException(403, "Нет доступа")
    if payload.parent_id:
        parent = db.get(ArticleComment, payload.parent_id)
        if not parent or parent.article_id != a.id:
            raise HTTPException(404, "Родительский комментарий не найден")
    c = ArticleComment(
        tenant_id=ctx.tenant.id,
        article_id=a.id,
        parent_id=payload.parent_id,
        author_id=ctx.user.id,
        body=payload.body,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return {
        "id": c.id, "parent_id": c.parent_id, "author_id": c.author_id, "body": c.body,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


@router.delete("/comments/{comment_id}", response_model=Message)
def delete_comment(
    comment_id: int,
    ctx: TenantContext = Depends(require("wiki.use")),
    db: Session = Depends(get_db),
):
    c = db.get(ArticleComment, comment_id)
    if not c or c.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Комментарий не найден")
    if c.author_id != ctx.user.id and not user_has(ctx.user, ["wiki.admin"]):
        raise HTTPException(403, "Только автор или wiki.admin может удалить")
    db.delete(c)
    db.commit()
    return Message(message="Комментарий удалён")


# =============================================================================
# Permissions
# =============================================================================


@router.get("/permissions")
def list_permissions(
    target_type: Optional[str] = None,
    target_id: Optional[int] = None,
    ctx: TenantContext = Depends(require("wiki.admin")),
    db: Session = Depends(get_db),
):
    q = db.query(ArticlePermission).filter(ArticlePermission.tenant_id == ctx.tenant.id)
    if target_type:
        q = q.filter(ArticlePermission.target_type == WikiTargetType(target_type))
    if target_id:
        q = q.filter(ArticlePermission.target_id == target_id)
    rows = q.order_by(ArticlePermission.id).all()
    return [
        {
            "id": p.id,
            "target_type": p.target_type.value if hasattr(p.target_type, "value") else p.target_type,
            "target_id": p.target_id,
            "principal_type": p.principal_type.value if hasattr(p.principal_type, "value") else p.principal_type,
            "principal_id": p.principal_id,
            "level": p.level.value if hasattr(p.level, "value") else p.level,
        }
        for p in rows
    ]


@router.post("/permissions", status_code=201)
def create_permission(
    payload: PermissionCreate,
    ctx: TenantContext = Depends(require("wiki.admin")),
    db: Session = Depends(get_db),
):
    if payload.level not in LEVEL_BY_STR:
        raise HTTPException(400, f"level must be one of {list(LEVEL_BY_STR)}")
    if payload.target_type not in ("folder", "article"):
        raise HTTPException(400, "target_type: folder|article")
    if payload.principal_type not in ("user", "role"):
        raise HTTPException(400, "principal_type: user|role")

    try:
        p = ArticlePermission(
            tenant_id=ctx.tenant.id,
            target_type=WikiTargetType(payload.target_type),
            target_id=payload.target_id,
            principal_type=WikiPrincipalType(payload.principal_type),
            principal_id=payload.principal_id,
            level=LEVEL_BY_STR[payload.level],
        )
        db.add(p)
        db.commit()
        db.refresh(p)
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Такое правило уже существует")
    return {"id": p.id}


@router.delete("/permissions/{perm_id}", response_model=Message)
def delete_permission(
    perm_id: int,
    ctx: TenantContext = Depends(require("wiki.admin")),
    db: Session = Depends(get_db),
):
    p = db.get(ArticlePermission, perm_id)
    if not p or p.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Правило не найдено")
    db.delete(p)
    db.commit()
    return Message(message="Правило удалено")


# =============================================================================
# Search
# =============================================================================


@router.get("/search")
def search_articles(
    q: str = Query(min_length=1),
    limit: int = Query(default=20, ge=1, le=100),
    ctx: TenantContext = Depends(require("wiki.use")),
    db: Session = Depends(get_db),
):
    """Полнотекстовый поиск по title/summary/content через tsvector (russian)."""
    query_str = q.strip()
    # plainto_tsquery терпимее к пользовательскому вводу чем to_tsquery
    sql = text("""
        SELECT id, title, summary, slug,
               ts_headline('russian', coalesce(content_md, ''),
                           plainto_tsquery('russian', :q),
                           'MaxWords=15,MinWords=5,ShortWord=2,HighlightAll=false') AS snippet,
               ts_rank(content_tsv, plainto_tsquery('russian', :q)) AS rank
        FROM wiki_articles
        WHERE tenant_id = :tid
          AND content_tsv @@ plainto_tsquery('russian', :q)
        ORDER BY rank DESC
        LIMIT :lim
    """)
    rows = db.execute(sql, {"q": query_str, "tid": ctx.tenant.id, "lim": limit}).fetchall()
    results = []
    for r in rows:
        # Проверяем доступ (view) — для приватных статей
        art = db.get(Article, r.id)
        if not art or not can_view(db, ctx.tenant.id, ctx.user, art):
            continue
        results.append({
            "id": r.id, "title": r.title, "summary": r.summary, "slug": r.slug,
            "snippet": r.snippet, "rank": float(r.rank) if r.rank else 0,
        })
    return results
