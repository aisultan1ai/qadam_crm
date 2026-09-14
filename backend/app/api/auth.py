import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from jose import JWTError
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..config import settings
from ..core.cookies import set_auth_cookies, clear_auth_cookies
from ..core.limiter import limiter
from ..core.security import (
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
    blacklist_token,
    is_blacklisted,
    hash_token,
    TOKEN_TYPE_REFRESH,
)
from ..core.captcha import verify_captcha
from ..core.permissions import all_permission_codes
from ..core.redis_client import get_redis
from ..core.security import hash_password
from ..core.tenant_setup import create_sample_project, create_tenant_with_owner
from ..models import User, Tenant, TenantMembership, UserSession
from ..schemas.auth import LoginRequest, RegisterRequest, TokenResponse, RefreshRequest
from ..schemas.user import MeOut
from ..schemas.common import Message
from .deps import get_current_user, get_current_token, log_action

router = APIRouter(prefix="/api/auth", tags=["auth"])

log = logging.getLogger("qadam.auth")

EMAIL_VERIFICATION_TTL_DAYS = 3
RESEND_COOLDOWN_SECONDS = 60

LOGIN_FAIL_LIMIT = 5
LOGIN_LOCK_SECONDS = 15 * 60


def _login_fail_key(email: str) -> str:
    return f"login_fail:{email.lower().strip()}"


def _check_login_lock(email: str) -> None:
    """Проверить, не заблокирован ли email. Если да — 429 с временем разблокировки."""
    try:
        r = get_redis()
        key = _login_fail_key(email)
        raw = r.get(key)
        fails = int(raw) if raw else 0
        if fails >= LOGIN_FAIL_LIMIT:
            ttl = r.ttl(key)
            wait = max(1, ttl) if ttl and ttl > 0 else LOGIN_LOCK_SECONDS
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                f"Слишком много неудачных попыток. Попробуйте через {wait // 60} мин.",
            )
    except HTTPException:
        raise
    except Exception as exc:
        log.warning("Redis unavailable for login lockout check: %s", exc)


def _record_login_fail(email: str) -> None:
    try:
        r = get_redis()
        key = _login_fail_key(email)
        pipe = r.pipeline()
        pipe.incr(key)
        pipe.expire(key, LOGIN_LOCK_SECONDS)
        pipe.execute()
    except Exception as exc:
        log.warning("Redis unavailable for login fail counter: %s", exc)


def _reset_login_fail(email: str) -> None:
    try:
        get_redis().delete(_login_fail_key(email))
    except Exception:
        pass


class VerifyEmailRequest(BaseModel):
    token: str


class ForgotPasswordRequest(BaseModel):
    email: str
    captcha_token: Optional[str] = None


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class ConfirmEmailChangeRequest(BaseModel):
    token: str


PASSWORD_RESET_TTL_HOURS = 1
EMAIL_CHANGE_TTL_HOURS = 24


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _new_verification_token() -> str:
    return secrets.token_urlsafe(32)


def _dispatch_verification_email(user: User) -> None:
    """Отправить письмо верификации через Celery. Ошибки логируем, но не роняем регистрацию."""
    from ..tasks.email import send_email_verification
    verify_url = f"{settings.APP_BASE_URL.rstrip('/')}/verify-email?token={user.email_verification_token}"
    try:
        send_email_verification.delay(
            to=user.email,
            verify_url=verify_url,
            full_name=user.name or user.email,
        )
    except Exception as exc:
        log.warning("Failed to enqueue email verification for %s: %s", user.email, exc)


def _pick_default_tenant(db: Session, user_id: int) -> int | None:
    """Первый активный tenant пользователя (owner в приоритете)."""
    row = (
        db.query(TenantMembership)
        .join(Tenant, Tenant.id == TenantMembership.tenant_id)
        .filter(TenantMembership.user_id == user_id, Tenant.is_active.is_(True))
        .order_by(TenantMembership.is_owner.desc(), TenantMembership.joined_at.asc())
        .first()
    )
    return row.tenant_id if row else None


