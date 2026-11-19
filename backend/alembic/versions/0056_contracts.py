"""Реестр договоров: договоры, EPC-разделы (этапы, гарантии, удержания, штрафы),
отметки отправленных напоминаний, файлы договора (documents.contract_id).

Перенос данных: записи старого реестра «Договоры» в «Объектах» (сущность с кодом contract)
становятся договорами модуля; связи других сущностей Объектов на object:contract
переключаются на системную цель "contract" с новыми номерами записей; старая сущность
и её записи удаляются. Делается по компаниям, в одной транзакции миграции.

Revision ID: 0056_contracts
Revises: 0055_offtake
Create Date: 2026-11-19
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Optional, Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0056_contracts"
down_revision: Union[str, None] = "0055_offtake"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _ts():
    return sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def upgrade() -> None:
    op.create_table(
        "contracts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("number", sa.String(100), nullable=False),
        sa.Column("date_signed", sa.Date(), nullable=True),
        sa.Column("legal_entity_id", sa.Integer(), sa.ForeignKey("legal_entities.id", ondelete="SET NULL"), nullable=True),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id", ondelete="SET NULL"), nullable=True),
        sa.Column("contract_type", sa.String(20), nullable=False, server_default="other"),
        sa.Column("subject", sa.Text(), nullable=True),
        sa.Column("amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("currency", sa.String(3), nullable=False, server_default="KZT"),
        sa.Column("vat_mode", sa.String(10), nullable=False, server_default="none"),
        sa.Column("vat_rate", sa.Numeric(5, 2), nullable=False, server_default="12"),
        sa.Column("valid_from", sa.Date(), nullable=True),
        sa.Column("valid_until", sa.Date(), nullable=True),
        sa.Column("auto_renewal", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("responsible_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("lawyer_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("deal_id", sa.Integer(), sa.ForeignKey("deals.id", ondelete="SET NULL"), nullable=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        _ts(),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    for col in ("tenant_id", "legal_entity_id", "company_id", "responsible_user_id", "lawyer_user_id", "deal_id", "project_id"):
        op.create_index(f"ix_contracts_{col}", "contracts", [col])
    op.create_index("ix_contracts_tenant_status", "contracts", ["tenant_id", "status"])
    op.create_index("ix_contracts_tenant_valid_until", "contracts", ["tenant_id", "valid_until"])

    def child(name: str, *cols: sa.Column) -> None:
        op.create_table(
            name,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("contract_id", sa.Integer(), sa.ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False),
            *cols,
            _ts(),
        )
        op.create_index(f"ix_{name}_tenant_id", name, ["tenant_id"])
        op.create_index(f"ix_{name}_contract_id", name, ["contract_id"])

    child(
        "contract_stages",
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("planned_start", sa.Date(), nullable=True),
        sa.Column("planned_end", sa.Date(), nullable=True),
        sa.Column("amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("percent_complete", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
    )
    child(
        "contract_guarantees",
        sa.Column("kind", sa.String(20), nullable=False, server_default="other"),
        sa.Column("bank_name", sa.String(300), nullable=True),
        sa.Column("amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("currency", sa.String(3), nullable=False, server_default="KZT"),
        sa.Column("valid_until", sa.Date(), nullable=True),
    )
    op.create_index("ix_contract_guarantees_valid_until", "contract_guarantees", ["valid_until"])
    child(
        "contract_retentions",
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("percent", sa.Numeric(7, 3), nullable=True),
        sa.Column("amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("release_condition", sa.Text(), nullable=True),
        sa.Column("release_date", sa.Date(), nullable=True),
    )
    child(
        "contract_penalties",
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("rate_percent", sa.Numeric(7, 3), nullable=True),
        sa.Column("amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("basis", sa.Text(), nullable=True),
    )

    op.create_table(
        "contract_reminder_marks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("object_id", sa.Integer(), nullable=False),
        sa.Column("days", sa.Integer(), nullable=False),
        sa.Column("target_date", sa.Date(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("kind", "object_id", "days", "target_date", name="uq_contract_reminder_mark"),
    )
    op.create_index("ix_contract_reminder_marks_tenant_id", "contract_reminder_marks", ["tenant_id"])

    op.add_column(
        "documents",
        sa.Column(
            "contract_id", sa.Integer(),
            sa.ForeignKey("contracts.id", ondelete="SET NULL", name="fk_documents_contract_id"),
            nullable=True,
        ),
    )
    op.create_index("ix_documents_contract_id", "documents", ["contract_id"])

    _migrate_objects_registry(op.get_bind())


# =============================================================================
# Перенос старого реестра «Договоры» из Объектов
# =============================================================================

STATUS_MAP = {
    "черновик": "draft",
    "на согласовании": "approval",
    "на подписании": "signing",
    "действует": "active",
    "исполнен": "completed",
    "расторгнут": "terminated",
}
# «Подряд» — договор подряда: в модуле это тип EPC (с этапами, гарантиями, удержаниями).
TYPE_MAP = {
    "поставка": "supply",
    "подряд": "epc",
    "epc": "epc",
    "услуги": "services",
    "аренда": "lease",
    "оффтейк": "offtake",
    "агентский": "other",
    "прочее": "other",
}
KNOWN_FIELDS = {"number", "counterparty", "contract_type", "amount", "signed_at", "valid_until", "curator", "deal", "status"}


def _json(v: Any) -> Any:
    if isinstance(v, str):
        try:
            return json.loads(v)
        except ValueError:
            return v
    return v


def _ids(v: Any) -> list[int]:
    if v is None or v == "":
        return []
    items = v if isinstance(v, list) else [v]
    out: list[int] = []
    for i in items:
        if isinstance(i, bool):
            continue
        if isinstance(i, int):
            out.append(i)
        elif isinstance(i, str) and i.strip().isdigit():
            out.append(int(i.strip()))
        elif isinstance(i, dict) and isinstance(i.get("id"), int):
            out.append(i["id"])
    return out


def _date(v: Any) -> Optional[date]:
    if not v:
        return None
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def _decimal(v: Any) -> Optional[Decimal]:
    if v is None or v == "" or isinstance(v, bool):
        return None
    try:
        d = Decimal(str(v).replace(" ", "").replace(",", "."))
    except (InvalidOperation, ValueError):
        return None
    if d < 0 or d >= Decimal("1e16"):
        return None
    return d.quantize(Decimal("0.01"))


def _text(v: Any) -> str:
    if isinstance(v, bool):
        return "да" if v else "нет"
    if isinstance(v, list):
        return ", ".join(_text(x) for x in v)
    return str(v)


def _migrate_objects_registry(conn) -> None:
    schemas = conn.execute(sa.text(
        "SELECT id, tenant_id, fields FROM custom_object_schemas WHERE code = 'contract' ORDER BY tenant_id"
    )).fetchall()
    id_maps: dict[int, dict[int, int]] = {}  # tenant_id -> {старый id записи: id договора}

    for schema_id, tenant_id, fields in schemas:
        fields = _json(fields) or []
        labels = {f.get("name"): f.get("label") or f.get("name") for f in fields if isinstance(f, dict)}
        le_id = _default_legal_entity(conn, tenant_id)
        mapping: dict[int, int] = {}
        records = conn.execute(sa.text(
            "SELECT id, title, data, created_by, created_at, updated_at FROM custom_object_records "
            "WHERE schema_id = :s AND tenant_id = :t ORDER BY id"
        ), {"s": schema_id, "t": tenant_id}).fetchall()

        for rec_id, title, data, created_by, created_at, updated_at in records:
            data = _json(data) or {}
            if not isinstance(data, dict):
                data = {}

            number = str(data.get("number") or "").strip() or (title or "").strip() or f"Без номера ({rec_id})"
            company_id = _first_owned(conn, "companies", tenant_id, _ids(data.get("counterparty")))
            deal_id = _first_owned(conn, "deals", tenant_id, _ids(data.get("deal")))
            curator = _first_member(conn, tenant_id, _ids(data.get("curator")))
            creator = created_by if created_by and _user_exists(conn, created_by) else None
            ctype = TYPE_MAP.get(str(data.get("contract_type") or "").strip().lower(), "other")
            signed = _date(data.get("signed_at"))
            status = STATUS_MAP.get(str(data.get("status") or "").strip().lower())
            if status is None:
                status = "active" if signed else "draft"

            extra = []
            for k, v in data.items():
                if k in KNOWN_FIELDS or v in (None, "", []):
                    continue
                extra.append(f"{labels.get(k, k)}: {_text(v)}")
            note = None
            if extra:
                note = "Из реестра «Объекты»:\n" + "\n".join(extra)

            new_id = conn.execute(sa.text(
                """
                INSERT INTO contracts (
                    tenant_id, number, date_signed, legal_entity_id, company_id, contract_type,
                    amount, currency, vat_mode, vat_rate, valid_until, auto_renewal,
                    responsible_user_id, deal_id, status, note, created_by, created_at, updated_at
                ) VALUES (
                    :tenant_id, :number, :date_signed, :le, :company_id, :ctype,
                    :amount, 'KZT', 'none', 12, :valid_until, false,
                    :resp, :deal_id, :status, :note, :created_by,
                    COALESCE(:created_at, now()), COALESCE(:updated_at, now())
                ) RETURNING id
                """
            ), {
                "tenant_id": tenant_id, "number": number[:100], "date_signed": signed, "le": le_id,
                "company_id": company_id, "ctype": ctype, "amount": _decimal(data.get("amount")),
                "valid_until": _date(data.get("valid_until")), "resp": curator, "deal_id": deal_id,
                "status": status, "note": note, "created_by": creator,
                "created_at": created_at, "updated_at": updated_at,
            }).scalar()
            mapping[rec_id] = new_id

        id_maps[tenant_id] = mapping

    # Связи других сущностей: object:contract → contract (с перенумерацией записей).
    others = conn.execute(sa.text(
        "SELECT id, tenant_id, fields FROM custom_object_schemas WHERE code <> 'contract'"
    )).fetchall()
    for schema_id, tenant_id, fields in others:
        fields = _json(fields) or []
        rel = [f.get("name") for f in fields
               if isinstance(f, dict) and f.get("type") == "relation" and f.get("target") == "object:contract"]
        if not rel:
            continue
        mapping = id_maps.get(tenant_id, {})
        for f in fields:
            if isinstance(f, dict) and f.get("type") == "relation" and f.get("target") == "object:contract":
                f["target"] = "contract"
        conn.execute(
            sa.text("UPDATE custom_object_schemas SET fields = CAST(:f AS jsonb) WHERE id = :id"),
            {"f": json.dumps(fields, ensure_ascii=False), "id": schema_id},
        )
        records = conn.execute(sa.text(
            "SELECT id, data FROM custom_object_records WHERE schema_id = :s"
        ), {"s": schema_id}).fetchall()
        for rec_id, data in records:
            data = _json(data) or {}
            if not isinstance(data, dict):
                continue
            changed = False
            for name in rel:
                if name not in data:
                    continue
                v = data[name]
                if isinstance(v, list):
                    new = [mapping[i] for i in _ids(v) if i in mapping]
                    if new:
                        data[name] = new
                    else:
                        data.pop(name)
                else:
                    old = _ids(v)
                    if old and old[0] in mapping:
                        data[name] = mapping[old[0]]
                    else:
                        data.pop(name)
                changed = True
            if changed:
                conn.execute(
                    sa.text("UPDATE custom_object_records SET data = CAST(:d AS jsonb) WHERE id = :id"),
                    {"d": json.dumps(data, ensure_ascii=False), "id": rec_id},
                )

    # Старый реестр больше не нужен.
    for schema_id, tenant_id, _fields in schemas:
        conn.execute(sa.text("DELETE FROM custom_object_records WHERE schema_id = :s"), {"s": schema_id})
        conn.execute(sa.text("DELETE FROM custom_object_schemas WHERE id = :s"), {"s": schema_id})


def _default_legal_entity(conn, tenant_id: int) -> Optional[int]:
    row = conn.execute(sa.text(
        "SELECT id FROM legal_entities WHERE tenant_id = :t "
        "ORDER BY is_default DESC, is_active DESC, id LIMIT 1"
    ), {"t": tenant_id}).first()
    if row:
        return row[0]
    name = conn.execute(sa.text("SELECT name FROM tenants WHERE id = :t"), {"t": tenant_id}).scalar() or "Основное юрлицо"
    return conn.execute(sa.text(
        "INSERT INTO legal_entities (tenant_id, full_name, short_name, currency, is_default, is_active, created_at, updated_at) "
        "VALUES (:t, :n, :s, 'KZT', true, true, now(), now()) RETURNING id"
    ), {"t": tenant_id, "n": name[:300], "s": name[:200]}).scalar()


def _first_owned(conn, table: str, tenant_id: int, ids: list[int]) -> Optional[int]:
    for i in ids:
        ok = conn.execute(sa.text(f"SELECT 1 FROM {table} WHERE id = :i AND tenant_id = :t"), {"i": i, "t": tenant_id}).first()
        if ok:
            return i
    return None


def _first_member(conn, tenant_id: int, ids: list[int]) -> Optional[int]:
    for i in ids:
        ok = conn.execute(sa.text(
            "SELECT 1 FROM tenant_members WHERE user_id = :i AND tenant_id = :t"
        ), {"i": i, "t": tenant_id}).first()
        if ok:
            return i
    return None


def _user_exists(conn, user_id: int) -> bool:
    return conn.execute(sa.text("SELECT 1 FROM users WHERE id = :i"), {"i": user_id}).first() is not None


def downgrade() -> None:
    # Перенесённые из «Объектов» договоры обратно не превращаются в записи Объектов.
    op.drop_index("ix_documents_contract_id", table_name="documents")
    op.drop_constraint("fk_documents_contract_id", "documents", type_="foreignkey")
    op.drop_column("documents", "contract_id")
    op.drop_table("contract_reminder_marks")
    op.drop_table("contract_penalties")
    op.drop_table("contract_retentions")
    op.drop_table("contract_guarantees")
    op.drop_table("contract_stages")
    op.drop_table("contracts")
