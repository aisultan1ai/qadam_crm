"""Системные роли больше не дают прав: переносим их назначения на роли компаний

Раньше user_has учитывал роли с tenant_id IS NULL в любой компании пользователя,
поэтому системный «Администратор» действовал во всех его компаниях. Теперь такие роли —
только шаблоны. Назначения переносим на одноимённую роль компании там, где
пользователь владелец (иначе перенос повторил бы ту же утечку), затем снимаем.

Revision ID: 0036_system_roles_no_grants
Revises: 0035_notification_snooze
Create Date: 2026-09-30
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0036_system_roles_no_grants"
down_revision: Union[str, None] = "0035_notification_snooze"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    pairs = conn.execute(sa.text(
        """
        SELECT DISTINCT ur.user_id, r.id AS sys_role_id, r.name, r.description, m.tenant_id
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id AND r.tenant_id IS NULL
        JOIN tenant_members m ON m.user_id = ur.user_id AND m.is_owner
        """
    )).mappings().all()

    for p in pairs:
        tenant_role_id = conn.execute(
            sa.text("SELECT id FROM roles WHERE tenant_id = :t AND name = :n"),
            {"t": p["tenant_id"], "n": p["name"]},
        ).scalar()
        if tenant_role_id is None:
            # Копии в компании нет — создаём с правами шаблона (только эту, новую роль).
            tenant_role_id = conn.execute(
                sa.text(
                    "INSERT INTO roles (tenant_id, name, description, is_system) "
                    "VALUES (:t, :n, :d, false) RETURNING id"
                ),
                {"t": p["tenant_id"], "n": p["name"], "d": p["description"]},
            ).scalar()
            conn.execute(
                sa.text(
                    "INSERT INTO role_permissions (role_id, permission_id) "
                    "SELECT :new, permission_id FROM role_permissions WHERE role_id = :sys"
                ),
                {"new": tenant_role_id, "sys": p["sys_role_id"]},
            )
        conn.execute(
            sa.text("INSERT INTO user_roles (user_id, role_id) VALUES (:u, :r) ON CONFLICT DO NOTHING"),
            {"u": p["user_id"], "r": tenant_role_id},
        )

    # Системные роли больше ни на кого не назначены.
    conn.execute(sa.text("DELETE FROM user_roles WHERE role_id IN (SELECT id FROM roles WHERE tenant_id IS NULL)"))


def downgrade() -> None:
    # Назначения системных ролей не восстанавливаем: это и была уязвимость.
    pass