def _issue_pair(
    user_id: int,
    tenant_id: int | None,
    session_id: int | None = None,
) -> tuple[str, str, int]:
    access, _access_jti, access_exp = create_access_token(
        user_id, tenant_id=tenant_id, session_id=session_id,
    )
    refresh, _refresh_jti, _ = create_refresh_token(
        user_id, tenant_id=tenant_id, session_id=session_id,
    )
    ttl = int((access_exp - datetime.now(timezone.utc)).total_seconds())
    return access, refresh, ttl


def _create_session(
    db: Session,
    *,
    request: Request,
    user_id: int,
    tenant_id: int | None,
) -> UserSession:
    """Создаёт запись UserSession с заглушкой token_hash — реальный хэш вписываем
    после выпуска refresh-токена. tenant_id не обязателен (пока не выбран).
    """
    ua = request.headers.get("user-agent")
    ip = request.client.host if request.client else None
    expires = datetime.now(timezone.utc) + timedelta(days=settings.JWT_REFRESH_DAYS)
    session = UserSession(
        user_id=user_id,
        tenant_id=tenant_id,
        token_hash="",  # проставим ниже, когда узнаем refresh
        user_agent=(ua or "")[:500] or None,
        ip_address=(ip or "")[:64] or None,
        expires_at=expires,
    )
    db.add(session)
    db.flush()
    return session


def _issue_pair_with_session(
    db: Session,
    request: Request,
    user_id: int,
    tenant_id: int | None,
) -> tuple[str, str, int, int]:
    """Создаёт сессию и выпускает access+refresh, связанные с ней через sid."""
    session = _create_session(db, request=request, user_id=user_id, tenant_id=tenant_id)
    access, refresh, ttl = _issue_pair(user_id, tenant_id, session_id=session.id)
    session.token_hash = hash_token(refresh)
    return access, refresh, ttl, session.id


def _read_refresh(request: Request, body: RefreshRequest | None) -> str | None:
    """Refresh-токен приходит в httpOnly cookie; body — фолбэк для совместимости."""
    cookie_tok = request.cookies.get(settings.REFRESH_COOKIE_NAME)
    if cookie_tok:
        return cookie_tok
    return body.refresh_token if body else None


@router.post("/login", response_model=TokenResponse)
@limiter.limit(settings.LOGIN_RATE_LIMIT)
def login(
    request: Request,
    response: Response,
    payload: LoginRequest,
    db: Session = Depends(get_db),
):
    email = payload.email.lower().strip()
    _check_login_lock(email)

    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        _record_login_fail(email)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный email или пароль")
    if not user.is_active:
        _record_login_fail(email)
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Пользователь заблокирован")

    _reset_login_fail(email)
    user.last_login_at = datetime.now(timezone.utc)
    tenant_id = _pick_default_tenant(db, user.id)
    log_action(db, tenant_id=tenant_id, user_id=user.id, action="login", entity="user", entity_id=user.id)

    access, refresh, ttl, _sid = _issue_pair_with_session(db, request, user.id, tenant_id)
    db.commit()

    set_auth_cookies(response, access, refresh)
    return TokenResponse(access_token=access, refresh_token=refresh, expires_in=ttl)


