"""ИИ-помощник: состояние, включение в компании и расходы.

Сами функции ИИ живут в отдельных модулях (ai_work, ai_documents, ai_crm, ai_assistant) и вызывают
Claude только через core.ai.run() — там лимиты, журнал и защитные правила.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core import ai as core_ai
from ..database import get_db
from ..models import AiUsage
from .deps import TenantContext, get_current_context, log_action, require

router = APIRouter(prefix="/api/ai", tags=["ai"])

FEATURE_LABELS = {
    "summarize_mail": "Сводка переписки",
    "summarize_chat": "Сводка чата",
    "tasks_from_text": "Задачи из письма",
    "report_suggest": "Отчёт по описанию",
    "contract_extract": "Разбор договора",
    "obligations": "Обязательства и сроки",
    "version_diff": "Сравнение версий",
    "offtake_email": "Черновик письма",
    "offtake_summary": "Сводка по контракту",
    "contact_extract": "Контакт из подписи",
    "assistant": "Спроси CRM",
}


@router.get("/status")
def ai_status(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    return core_ai.status(db, ctx.tenant)


class AiSettingsIn(BaseModel):
    enabled: bool


@router.put("/settings")
def set_ai_settings(
    payload: AiSettingsIn,
    ctx: TenantContext = Depends(require("settings.system")),
    db: Session = Depends(get_db),
):
    ctx.tenant.ai_enabled = payload.enabled
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="tenant", entity_id=ctx.tenant.id,
               detail="ИИ-помощник " + ("включён" if payload.enabled else "выключен"))
    db.commit()
    return core_ai.status(db, ctx.tenant)


@router.get("/usage")
def ai_usage(ctx: TenantContext = Depends(require("settings.system")), db: Session = Depends(get_db)):
    """Расход за текущий месяц по функциям — только своей компании."""
    start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    rows = (
        db.query(AiUsage.feature, AiUsage.status, func.count(AiUsage.id),
                 func.coalesce(func.sum(AiUsage.input_tokens), 0), func.coalesce(func.sum(AiUsage.output_tokens), 0))
        .filter(AiUsage.tenant_id == ctx.tenant.id, AiUsage.created_at >= start)
        .group_by(AiUsage.feature, AiUsage.status)
        .all()
    )
    by_feature: dict[str, dict] = {}
    for feature, st, cnt, tin, tout in rows:
        f = by_feature.setdefault(feature, {"feature": feature, "label": FEATURE_LABELS.get(feature, feature),
                                            "requests": 0, "off_topic": 0, "errors": 0, "input_tokens": 0, "output_tokens": 0})
        if st == "off_topic":
            f["off_topic"] += cnt
        if st == "error":
            f["errors"] += cnt
        else:
            f["requests"] += cnt
        f["input_tokens"] += int(tin)
        f["output_tokens"] += int(tout)
    return {**core_ai.status(db, ctx.tenant), "features": sorted(by_feature.values(), key=lambda x: -x["requests"])}
