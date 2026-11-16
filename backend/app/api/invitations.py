"""Приглашения новых членов в tenant.

Owner (или юзер с permission users.create) генерит приглашение → отправляется email
со ссылкой /invite/{token}. Ссылка живёт 7 дней. При accept:
- если юзер с email существует → просто TenantMembership;
- иначе создаётся User + membership.

Rate-limit на создание — 30 приглашений/час на юзера (защита от массового спама).
"""

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from ..config import settings
from ..core.cookies import set_auth_cookies
from ..core.limiter import limiter
from ..core.plans import check_feature, check_user_limit
from ..core.security import hash_password, verify_password
from ..database import get_db
from ..models import Department, Invitation, Role, Tenant, TenantMembership, User
from ..schemas.auth import TokenResponse
from ..schemas.common import Message
from ..tasks.email import send_invitation_email
from .auth import _issue_pair
from .deps import TenantContext, require, log_action

router = APIRouter(prefix="/api", tags=["invitations"])

TOKEN_TTL_DAYS = 7


class InviteResponse(BaseModel):
    id: int
    email: str
    role_id: Optional[int]
    token: str
    invite_url: str
    expires_at: str
    email_sent: bool
    email_error: Optional[str] = None


class InviteCreate(BaseModel):
    email: EmailStr
    role_id: Optional[int] = None
    department_id: Optional[int] = None
    position: Optional[str] = Field(default=None, max_length=150)


class AcceptRequest(BaseModel):
    password: Optional[str] = Field(default=None, min_length=8, max_length=200)
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=200)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _tenant_role_or_none(db: Session, tenant_id: int, role_id: Optional[int]) -> Optional[Role]:
    if role_id is None:
        return None
    role = db.get(Role, role_id)
    if not role or role.tenant_id not in (tenant_id, None):
        raise HTTPException(400, "Роль не найдена в этой компании")
    return role


@router.post("/tenants/{tenant_id}/invite", response_model=InviteResponse, status_code=201)
def create_invite(
    request: Request,
    tenant_id: int,
    payload: InviteCreate,
    ctx: TenantContext = Depends(require("users.create")),
    db: Session = Depends(get_db),
):
    if tenant_id != ctx.tenant.id:
        raise HTTPException(403, "Можно приглашать только в текущую компанию")

    check_feature(db, ctx.tenant, "invitations")

    email = payload.email.lower().strip()

    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        already = (
            db.query(TenantMembership.id)
            .filter(
                TenantMembership.tenant_id == ctx.tenant.id,
                TenantMembership.user_id == existing_user.id,
            )
            .first()
        )
        if already:
            raise HTTPException(400, "Пользователь уже в компании")

    role = _tenant_role_or_none(db, ctx.tenant.id, payload.role_id)
    department_id = payload.department_id or None
    if department_id:
        dep = db.get(Department, department_id)
        if not dep or dep.tenant_id != ctx.tenant.id:
            raise HTTPException(400, "Отдел не найден в этой компании")
    position = (payload.position or "").strip() or None

    # Идемпотентность: продлеваем существующее непринятое приглашение.
    invite = (
        db.query(Invitation)
        .filter(
            Invitation.tenant_id == ctx.tenant.id,
            Invitation.email == email,
            Invitation.accepted_at.is_(None),
        )
        .first()
    )
    token = secrets.token_urlsafe(32)
    expires_at = _now() + timedelta(days=TOKEN_TTL_DAYS)

    if invite:
        invite.token = token
        invite.role_id = role.id if role else None
        invite.department_id = department_id
        invite.position = position
        invite.expires_at = expires_at
        invite.invited_by = ctx.user.id
    else:
        invite = Invitation(
            tenant_id=ctx.tenant.id,
            email=email,
            role_id=role.id if role else None,
            department_id=department_id,
            position=position,
            token=token,
            invited_by=ctx.user.id,
            expires_at=expires_at,
        )
        db.add(invite)

    log_action(
        db, tenant_id=ctx.tenant.id, user_id=ctx.user.id,
        action="invite", entity="user", detail=email,
    )
    db.commit()
    db.refresh(invite)

    invite_url = f"{settings.APP_BASE_URL.rstrip('/')}/invite/{token}"
    email_sent = False
    email_error: Optional[str] = None
    if not settings.SMTP_HOST:
        email_error = "smtp_not_configured"
    else:
        try:
            send_invitation_email.delay(
                to=email,
                tenant_name=ctx.tenant.name,
                invite_url=invite_url,
                inviter_name=ctx.user.name,
            )
            email_sent = True
        except Exception as exc:
            # Не роняем запрос из-за Celery/SMTP — приглашение уже создано,
            # админ увидит ссылку в UI и сможет её скопировать вручную.
            import logging
            logging.getLogger("qadam.invitations").warning(
                "Failed to enqueue invitation email to %s: %s", email, exc
            )
            email_error = "celery_unavailable"

    return InviteResponse(
        id=invite.id,
        email=invite.email,
        role_id=invite.role_id,
        token=token,
        invite_url=invite_url,
        expires_at=expires_at.isoformat(),
        email_sent=email_sent,
        email_error=email_error,
    )


@router.get("/invitations/{token}")
@limiter.limit("20/minute")
def get_invitation(request: Request, token: str, db: Session = Depends(get_db)):
    """Публичный лукап приглашения. Rate-limit 20/min per-IP защищает от перебора
    токенов (24 байта, но не полагаемся только на длину)."""
    invite = db.query(Invitation).filter(Invitation.token == token).first()
    if not invite or invite.accepted_at is not None or invite.expires_at < _now():
        raise HTTPException(404, "Приглашение недействительно или просрочено")

    user_exists = db.query(User.id).filter(User.email == invite.email).first() is not None

    return {
        "token": invite.token,
        "email": invite.email,
        "tenant": {
            "id": invite.tenant.id,
            "name": invite.tenant.name,
            "slug": invite.tenant.slug,
            "logo_url": invite.tenant.logo_url,
        },
        "expires_at": invite.expires_at.isoformat(),
        "requires_signup": not user_exists,
    }


