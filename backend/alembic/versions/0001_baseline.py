"""baseline (no-op)

Пустая начальная ревизия — фиксирует точку отсчёта. Схема на этот момент
создаётся через Base.metadata.create_all() в bootstrap.main() для fresh БД,
а существующие окружения помечаются `alembic stamp head`. Дальнейшие
структурные правки — только через alembic revision --autogenerate.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-07-16
"""
from typing import Sequence, Union

revision: str = "0001_baseline"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
