"""multi-tenant: create tenants + tenant_members, backfill tenant_id

Revision ID: 0004_multi_tenant
Revises: 0003_comment_reactions
Create Date: 2026-08-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0004_multi_tenant"
down_revision: Union[str, None] = "0003_comment_reactions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


BUSINESS_TABLES = [
    "projects", "tasks", "comments", "attachments",
    "activity_logs", "notifications", "departments",
]


def upgrade() -> None:
    op.create_table(
        "tenants",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("slug", sa.String(length=100), nullable=False),
        sa.Column("plan", sa.String(length=50), nullable=False, server_default="free"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("logo_url", sa.String(length=500), nullable=True),
        sa.Column("primary_color", sa.String(length=20), nullable=True),
        sa.Column("subdomain", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_tenants_slug", "tenants", ["slug"], unique=True)
    op.create_index("ix_tenants_subdomain", "tenants", ["subdomain"], unique=True)

    op.create_table(
        "tenant_members",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role_id", sa.Integer(), sa.ForeignKey("roles.id", ondelete="SET NULL"), nullable=True),
        sa.Column("is_owner", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "user_id", name="uq_tenant_members_tenant_user"),
    )
    op.create_index("ix_tenant_members_tenant_id", "tenant_members", ["tenant_id"])
    op.create_index("ix_tenant_members_user_id", "tenant_members", ["user_id"])

    for table in BUSINESS_TABLES:
        op.add_column(
            table,
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True),
        )
        op.create_index(f"ix_{table}_tenant_id", table, ["tenant_id"])

    op.add_column(
        "roles",
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True),
    )
    op.create_index("ix_roles_tenant_id", "roles", ["tenant_id"])
    op.add_column(
        "roles",
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    conn = op.get_bind()
    conn.execute(sa.text("""
        INSERT INTO tenants (id, name, slug, plan, is_active)
        VALUES (1, 'Default', 'default', 'enterprise', true)
        ON CONFLICT (id) DO NOTHING
    """))
    conn.execute(sa.text(
        "SELECT setval('tenants_id_seq', GREATEST((SELECT MAX(id) FROM tenants), 1))"
    ))

    for table in BUSINESS_TABLES:
        conn.execute(sa.text(f"UPDATE {table} SET tenant_id = 1 WHERE tenant_id IS NULL"))

    conn.execute(sa.text("UPDATE roles SET is_system = true"))

    conn.execute(sa.text("""
        INSERT INTO tenant_members (tenant_id, user_id, role_id, is_owner, joined_at)
        SELECT
            1,
            u.id,
            (SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = u.id LIMIT 1),
            u.is_superuser,
            now()
        FROM users u
        ON CONFLICT (tenant_id, user_id) DO NOTHING
    """))

    conn.execute(sa.text("""
        UPDATE tenants SET owner_id = (
            SELECT id FROM users WHERE is_superuser = true ORDER BY id LIMIT 1
        )
        WHERE id = 1 AND owner_id IS NULL
    """))

    # departments.name: было unique(name). Constraint либо через UNIQUE constraint, либо через unique index.
    conn.execute(sa.text("ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_name_key"))
    conn.execute(sa.text("DROP INDEX IF EXISTS ix_departments_name"))
    op.create_unique_constraint("uq_departments_tenant_name", "departments", ["tenant_id", "name"])

    # roles.name имел unique=True + index=True → SA создал unique index, не table constraint.
    conn.execute(sa.text("ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_name_key"))
    conn.execute(sa.text("DROP INDEX IF EXISTS ix_roles_name"))
    op.create_index("ix_roles_name", "roles", ["name"])  # неуникальный индекс для поиска по имени
    op.create_unique_constraint("uq_roles_tenant_name", "roles", ["tenant_id", "name"])

    op.create_index("ix_tasks_tenant_status", "tasks", ["tenant_id", "status"], if_not_exists=True)
    op.create_index("ix_activity_tenant_created", "activity_logs", ["tenant_id", "created_at"], if_not_exists=True)
    op.create_index("ix_notifications_tenant_user", "notifications", ["tenant_id", "user_id"], if_not_exists=True)


def downgrade() -> None:
    op.drop_index("ix_notifications_tenant_user", table_name="notifications", if_exists=True)
    op.drop_index("ix_activity_tenant_created", table_name="activity_logs", if_exists=True)
    op.drop_index("ix_tasks_tenant_status", table_name="tasks", if_exists=True)

    op.drop_constraint("uq_roles_tenant_name", "roles", type_="unique")
    op.drop_index("ix_roles_name", table_name="roles", if_exists=True)
    op.create_index("ix_roles_name", "roles", ["name"], unique=True)

    op.drop_constraint("uq_departments_tenant_name", "departments", type_="unique")
    op.create_unique_constraint("departments_name_key", "departments", ["name"])

    op.drop_column("roles", "is_system")
    op.drop_index("ix_roles_tenant_id", table_name="roles")
    op.drop_column("roles", "tenant_id")

    for table in BUSINESS_TABLES:
        op.drop_index(f"ix_{table}_tenant_id", table_name=table)
        op.drop_column(table, "tenant_id")

    op.drop_index("ix_tenant_members_user_id", table_name="tenant_members")
    op.drop_index("ix_tenant_members_tenant_id", table_name="tenant_members")
    op.drop_table("tenant_members")

    op.drop_index("ix_tenants_subdomain", table_name="tenants")
    op.drop_index("ix_tenants_slug", table_name="tenants")
    op.drop_table("tenants")
