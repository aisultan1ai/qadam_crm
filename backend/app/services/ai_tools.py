"""Инструменты-«чтецы» для чата «Спроси CRM» (api/ai_assistant.py).

Правила безопасности (не ослаблять):
- Модель не получает SQL и не задаёт произвольных запросов: только эти функции с фиксированными параметрами.
- Каждая функция работает строго в ctx.tenant и с правами ctx.user — так же, как обычные списки
  (scope задач из core/task_scope.py, права deals.view / contracts.view / wiki.use, доступ к статьям wiki).
- tenant_id / user_id в схемах нет и быть не должно; лишние параметры отбрасываются в `execute()`.
- Нет права → {"error": "нет доступа"}, а не данные.
- Результат ограничен MAX_ROWS строками, длинные поля обрезаются.
- Каждая возвращённая запись регистрируется в `seen` — только на них модель может сослаться в ответе.
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Optional

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, noload

from ..core.permissions import user_has
from ..core.task_scope import apply_task_scope, can_list_tasks
from ..models import Article, Company, Contract, Deal, Project, Task
from ..models.contract import CONTRACT_STATUSES
from ..models.deal import OFFTAKE_STAGE_LABEL, DealPipeline, DealStage, DealStatus, OfftakeStage
from ..models.task import TaskStatus, task_assignees

log = logging.getLogger("qadam.ai.tools")

MAX_ROWS = 30
MAX_FIELD = 300
MAX_ARTICLE = 6000
NO_ACCESS = {"error": "нет доступа"}

TASK_STATUS_LABEL = {"new": "Новая", "in_progress": "В работе", "review": "На проверке", "done": "Готова", "cancelled": "Отменена"}
DEAL_STAGE_LABEL = {"new": "Новая", "qualified": "Квалификация", "proposal": "Предложение", "negotiation": "Переговоры",
                    "won": "Выиграна", "lost": "Проиграна"}


def _cut(s: Optional[str], n: int = MAX_FIELD) -> Optional[str]:
    if s is None:
        return None
    s = str(s).strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def _d(v) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    return v.isoformat() if hasattr(v, "isoformat") else str(v)


def _can(ctx, code: str) -> bool:
    """Как deps.require(): владелец компании — все права, иначе право роли в этой компании."""
    return bool(ctx.membership.is_owner) or user_has(ctx.user, [code], tenant_id=ctx.tenant.id)


def _parse_date(v: Any) -> Optional[date]:
    if not v:
        return None
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


class Seen:
    """Записи, которые инструменты реально вернули в этом запросе: (type, id) → {title, url}."""

    def __init__(self) -> None:
        self.items: dict[tuple[str, int], dict] = {}

    def add(self, typ: str, rid: int, title: str, url: str) -> str:
        self.items[(typ, int(rid))] = {"title": _cut(title, 200) or f"#{rid}", "url": url}
        return url

    def get(self, typ: str, rid: Any) -> Optional[dict]:
        try:
            return self.items.get((typ, int(rid)))
        except (TypeError, ValueError):
            return None

    def urls(self) -> set[str]:
        return {v["url"] for v in self.items.values()}


# =============================================================================
# Инструменты
# =============================================================================


def search_tasks(db: Session, ctx, seen: Seen, *, query: Optional[str] = None, status: Optional[str] = None,
                 assigned_to_me: Optional[bool] = None, overdue: Optional[bool] = None,
                 project: Optional[str] = None, deadline_before: Optional[str] = None) -> dict:
    tid = ctx.tenant.id
    if not can_list_tasks(db, ctx.user, tid):
        return NO_ACCESS
    q = db.query(Task).filter(Task.tenant_id == tid).options(
        noload(Task.checklist), noload(Task.comments), noload(Task.attachments), noload(Task.activities),
    )
    q = apply_task_scope(q, db, ctx.user, tid)  # свои / отдел / все — как в списке задач
    if query:
        like = f"%{query.strip()[:200]}%"
        q = q.filter(or_(Task.title.ilike(like), Task.description.ilike(like)))
    if status in TASK_STATUS_LABEL:
        q = q.filter(Task.status == TaskStatus(status))
    elif status == "open":
        q = q.filter(Task.status.notin_([TaskStatus.done, TaskStatus.cancelled]))
    if assigned_to_me:
        q = q.filter(or_(Task.assignee_id == ctx.user.id,
                         Task.id.in_(db.query(task_assignees.c.task_id).filter(task_assignees.c.user_id == ctx.user.id))))
    if overdue:
        q = q.filter(and_(Task.deadline.is_not(None), Task.deadline < datetime.now(timezone.utc),
                          Task.status.notin_([TaskStatus.done, TaskStatus.cancelled])))
    if project:
        pids = [p for (p,) in db.query(Project.id).filter(Project.tenant_id == tid,
                                                           Project.name.ilike(f"%{project.strip()[:200]}%")).limit(50)]
        q = q.filter(Task.project_id.in_(pids or [-1]))
    dl = _parse_date(deadline_before)
    if dl:
        q = q.filter(Task.deadline.is_not(None), Task.deadline < datetime.combine(dl + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc))
    total = q.count()
    rows = q.order_by(Task.deadline.asc().nullslast(), Task.id.desc()).limit(MAX_ROWS).all()
    items = []
    for t in rows:
        st = t.status.value if hasattr(t.status, "value") else str(t.status)
        items.append({
            "id": t.id,
            "title": _cut(t.title, 200),
            "status": TASK_STATUS_LABEL.get(st, st),
            "priority": t.priority.value if hasattr(t.priority, "value") else t.priority,
            "deadline": _d(t.deadline),
            "project": _cut(t.project.name, 120) if t.project else None,
            "assignee": t.assignee.name if t.assignee else None,
            "url": seen.add("task", t.id, t.title, f"/tasks/{t.id}"),
        })
    return {"total": total, "shown": len(items), "items": items}


def search_deals(db: Session, ctx, seen: Seen, *, pipeline: Optional[str] = None, stage: Optional[str] = None,
                 status: Optional[str] = None, stale_days: Optional[int] = None, query: Optional[str] = None) -> dict:
    if not _can(ctx, "deals.view"):
        return NO_ACCESS
    q = db.query(Deal).filter(Deal.tenant_id == ctx.tenant.id)
    if pipeline in (DealPipeline.sales.value, DealPipeline.offtake.value):
        q = q.filter(Deal.pipeline == pipeline)
    if stage:
        if stage in {s.value for s in OfftakeStage}:
            q = q.filter(Deal.offtake_stage == stage)
        elif stage in {s.value for s in DealStage}:
            q = q.filter(Deal.stage == stage)
    if status in {s.value for s in DealStatus}:
        q = q.filter(Deal.status == status)
    if stale_days is not None and stale_days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=min(int(stale_days), 3650))
        q = q.filter(Deal.updated_at < cutoff, Deal.status == DealStatus.open.value)
    if query:
        like = f"%{query.strip()[:200]}%"
        q = q.outerjoin(Company, Company.id == Deal.company_id).filter(or_(Deal.title.ilike(like), Company.name.ilike(like)))
    total = q.count()
    rows = q.order_by(Deal.updated_at.asc() if stale_days else Deal.created_at.desc()).limit(MAX_ROWS).all()
    items = []
    for d in rows:
        item = {
            "id": d.id,
            "title": _cut(d.title, 200),
            "pipeline": d.pipeline,
            "stage": OFFTAKE_STAGE_LABEL.get(d.offtake_stage or "", None) if d.pipeline == "offtake" else DEAL_STAGE_LABEL.get(d.stage, d.stage),
            "status": d.status,
            "amount": round((d.amount_cents or 0) / 100, 2),
            "currency": d.currency,
            "probability": d.probability,
            "close_date": _d(d.close_date),
            "company": _cut(d.company.name, 150) if d.company else None,
            "owner": d.owner.name if d.owner else None,
            "last_change": _d(d.updated_at),
            "url": seen.add("deal", d.id, d.title, f"/deals?deal={d.id}"),
        }
        if d.pipeline == "offtake":
            item.update({
                "product": d.product.name if d.product else None,
                "volume_tpy": float(d.volume_tpy) if d.volume_tpy is not None else None,
                "term_years": d.term_years, "start_year": d.start_year,
            })
        items.append(item)
    return {"total": total, "shown": len(items), "items": items}


def offtake_volume_by_year(db: Session, ctx, seen: Seen) -> dict:
    if not _can(ctx, "deals.view"):
        return NO_ACCESS
    # Тот же расчёт, что у графика «Законтрактованный объём по годам»
    from ..api.deals import contracted_volume
    out = contracted_volume(legal_entity_id=None, ctx=ctx, db=db)
    names = {str(p.id): p.name for p in out.products}
    names["none"] = "Продукт не указан"
    return {
        "unit": "тонн",
        "signed_deals": out.deals_count,
        "years": [
            {"year": y.year, "total": y.total, "by_product": {names.get(k, k): v for k, v in y.by_product.items()}}
            for y in out.years[:60]
        ],
    }


def search_contracts(db: Session, ctx, seen: Seen, *, status: Optional[str] = None, expiring_before: Optional[str] = None,
                     query: Optional[str] = None) -> dict:
    if not _can(ctx, "contracts.view"):
        return NO_ACCESS
    from ..api.contracts import FINAL_STATUSES
    q = db.query(Contract).filter(Contract.tenant_id == ctx.tenant.id)
    if status in CONTRACT_STATUSES:
        q = q.filter(Contract.status == status)
    exp = _parse_date(expiring_before)
    if exp:
        # Как фильтр «истекают» в списке договоров: срок ещё не прошёл, договор не завершён
        q = q.filter(Contract.valid_until.is_not(None), Contract.valid_until >= date.today(),
                     Contract.valid_until <= exp, Contract.status.notin_(list(FINAL_STATUSES)))
    if query:
        like = f"%{query.strip()[:200]}%"
        q = q.outerjoin(Company, Company.id == Contract.company_id).filter(
            or_(Contract.number.ilike(like), Contract.subject.ilike(like), Company.name.ilike(like)))
    total = q.count()
    order = Contract.valid_until.asc().nullslast() if exp else Contract.date_signed.desc().nullslast()
    rows = q.order_by(order, Contract.id.desc()).limit(MAX_ROWS).all()
    items = []
    for c in rows:
        title = f"Договор № {c.number}"
        items.append({
            "id": c.id,
            "number": _cut(c.number, 100),
            "subject": _cut(c.subject),
            "type": c.contract_type,
            "status": CONTRACT_STATUSES.get(c.status, c.status),
            "company": _cut(c.company.name, 150) if c.company else None,
            "amount": float(c.amount) if c.amount is not None else None,
            "currency": c.currency,
            "date_signed": _d(c.date_signed),
            "valid_until": _d(c.valid_until),
            "days_left": (c.valid_until - date.today()).days if c.valid_until else None,
            "responsible": c.responsible.name if c.responsible else None,
            "url": seen.add("contract", c.id, title, f"/contracts/{c.id}"),
        })
    return {"total": total, "shown": len(items), "items": items}


_MARK = re.compile(r"</?mark>")


def search_wiki(db: Session, ctx, seen: Seen, *, query: str = "") -> dict:
    if not _can(ctx, "wiki.use"):
        return NO_ACCESS
    query = (query or "").strip()[:200]
    if not query:
        return {"total": 0, "items": []}
    import html
    from ..api.wiki import search_articles  # полнотекстовый tsvector-поиск + проверка доступа к статьям
    rows = search_articles(q=query, limit=MAX_ROWS, ctx=ctx, db=db)
    items = []
    for r in rows:
        items.append({
            "id": r["id"],
            "title": _cut(r["title"], 200),
            "summary": _cut(r.get("summary")),
            "snippet": _cut(html.unescape(_MARK.sub("", r.get("snippet") or "")), 400),
            "url": seen.add("wiki", r["id"], r["title"], f"/wiki/{r['slug']}"),
        })
    return {"total": len(items), "items": items}


def get_wiki_article(db: Session, ctx, seen: Seen, *, article_id: int = 0) -> dict:
    if not _can(ctx, "wiki.use"):
        return NO_ACCESS
    from ..services.wiki.access import can_view
    try:
        aid = int(article_id)
    except (TypeError, ValueError):
        return {"error": "статья не найдена"}
    a = db.get(Article, aid)
    if not a or a.tenant_id != ctx.tenant.id or not can_view(db, ctx.tenant.id, ctx.user, a):
        return {"error": "статья не найдена"}
    content = a.content_md or ""
    return {
        "id": a.id,
        "title": a.title,
        "summary": _cut(a.summary),
        "updated_at": _d(a.updated_at),
        "content": content[:MAX_ARTICLE] + ("\n…(текст обрезан)" if len(content) > MAX_ARTICLE else ""),
        "url": seen.add("wiki", a.id, a.title, f"/wiki/{a.slug}"),
    }


# =============================================================================
# Описание для Claude (strict: только эти параметры, без tenant_id/user_id)
# =============================================================================


def _schema(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or [], "additionalProperties": False}


_STR = {"type": "string"}
_BOOL = {"type": "boolean"}

TOOLS: dict[str, dict] = {
    "search_tasks": {
        "fn": search_tasks,
        "description": "Найти задачи компании, видимые текущему пользователю. Вызывай, когда спрашивают о задачах: "
                       "мои задачи, просроченные, по проекту, по статусу, со сроком до даты.",
        "schema": _schema({
            "query": {**_STR, "description": "Текст для поиска в названии и описании задачи"},
            "status": {"type": "string", "enum": ["open", "new", "in_progress", "review", "done", "cancelled"],
                       "description": "open — все незавершённые"},
            "assigned_to_me": {**_BOOL, "description": "Только задачи, где текущий пользователь исполнитель"},
            "overdue": {**_BOOL, "description": "Только просроченные незавершённые"},
            "project": {**_STR, "description": "Часть названия проекта"},
            "deadline_before": {"type": "string", "format": "date", "description": "Срок не позже этой даты (YYYY-MM-DD)"},
        }),
        "params": {"query": str, "status": str, "assigned_to_me": bool, "overdue": bool, "project": str, "deadline_before": str},
    },
    "search_deals": {
        "fn": search_deals,
        "description": "Найти сделки компании (воронка продаж sales или offtake). Вызывай для вопросов о сделках, "
                       "стадиях, суммах, сделках без движения N дней.",
        "schema": _schema({
            "pipeline": {"type": "string", "enum": ["sales", "offtake"]},
            "stage": {"type": "string", "enum": [s.value for s in DealStage] + [s.value for s in OfftakeStage],
                      "description": "Стадия: для sales — new…lost, для offtake — initial_contact…refused"},
            "status": {"type": "string", "enum": ["open", "won", "lost"]},
            "stale_days": {"type": "integer", "description": "Открытые сделки без изменений дольше стольких дней"},
            "query": {**_STR, "description": "Текст в названии сделки или компании-клиента"},
        }),
        "params": {"pipeline": str, "stage": str, "status": str, "stale_days": int, "query": str},
    },
    "offtake_volume_by_year": {
        "fn": offtake_volume_by_year,
        "description": "Законтрактованный объём (тонн) по годам по подписанным offtake-сделкам, с разбивкой по продуктам.",
        "schema": _schema({}),
        "params": {},
    },
    "search_contracts": {
        "fn": search_contracts,
        "description": "Найти договоры компании: по статусу, истекающие до даты, по номеру/предмету/контрагенту.",
        "schema": _schema({
            "status": {"type": "string", "enum": list(CONTRACT_STATUSES)},
            "expiring_before": {"type": "string", "format": "date",
                                "description": "Действующие договоры, срок которых истекает не позже даты (YYYY-MM-DD)"},
            "query": {**_STR, "description": "Номер, предмет договора или название контрагента"},
        }),
        "params": {"status": str, "expiring_before": str, "query": str},
    },
    "search_wiki": {
        "fn": search_wiki,
        "description": "Полнотекстовый поиск по базе знаний компании. Вызывай для вопросов о регламентах, инструкциях, "
                       "правилах компании и о том, как что-то сделать. Возвращает статьи с фрагментами.",
        "schema": _schema({"query": {**_STR, "description": "Ключевые слова для поиска"}}, ["query"]),
        "params": {"query": str},
    },
    "get_wiki_article": {
        "fn": get_wiki_article,
        "description": "Прочитать текст статьи базы знаний по id из результата search_wiki, чтобы ответить по её содержанию.",
        "schema": _schema({"article_id": {"type": "integer"}}, ["article_id"]),
        "params": {"article_id": int},
    },
}


def tool_definitions() -> list[dict]:
    return [
        {"name": name, "description": t["description"], "input_schema": t["schema"], "strict": True}
        for name, t in TOOLS.items()
    ]


def _clean(name: str, raw: Any) -> dict:
    """Оставляет только объявленные параметры нужного типа. tenant_id, user_id и прочее — отбрасываются."""
    spec: dict[str, type] = TOOLS[name]["params"]
    out: dict[str, Any] = {}
    if not isinstance(raw, dict):
        return out
    for key, typ in spec.items():
        if key not in raw or raw[key] is None:
            continue
        v = raw[key]
        if typ is bool:
            if isinstance(v, bool):
                out[key] = v
        elif typ is int:
            if isinstance(v, int) and not isinstance(v, bool):
                out[key] = v
            elif isinstance(v, str) and v.strip().isdigit():
                out[key] = int(v.strip())
        elif typ is str and isinstance(v, (str, int, float)) and not isinstance(v, bool):
            out[key] = str(v)[:300]
    return out


def execute(db: Session, ctx, seen: Seen, name: str, raw_input: Any) -> tuple[dict, bool]:
    """Выполняет инструмент. Возвращает (результат, is_error)."""
    tool = TOOLS.get(name)
    if not tool:
        return {"error": "неизвестный инструмент"}, True
    fn: Callable = tool["fn"]
    try:
        return fn(db, ctx, seen, **_clean(name, raw_input)), False
    except Exception:
        log.exception("ai tool failed: %s", name)
        db.rollback()
        return {"error": "не удалось получить данные"}, True
