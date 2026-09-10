"""AI-помощник: генерация задач из писем, summary тредов, подсказки для отчётов.

Использует Anthropic Claude API (SDK 0.72+). Ключ — ANTHROPIC_API_KEY из env.
Модель по умолчанию — claude-opus-4-7 (актуальная на 2026). Prompt caching для
frozen system-промптов.
"""
from __future__ import annotations

import json
import os
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .deps import TenantContext, get_current_context

router = APIRouter(prefix="/api/ai", tags=["ai"])


DEFAULT_MODEL = os.getenv("AI_MODEL", "claude-opus-4-7")
MAX_TOKENS = int(os.getenv("AI_MAX_TOKENS", "4096"))


def _client():
    """Ленивая инициализация — при отсутствии SDK или ключа возвращает 501/503."""
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(503, "AI не настроен: ANTHROPIC_API_KEY не задан. Обратитесь к администратору.")
    try:
        from anthropic import Anthropic
    except ImportError:
        raise HTTPException(501, "AI не установлен: пакет anthropic отсутствует в бекенде.")
    return Anthropic(api_key=api_key)


# =============================================================================
# 1. Generate tasks from email/text
# =============================================================================

GENERATE_TASKS_SYSTEM = """Ты — ассистент CRM-системы Qadam. Твоя задача — разобрать письмо или заметку и вернуть JSON-массив задач.

Каждая задача — объект с полями:
- title: короткое действие (не более 100 символов, инфинитив на русском: "Подготовить...", "Ответить...", "Связаться...")
- description: пояснение (можно пусто)
- priority: "low" | "medium" | "high" | "critical" (по важности из контекста)
- deadline_hint: подсказка о сроке из текста или null

Верни ТОЛЬКО валидный JSON-массив, без комментариев. Если задач нет — верни [].
Пример: [{"title": "Ответить клиенту про интеграцию", "description": "Клиент спрашивал сроки", "priority": "high", "deadline_hint": "завтра"}]"""


class GenerateTasksIn(BaseModel):
    text: str
    context: Optional[str] = None


class GeneratedTask(BaseModel):
    title: str
    description: Optional[str] = ""
    priority: str = "medium"
    deadline_hint: Optional[str] = None


class GenerateTasksOut(BaseModel):
    tasks: list[GeneratedTask]
    model: str
    input_tokens: int
    output_tokens: int


