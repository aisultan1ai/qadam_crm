from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


class Invitation(Base):
    __tablename__ = "invitations"
    __table_args__ = (
        UniqueConstraint("token", name="uq_invitations_token"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    role_id: Mapped[Optional[int]] = mapped_column(ForeignKey("roles.id", ondelete="SET NULL"), nullable=True)
    token: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    invited_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    tenant: Mapped["Tenant"] = relationship("Tenant", lazy="joined")  # type: ignore  # noqa: F821
    role: Mapped[Optional["Role"]] = relationship("Role", lazy="joined")  # type: ignore  # noqa: F821
    inviter: Mapped[Optional["User"]] = relationship("User", lazy="joined")  # type: ignore  # noqa: F821