@router.post("/register", response_model=TokenResponse, status_code=201)
@limiter.limit("5/hour")
def register(
    request: Request,
    response: Response,
    payload: RegisterRequest,
    db: Session = Depends(get_db),
):
    """Публичная регистрация: создаёт компанию и владельца одним запросом."""
    client_ip = request.client.host if request.client else None
    if not verify_captcha(payload.captcha_token, remote_ip=client_ip):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Проверка CAPTCHA не пройдена")

    email = payload.email.lower().strip()
    if db.query(User.id).filter(User.email == email).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Пользователь с таким email уже существует")

    # P4t.1: password policy — на регистрации применяется дефолт (без tenant policy)
    from ..core.security import validate_password, PasswordPolicyError
    try:
        validate_password(payload.password, tenant_id=None)
    except PasswordPolicyError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))

    user = User(
        email=email,
        name=payload.full_name.strip(),
        password_hash=hash_password(payload.password),
        is_active=True,
        email_verified=False,
        email_verification_token=_new_verification_token(),
        email_verification_sent_at=_now_utc(),
    )
    db.add(user)
    db.flush()

    tenant = create_tenant_with_owner(
        db,
        company_name=payload.company_name.strip(),
        owner=user,
        plan="free",
    )
    create_sample_project(db, tenant=tenant, owner=user)

    log_action(db, tenant_id=tenant.id, user_id=user.id, action="register", entity="tenant", entity_id=tenant.id, detail=tenant.name)
    access, refresh, ttl, _sid = _issue_pair_with_session(db, request, user.id, tenant.id)
    db.commit()

    _dispatch_verification_email(user)

    set_auth_cookies(response, access, refresh)
    return TokenResponse(access_token=access, refresh_token=refresh, expires_in=ttl)


@router.post("/forgot-password", response_model=Message)
@limiter.limit("5/hour")
def forgot_password(
    request: Request,
    payload: ForgotPasswordRequest,
    db: Session = Depends(get_db),
):
    """Инициирует сброс пароля: генерит токен и шлёт письмо со ссылкой.

    В ответе НЕ выдаём информацию о существовании email (защита от enumeration):
    возвращаем одинаковое сообщение независимо от того, найден пользователь или нет.
    Токен действует PASSWORD_RESET_TTL_HOURS часов, одноразовый.

    CAPTCHA (Cloudflare Turnstile) обязательна если задан TURNSTILE_SECRET_KEY —
    без неё rate-limit 5/hour можно обходить сменой IP и слать волны фишинговых
    писем на существующие email'ы.
    """
    client_ip = request.client.host if request.client else None
    if not verify_captcha(payload.captcha_token, remote_ip=client_ip):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Проверка CAPTCHA не пройдена")
    email = (payload.email or "").lower().strip()
    if email:
        user = db.query(User).filter(User.email == email).first()
        if user and user.is_active:
            user.password_reset_token = _new_verification_token()
            user.password_reset_sent_at = _now_utc()
            db.commit()
            try:
                from ..tasks.email import send_password_reset_email
                reset_url = f"{settings.APP_BASE_URL.rstrip('/')}/reset-password?token={user.password_reset_token}"
                send_password_reset_email.delay(to=user.email, reset_url=reset_url)
            except Exception as exc:
                log.warning("Failed to enqueue password reset email for %s: %s", user.email, exc)
    return Message(message="Если email зарегистрирован, мы отправили инструкции по сбросу пароля.")


@router.post("/reset-password", response_model=Message)
@limiter.limit("10/hour")
def reset_password(
    request: Request,
    payload: ResetPasswordRequest,
    db: Session = Depends(get_db),
):
    """Применяет новый пароль по токену из письма.

    Токен одноразовый: после успешной смены очищаем поля password_reset_*.
    Также устанавливаем password_changed_at → все ранее выданные токены
    инвалидируются через _assert_token_not_stale.
    """
    token = (payload.token or "").strip()
    if not token:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Токен не передан")

    user = db.query(User).filter(User.password_reset_token == token).first()
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ссылка недействительна или уже использована")

    sent_at = user.password_reset_sent_at
    if not sent_at or _now_utc() - sent_at > timedelta(hours=PASSWORD_RESET_TTL_HOURS):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Срок действия ссылки истёк. Запросите новую.")

    from ..core.security import validate_password, PasswordPolicyError
    try:
        validate_password(payload.new_password, tenant_id=None)
    except PasswordPolicyError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))

    user.password_hash = hash_password(payload.new_password)
    user.password_changed_at = _now_utc()
    user.password_reset_token = None
    user.password_reset_sent_at = None
    log_action(db, tenant_id=None, user_id=user.id, action="password_reset", entity="user", entity_id=user.id)
    db.commit()
    return Message(message="Пароль изменён. Войдите с новым паролем.")