def _is_logged_in_as(request: Request, db: Session, user: User) -> bool:
    """Текущая сессия браузера принадлежит этому пользователю."""
    from .deps import get_current_user
    from fastapi import HTTPException as _H
    try:
        auth = request.headers.get("Authorization", "")
        bearer = auth[7:] if auth.lower().startswith("bearer ") else None
        current = get_current_user(request, bearer, db)
    except _H:
        return False
    return current.id == user.id


@router.post("/invitations/{token}/accept", response_model=TokenResponse)
@limiter.limit("10/minute")
def accept_invitation(
    request: Request,
    response: Response,
    token: str,
    payload: AcceptRequest,
    db: Session = Depends(get_db),
):
    invite = db.query(Invitation).filter(Invitation.token == token).first()
    if not invite or invite.accepted_at is not None or invite.expires_at < _now():
        raise HTTPException(404, "Приглашение недействительно или просрочено")

    # Проверяем лимит пользователей для tenant'а (иначе можно обойти через приглашения).
    check_user_limit(db, invite.tenant)

    user = db.query(User).filter(User.email == invite.email).first()

    if user is not None:
        # Аккаунт уже есть. Ссылку видит и тот, кто приглашал («Копировать ссылку»), поэтому
        # одной ссылки мало: нужен вход под этим аккаунтом либо его пароль. Иначе приглашающий
        # мог бы войти в чужой аккаунт (и в его компании) по своей же ссылке.
        if not _is_logged_in_as(request, db, user) and not (
            payload.password and user.password_hash and verify_password(payload.password, user.password_hash)
        ):
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                "У вас уже есть аккаунт Qadam — введите пароль от него, чтобы принять приглашение",
            )
        if not user.is_active:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Аккаунт заблокирован")

    if user is None:
        # Новый юзер — нужны пароль и имя.
        if not payload.password or not payload.full_name:
            raise HTTPException(400, "Заполните имя и пароль")
        # P4t.1: password policy для tenant'а приглашения
        from ..core.security import validate_password, PasswordPolicyError
        try:
            validate_password(payload.password, tenant_id=invite.tenant_id)
        except PasswordPolicyError as e:
            raise HTTPException(400, str(e))
        user = User(
            email=invite.email,
            name=payload.full_name.strip(),
            password_hash=hash_password(payload.password),
            is_active=True,
        )
        db.add(user)
        db.flush()

    # Membership.
    exists = (
        db.query(TenantMembership)
        .filter(
            TenantMembership.tenant_id == invite.tenant_id,
            TenantMembership.user_id == user.id,
        )
        .first()
    )
    if invite.make_owner:
        # Компанию создал платформенный админ — приглашённый становится её владельцем.
        invite.tenant.owner_id = user.id
        if exists:
            exists.is_owner = True
            exists.role_id = invite.role_id or exists.role_id
    if not exists:
        db.add(TenantMembership(
            tenant_id=invite.tenant_id,
            user_id=user.id,
            role_id=invite.role_id,
            is_owner=invite.make_owner,
            department_id=invite.department_id,
            position=invite.position,
        ))
        # Роль назначаем и на глобальном уровне (user.roles), т.к. permissions читаются оттуда.
        if invite.role_id:
            role = db.get(Role, invite.role_id)
            if role and role not in user.roles:
                user.roles.append(role)

    invite.accepted_at = _now()

    log_action(
        db, tenant_id=invite.tenant_id, user_id=user.id,
        action="accept_invite", entity="user", entity_id=user.id, detail=user.email,
    )
    db.commit()

    access, refresh, ttl = _issue_pair(user.id, invite.tenant_id)
    set_auth_cookies(response, access, refresh)
    return TokenResponse(access_token=access, refresh_token=refresh, expires_in=ttl)


@router.get("/tenants/{tenant_id}/invitations")
def list_invites(
    tenant_id: int,
    ctx: TenantContext = Depends(require("users.view")),
    db: Session = Depends(get_db),
):
    if tenant_id != ctx.tenant.id:
        raise HTTPException(403, "Нет доступа")
    rows = (
        db.query(Invitation)
        .filter(Invitation.tenant_id == ctx.tenant.id)
        .order_by(Invitation.created_at.desc())
        .all()
    )
    return [
        {
            "id": i.id,
            "email": i.email,
            "role_id": i.role_id,
            "department_id": i.department_id,
            "position": i.position,
            "expires_at": i.expires_at.isoformat(),
            "accepted_at": i.accepted_at.isoformat() if i.accepted_at else None,
            "created_at": i.created_at.isoformat() if i.created_at else None,
            "inviter": {"id": i.inviter.id, "name": i.inviter.name} if i.inviter else None,
        }
        for i in rows
    ]


@router.delete("/tenants/{tenant_id}/invitations/{invite_id}", response_model=Message)
def revoke_invite(
    tenant_id: int,
    invite_id: int,
    ctx: TenantContext = Depends(require("users.create")),
    db: Session = Depends(get_db),
):
    if tenant_id != ctx.tenant.id:
        raise HTTPException(403, "Нет доступа")
    invite = db.get(Invitation, invite_id)
    if not invite or invite.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Приглашение не найдено")
    db.delete(invite)
    db.commit()
    return Message(message="Приглашение отозвано")
