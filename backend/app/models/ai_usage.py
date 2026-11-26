"""Журнал запросов к ИИ: для месячного лимита компании и прозрачности расходов. Тексты запросов не храним."""
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class AiUsage(Base):
    __tablename__ = "ai_usage"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    feature: Mapped[str] = mapped_column(String(50))
    # ok | off_topic | refused | error
    status: Mapped[str] = mapped_column(String(20))
    model: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