@router.post("/confirm-email-change", response_model=Message)
@limiter.limit("20/hour")
def confirm_email_change(
    request: Request,
    payload: ConfirmEmailChangeRequest,
    db: Session = Depends(get_db),
):
    """Подтверждает смену email по токену из письма (получено на новый адрес).

    Переносит pending_email → email, очищает поля токена. Email должен быть
    свободен на момент подтверждения (кто-то мог занять его пока пользователь
    тянул с подтверждением — тогда ошибка и надо запросить смену заново).
    """
    token = (payload.token or "").strip()
    if not token:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Токен не передан")

    user = db.query(User).filter(User.email_change_token == token).first()
    if not user:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ссылка недействительна или уже использована")

    sent_at = user.email_change_sent_at
    if not sent_at or _now_utc() - sent_at > timedelta(hours=EMAIL_CHANGE_TTL_HOURS):
        # Чистим просроченный токен, чтобы не висел.
        user.email_change_token = None
        user.pending_email = None
        user.email_change_sent_at = None
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Срок действия ссылки истёк. Запросите новую.")

    new_email = (user.pending_email or "").lower().strip()
    if not new_email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нет ожидающего email")

    if db.query(User).filter(User.email == new_email, User.id != user.id).first():
        # Кто-то занял адрес пока висело подтверждение — сбрасываем и просим повторить.
        user.email_change_token = None
        user.pending_email = None
        user.email_change_sent_at = None
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email уже используется, запросите смену повторно.")

    user.email = new_email
    user.pending_email = None
    user.email_change_token = None
    user.email_change_sent_at = None
    log_action(db, tenant_id=None, user_id=user.id, action="email_changed", entity="user", entity_id=user.id, detail=new_email)
    db.commit()
    return Message(message="Email изменён. Используйте новый адрес для входа.")


@router.post("/verify-email", response_model=Message)
@limiter.limit("30/hour")
def verify_email(
    request: Request,
    payload: VerifyEmailRequest,
    db: Session = Depends(get_db),
):
    """Публичный endpoint: юзер приходит по ссылке из письма, токен подтверждается."""
    token = (payload.token or "").strip()
    if not token:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Токен не передан")

    user = db.query(User).filter(User.email_verification_token == token).first()
    if not user:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ссылка недействительна или уже использована")

    if user.email_verified:
        # Идемпотентно: чистим токен и возвращаем ok.
        user.email_verification_token = None
        db.commit()
        return Message(message="Email уже подтверждён")

    sent_at = user.email_verification_sent_at
    if sent_at and _now_utc() - sent_at > timedelta(days=EMAIL_VERIFICATION_TTL_DAYS):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Срок действия ссылки истёк. Запросите новую.")

    user.email_verified = True
    user.email_verification_token = None
    log_action(db, tenant_id=None, user_id=user.id, action="email_verified", entity="user", entity_id=user.id)
    db.commit()
    return Message(message="Email подтверждён")


