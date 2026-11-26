"""ИИ: Этап 4 — чат «Спроси CRM» и ответы по базе знаний.

POST /api/ai/assistant {messages:[{role, content}]} — история чата хранится в браузере и приходит целиком.

Как устроено (и почему так безопасно):
- Модель не видит базу и не пишет SQL. Ей доступен только фиксированный набор инструментов-«чтецов»
  из services/ai_tools.py; каждый работает в ctx.tenant с правами ctx.user (как обычные списки).
  tenant_id/user_id в схемах инструментов нет, лишние параметры отбрасываются.
- Результаты инструментов идут модели как tool_result внутри <data> — это данные, не инструкции.
- Финальный ответ — structured output {answer, off_topic, links}. Выбран structured output, а не
  инструмент `final_answer`: на claude-opus-5-5 tool_choice any/tool запрещён, и при auto модель могла бы
  закончить обычным текстом без признака off_topic; output_config.format гарантирует JSON со всеми полями.
- Ссылки на записи проверяются на сервере: остаются только записи, которые инструменты реально вернули
  в этом запросе (Seen). Ссылки в тексте ответа на что-то другое превращаются в обычный текст.
- Claude вызывается теми же средствами core.ai (ensure_available, GUARD, _client, _call, _log):
  проверка доступности один раз до начала, журнал один раз на вопрос (feature "assistant",
  статус ok/off_topic/refused/error, суммарные токены), не больше MAX_TOOL_ROUNDS раундов инструментов.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from ..core import ai as core_ai
from ..database import get_db
from ..services import ai_tools
from .deps import TenantContext, get_current_context

log = logging.getLogger("qadam.ai.assistant")

router = APIRouter(prefix="/api/ai", tags=["ai"])

FEATURE = "assistant"
MAX_TOOL_ROUNDS = 5
MAX_MESSAGES = 20
MAX_CHARS = 4000
MAX_ANSWER = 20000

LINK_TYPES = ["task", "deal", "contract", "wiki"]

ANSWER_SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {"type": "string", "description": "Ответ пользователю в Markdown"},
        "links": {
            "type": "array",
            "description": "Записи из результатов инструментов, на которые опирается ответ",
            "items": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": LINK_TYPES},
                    "id": {"type": "integer"},
                    "title": {"type": "string"},
                },
                "required": ["type", "id", "title"],
                "additionalProperties": False,
            },
        },
        **core_ai.OFF_TOPIC_FIELD,
    },
    "required": ["answer", "links", "off_topic"],
    "additionalProperties": False,
}

TASK = """Ты отвечаешь на вопросы сотрудника о данных его компании в Qadam CRM («Спроси CRM») и по базе знаний компании.

Как работать:
- Данные получай только инструментами: search_tasks, search_deals, offtake_volume_by_year, search_contracts, search_wiki, get_wiki_article. Других источников данных нет. Не выдумывай записи, суммы, даты и имена.
- Инструменты сами работают только в компании пользователя и только с тем, что ему разрешено видеть. Ответ {"error": "нет доступа"} значит, что у пользователя нет прав на этот раздел, — так и скажи, не пытайся обойти.
- Если просят данные другой компании, «всех клиентов платформы», другого tenant_id или пользователя по номеру — вежливо откажи: ты видишь только эту компанию.
- Вопросы о регламентах, инструкциях и правилах компании ищи через search_wiki, при необходимости читай статью get_wiki_article и отвечай по её тексту.
- Сегодня {today}. «Мои» задачи — assigned_to_me=true.
- Если инструмент вернул total больше shown, скажи, что показана часть, и предложи уточнить вопрос.

