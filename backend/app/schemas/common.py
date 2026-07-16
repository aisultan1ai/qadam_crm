from typing import Generic, List, Optional, TypeVar
from pydantic import BaseModel, Field
from fastapi import Query

T = TypeVar("T")


class Message(BaseModel):
    message: str


class IdOnly(BaseModel):
    id: int


class PageParams(BaseModel):
    page: Optional[int] = Field(default=None, ge=1)
    per_page: int = Field(default=50, ge=1, le=200)


def page_params(
    page: Optional[int] = Query(default=None, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
) -> PageParams:
    return PageParams(page=page, per_page=per_page)


class Page(BaseModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    per_page: int
    pages: int


def paginate(query, params: PageParams) -> Page:
    """Вернёт Page[T] на основе SQLAlchemy Query. Если page не задан — всё в одну страницу (с safety cap)."""
    if params.page is None:
        MAX_UNPAGED = 500
        items = query.limit(MAX_UNPAGED).all()
        total = len(items)
        return Page(items=items, total=total, page=1, per_page=total or params.per_page, pages=1)

    total = query.order_by(None).count()
    offset = (params.page - 1) * params.per_page
    items = query.offset(offset).limit(params.per_page).all()
    pages = (total + params.per_page - 1) // params.per_page if params.per_page else 1
    return Page(items=items, total=total, page=params.page, per_page=params.per_page, pages=pages or 1)
