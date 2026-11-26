"""API-токены компании и публичная документация API.

/api/api-tokens          — выпуск, список, отзыв (право «Системные настройки» или владелец).
/api/docs                — документация API (ReDoc) для интеграторов клиента, без входа.
/api/openapi-public.json — схема только тех методов, что доступны по токену.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.openapi.utils import get_openapi
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core import api_tokens as tokens
from ..core.permissions import PERMISSIONS, all_permission_codes
from ..core.plans import get_limits
from ..database import get_db
from ..models import ApiToken, User
from ..schemas.common import Message
from .deps import TenantContext, log_action, require

router = APIRouter(tags=["api-tokens"])


class TokenOut(BaseModel):
    id: int
    name: str
    token_prefix: str
    permission_codes: list[str]
    created_by_name: Optional[str] = None
    last_used_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None
    created_at: datetime


class TokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    permission_codes: list[str] = Field(min_length=1)
    expires_in_days: Optional[int] = Field(default=None, ge=1, le=3650)


class TokenCreated(TokenOut):
    token: str  # показывается один раз


class TokensMeta(BaseModel):
    plan: str
    rate_per_min: int
    docs_url: str
    permission_groups: list[dict]


def _out(db: Session, t: ApiToken) -> TokenOut:
    u = db.get(User, t.created_by) if t.created_by else None
    return TokenOut(
        id=t.id, name=t.name, token_prefix=t.token_prefix, permission_codes=list(t.permission_codes or []),
        created_by_name=u.name if u else None, last_used_at=t.last_used_at, expires_at=t.expires_at,
        revoked_at=t.revoked_at, created_at=t.created_at,
    )


@router.get("/api/api-tokens/meta", response_model=TokensMeta)
def tokens_meta(ctx: TenantContext = Depends(require("settings.system")), db: Session = Depends(get_db)):
    limits = get_limits(db, ctx.tenant.plan)
    return TokensMeta(
        plan=ctx.tenant.plan,
        rate_per_min=limits.get("api_rate_per_min") or 60,
        docs_url="/api/docs",
        permission_groups=[
            {"group": g, "items": [{"code": c, "label": lbl} for c, lbl in items]}
            for g, items in PERMISSIONS.items()
        ],
    )


@router.get("/api/api-tokens", response_model=list[TokenOut])
def list_tokens(ctx: TenantContext = Depends(require("settings.system")), db: Session = Depends(get_db)):
    rows = (
        db.query(ApiToken).filter(ApiToken.tenant_id == ctx.tenant.id)
        .order_by(ApiToken.revoked_at.isnot(None), ApiToken.created_at.desc()).all()
    )
    return [_out(db, t) for t in rows]


@router.post("/api/api-tokens", response_model=TokenCreated, status_code=201)
def create_token(payload: TokenCreate, ctx: TenantContext = Depends(require("settings.system")), db: Session = Depends(get_db)):
    if ctx.user.is_platform_admin:
        raise HTTPException(400, "Администратор платформы не выпускает токены компаний — войдите обычным сотрудником компании")
    known = set(all_permission_codes())
    wanted = sorted({c for c in payload.permission_codes if c in known})
    if not wanted:
        raise HTTPException(400, "Выберите хотя бы одно право для токена")
    # Нельзя выдать токену больше, чем есть у самого сотрудника.
    allowed = tokens.effective_scopes(ctx.user, ctx.tenant.id, ctx.membership.is_owner, wanted)
    extra = [c for c in wanted if c not in allowed]
    if extra:
        raise HTTPException(400, "У вас самих нет части выбранных прав: " + ", ".join(extra))
    if db.query(ApiToken).filter(ApiToken.tenant_id == ctx.tenant.id, ApiToken.revoked_at.is_(None)).count() >= 50:
        raise HTTPException(400, "Слишком много активных токенов (максимум 50) — отзовите ненужные")
    raw, prefix, digest = tokens.generate()
    expires = datetime.now(timezone.utc) + timedelta(days=payload.expires_in_days) if payload.expires_in_days else None
    row = ApiToken(
        tenant_id=ctx.tenant.id, created_by=ctx.user.id, name=payload.name.strip(), token_prefix=prefix,
        token_hash=digest, permission_codes=wanted, expires_at=expires,
    )
    db.add(row)
    db.flush()
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="create", entity="api_token", entity_id=row.id, detail=row.name)
    db.commit()
    db.refresh(row)
    return TokenCreated(**_out(db, row).model_dump(), token=raw)


@router.delete("/api/api-tokens/{tid}", response_model=Message)
def revoke_token(tid: int, ctx: TenantContext = Depends(require("settings.system")), db: Session = Depends(get_db)):
    row = db.get(ApiToken, tid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Токен не найден")
    if row.revoked_at is None:
        row.revoked_at = datetime.now(timezone.utc)
        log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="revoke", entity="api_token", entity_id=row.id, detail=row.name)
        db.commit()
    return Message(message="Токен отозван")


# =============================================================================
# Публичная документация API: только методы, доступные по токену
# =============================================================================

_SKIP_PREFIXES = tokens.DENIED_PREFIXES + (
    "/api/public", "/api/f/", "/api/book", "/api/webhooks", "/api/telephony/webhook", "/api/messengers/webhook",
    "/api/integrations/google/callback", "/api/integrations/storage", "/api/docs", "/api/openapi-public",
)
_schema_cache: dict = {}


@router.get("/api/openapi-public.json", include_in_schema=False)
def public_openapi(request: Request):
    if "v" not in _schema_cache:
        routes = [
            r for r in request.app.routes
            if getattr(r, "path", "").startswith("/api/")
            and getattr(r, "include_in_schema", True)
            and not any(r.path.startswith(p) for p in _SKIP_PREFIXES)
            and "webhook" not in r.path and "callback" not in r.path
        ]
        schema = get_openapi(
            title="Qadam API",
            version="1.0",
            description=(
                "REST API Qadam. Авторизация: заголовок `Authorization: Bearer qd_…` — токен выпускает "
                "администратор компании в «Настройки компании» → «API». Токен действует только в пределах выбранных прав.\n\n"
                "Лимит запросов зависит от тарифа (Free — 60/мин, Plan A — 120, Plan B — 300, Plan X — 600). "
                "При превышении — ответ 429 и заголовок Retry-After.\n\n"
                "Списки возвращаются постранично: параметры `page` и `per_page`."
            ),
            routes=routes,
        )
        schema.setdefault("components", {}).setdefault("securitySchemes", {})["ApiToken"] = {
            "type": "http", "scheme": "bearer", "description": "API-токен компании (qd_…)",
        }
        schema["security"] = [{"ApiToken": []}]
        _schema_cache["v"] = schema
    return JSONResponse(_schema_cache["v"])


@router.get("/api/docs", include_in_schema=False, response_class=HTMLResponse)
def public_docs():
    return HTMLResponse(
        """<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Qadam API</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0}</style></head><body>
<redoc spec-url="/api/openapi-public.json" hide-download-button="false"></redoc>
<script src="https://cdn.jsdelivr.net/npm/redoc@2.1.5/bundles/redoc.standalone.js"></script>
</body></html>"""
    )
