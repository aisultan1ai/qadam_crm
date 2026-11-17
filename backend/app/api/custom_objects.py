"""Объекты — пользовательские сущности (low-code): схема полей + записи.

Связи: поле type="relation" с target (contact/company/deal/project/task/user/object:<code>),
значение — id записи (или список id при multiple). Подписи связей отдаются в refs, чтобы
интерфейс показывал названия, а не голые номера. Схемы меняет тот, у кого «Управление справочниками».
"""
from datetime import date, datetime
from typing import Any, Optional
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import String, cast, or_
from sqlalchemy.orm import Session

from ..core import record_refs
from ..database import get_db
from ..models import CustomObjectRecord, CustomObjectSchema
from ..schemas.common import Message, Page, PageParams, page_params, paginate
from .deps import TenantContext, get_current_context, log_action, require


router = APIRouter(prefix="/api/objects", tags=["custom-objects"])


ALLOWED_FIELD_TYPES = {"text", "textarea", "number", "date", "select", "checkbox", "user", "relation"}
CODE_RE = re.compile(r"^[a-z][a-z0-9_]{1,49}$")


class SchemaField(BaseModel):
    name: str
    label: str = Field(min_length=1, max_length=100)
    type: str
    required: bool = False
    options: Optional[list[str]] = None  # для select
    target: Optional[str] = None  # для relation: contact/company/deal/project/task/user/object:<code>
    multiple: bool = False  # relation/user: несколько значений

    @field_validator("type")
    @classmethod
    def _valid_type(cls, v: str) -> str:
        if v not in ALLOWED_FIELD_TYPES:
            raise ValueError("Неизвестный тип поля")
        return v

    @field_validator("name")
    @classmethod
    def _valid_name(cls, v: str) -> str:
        if not re.match(r"^[a-z][a-z0-9_]{0,49}$", v):
            raise ValueError("Код поля: латинские буквы, цифры и _ (например, amount)")
        return v

    @field_validator("options")
    @classmethod
    def _clean_options(cls, v: Optional[list[str]]) -> Optional[list[str]]:
        if v is None:
            return None
        out: list[str] = []
        for o in v:
            o = (o or "").strip()
            if o and o not in out:
                out.append(o[:100])
        return out


class SchemaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    label: str
    icon: Optional[str] = None
    fields: list[dict[str, Any]] = []
    created_at: datetime


class SchemaCreate(BaseModel):
    code: str
    label: str = Field(min_length=1, max_length=100)
    icon: Optional[str] = None
    fields: list[SchemaField] = []

    @field_validator("code")
    @classmethod
    def _valid_code(cls, v: str) -> str:
        if not CODE_RE.match(v):
            raise ValueError("Код: латинские буквы, цифры и _ (например, contract)")
        return v


class SchemaUpdate(BaseModel):
    label: Optional[str] = Field(default=None, min_length=1, max_length=100)
    icon: Optional[str] = None
    fields: Optional[list[SchemaField]] = None


class RefOut(BaseModel):
    id: int
    label: str
    subtitle: Optional[str] = None
    url: Optional[str] = None


class RecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    schema_id: int
    title: Optional[str] = None
    data: dict[str, Any] = {}
    refs: dict[str, list[RefOut]] = {}
    created_at: datetime
    updated_at: datetime


class RecordCreate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    data: dict[str, Any] = {}


class RecordUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    data: Optional[dict[str, Any]] = None


# =============================================================================
# Schemas CRUD
# =============================================================================

def _check_fields(db: Session, tenant_id: int, fields: list[SchemaField], self_code: Optional[str]) -> list[dict]:
    seen: set[str] = set()
    out = []
    for f in fields:
        if f.name in seen:
            raise HTTPException(400, f"Поле с кодом «{f.name}» уже есть")
        seen.add(f.name)
        d = f.model_dump()
        if f.type == "relation":
            # Ссылка на свою же сущность допустима (например, «Родительский договор»).
            if not (self_code and f.target == f"object:{self_code}"):
                record_refs.validate_target(db, tenant_id, f.target)
        else:
            d["target"] = None
        if f.type == "select" and not f.options:
            raise HTTPException(400, f"Для поля «{f.label}» укажите варианты выбора")
        if f.type not in ("relation", "user"):
            d["multiple"] = False
        out.append(d)
    return out


