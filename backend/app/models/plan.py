from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class Plan(Base):
    __tablename__ = "plans"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(100))
    tagline: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)

    price_month: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    currency: Mapped[str] = mapped_column(String(8), default="KZT")

    max_users: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    max_projects: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    max_storage_bytes: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    api_rate_per_min: Mapped[int] = mapped_column(Integer, default=60)

    feature_export: Mapped[bool] = mapped_column(Boolean, default=True)
    feature_import: Mapped[bool] = mapped_column(Boolean, default=True)
    feature_invitations: Mapped[bool] = mapped_column(Boolean, default=True)
    feature_lead_forms: Mapped[bool] = mapped_column(Boolean, default=True)
    feature_analytics_cache: Mapped[bool] = mapped_column(Boolean, default=False)
    feature_branding: Mapped[bool] = mapped_column(Boolean, default=False)
    feature_custom_subdomain: Mapped[bool] = mapped_column(Boolean, default=False)
    feature_priority_support: Mapped[bool] = mapped_column(Boolean, default=False)

    marketing_features: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
