"""Очистка HTML из недоверенных источников (входящие письма и т.п.) перед отдачей во фронтенд.

Фронтенд вставляет такой HTML через dangerouslySetInnerHTML, поэтому всё исполняемое
(script, обработчики on*, javascript:-ссылки, iframe/object/form, style) вырезается здесь.
"""
from __future__ import annotations

import html
import re
from typing import Optional

import bleach

ALLOWED_TAGS = frozenset({
    "a", "abbr", "b", "blockquote", "br", "caption", "code", "col", "colgroup", "dd", "del", "div", "dl", "dt",
    "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "li", "ol", "p", "pre", "q", "s",
    "small", "span", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
    "font", "center",
})

ALLOWED_ATTRIBUTES = {
    "a": ["href", "title", "name"],
    "img": ["src", "alt", "title", "width", "height"],
    "td": ["colspan", "rowspan", "align", "valign", "width"],
    "th": ["colspan", "rowspan", "align", "valign", "width"],
    "table": ["width", "border", "cellpadding", "cellspacing", "align"],
    "col": ["span", "width"],
    "colgroup": ["span", "width"],
    "font": ["color", "size"],
    "p": ["align"],
    "div": ["align"],
    "abbr": ["title"],
    "q": ["cite"],
    "blockquote": ["cite"],
}

# data: в img допустим только для картинок; в ссылках — только http(s)/mailto/tel.
ALLOWED_PROTOCOLS = frozenset({"http", "https", "mailto", "tel", "cid"})


# Блоки, содержимое которых не должно попасть в текст письма (bleach с strip=True оставил бы их текст).
_DROP_BLOCKS = re.compile(r"<(script|style|head|title|noscript|template)\b[^>]*>.*?</\1\s*>", re.I | re.S)


def _set_link_rel(attrs, new=False):
    href_key = (None, "href")
    if href_key in attrs:
        attrs[(None, "target")] = "_blank"
        attrs[(None, "rel")] = "noopener noreferrer nofollow"
    return attrs


def sanitize_email_html(raw: Optional[str]) -> Optional[str]:
    """Безопасный HTML письма: только разметка, без скриптов, стилей и опасных ссылок."""
    if not raw:
        return raw
    cleaned = bleach.clean(
        _DROP_BLOCKS.sub("", raw),
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        protocols=ALLOWED_PROTOCOLS,
        strip=True,
        strip_comments=True,
    )
    return bleach.linkify(cleaned, callbacks=[_set_link_rel], skip_tags={"pre", "code"}, parse_email=False)


def highlight_snippet(raw: Optional[str], start: str, stop: str) -> str:
    """Экранирует текст фрагмента поиска и превращает маркеры подсветки в <mark>."""
    if not raw:
        return ""
    escaped = html.escape(raw, quote=True)
    return escaped.replace(html.escape(start), "<mark>").replace(html.escape(stop), "</mark>")