@router.get("/schemas", response_model=list[SchemaOut])
def list_schemas(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    return (
        db.query(CustomObjectSchema)
        .filter(CustomObjectSchema.tenant_id == ctx.tenant.id)
        .order_by(CustomObjectSchema.label)
        .all()
    )


@router.post("/schemas", response_model=SchemaOut, status_code=201)
def create_schema(payload: SchemaCreate, ctx: TenantContext = Depends(require("settings.dictionaries")), db: Session = Depends(get_db)):
    exists = (
        db.query(CustomObjectSchema)
        .filter(CustomObjectSchema.tenant_id == ctx.tenant.id, CustomObjectSchema.code == payload.code)
        .first()
    )
    if exists:
        raise HTTPException(409, "Сущность с таким кодом уже существует")
    row = CustomObjectSchema(
        tenant_id=ctx.tenant.id,
        code=payload.code,
        label=payload.label.strip(),
        icon=payload.icon,
        fields=_check_fields(db, ctx.tenant.id, payload.fields, payload.code),
        created_by=ctx.user.id,
    )
    db.add(row)
    db.flush()
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="create", entity="object_schema", entity_id=row.id, detail=row.code)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/schemas/{sid}", response_model=SchemaOut)
def update_schema(sid: int, payload: SchemaUpdate, ctx: TenantContext = Depends(require("settings.dictionaries")), db: Session = Depends(get_db)):
    row = db.get(CustomObjectSchema, sid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Схема не найдена")
    if payload.label is not None:
        row.label = payload.label.strip()
    if payload.icon is not None:
        row.icon = payload.icon
    if payload.fields is not None:
        row.fields = _check_fields(db, ctx.tenant.id, payload.fields, row.code)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="object_schema", entity_id=row.id, detail=row.code)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/schemas/{sid}", response_model=Message)
def delete_schema(sid: int, ctx: TenantContext = Depends(require("settings.dictionaries")), db: Session = Depends(get_db)):
    row = db.get(CustomObjectSchema, sid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Схема не найдена")
    # Нельзя удалить сущность, на которую ссылаются поля других сущностей — связи бы «повисли».
    target = f"object:{row.code}"
    users_of = [
        s.label for s in db.query(CustomObjectSchema).filter(
            CustomObjectSchema.tenant_id == ctx.tenant.id, CustomObjectSchema.id != row.id,
        )
        if any(f.get("type") == "relation" and f.get("target") == target for f in (s.fields or []))
    ]
    if users_of:
        raise HTTPException(400, f"На эту сущность ссылаются поля в: {', '.join(users_of)}. Сначала уберите эти поля.")
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="delete", entity="object_schema", entity_id=row.id, detail=row.code)
    db.delete(row)
    db.commit()
    return Message(message="Схема удалена")


# =============================================================================
# Связи: поиск при выборе, подписи, превью, обратные ссылки
# =============================================================================