@router.post("/resend-verification", response_model=Message)
@limiter.limit("5/hour")
def resend_verification(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Запросить новое письмо подтверждения. Требует логина, ограничено 5/час."""
    if user.email_verified:
        return Message(message="Email уже подтверждён")

    if user.email_verification_sent_at:
        elapsed = (_now_utc() - user.email_verification_sent_at).total_seconds()
        if elapsed < RESEND_COOLDOWN_SECONDS:
            wait = int(RESEND_COOLDOWN_SECONDS - elapsed)
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                f"Повторная отправка возможна через {wait} сек.",
            )

    user.email_verification_token = _new_verification_token()
    user.email_verification_sent_at = _now_utc()
    db.commit()

    _dispatch_verification_email(user)
    return Message(message="Письмо отправлено. Проверьте почту.")


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("30/minute")
def refresh(
    request: Request,
    response: Response,
    payload: RefreshRequest | None = None,
    db: Session = Depends(get_db),
):
    refresh_tok = _read_refresh(request, payload)
    if not refresh_tok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing refresh token")

    try:
        data = decode_token(refresh_tok)
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")

    if data.get("typ") != TOKEN_TYPE_REFRESH:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong token type")
    if is_blacklisted(data.get("jti")):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token revoked")

    try:
        user_id = int(data.get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid subject")

    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")

    # Отклоняем refresh-токен, выданный до последней смены пароля.
    from .deps import _assert_token_not_stale, _assert_session_active
    _assert_token_not_stale(user, data)
    _assert_session_active(db, data)

    # ротируем refresh: старый попадает в blacklist
    old_exp = datetime.fromtimestamp(data["exp"], tz=timezone.utc)
    blacklist_token(data.get("jti"), old_exp)

    tenant_id = data.get("tid")
    if tenant_id is not None:
        membership = (
            db.query(TenantMembership)
            .join(Tenant, Tenant.id == TenantMembership.tenant_id)
            .filter(
                TenantMembership.user_id == user.id,
                TenantMembership.tenant_id == tenant_id,
                Tenant.is_active.is_(True),
            )
            .first()
        )
        if not membership:
            tenant_id = _pick_default_tenant(db, user.id)
    else:
        tenant_id = _pick_default_tenant(db, user.id)

    # Сессия: если старый refresh имеет sid — используем ту же запись, иначе
    # (legacy без sid) — создаём новую. Обновляем token_hash под новый refresh.
    sid = data.get("sid")
    session: UserSession | None = None
    if sid is not None:
        session = db.get(UserSession, int(sid))
        if session and session.user_id == user.id and session.revoked_at is None:
            session.last_seen_at = datetime.now(timezone.utc)
        else:
            session = None
    if session is None:
        session = _create_session(db, request=request, user_id=user.id, tenant_id=tenant_id)

    access, new_refresh, ttl = _issue_pair(user.id, tenant_id, session_id=session.id)
    session.token_hash = hash_token(new_refresh)
    if tenant_id is not None:
        session.tenant_id = tenant_id
    db.commit()

    set_auth_cookies(response, access, new_refresh)
    return TokenResponse(access_token=access, refresh_token=new_refresh, expires_in=ttl)


@router.post("/logout", response_model=Message)
def logout(
    request: Request,
    response: Response,
    payload: RefreshRequest | None = None,
    token: str | None = Depends(get_current_token),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # blacklist access + revoke session (sid из access-токена)
    session_ids: set[int] = set()
    if token:
        try:
            data = decode_token(token)
            blacklist_token(data.get("jti"), datetime.fromtimestamp(data["exp"], tz=timezone.utc))
            if data.get("sid") is not None:
                session_ids.add(int(data["sid"]))
        except JWTError:
            pass
    # blacklist refresh — из cookie или body
    refresh_tok = _read_refresh(request, payload)
    if refresh_tok:
        try:
            data = decode_token(refresh_tok)
            blacklist_token(data.get("jti"), datetime.fromtimestamp(data["exp"], tz=timezone.utc))
            if data.get("sid") is not None:
                session_ids.add(int(data["sid"]))
        except JWTError:
            pass

    if session_ids:
        now = datetime.now(timezone.utc)
        for sid in session_ids:
            s = db.get(UserSession, sid)
            if s and s.user_id == user.id and s.revoked_at is None:
                s.revoked_at = now

    clear_auth_cookies(response)
    log_action(db, tenant_id=None, user_id=user.id, action="logout", entity="user", entity_id=user.id)
    db.commit()
    return Message(message="Вы вышли из системы")


@router.get("/me", response_model=MeOut)
def me(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    current_tenant = None
    current_tenant_id: int | None = None
    current_is_owner = False
    # Читаем tid из access-cookie/Bearer напрямую, чтобы не тащить get_current_context в /me
    tok = request.cookies.get(settings.AUTH_COOKIE_NAME)
    if not tok:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.lower().startswith("bearer "):
            tok = auth_header[7:]
    if tok:
        try:
            payload = decode_token(tok)
            tenant_id = payload.get("tid")
            if tenant_id is not None:
                membership = (
                    db.query(TenantMembership)
                    .join(Tenant, Tenant.id == TenantMembership.tenant_id)
                    .filter(
                        TenantMembership.user_id == user.id,
                        TenantMembership.tenant_id == tenant_id,
                        Tenant.is_active.is_(True),
                    )
                    .first()
                )
                if membership:
                    t = membership.tenant
                    current_tenant_id = t.id
                    current_is_owner = membership.is_owner
                    current_tenant = {
                        "id": t.id,
                        "name": t.name,
                        "slug": t.slug,
                        "plan": t.plan,
                        "logo_url": t.logo_url,
                        "primary_color": t.primary_color,
                        "company_display_name": t.company_display_name,
                        "is_owner": membership.is_owner,
                    }
        except JWTError:
            pass

    # Permissions ограничиваем контекстом текущего tenant'а: платформенный админ
    # видит всё, owner компании — все permissions компании, остальные — только
    # permissions ролей, привязанных к текущему tenant'у (либо системных).
    if user.is_platform_admin or user.is_superuser:
        perms = all_permission_codes()
    elif current_is_owner:
        perms = all_permission_codes()
    else:
        perms = sorted({
            p.code
            for r in user.roles
            if current_tenant_id is None or r.tenant_id is None or r.tenant_id == current_tenant_id
            for p in r.permissions
        })

    data = MeOut.model_validate(user).model_copy(update={
        "permissions": perms,
        "current_tenant": current_tenant,
    })
    return data


@router.get("/tenants")
def list_my_tenants(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(TenantMembership, Tenant)
        .join(Tenant, Tenant.id == TenantMembership.tenant_id)
        .filter(TenantMembership.user_id == user.id, Tenant.is_active.is_(True))
        .order_by(TenantMembership.is_owner.desc(), TenantMembership.joined_at.asc())
        .all()
    )
    return [
        {
            "id": t.id,
            "name": t.name,
            "slug": t.slug,
            "plan": t.plan,
            "logo_url": t.logo_url,
            "primary_color": t.primary_color,
            "company_display_name": t.company_display_name,
            "is_owner": m.is_owner,
        }
        for m, t in rows
    ]


@router.post("/switch-tenant/{tenant_id}", response_model=TokenResponse)
def switch_tenant(
    tenant_id: int,
    request: Request,
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    membership = (
        db.query(TenantMembership)
        .join(Tenant, Tenant.id == TenantMembership.tenant_id)
        .filter(
            TenantMembership.user_id == user.id,
            TenantMembership.tenant_id == tenant_id,
            Tenant.is_active.is_(True),
        )
        .first()
    )
    if not membership:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа к компании")

    # Переиспользуем текущую сессию (только меняем tenant_id внутри). Так UI
    # «Активные сессии» покажет одну запись на устройство, а не по одной на
    # переключение компании.
    tok = request.cookies.get(settings.AUTH_COOKIE_NAME)
    session: UserSession | None = None
    if tok:
        try:
            data = decode_token(tok)
            sid = data.get("sid")
            if sid is not None:
                candidate = db.get(UserSession, int(sid))
                if candidate and candidate.user_id == user.id and candidate.revoked_at is None:
                    session = candidate
        except JWTError:
            session = None
    if session is None:
        session = _create_session(db, request=request, user_id=user.id, tenant_id=tenant_id)

    access, refresh, ttl = _issue_pair(user.id, tenant_id, session_id=session.id)
    session.tenant_id = tenant_id
    session.token_hash = hash_token(refresh)
    session.last_seen_at = datetime.now(timezone.utc)
    db.commit()

    set_auth_cookies(response, access, refresh)
    return TokenResponse(access_token=access, refresh_token=refresh, expires_in=ttl)
