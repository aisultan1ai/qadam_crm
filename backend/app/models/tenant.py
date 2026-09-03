from datetime import datetime
from sqlalchemy import String, Integer, ForeignKey, Boolean, DateTime, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from typing import List, Optional

from ..database import Base


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    plan: Mapped[str] = mapped_column(String(50), default="free")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    owner_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    logo_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    primary_color: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    subdomain: Mapped[Optional[str]] = mapped_column(String(100), unique=True, nullable=True, index=True)
    company_display_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    # Google Calendar OAuth credentials — задаются tenant owner в /settings/integrations
    google_client_id: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    google_client_secret_enc: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    google_redirect_uri: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    memberships: Mapped[List["TenantMembership"]] = relationship(
        "TenantMembership", back_populates="tenant", cascade="all, delete-orphan", lazy="selectin"
    )


class TenantMembership(Base):
    __tablename__ = "tenant_members"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", name="uq_tenant_members_tenant_user"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role_id: Mapped[Optional[int]] = mapped_column(ForeignKey("roles.id", ondelete="SET NULL"), nullable=True)

    is_owner: Mapped[bool] = mapped_column(Boolean, default=False)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="memberships", lazy="joined")
    user: Mapped["User"] = relationship("User", lazy="joined")  # type: ignore  # noqa: F821
    role: Mapped[Optional["Role"]] = relationship("Role", lazy="joined")  # type: ignore  # noqa: F821
