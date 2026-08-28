from functools import lru_cache
from typing import List, Optional
from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # "development" | "production". В prod ужесточаются проверки (CORS, docs, etc.)
    APP_ENV: str = "development"

    DATABASE_URL: str = "postgresql+psycopg://qadam_crm:qadam_crm@db:5432/qadam_crm"

    JWT_SECRET: str = Field(..., min_length=32, description="JWT signing secret, must be set via env, min 32 chars")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24

    CORS_ORIGINS: str = "http://localhost:5173"
    UPLOAD_DIR: str = "/app/uploads"

    MAX_UPLOAD_BYTES: int = 10 * 1024 * 1024
    MAX_AVATAR_BYTES: int = 5 * 1024 * 1024

    LOGIN_RATE_LIMIT: str = "5/minute"

    # HMAC-подпись для billing webhook. Провайдер (Stripe/Kaspi) шлёт X-Signature = HMAC-SHA256(secret, raw_body).
    # В dev может быть None — тогда подпись НЕ проверяется (только warning в логе).
    BILLING_WEBHOOK_SECRET: Optional[str] = None

    # Cloudflare Turnstile — защита /register от ботов. Если secret пуст —
    # проверка пропускается (dev-режим), фронт тоже пропускает виджет.
    TURNSTILE_SECRET_KEY: Optional[str] = None

    ADMIN_EMAIL: str = "admin@qadam.local"
    ADMIN_PASSWORD: Optional[str] = None

    REDIS_URL: str = "redis://redis:6379/0"

    # === SMTP (для отправки писем через Celery) ===
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_FROM: str = "noreply@qadam.local"
    SMTP_FROM_NAME: str = "Qadam CRM"
    SMTP_USE_TLS: bool = True
    # Если не задан SMTP_HOST — письма только логируются, реальной отправки нет.
    SMTP_DRY_RUN: bool = False

    APP_BASE_URL: str = "http://localhost"

    EXPORT_DIR: str = "/app/exports"

    # Fernet-ключ для шифрования секретов в БД (IMAP/SMTP пароли и т.п.).
    # Генерация: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    # В dev — если пусто, генерится ephemeral (данные не сохранятся между рестартами).
    SECRETS_KEY: Optional[str] = None

    # Считаем на 2 uvicorn workers: 2 * (POOL_SIZE + MAX_OVERFLOW) = 100 макс соединений.
    # Postgres по умолчанию max_connections=100 — оставляем запас для admin/psql/celery.
    DB_POOL_SIZE: int = 20
    DB_MAX_OVERFLOW: int = 30
    DB_POOL_RECYCLE: int = 1800

    JWT_ACCESS_MINUTES: int = 30
    JWT_REFRESH_DAYS: int = 30

    # === Cookie-based auth ===
    AUTH_COOKIE_NAME: str = "qadam_access"
    REFRESH_COOKIE_NAME: str = "qadam_refresh"
    # В prod (HTTPS) должно быть True. В dev через http://localhost — False.
    COOKIE_SECURE: bool = False
    # "lax" безопасно для SPA на том же origin. "strict" сломает переходы по ссылкам с внешних сайтов.
    COOKIE_SAMESITE: str = "lax"
    COOKIE_DOMAIN: Optional[str] = None
    # Путь refresh-cookie ограничивается /api/auth — уменьшает поверхность CSRF.
    REFRESH_COOKIE_PATH: str = "/api/auth"

    # Явный opt-out для локального тестирования prod-режима через http://localhost.
    # В настоящем проде (за HTTPS-реверс-прокси) НИКОГДА не ставить в true.
    ALLOW_INSECURE_PROD: bool = False

    @field_validator("JWT_SECRET")
    @classmethod
    def _reject_placeholder(cls, v: str) -> str:
        if v.lower() in {"change-me", "changeme", "secret", "change-me-in-production-please"}:
            raise ValueError("JWT_SECRET must not use a placeholder value")
        return v

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def is_prod(self) -> bool:
        return self.APP_ENV.lower() == "production"

    @model_validator(mode="after")
    def _validate_prod(self) -> "Settings":
        if not self.is_prod:
            return self

        if not self.cors_origins_list:
            raise ValueError("CORS_ORIGINS must be set to a non-empty list in production")

        # В prod-режиме без явного opt-out — жёсткие требования безопасности.
        if not self.ALLOW_INSECURE_PROD:
            if self.COOKIE_SECURE is False:
                raise ValueError(
                    "COOKIE_SECURE=false in production. Ставь COOKIE_SECURE=true (нужен HTTPS) "
                    "или ALLOW_INSECURE_PROD=true для локального тестирования prod-режима."
                )
            if not self.BILLING_WEBHOOK_SECRET:
                raise ValueError(
                    "BILLING_WEBHOOK_SECRET не задан в production. Сгенерируй: "
                    "python -c \"import secrets; print(secrets.token_urlsafe(32))\" "
                    "или ALLOW_INSECURE_PROD=true если billing-webhook не используется."
                )
        else:
            import logging
            log = logging.getLogger("qadam.config")
            if self.COOKIE_SECURE is False:
                log.warning("ALLOW_INSECURE_PROD=true — COOKIE_SECURE=false в prod допущен, но НЕБЕЗОПАСНО.")
            if not self.BILLING_WEBHOOK_SECRET:
                log.warning("ALLOW_INSECURE_PROD=true — BILLING_WEBHOOK_SECRET не задан, webhook отклонит запросы.")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
