"""Права доступа к вики.

Алгоритм:
1. Если у user есть permission wiki.admin или он owner — full access.
2. Если статья опубликована (is_published=True) и permission wiki.use — view.
3. Иначе смотрим ArticlePermission:
   - Ищем правила для (article) и всех parent folders вверх по цепочке.
   - Ищем правила для user_id или для любой из ролей юзера.
   - Уровни: admin > edit > view. Максимальный выигранный уровень.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from ...core.permissions import user_has
from ...models import (
    Article, ArticlePermission, WikiAccessLevel, WikiFolder, WikiPrincipalType, WikiTargetType,
)

LEVEL_ORDER = {
    None: 0,
    WikiAccessLevel.view: 1,
    WikiAccessLevel.edit: 2,
    WikiAccessLevel.admin: 3,
}
LEVEL_BY_STR = {
    "view": WikiAccessLevel.view,
    "edit": WikiAccessLevel.edit,
    "admin": WikiAccessLevel.admin,
}


def _folder_chain_ids(db: Session, folder_id: Optional[int]) -> list[int]:
    """Возвращает id всех папок вверх от указанной, включая её саму."""
    ids: list[int] = []
    current_id = folder_id
    guard = 0
    while current_id is not None and guard < 20:
        guard += 1
        f = db.get(WikiFolder, current_id)
        if not f:
            break
        ids.append(f.id)
        current_id = f.parent_id
    return ids


def _user_role_ids(user) -> list[int]:
    return [r.id for r in (user.roles or [])]


def effective_level(db: Session, tenant_id: int, user, article: Article) -> Optional[WikiAccessLevel]:
    """Возвращает максимально доступный уровень доступа к статье или None."""
    if getattr(user, "is_superuser", False) or getattr(user, "is_platform_admin", False):
        return WikiAccessLevel.admin
    if user_has(user, ["wiki.admin"]):
        return WikiAccessLevel.admin

    # Опубликованная статья видна всем с wiki.use
    if article.is_published and user_has(user, ["wiki.use"]):
        base = WikiAccessLevel.view
    else:
        base = None

    # Если есть wiki.publish — минимум edit на любую статью в tenant
    if user_has(user, ["wiki.publish"]):
        base = max_level(base, WikiAccessLevel.edit)

    # Явные ArticlePermission
    folder_ids = _folder_chain_ids(db, article.folder_id)
    role_ids = _user_role_ids(user)

    principals_or = [
        and_(ArticlePermission.principal_type == WikiPrincipalType.user, ArticlePermission.principal_id == user.id),
    ]
    if role_ids:
        principals_or.append(and_(
            ArticlePermission.principal_type == WikiPrincipalType.role,
            ArticlePermission.principal_id.in_(role_ids),
        ))

    targets_or = [
        and_(ArticlePermission.target_type == WikiTargetType.article, ArticlePermission.target_id == article.id),
    ]
    if folder_ids:
        targets_or.append(and_(
            ArticlePermission.target_type == WikiTargetType.folder,
            ArticlePermission.target_id.in_(folder_ids),
        ))

    rows = (
        db.query(ArticlePermission.level)
        .filter(
            ArticlePermission.tenant_id == tenant_id,
            or_(*principals_or),
            or_(*targets_or),
        )
        .all()
    )
    for (lvl,) in rows:
        base = max_level(base, lvl)
    return base


def max_level(a: Optional[WikiAccessLevel], b: Optional[WikiAccessLevel]) -> Optional[WikiAccessLevel]:
    return a if LEVEL_ORDER[a] >= LEVEL_ORDER[b] else b


def has_at_least(level: Optional[WikiAccessLevel], min_level: WikiAccessLevel) -> bool:
    return LEVEL_ORDER[level] >= LEVEL_ORDER[min_level]


def can_view(db: Session, tenant_id: int, user, article: Article) -> bool:
    return has_at_least(effective_level(db, tenant_id, user, article), WikiAccessLevel.view)


def can_edit(db: Session, tenant_id: int, user, article: Article) -> bool:
    return has_at_least(effective_level(db, tenant_id, user, article), WikiAccessLevel.edit)


def can_admin(db: Session, tenant_id: int, user, article: Article) -> bool:
    return has_at_least(effective_level(db, tenant_id, user, article), WikiAccessLevel.admin)
