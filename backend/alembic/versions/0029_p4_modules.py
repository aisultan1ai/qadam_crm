"""P4 modules: comment history, project groups/roles, directories, documents,
retention, holidays, security policy, integration providers, user 2FA/bot fields,
new columns on projects/comments.

Revision ID: 0029_p4_modules
Revises: 0028_p3_modules
Create Date: 2026-09-10
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0029_p4_modules"
down_revision: Union[str, None] = "0028_p3_modules"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ================= new columns =================

    # users: 2FA / bot / password_changed_at
    op.add_column("users", sa.Column("totp_secret", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("totp_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("is_bot", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True))

    # comments: pinned/hidden/draft/edit_count/edited_at
    op.add_column("comments", sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("comments", sa.Column("is_hidden", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("comments", sa.Column("is_draft", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("comments", sa.Column("edit_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("comments", sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True))

    # ================= project_groups =================
    op.create_table(
        "project_groups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("color", sa.String(length=20), nullable=True),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_project_groups_tenant_id", "project_groups", ["tenant_id"])

    # projects: is_hidden / group_id / baseline
    op.add_column("projects", sa.Column("is_hidden", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("projects", sa.Column("group_id", sa.Integer(), sa.ForeignKey("project_groups.id", ondelete="SET NULL"), nullable=True))
    op.create_index("ix_projects_group_id", "projects", ["group_id"])
    op.add_column("projects", sa.Column("baseline_start", sa.Date(), nullable=True))
    op.add_column("projects", sa.Column("baseline_end", sa.Date(), nullable=True))

    # ================= project_role_assignments =================
    op.create_table(
        "project_role_assignments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role_name", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("project_id", "user_id", "role_name", name="uq_project_role"),
    )
    op.create_index("ix_project_role_assignments_project_id", "project_role_assignments", ["project_id"])
    op.create_index("ix_project_role_assignments_user_id", "project_role_assignments", ["user_id"])

    # ================= comment_edit_history =================
    op.create_table(
        "comment_edit_history",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("comment_id", sa.Integer(), sa.ForeignKey("comments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("old_body", sa.Text(), nullable=False),
        sa.Column("edited_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("edited_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_ceh_comment", "comment_edit_history", ["comment_id"])

    # ================= directories + entries =================
    op.create_table(
        "directories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("icon", sa.String(length=30), nullable=True),
        sa.Column("fields", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "code", name="uq_directory_code"),
    )
    op.create_index("ix_directories_tenant_id", "directories", ["tenant_id"])

    op.create_table(
        "directory_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("directory_id", sa.Integer(), sa.ForeignKey("directories.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=True),
        sa.Column("values", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_directory_entries_tenant_id", "directory_entries", ["tenant_id"])
    op.create_index("ix_dir_entries_dir", "directory_entries", ["directory_id"])

    # ================= document_folders + documents + versions =================
    op.create_table(
        "document_folders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("document_folders.id", ondelete="CASCADE"), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_document_folders_tenant_id", "document_folders", ["tenant_id"])
    op.create_index("ix_document_folders_parent_id", "document_folders", ["parent_id"])

    op.create_table(
        "documents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("folder_id", sa.Integer(), sa.ForeignKey("document_folders.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(length=300), nullable=False),
        sa.Column("mime", sa.String(length=150), nullable=True),
        sa.Column("size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("file_path", sa.String(length=500), nullable=True),
        sa.Column("version_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("public_slug", sa.String(length=64), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_documents_tenant_id", "documents", ["tenant_id"])
    op.create_index("ix_documents_tenant_folder", "documents", ["tenant_id", "folder_id"])
    op.create_index("ix_documents_public_slug", "documents", ["public_slug"], unique=True)

    op.create_table(
        "document_versions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("document_id", sa.Integer(), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("file_path", sa.String(length=500), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("uploaded_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_docv_document", "document_versions", ["document_id"])

    # ================= retention + holidays + security policy + integration_providers =================
    op.create_table(
        "tenant_log_retention",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entity_type", sa.String(length=30), nullable=False),
        sa.Column("retention_days", sa.Integer(), nullable=True),
        sa.UniqueConstraint("tenant_id", "entity_type", name="uq_retention_entity"),
    )
    op.create_index("ix_tenant_log_retention_tenant_id", "tenant_log_retention", ["tenant_id"])

    op.create_table(
        "tenant_holidays",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("is_workday", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint("tenant_id", "date", name="uq_holiday_date"),
    )
    op.create_index("ix_tenant_holidays_tenant_id", "tenant_holidays", ["tenant_id"])

    op.create_table(
        "tenant_security_policy",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), unique=True, nullable=False),
        sa.Column("password_min_length", sa.Integer(), nullable=False, server_default="8"),
        sa.Column("password_require_upper", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("password_require_number", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("password_require_special", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("password_rotation_days", sa.Integer(), nullable=True),
        sa.Column("session_timeout_minutes", sa.Integer(), nullable=True),
        sa.Column("ip_allowlist", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("require_2fa", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("require_2fa_for_admins", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "integration_providers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True),
        sa.Column("code", sa.String(length=50), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("category", sa.String(length=50), nullable=False, server_default="other"),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="coming_soon"),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_integration_providers_tenant_id", "integration_providers", ["tenant_id"])
    op.create_index("ix_integration_providers_code", "integration_providers", ["code"])


def downgrade() -> None:
    for tbl in (
        "integration_providers", "tenant_security_policy", "tenant_holidays", "tenant_log_retention",
        "document_versions", "documents", "document_folders",
        "directory_entries", "directories",
        "comment_edit_history", "project_role_assignments", "project_groups",
    ):
        op.drop_table(tbl)

    for col in ("baseline_end", "baseline_start", "group_id", "is_hidden"):
        op.drop_column("projects", col)
    for col in ("edited_at", "edit_count", "is_draft", "is_hidden", "is_pinned"):
        op.drop_column("comments", col)
    for col in ("password_changed_at", "is_bot", "totp_enabled", "totp_secret"):
        op.drop_column("users", col)