@router.get("/lookup", response_model=list[RefOut])
def lookup(
    target: str,
    q: Optional[str] = Query(default=None, max_length=100),
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    """Поиск записей для поля-связи. Только то, что этот сотрудник вправе видеть."""
    record_refs.validate_target(db, ctx.tenant.id, target)
    return [r.brief() for r in record_refs.lookup(db, ctx.user, ctx.tenant.id, ctx.membership.is_owner, target, q)]


class PreviewOut(BaseModel):
    id: int
    label: str
    subtitle: Optional[str] = None
    url: Optional[str] = None
    kind: str
    details: list[tuple[str, str]] = []


@router.get("/preview", response_model=PreviewOut)
def preview(target: str, id: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    """Короткая карточка для превью по наведению."""
    record_refs.validate_target(db, ctx.tenant.id, target)
    ref = record_refs.resolve(db, ctx.user, ctx.tenant.id, ctx.membership.is_owner, target, [id]).get(id)
    if not ref:
        raise HTTPException(404, "Запись не найдена или нет доступа")
    return PreviewOut(
        id=ref.id, label=ref.label, subtitle=ref.subtitle, url=ref.url,
        kind=record_refs.target_label(db, ctx.tenant.id, target), details=ref.details,
    )


class BacklinkOut(BaseModel):
    schema_code: str
    schema_label: str
    field_label: str
    record: RefOut


@router.get("/backlinks", response_model=list[BacklinkOut])
def backlinks(target: str, id: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    """Какие записи Объектов ссылаются на данную запись (договор → акты, контрагент → договоры)."""
    record_refs.validate_target(db, ctx.tenant.id, target)
    out: list[BacklinkOut] = []
    for schema in db.query(CustomObjectSchema).filter(CustomObjectSchema.tenant_id == ctx.tenant.id):
        for f in schema.fields or []:
            if f.get("type") != "relation" or f.get("target") != target:
                continue
            name = f["name"]
            single = CustomObjectRecord.data[name].astext == str(id)
            multi = CustomObjectRecord.data[name].contains([id])
            rows = (
                db.query(CustomObjectRecord)
                .filter(CustomObjectRecord.tenant_id == ctx.tenant.id, CustomObjectRecord.schema_id == schema.id)
                .filter(or_(single, multi))
                .order_by(CustomObjectRecord.id.desc())
                .limit(50)
                .all()
            )
            for r in rows:
                out.append(BacklinkOut(
                    schema_code=schema.code, schema_label=schema.label, field_label=f.get("label", name),
                    record=RefOut(id=r.id, label=r.title or f"{schema.label} #{r.id}",
                                  url=f"/objects?code={schema.code}&record={r.id}"),
                ))
    return out


# =============================================================================
# Records CRUD
# =============================================================================

def _get_schema_by_code(db: Session, tenant_id: int, code: str) -> CustomObjectSchema:
    row = (
        db.query(CustomObjectSchema)
        .filter(CustomObjectSchema.tenant_id == tenant_id, CustomObjectSchema.code == code)
        .first()
    )
    if not row:
        raise HTTPException(404, "Сущность не найдена")
    return row


def _ids(value: Any) -> list[int]:
    vals = value if isinstance(value, list) else [value]
    out = []
    for v in vals:
        if isinstance(v, bool):
            continue
        if isinstance(v, int):
            out.append(v)
        elif isinstance(v, str) and v.strip().isdigit():
            out.append(int(v.strip()))
    return out


def _clean_record(db: Session, tenant_id: int, schema: CustomObjectSchema, data: dict[str, Any]) -> dict[str, Any]:
    """Проверка и нормализация значений по типам полей; ссылки — только на записи своей компании."""
    field_map = {f["name"]: f for f in (schema.fields or [])}
    unknown = set(data.keys()) - set(field_map.keys())
    if unknown:
        raise HTTPException(400, f"Поля вне схемы: {', '.join(sorted(unknown))}")
    out: dict[str, Any] = {}
    for name, spec in field_map.items():
        label = spec.get("label", name)
        v = data.get(name)
        empty = v in (None, "", []) or (spec["type"] == "checkbox" and v is False)
        if empty:
            if spec.get("required") and spec["type"] != "checkbox":
                raise HTTPException(400, f"Заполните поле «{label}»")
            if v is not None and spec["type"] == "checkbox":
                out[name] = False
            continue
        t = spec["type"]
        if t == "number":
            try:
                num = float(v) if not isinstance(v, (int, float)) else v
                out[name] = int(num) if isinstance(num, float) and num.is_integer() else num
            except (TypeError, ValueError):
                raise HTTPException(400, f"В поле «{label}» должно быть число")
        elif t == "date":
            try:
                out[name] = date.fromisoformat(str(v)[:10]).isoformat()
            except ValueError:
                raise HTTPException(400, f"В поле «{label}» неверная дата")
        elif t == "checkbox":
            out[name] = bool(v)
        elif t == "select":
            if str(v) not in (spec.get("options") or []):
                raise HTTPException(400, f"В поле «{label}» выберите значение из списка")
            out[name] = str(v)
        elif t in ("relation", "user"):
            target = spec.get("target") if t == "relation" else "user"
            ids = _ids(v)
            if not ids:
                raise HTTPException(400, f"В поле «{label}» выберите запись из списка")
            for i in ids:
                record_refs.ensure_exists(db, tenant_id, target, i)
            out[name] = ids if spec.get("multiple") else ids[0]
        else:
            s = str(v)
            if len(s) > 5000:
                raise HTTPException(400, f"Поле «{label}» слишком длинное")
            out[name] = s
    return out


def _with_refs(db: Session, ctx: TenantContext, schema: CustomObjectSchema, rows: list[CustomObjectRecord]) -> list[RecordOut]:
    """Подписи для полей-связей пачкой (по одному запросу на цель, а не на запись)."""
    link_fields = [
        (f["name"], f.get("target") if f["type"] == "relation" else "user")
        for f in (schema.fields or []) if f.get("type") in ("relation", "user")
    ]
    wanted: dict[str, set[int]] = {}
    for r in rows:
        for name, target in link_fields:
            if target:
                wanted.setdefault(target, set()).update(_ids((r.data or {}).get(name)))
    resolved = {
        t: record_refs.resolve(db, ctx.user, ctx.tenant.id, ctx.membership.is_owner, t, ids)
        for t, ids in wanted.items()
    }
    out = []
    for r in rows:
        refs: dict[str, list[RefOut]] = {}
        for name, target in link_fields:
            ids = _ids((r.data or {}).get(name))
            if ids and target:
                refs[name] = [
                    RefOut(**resolved[target][i].brief()) if i in resolved.get(target, {})
                    else RefOut(id=i, label=f"#{i} (нет доступа или удалена)")
                    for i in ids
                ]
        out.append(RecordOut(
            id=r.id, schema_id=r.schema_id, title=r.title, data=r.data or {}, refs=refs,
            created_at=r.created_at, updated_at=r.updated_at,
        ))
    return out


@router.get("/schemas/{code}/records", response_model=Page[RecordOut])
def list_records(
    code: str,
    q: Optional[str] = Query(default=None, max_length=100),
    pagination: PageParams = Depends(page_params),
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    schema = _get_schema_by_code(db, ctx.tenant.id, code)
    query = (
        db.query(CustomObjectRecord)
        .filter(CustomObjectRecord.tenant_id == ctx.tenant.id, CustomObjectRecord.schema_id == schema.id)
        .order_by(CustomObjectRecord.created_at.desc())
    )
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(or_(CustomObjectRecord.title.ilike(like), cast(CustomObjectRecord.data, String).ilike(like)))
    page = paginate(query, pagination)
    page.items = _with_refs(db, ctx, schema, list(page.items))
    return page


@router.get("/records/{rid}", response_model=RecordOut)
def get_record(rid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(CustomObjectRecord, rid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Запись не найдена")
    return _with_refs(db, ctx, db.get(CustomObjectSchema, row.schema_id), [row])[0]


@router.post("/schemas/{code}/records", response_model=RecordOut, status_code=201)
def create_record(
    code: str,
    payload: RecordCreate,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    schema = _get_schema_by_code(db, ctx.tenant.id, code)
    row = CustomObjectRecord(
        tenant_id=ctx.tenant.id,
        schema_id=schema.id,
        title=(payload.title or "").strip() or None,
        data=_clean_record(db, ctx.tenant.id, schema, payload.data),
        created_by=ctx.user.id,
    )
    db.add(row)
    db.flush()
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="create", entity="object_record", entity_id=row.id, detail=schema.code)
    db.commit()
    db.refresh(row)
    return _with_refs(db, ctx, schema, [row])[0]


@router.patch("/records/{rid}", response_model=RecordOut)
def update_record(
    rid: int,
    payload: RecordUpdate,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    row = db.get(CustomObjectRecord, rid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Запись не найдена")
    schema = db.get(CustomObjectSchema, row.schema_id)
    if payload.title is not None:
        row.title = payload.title.strip() or None
    if payload.data is not None:
        row.data = _clean_record(db, ctx.tenant.id, schema, payload.data)
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="object_record", entity_id=row.id, detail=schema.code)
    db.commit()
    db.refresh(row)
    return _with_refs(db, ctx, schema, [row])[0]


@router.delete("/records/{rid}", response_model=Message)
def delete_record(rid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(CustomObjectRecord, rid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Запись не найдена")
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="delete", entity="object_record", entity_id=row.id)
    db.delete(row)
    db.commit()
    return Message(message="Запись удалена")
