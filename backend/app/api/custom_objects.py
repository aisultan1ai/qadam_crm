from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Any, Optional
from datetime import datetime
import re
from pydantic import BaseModel, ConfigDict, field_validator

from ..database import get_db
from ..models import CustomObjectSchema, CustomObjectRecord
from ..schemas.common import Message, Page, PageParams, page_params, paginate
from .deps import TenantContext, get_current_context, log_action


router = APIRouter(prefix="/api/objects", tags=["custom-objects"])


ALLOWED_FIELD_TYPES = {"text", "textarea", "number", "date", "select", "checkbox", "user", "relation"}
CODE_RE = re.compile(r"^[a-z][a-z0-9_]{1,49}$")


class SchemaField(BaseModel):
    name: str
    label: str
    type: str
    required: bool = False
    options: Optional[list[str]] = None  # для select

    @field_validator("type")
    @classmethod
    def _valid_type(cls, v: str) -> str:
        if v not in ALLOWED_FIELD_TYPES:
            raise ValueError(f"Unknown field type: {v}")
        return v

    @field_validator("name")
    @classmethod
    def _valid_name(cls, v: str) -> str:
        if not re.match(r"^[a-z][a-z0-9_]{0,49}$", v):
            raise ValueError("name must be snake_case, letters/digits/underscore")
        return v


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
    label: str
    icon: Optional[str] = None
    fields: list[SchemaField] = []

    @field_validator("code")
    @classmethod
    def _valid_code(cls, v: str) -> str:
        if not CODE_RE.match(v):
            raise ValueError("code must be snake_case: [a-z][a-z0-9_]+")
        return v


class SchemaUpdate(BaseModel):
    label: Optional[str] = None
    icon: Optional[str] = None
    fields: Optional[list[SchemaField]] = None


class RecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    schema_id: int
    title: Optional[str] = None
    data: dict[str, Any] = {}
    created_at: datetime
    updated_at: datetime


class RecordCreate(BaseModel):
    title: Optional[str] = None
    data: dict[str, Any] = {}


class RecordUpdate(BaseModel):
    title: Optional[str] = None
    data: Optional[dict[str, Any]] = None


# =============================================================================
# Schemas CRUD
# =============================================================================

@router.get("/schemas", response_model=list[SchemaOut])
def list_schemas(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    return (
        db.query(CustomObjectSchema)
        .filter(CustomObjectSchema.tenant_id == ctx.tenant.id)
        .order_by(CustomObjectSchema.label)
        .all()
    )


@router.post("/schemas", response_model=SchemaOut, status_code=201)
def create_schema(payload: SchemaCreate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    exists = (
        db.query(CustomObjectSchema)
        .filter(CustomObjectSchema.tenant_id == ctx.tenant.id, CustomObjectSchema.code == payload.code)
        .first()
    )
    if exists:
        raise HTTPException(409, f"Схема с code={payload.code} уже существует")
    row = CustomObjectSchema(
        tenant_id=ctx.tenant.id,
        code=payload.code,
        label=payload.label,
        icon=payload.icon,
        fields=[f.model_dump() for f in payload.fields],
        created_by=ctx.user.id,
    )
    db.add(row)
    db.flush()
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="create", entity="object_schema", entity_id=row.id, detail=row.code)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/schemas/{sid}", response_model=SchemaOut)
def update_schema(sid: int, payload: SchemaUpdate, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(CustomObjectSchema, sid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Схема не найдена")
    if payload.label is not None:
        row.label = payload.label
    if payload.icon is not None:
        row.icon = payload.icon
    if payload.fields is not None:
        row.fields = [f.model_dump() for f in payload.fields]
    db.commit()
    db.refresh(row)
    return row


@router.delete("/schemas/{sid}", response_model=Message)
def delete_schema(sid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(CustomObjectSchema, sid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Схема не найдена")
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="delete", entity="object_schema", entity_id=row.id, detail=row.code)
    db.delete(row)
    db.commit()
    return Message(message="Схема удалена")


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
        raise HTTPException(404, f"Схема {code} не найдена")
    return row


def _validate_record(schema: CustomObjectSchema, data: dict[str, Any]) -> None:
    field_map = {f["name"]: f for f in (schema.fields or [])}
    for name, spec in field_map.items():
        if spec.get("required") and (data.get(name) in (None, "", [])):
            raise HTTPException(400, f"Поле «{spec.get('label', name)}» обязательно")
    # Отсекаем поля вне схемы
    unknown = set(data.keys()) - set(field_map.keys())
    if unknown:
        raise HTTPException(400, f"Поля вне схемы: {', '.join(sorted(unknown))}")


@router.get("/schemas/{code}/records", response_model=Page[RecordOut])
def list_records(
    code: str,
    pagination: PageParams = Depends(page_params),
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    schema = _get_schema_by_code(db, ctx.tenant.id, code)
    q = (
        db.query(CustomObjectRecord)
        .filter(CustomObjectRecord.tenant_id == ctx.tenant.id, CustomObjectRecord.schema_id == schema.id)
        .order_by(CustomObjectRecord.created_at.desc())
    )
    return paginate(q, pagination)


@router.post("/schemas/{code}/records", response_model=RecordOut, status_code=201)
def create_record(
    code: str,
    payload: RecordCreate,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    schema = _get_schema_by_code(db, ctx.tenant.id, code)
    _validate_record(schema, payload.data)
    row = CustomObjectRecord(
        tenant_id=ctx.tenant.id,
        schema_id=schema.id,
        title=payload.title,
        data=payload.data,
        created_by=ctx.user.id,
    )
    db.add(row)
    db.flush()
    db.commit()
    db.refresh(row)
    return row


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
    if payload.title is not None:
        row.title = payload.title
    if payload.data is not None:
        schema = db.get(CustomObjectSchema, row.schema_id)
        _validate_record(schema, payload.data)
        row.data = payload.data
    db.commit()
    db.refresh(row)
    return row


@router.delete("/records/{rid}", response_model=Message)
def delete_record(rid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    row = db.get(CustomObjectRecord, rid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Запись не найдена")
    db.delete(row)
    db.commit()
    return Message(message="Запись удалена")
