"""Рендер markdown с подсветкой кода и разрешением wiki-links [[Slug]].

Wiki-links синтаксис:
- `[[my-slug]]` — ссылка с текстом "my-slug"
- `[[my-slug|Кастомный текст]]` — с явным anchor

Backlinks извлекаются функцией `extract_wiki_links()` — используется при save
для пересчёта таблицы ArticleLink.
"""
from __future__ import annotations

import re
from typing import Iterable

from markdown_it import MarkdownIt
from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexers import get_lexer_by_name
from pygments.util import ClassNotFound

WIKI_LINK_RE = re.compile(r"\[\[([^\]|\n]{1,200})(?:\|([^\]\n]{1,300}))?\]\]")


def _highlight(code: str, lang: str, _attrs: str) -> str:
    if not lang:
        return f"<pre><code>{_escape(code)}</code></pre>"
    try:
        lexer = get_lexer_by_name(lang.strip(), stripall=True)
    except ClassNotFound:
        return f"<pre><code>{_escape(code)}</code></pre>"
    formatter = HtmlFormatter(nowrap=False, cssclass=f"codehilite lang-{lang}")
    return highlight(code, lexer, formatter)


def _escape(text: str) -> str:
    return (
        text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    )


def _md() -> MarkdownIt:
    md = MarkdownIt("commonmark", {"html": False, "linkify": True, "typographer": True, "highlight": _highlight})
    md.enable("table")
    md.enable("strikethrough")
    return md


def render_markdown(text: str, resolve_slug=None) -> str:
    """Конвертирует md → HTML. Wiki-links `[[slug]]` заменяются ссылками.

    resolve_slug(slug) → dict {"exists": bool, "title": Optional[str]} — опционально,
    для правильного класса `wiki-link--exists / --missing`.

    Placeholder-техника: заменяем [[…]] на markdown-совместимую ссылку
    `[anchor](/wiki/slug "title")` до рендера, класс добавляем post-processing'ом
    через уникальные data-атрибуты, чтобы markdown-it не эскейпил наш HTML.
    """
    if not text:
        return ""

    replacements: dict[str, str] = {}

    def _wiki_replace(match: re.Match) -> str:
        slug = match.group(1).strip()
        anchor = (match.group(2) or "").strip() or slug
        info = resolve_slug(slug) if resolve_slug else None
        exists = bool(info and info.get("exists"))
        title = (info or {}).get("title") or anchor
        # Уникальный placeholder — не будет сломан markdown-it
        token = f"WLINKPLACEHOLDER{len(replacements)}ENDWL"
        cls = "wiki-link" if exists else "wiki-link wiki-link--missing"
        href = f"/wiki/{slug}"
        replacements[token] = (
            f"<a class=\"{cls}\" href=\"{href}\" title=\"{_escape(title)}\">{_escape(anchor)}</a>"
        )
        return token

    pre_processed = WIKI_LINK_RE.sub(_wiki_replace, text)
    html = _md().render(pre_processed)
    # Возвращаем placeholder'ы обратно
    for token, replacement in replacements.items():
        html = html.replace(token, replacement)
    return html


def extract_wiki_links(text: str) -> list[tuple[str, str]]:
    """Возвращает список (slug, anchor) для всех [[…]] в тексте. Дедупликация по slug."""
    seen: set[str] = set()
    result: list[tuple[str, str]] = []
    for m in WIKI_LINK_RE.finditer(text or ""):
        slug = m.group(1).strip().lower()
        anchor = (m.group(2) or slug).strip()
        if not slug or slug in seen:
            continue
        seen.add(slug)
        result.append((slug, anchor))
    return result
