"""P4-модели: комментарии-history, project-groups/roles, directories, documents,
retention policies, holidays, security policy."""
from datetime import datetime, date
from typing import Optional, Any

from sqlalchemy import (
    String, Integer, ForeignKey, DateTime, Date, Text, Boolean, Index, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB

from ..database import Base


# =============================================================================
# Комментарии — история правок
# =============================================================================

class CommentEditHistory(Base):
    __tablename__ = "comment_edit_history"
    __table_args__ = (
        Index("ix_ceh_comment", "comment_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    comment_id: Mapped[int] = mapped_column(ForeignKey("comments.id", ondelete="CASCADE"), index=True)
    old_body: Mapped[str] = mapped_column(Text)
    edited_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    edited_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# =============================================================================
# Проекты — группы и роли
# =============================================================================

class ProjectGroup(Base):
    __tablename__ = "project_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    color: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProjectRoleAssignment(Base):
    """Роли пользователя в конкретном проекте (owner / manager / member / observer / …)."""
    __tablename__ = "project_role_assignments"
    __table_args__ = (
        UniqueConstraint("project_id", "user_id", "role_name", name="uq_project_role"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role_name: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# =============================================================================
# Пользовательские справочники (Directories)
# =============================================================================

class Directory(Base):
    """Справочник — набор полей + записи. Аналог Planfix Directories."""
    __tablename__ = "directories"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_directory_code"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(50))
    label: Mapped[str] = mapped_column(String(100))
    icon: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    fields: Mapped[list[dict]] = mapped_column(JSONB, default=list)  # [{name,label,type,required}]
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class DirectoryEntry(Base):
    __tablename__ = "directory_entries"
    __table_args__ = (
        Index("ix_dir_entries_dir", "directory_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    directory_id: Mapped[int] = mapped_column(ForeignKey("directories.id", ondelete="CASCADE"))
    label: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)  # denormalized display
    values: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# =============================================================================
# Документы — отдельный модуль
# =============================================================================

class DocumentFolder(Base):
    __tablename__ = "document_folders"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("document_folders.id", ondelete="CASCADE"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        Index("ix_documents_tenant_folder", "tenant_id", "folder_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    folder_id: Mapped[Optional[int]] = mapped_column(ForeignKey("document_folders.id", ondelete="SET NULL"), nullable=True)

    name: Mapped[str] = mapped_column(String(300))
    mime: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    size: Mapped[int] = mapped_column(Integer, default=0)
    file_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)  # текущая версия
    version_count: Mapped[int] = mapped_column(Integer, default=1)

    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    public_slug: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True, index=True)

    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class DocumentVersion(Base):
    __tablename__ = "document_versions"
    __table_args__ = (
        Index("ix_docv_document", "document_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    version_no: Mapped[int] = mapped_column(Integer)
    file_path: Mapped[str] = mapped_column(String(500))
    size: Mapped[int] = mapped_column(Integer, default=0)
    uploaded_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# =============================================================================
# Retention policies + Holidays + Security policy
# =============================================================================

class TenantLogRetention(Base):
    """Сколько дней хранить логи по каждой сущности. Пусто = не удалять."""
    __tablename__ = "tenant_log_retention"
    __table_args__ = (
        UniqueConstraint("tenant_id", "entity_type", name="uq_retention_entity"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    entity_type: Mapped[str] = mapped_column(String(30))  # task, project, contact, directory, mail
    retention_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # None = ∞


class TenantHoliday(Base):
    """Рабочий/нерабочий день компании."""
    __tablename__ = "tenant_holidays"
    __table_args__ = (
        UniqueConstraint("tenant_id", "date", name="uq_holiday_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    date: Mapped[date] = mapped_column(Date)
    name: Mapped[str] = mapped_column(String(200))
    is_workday: Mapped[bool] = mapped_column(Boolean, default=False)  # true = рабочий (перенос), false = выходной


class TenantSecurityPolicy(Base):
    """Одна на tenant. Настройки безопасности (пароли, IP, сессии, 2FA required)."""
    __tablename__ = "tenant_security_policy"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), unique=True, index=True)

    password_min_length: Mapped[int] = mapped_column(Integer, default=8)
    password_require_upper: Mapped[bool] = mapped_column(Boolean, default=False)
    password_require_number: Mapped[bool] = mapped_column(Boolean, default=False)
    password_require_special: Mapped[bool] = mapped_column(Boolean, default=False)
    password_rotation_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # None = не требовать смены

    session_timeout_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    ip_allowlist: Mapped[list[str]] = mapped_column(JSONB, default=list)  # ["1.2.3.4/32", ...]
    require_2fa: Mapped[bool] = mapped_column(Boolean, default=False)
    require_2fa_for_admins: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class IntegrationProvider(Base):
    """Витрина доступных интеграций (для страницы /integrations)."""
    __tablename__ = "integration_providers"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True)
    code: Mapped[str] = mapped_column(String(50), index=True)  # google_drive, dropbox, viber, tiktok, mailchimp
    label: Mapped[str] = mapped_column(String(100))
    category: Mapped[str] = mapped_column(String(50), default="other")  # storage / messenger / marketing / social / other
    status: Mapped[str] = mapped_column(String(30), default="coming_soon")  # available / beta / coming_soon / disabled
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
