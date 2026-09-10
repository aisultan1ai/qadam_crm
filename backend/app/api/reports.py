"""Гибкий конструктор отчётов + библиотека готовых отчётов.

Metric × Group-by × Filters. Возвращает {rows: [{group, value}], total, meta}.
Safe: ни один параметр не подставляется в SQL сырой строкой — только через ORM.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, case
from typing import Optional
from datetime import datetime, timedelta, date, timezone
from pydantic import BaseModel

from ..database import get_db
from ..models import Task, Project, User, Deal, TimeEntry
from ..models.task import TaskStatus
from ..models.deal import DealStatus
from .deps import TenantContext, require


router = APIRouter(prefix="/api/reports", tags=["reports"])


ALLOWED_METRICS = {
    "tasks_count": "Количество задач",
    "tasks_completed": "Завершённые задачи",
    "tasks_overdue": "Просроченные задачи",
    "hours_logged": "Учтённые часы",
    "deals_amount": "Сумма сделок",
    "deals_weighted": "Взвешенный прогноз сделок",
    "deals_count": "Количество сделок",
}

ALLOWED_GROUPS = {
    "assignee": "По исполнителю",
    "project": "По проекту",
    "status": "По статусу",
    "priority": "По приоритету",
    "stage": "По стадии (сделки)",
    "owner": "По владельцу (сделки)",
    "day": "По дню",
    "week": "По неделе",
    "month": "По месяцу",
}


class ReportRow(BaseModel):
    group: Optional[str] = None
    group_id: Optional[int] = None
    value: float
    count: int = 0
    computed: dict[str, float] = {}  # P5.1: {formula_name: computed_value}


class FormulaSpec(BaseModel):
    name: str
    expression: str  # напр. "value * 0.15", "value / (count or 1)"


class ReportOut(BaseModel):
    metric: str
    group_by: str
    rows: list[ReportRow]
    total: float
    meta: dict = {}
    formula_totals: dict[str, float] = {}  # суммы по каждой formula


class StandardOut(BaseModel):
    key: str
    label: str
    metric: str
    group_by: str
    description: str


STANDARD_REPORTS: list[StandardOut] = [
    StandardOut(key="tasks_by_assignee", label="Задачи по исполнителям", metric="tasks_count", group_by="assignee", description="Кто сколько задач ведёт"),
    StandardOut(key="tasks_by_status", label="Задачи по статусам", metric="tasks_count", group_by="status", description="Распределение по статусам"),
    StandardOut(key="tasks_by_project", label="Задачи по проектам", metric="tasks_count", group_by="project", description="Загрузка проектов"),
    StandardOut(key="completed_by_assignee", label="Завершённые задачи по сотрудникам", metric="tasks_completed", group_by="assignee", description="Продуктивность"),
    StandardOut(key="overdue_by_assignee", label="Просроченные задачи по сотрудникам", metric="tasks_overdue", group_by="assignee", description="Кто задерживает"),
    StandardOut(key="hours_by_user", label="Часы по сотрудникам", metric="hours_logged", group_by="assignee", description="Учёт времени"),
    StandardOut(key="hours_by_project", label="Часы по проектам", metric="hours_logged", group_by="project", description="Бюджет проектов в часах"),
    StandardOut(key="deals_by_stage", label="Сделки по стадиям", metric="deals_amount", group_by="stage", description="Воронка в деньгах"),
    StandardOut(key="deals_forecast", label="Взвешенный прогноз", metric="deals_weighted", group_by="stage", description="Прогноз с учётом вероятности"),
    StandardOut(key="deals_by_owner", label="Сделки по менеджерам", metric="deals_amount", group_by="owner", description="Продажи по владельцам"),
    StandardOut(key="tasks_by_month", label="Активность задач по месяцам", metric="tasks_count", group_by="month", description="Динамика во времени"),
    StandardOut(key="hours_by_day", label="Часы по дням", metric="hours_logged", group_by="day", description="Ежедневная загрузка"),
]


@router.get("/standard", response_model=list[StandardOut])
def standard_reports(ctx: TenantContext = Depends(require("analytics.reports"))):
    return STANDARD_REPORTS


@router.get("/metrics")
def list_metrics(ctx: TenantContext = Depends(require("analytics.reports"))):
    return {
        "metrics": [{"key": k, "label": v} for k, v in ALLOWED_METRICS.items()],
        "groups": [{"key": k, "label": v} for k, v in ALLOWED_GROUPS.items()],
    }


def _date_trunc(period: str, column):
    return func.date_trunc(period, column)


def _apply_date_range(query, column, from_date: Optional[date], to_date: Optional[date]):
    if from_date is not None:
        query = query.filter(column >= from_date)
    if to_date is not None:
        query = query.filter(column <= to_date)
    return query


def _apply_formulas(rows: list[ReportRow], formulas: list[dict]) -> dict[str, float]:
    """P5.1: safe eval формул для каждой строки. Возвращает totals по formula.

    Formula expression имеет доступ к переменным: value, count, group.
    Используется simpleeval — sandboxed math evaluator.
    """
    if not formulas:
        return {}
    try:
        from simpleeval import SimpleEval
    except ImportError:
        return {}

    se = SimpleEval()
    totals: dict[str, float] = {}
    for row in rows:
        row.computed = {}
        se.names = {"value": row.value, "count": row.count, "group": row.group or ""}
        for f in formulas:
            name = f.get("name") or ""
            expr = f.get("expression") or ""
            if not name or not expr:
                continue
            try:
                v = float(se.eval(expr))
            except Exception:
                v = 0.0
            row.computed[name] = v
            totals[name] = totals.get(name, 0.0) + v
    return totals


def compute_report(
    db: Session,
    tenant_id: int,
    metric: str,
    group_by: str = "assignee",
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    project_id: Optional[int] = None,
    formulas: Optional[list[dict]] = None,
) -> ReportOut:
    """Standalone-функция расчёта отчёта. Используется в /run endpoint И в
    celery-задаче send_report_email (без FastAPI-контекста).

    formulas: [{"name": "profit", "expression": "value * 0.15"}, ...]
    """
    if metric not in ALLOWED_METRICS:
        raise HTTPException(400, f"Неизвестная метрика: {metric}")
    if group_by not in ALLOWED_GROUPS:
        raise HTTPException(400, f"Неизвестная группировка: {group_by}")

    # --- Task-based metrics ---
    if metric in ("tasks_count", "tasks_completed", "tasks_overdue"):
        q = db.query(Task).filter(Task.tenant_id == tenant_id)
        if project_id is not None:
            q = q.filter(Task.project_id == project_id)
        if metric == "tasks_completed":
            q = q.filter(Task.status == TaskStatus.done)
        elif metric == "tasks_overdue":
            q = q.filter(
                Task.deadline.is_not(None),
                Task.deadline < datetime.now(timezone.utc),
                Task.status.notin_([TaskStatus.done, TaskStatus.cancelled]),
            )
        q = _apply_date_range(q, Task.created_at, from_date, to_date)

        rows: list[ReportRow] = []
        if group_by == "assignee":
            data = (
                db.query(User.id, User.name, func.count(Task.id))
                .join(Task, Task.assignee_id == User.id)
                .filter(Task.tenant_id == tenant_id)
            )
            if project_id is not None:
                data = data.filter(Task.project_id == project_id)
            if metric == "tasks_completed":
                data = data.filter(Task.status == TaskStatus.done)
            elif metric == "tasks_overdue":
                data = data.filter(
                    Task.deadline.is_not(None),
                    Task.deadline < datetime.now(timezone.utc),
                    Task.status.notin_([TaskStatus.done, TaskStatus.cancelled]),
                )
            data = _apply_date_range(data, Task.created_at, from_date, to_date)
            data = data.group_by(User.id, User.name).order_by(func.count(Task.id).desc())
            for uid, name, cnt in data.limit(50).all():
                rows.append(ReportRow(group=name, group_id=uid, value=float(cnt), count=int(cnt)))
        elif group_by == "project":
            data = (
                db.query(Project.id, Project.name, func.count(Task.id))
                .join(Task, Task.project_id == Project.id)
                .filter(Task.tenant_id == tenant_id)
            )
            if metric == "tasks_completed":
                data = data.filter(Task.status == TaskStatus.done)
            elif metric == "tasks_overdue":
                data = data.filter(Task.deadline.is_not(None), Task.deadline < datetime.now(timezone.utc), Task.status.notin_([TaskStatus.done, TaskStatus.cancelled]))
            data = _apply_date_range(data, Task.created_at, from_date, to_date)
            data = data.group_by(Project.id, Project.name).order_by(func.count(Task.id).desc())
            for pid, name, cnt in data.limit(50).all():
                rows.append(ReportRow(group=name, group_id=pid, value=float(cnt), count=int(cnt)))
        elif group_by in ("status", "priority"):
            col = Task.status if group_by == "status" else Task.priority
            data = (
                db.query(col, func.count(Task.id))
                .filter(Task.tenant_id == tenant_id)
            )
            if project_id is not None:
                data = data.filter(Task.project_id == project_id)
            data = _apply_date_range(data, Task.created_at, from_date, to_date)
            data = data.group_by(col).order_by(func.count(Task.id).desc())
            for k, cnt in data.all():
                rows.append(ReportRow(group=str(k.value if hasattr(k, "value") else k), value=float(cnt), count=int(cnt)))
        elif group_by in ("day", "week", "month"):
            trunc = _date_trunc(group_by, Task.created_at)
            data = (
                db.query(trunc.label("period"), func.count(Task.id))
                .filter(Task.tenant_id == tenant_id)
            )
            if project_id is not None:
                data = data.filter(Task.project_id == project_id)
            data = _apply_date_range(data, Task.created_at, from_date, to_date)
            data = data.group_by("period").order_by("period")
            for period, cnt in data.limit(365).all():
                rows.append(ReportRow(group=period.strftime("%Y-%m-%d") if period else "?", value=float(cnt), count=int(cnt)))
        else:
            raise HTTPException(400, f"Группировка {group_by} не поддерживается для {metric}")

        totals = _apply_formulas(rows, formulas or [])
        return ReportOut(metric=metric, group_by=group_by, rows=rows, total=sum(r.value for r in rows), meta={"unit": "задач"}, formula_totals=totals)

    # --- Hours logged ---
    if metric == "hours_logged":
        q = db.query(TimeEntry).filter(TimeEntry.tenant_id == tenant_id)
        if project_id is not None:
            q = q.join(Task, Task.id == TimeEntry.task_id).filter(Task.project_id == project_id)
        rows: list[ReportRow] = []
        if group_by == "assignee":
            data = (
                db.query(User.id, User.name, func.coalesce(func.sum(TimeEntry.seconds), 0))
                .join(TimeEntry, TimeEntry.user_id == User.id)
                .filter(TimeEntry.tenant_id == tenant_id)
            )
            data = _apply_date_range(data, TimeEntry.started_at, from_date, to_date)
            data = data.group_by(User.id, User.name).order_by(func.sum(TimeEntry.seconds).desc())
            for uid, name, mins in data.limit(50).all():
                hours = round((mins or 0) / 3600, 2)
                rows.append(ReportRow(group=name, group_id=uid, value=hours, count=int(mins or 0)))
        elif group_by == "project":
            data = (
                db.query(Project.id, Project.name, func.coalesce(func.sum(TimeEntry.seconds), 0))
                .join(Task, Task.project_id == Project.id)
                .join(TimeEntry, TimeEntry.task_id == Task.id)
                .filter(TimeEntry.tenant_id == tenant_id)
            )
            data = _apply_date_range(data, TimeEntry.started_at, from_date, to_date)
            data = data.group_by(Project.id, Project.name).order_by(func.sum(TimeEntry.seconds).desc())
            for pid, name, mins in data.limit(50).all():
                hours = round((mins or 0) / 3600, 2)
                rows.append(ReportRow(group=name, group_id=pid, value=hours, count=int(mins or 0)))
        elif group_by in ("day", "week", "month"):
            trunc = _date_trunc(group_by, TimeEntry.started_at)
            data = (
                db.query(trunc.label("period"), func.coalesce(func.sum(TimeEntry.seconds), 0))
                .filter(TimeEntry.tenant_id == tenant_id)
            )
            data = _apply_date_range(data, TimeEntry.started_at, from_date, to_date)
            data = data.group_by("period").order_by("period")
            for period, mins in data.limit(365).all():
                hours = round((mins or 0) / 3600, 2)
                rows.append(ReportRow(group=period.strftime("%Y-%m-%d") if period else "?", value=hours, count=int(mins or 0)))
        else:
            raise HTTPException(400, f"Группировка {group_by} не поддерживается для {metric}")
        totals = _apply_formulas(rows, formulas or [])
        return ReportOut(metric=metric, group_by=group_by, rows=rows, total=sum(r.value for r in rows), meta={"unit": "часов"}, formula_totals=totals)

    # --- Deals metrics ---
    if metric in ("deals_amount", "deals_weighted", "deals_count"):
        rows: list[ReportRow] = []
        base = db.query(Deal).filter(Deal.tenant_id == tenant_id)
        base = _apply_date_range(base, Deal.created_at, from_date, to_date)

        if group_by == "stage":
            data = (
                db.query(
                    Deal.stage,
                    func.count(Deal.id),
                    func.coalesce(func.sum(Deal.amount_cents), 0),
                    func.coalesce(func.sum(Deal.amount_cents * Deal.probability / 100), 0),
                )
                .filter(Deal.tenant_id == tenant_id)
            )
            data = _apply_date_range(data, Deal.created_at, from_date, to_date)
            data = data.group_by(Deal.stage).order_by(Deal.stage)
            for stage, cnt, amount, weighted in data.all():
                if metric == "deals_count":
                    val = float(cnt)
                elif metric == "deals_amount":
                    val = float(amount or 0) / 100
                else:
                    val = float(weighted or 0) / 100
                rows.append(ReportRow(group=str(stage.value if hasattr(stage, "value") else stage), value=val, count=int(cnt)))
        elif group_by == "owner":
            data = (
                db.query(
                    User.id, User.name,
                    func.count(Deal.id),
                    func.coalesce(func.sum(Deal.amount_cents), 0),
                    func.coalesce(func.sum(Deal.amount_cents * Deal.probability / 100), 0),
                )
                .join(Deal, Deal.owner_id == User.id)
                .filter(Deal.tenant_id == tenant_id)
            )
            data = _apply_date_range(data, Deal.created_at, from_date, to_date)
            data = data.group_by(User.id, User.name).order_by(func.sum(Deal.amount_cents).desc())
            for uid, name, cnt, amount, weighted in data.limit(50).all():
                if metric == "deals_count":
                    val = float(cnt)
                elif metric == "deals_amount":
                    val = float(amount or 0) / 100
                else:
                    val = float(weighted or 0) / 100
                rows.append(ReportRow(group=name, group_id=uid, value=val, count=int(cnt)))
        elif group_by in ("day", "week", "month"):
            trunc = _date_trunc(group_by, Deal.created_at)
            data = (
                db.query(
                    trunc.label("period"),
                    func.count(Deal.id),
                    func.coalesce(func.sum(Deal.amount_cents), 0),
                    func.coalesce(func.sum(Deal.amount_cents * Deal.probability / 100), 0),
                )
                .filter(Deal.tenant_id == tenant_id)
            )
            data = _apply_date_range(data, Deal.created_at, from_date, to_date)
            data = data.group_by("period").order_by("period")
            for period, cnt, amount, weighted in data.limit(365).all():
                if metric == "deals_count":
                    val = float(cnt)
                elif metric == "deals_amount":
                    val = float(amount or 0) / 100
                else:
                    val = float(weighted or 0) / 100
                rows.append(ReportRow(group=period.strftime("%Y-%m-%d") if period else "?", value=val, count=int(cnt)))
        else:
            raise HTTPException(400, f"Группировка {group_by} не поддерживается для {metric}")

        unit = "сделок" if metric == "deals_count" else "денег"
        totals = _apply_formulas(rows, formulas or [])
        return ReportOut(metric=metric, group_by=group_by, rows=rows, total=sum(r.value for r in rows), meta={"unit": unit}, formula_totals=totals)

    raise HTTPException(400, "Не удалось построить отчёт")


@router.get("/run", response_model=ReportOut)
def run_report_endpoint(
    metric: str,
    group_by: str = "assignee",
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    project_id: Optional[int] = None,
    ctx: TenantContext = Depends(require("analytics.reports")),
    db: Session = Depends(get_db),
):
    """HTTP wrapper вокруг compute_report."""
    return compute_report(db, ctx.tenant.id, metric, group_by, from_date, to_date, project_id)