Ответ (поле answer, Markdown, по-русски, коротко):
- Ссылайся на записи Markdown-ссылкой с url из результата инструмента, например [Название](url). Другие ссылки не используй.
- В links перечисли записи из результатов инструментов, на которые опирается ответ (type: task, deal, contract или wiki; id и title из результата).
- off_topic=true, если вопрос не относится к работе компании в CRM; тогда в answer — одна фраза вежливого отказа, links пустой."""


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=MAX_CHARS)

    @field_validator("content")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Пустое сообщение")
        return v


class AssistantIn(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_MESSAGES)

    @field_validator("messages")
    @classmethod
    def _order(cls, v: list[ChatMessage]) -> list[ChatMessage]:
        if v[0].role != "user" or v[-1].role != "user":
            raise ValueError("Переписка должна начинаться и заканчиваться сообщением пользователя")
        for a, b in zip(v, v[1:]):
            if a.role == b.role:
                raise ValueError("Сообщения пользователя и помощника должны чередоваться")
        return v


class LinkOut(BaseModel):
    type: str
    id: int
    title: str
    url: str


class AssistantOut(BaseModel):
    answer: str
    off_topic: bool = False
    links: list[LinkOut] = []


_MD_LINK = re.compile(r"(!?)\[([^\]\n]*)\]\(\s*<?([^)\s>]*)>?(?:\s+\"[^\"]*\")?\s*\)")
_AUTOLINK = re.compile(r"<((?:https?|mailto|ftp|javascript|data):[^>\s]*)>", re.I)
_REF_DEF = re.compile(r"^\s{0,3}\[[^\]]+\]:\s*\S+.*$", re.M)


def sanitize_answer(text: str, allowed_urls: set[str]) -> str:
    """Оставляет в Markdown только ссылки на записи, которые вернули инструменты. Картинки убирает."""
    def repl(m: re.Match) -> str:
        bang, label, url = m.group(1), m.group(2), m.group(3)
        if bang:
            return label
        return f"[{label}]({url})" if url in allowed_urls else label
    text = _MD_LINK.sub(repl, text or "")
    text = _AUTOLINK.sub(lambda m: m.group(1), text)
    text = _REF_DEF.sub("", text)
    return text.strip()[:MAX_ANSWER]


def filter_links(raw: object, seen: ai_tools.Seen) -> list[LinkOut]:
    out: list[LinkOut] = []
    done: set[tuple[str, int]] = set()
    if not isinstance(raw, list):
        return out
    for item in raw[:50]:
        if not isinstance(item, dict) or item.get("type") not in LINK_TYPES:
            continue
        rec = seen.get(item["type"], item.get("id"))
        if not rec:
            continue  # модель сослалась на запись, которую не получала в этом запросе
        key = (item["type"], int(item["id"]))
        if key in done:
            continue
        done.add(key)
        # Название и адрес — с сервера, не из ответа модели
        out.append(LinkOut(type=key[0], id=key[1], title=rec["title"], url=rec["url"]))
    return out


def _text(resp) -> str:
    return "".join(b.text for b in resp.content if getattr(b, "type", None) == "text").strip()


@router.post("/assistant", response_model=AssistantOut)
def assistant(payload: AssistantIn, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    core_ai.ensure_available(db, ctx.tenant)

    tenant_id, user_id = ctx.tenant.id, ctx.user.id
    system = [{
        "type": "text",
        "text": core_ai.GUARD + "\n\nЗадача:\n" + TASK.replace("{today}", date.today().isoformat()),
        "cache_control": {"type": "ephemeral"},
    }]
    tools = ai_tools.tool_definitions()
    output_config = {"effort": "low", "format": {"type": "json_schema", "schema": ANSWER_SCHEMA}}
    messages: list[dict] = [{"role": m.role, "content": m.content} for m in payload.messages]
    seen = ai_tools.Seen()
    in_t = out_t = 0
    model = None

    def fail(status: str, code: int, msg: str):
        core_ai._log(tenant_id, user_id, FEATURE, status, model, in_t, out_t)
        raise HTTPException(code, msg)

    client = core_ai._client()
    resp = None
    for step in range(MAX_TOOL_ROUNDS + 1):
        last = step == MAX_TOOL_ROUNDS
        kwargs = dict(
            model=core_ai.MODEL,
            max_tokens=8000,
            system=system,
            tools=tools,
            messages=messages,
            extra_body={"output_config": output_config, "fallbacks": "default"},
        )
        if last:
            # Раунды инструментов исчерпаны: просим ответить по уже собранным данным
            kwargs["tool_choice"] = {"type": "none"}
        try:
            resp = core_ai._call(client, **kwargs)
        except HTTPException:
            raise
        except Exception:
            log.exception("assistant call failed")
            fail("error", 502, "ИИ-помощник сейчас недоступен. Попробуйте ещё раз через минуту")

        usage = getattr(resp, "usage", None)
        in_t += getattr(usage, "input_tokens", 0) or 0
        out_t += getattr(usage, "output_tokens", 0) or 0
        model = getattr(resp, "model", None) or model
        stop = getattr(resp, "stop_reason", None)

        if stop == "refusal":
            # Инструменты из ответа с refusal не выполняем
            fail("refused", 422, "ИИ-помощник не может обработать этот запрос. Переформулируйте его")
        if stop == "max_tokens":
            fail("error", 502, "Ответ ИИ получился слишком длинным. Сузьте вопрос")

        tool_uses = [b for b in resp.content if getattr(b, "type", None) == "tool_use"]
        if stop == "tool_use" and tool_uses:
            if last:
                break
            # Ответ ассистента возвращаем целиком (thinking, text, tool_use) без изменений
            messages.append({"role": "assistant", "content": resp.content})
            results = []
            for b in tool_uses:
                data, is_error = ai_tools.execute(db, ctx, seen, b.name, b.input)
                block = {
                    "type": "tool_result",
                    "tool_use_id": b.id,
                    "content": core_ai.wrap_data(f"tool:{b.name}", json.dumps(data, ensure_ascii=False, default=str)),
                }
                if is_error:
                    block["is_error"] = True
                results.append(block)
            messages.append({"role": "user", "content": results})
            continue
        if stop == "pause_turn":
            if last:
                break
            messages.append({"role": "assistant", "content": resp.content})
            continue
        # end_turn — финальный ответ
        try:
            data = json.loads(_text(resp))
        except (json.JSONDecodeError, TypeError):
            fail("error", 502, "ИИ-помощник вернул непонятный ответ. Попробуйте ещё раз")
        if not isinstance(data, dict):
            fail("error", 502, "ИИ-помощник вернул непонятный ответ. Попробуйте ещё раз")
        if data.get("off_topic"):
            core_ai._log(tenant_id, user_id, FEATURE, "off_topic", model, in_t, out_t)
            return AssistantOut(answer=core_ai.OFF_TOPIC_MESSAGE, off_topic=True, links=[])
        answer = sanitize_answer(str(data.get("answer") or ""), seen.urls())
        links = filter_links(data.get("links"), seen)
        core_ai._log(tenant_id, user_id, FEATURE, "ok", model, in_t, out_t)
        return AssistantOut(answer=answer or "Не удалось сформулировать ответ. Уточните вопрос.", off_topic=False, links=links)

    fail("error", 502, "ИИ-помощник не уложился в допустимое число шагов. Сузьте вопрос, например укажите проект или период")
