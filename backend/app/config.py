from functools import lru_cache
from typing import List, Optional
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "postgresql+psycopg://qadam_crm:qadam_crm@db:5432/qadam_crm"

    JWT_SECRET: str = Field(..., min_length=32, description="JWT signing secret, must be set via env, min 32 chars")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24

    CORS_ORIGINS: str = "http://localhost:5173"
    UPLOAD_DIR: str = "/app/uploads"

    MAX_UPLOAD_BYTES: int = 10 * 1024 * 1024
    MAX_AVATAR_BYTES: int = 5 * 1024 * 1024

    LOGIN_RATE_LIMIT: str = "5/minute"

    ADMIN_EMAIL: str = "admin@qadam.local"
    ADMIN_PASSWORD: Optional[str] = None

    REDIS_URL: str = "redis://redis:6379/0"

    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_RECYCLE: int = 1800

    JWT_ACCESS_MINUTES: int = 30
    JWT_REFRESH_DAYS: int = 30

    @field_validator("JWT_SECRET")
    @classmethod
    def _reject_placeholder(cls, v: str) -> str:
        if v.lower() in {"change-me", "changeme", "secret", "change-me-in-production-please"}:
            raise ValueError("JWT_SECRET must not use a placeholder value")
        return v

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