@router.post("/generate-tasks", response_model=GenerateTasksOut)
def generate_tasks(
    payload: GenerateTasksIn,
    ctx: TenantContext = Depends(get_current_context),
):
    if len(payload.text.strip()) < 5:
        raise HTTPException(400, "Слишком короткий текст")
    if len(payload.text) > 20000:
        raise HTTPException(400, "Текст слишком длинный (>20000 символов)")

    client = _client()
    user_message = payload.text
    if payload.context:
        user_message = f"Контекст: {payload.context}\n\nПисьмо:\n{payload.text}"

    try:
        response = client.messages.create(
            model=DEFAULT_MODEL,
            max_tokens=MAX_TOKENS,
            system=[
                {
                    "type": "text",
                    "text": GENERATE_TASKS_SYSTEM,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": user_message}],
        )
    except Exception as e:
        raise HTTPException(502, f"AI не смог обработать запрос: {type(e).__name__}")

    text_blocks = [b.text for b in response.content if b.type == "text"]
    raw = (text_blocks[0] if text_blocks else "").strip()

    # Пытаемся вытащить JSON, даже если модель обернула его в ```json ... ```
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    try:
        parsed = json.loads(raw)
        if not isinstance(parsed, list):
            parsed = []
    except json.JSONDecodeError:
        parsed = []

    tasks: list[GeneratedTask] = []
    for item in parsed[:20]:  # безопасность: не более 20 задач за раз
        if isinstance(item, dict) and item.get("title"):
            tasks.append(GeneratedTask(
                title=str(item.get("title", "")).strip()[:200],
                description=str(item.get("description") or "")[:2000],
                priority=str(item.get("priority", "medium")).lower(),
                deadline_hint=item.get("deadline_hint"),
            ))

    return GenerateTasksOut(
        tasks=tasks,
        model=response.model,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
    )


# =============================================================================
# 2. Summarize thread / comments
# =============================================================================

SUMMARIZE_SYSTEM = """Ты — ассистент CRM. Тебе присылают тред сообщений/комментариев. Верни краткое резюме на русском:
- 1-2 предложения о главной теме
- 3-5 маркеров с ключевыми решениями/фактами (если есть)
- Список открытых вопросов или action items (если есть)

Резюме — только текст в Markdown. Не пиши "Резюме:" или "Ответ:" — сразу по делу."""


class SummarizeIn(BaseModel):
    text: str


class SummarizeOut(BaseModel):
    summary: str
    model: str
    input_tokens: int
    output_tokens: int


@router.post("/summarize", response_model=SummarizeOut)
def summarize(
    payload: SummarizeIn,
    ctx: TenantContext = Depends(get_current_context),
):
    if len(payload.text.strip()) < 20:
        raise HTTPException(400, "Слишком коротко — нечего резюмировать")
    if len(payload.text) > 100000:
        raise HTTPException(400, "Тред слишком большой (>100000 символов)")

    client = _client()
    try:
        response = client.messages.create(
            model=DEFAULT_MODEL,
            max_tokens=MAX_TOKENS,
            system=[
                {
                    "type": "text",
                    "text": SUMMARIZE_SYSTEM,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": payload.text}],
        )
    except Exception as e:
        raise HTTPException(502, f"AI не смог обработать запрос: {type(e).__name__}")

    text_blocks = [b.text for b in response.content if b.type == "text"]
    return SummarizeOut(
        summary=(text_blocks[0] if text_blocks else "").strip(),
        model=response.model,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
    )


# =============================================================================
# 3. Suggest a report configuration from natural-language description
# =============================================================================

REPORT_SUGGEST_SYSTEM = """Ты — помощник по построению отчётов. Пользователь пишет что хочет увидеть, ты выбираешь метрику и группировку из списка.

Метрики:
- tasks_count — количество задач
- tasks_completed — завершённые задачи
- tasks_overdue — просроченные задачи
- hours_logged — учтённые часы
- deals_amount — сумма сделок
- deals_weighted — взвешенный прогноз сделок
- deals_count — количество сделок

Группировки:
- assignee — по исполнителю
- project — по проекту
- status — по статусу
- priority — по приоритету
- stage — по стадии (сделки)
- owner — по владельцу (сделки)
- day, week, month — временные

Верни ТОЛЬКО JSON-объект {"metric": "...", "group_by": "...", "explanation": "..."} без комментариев."""


class ReportSuggestIn(BaseModel):
    description: str


class ReportSuggestOut(BaseModel):
    metric: str
    group_by: str
    explanation: str
    model: str


@router.post("/report-suggest", response_model=ReportSuggestOut)
def report_suggest(
    payload: ReportSuggestIn,
    ctx: TenantContext = Depends(get_current_context),
):
    if len(payload.description.strip()) < 3:
        raise HTTPException(400, "Слишком короткое описание")

    client = _client()
    try:
        response = client.messages.create(
            model=DEFAULT_MODEL,
            max_tokens=512,
            system=[
                {
                    "type": "text",
                    "text": REPORT_SUGGEST_SYSTEM,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": payload.description}],
        )
    except Exception as e:
        raise HTTPException(502, f"AI не смог обработать запрос: {type(e).__name__}")

    text_blocks = [b.text for b in response.content if b.type == "text"]
    raw = (text_blocks[0] if text_blocks else "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(502, "AI вернул некорректный JSON")

    metric = str(parsed.get("metric", "tasks_count"))
    group_by = str(parsed.get("group_by", "assignee"))
    explanation = str(parsed.get("explanation", ""))[:500]

    return ReportSuggestOut(
        metric=metric,
        group_by=group_by,
        explanation=explanation,
        model=response.model,
    )


# =============================================================================
# 4. Health-check — есть ли ключ
# =============================================================================

@router.get("/status")
def ai_status(ctx: TenantContext = Depends(get_current_context)):
    key_set = bool(os.getenv("ANTHROPIC_API_KEY", "").strip())
    return {
        "configured": key_set,
        "model": DEFAULT_MODEL if key_set else None,
        "features": ["generate_tasks", "summarize", "report_suggest"] if key_set else [],
    }
