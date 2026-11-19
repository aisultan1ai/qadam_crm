"""Юрлица компании (/api/legal-entities).

Список доступен всем сотрудникам (нужен для выбора в формах), изменения — с правом
«Управление справочниками».

Удаление: юрлицо по умолчанию удалить нельзя (сначала сделайте основным другое).
Юрлицо, к которому уже привязаны сделки, проекты или документы, тоже не удаляется —
вместо этого его можно отключить: оно пропадёт из выбора, а история останется
с правильным юрлицом. Молча переносить записи на другое юрлицо мы не стали:
это меняет, от чьего имени заключена сделка или подписан документ.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import settings
from ..core.kz import is_valid_bin, normalize_bin
from ..core.legal_entities import get_default_legal_entity
from ..database import get_db
from ..models import Deal, Document, LegalEntity, Project
from ..schemas.common import Message
from .deps import TenantContext, get_current_context, log_action, require

router = APIRouter(prefix="/api/legal-entities", tags=["legal-entities"])

# SVG не принимаем: он может содержать скрипты и раздаётся с домена приложения.
LOGO_EXT_BY_MIME = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
LOGO_MAX_BYTES = 2 * 1024 * 1024


class LegalEntityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    full_name: str
    short_name: str
    bin: Optional[str] = None
    address: Optional[str] = None
    director_name: Optional[str] = None
    director_position: Optional[str] = None
    logo_url: Optional[str] = None
    currency: str
    is_default: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime


class LegalEntityIn(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=300)
    short_name: Optional[str] = Field(default=None, max_length=200)
    bin: Optional[str] = Field(default=None, max_length=20)
    address: Optional[str] = Field(default=None, max_length=1000)
    director_name: Optional[str] = Field(default=None, max_length=200)
    director_position: Optional[str] = Field(default=None, max_length=200)
    currency: Optional[str] = Field(default=None, max_length=3)
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None


def _load(db: Session, ctx: TenantContext, eid: int) -> LegalEntity:
    row = db.get(LegalEntity, eid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Юрлицо не найдено")
    return row


def _clean(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    v = v.strip()
    return v or None


def _apply(row: LegalEntity, payload: LegalEntityIn) -> None:
    data = payload.model_dump(exclude_unset=True)
    if "full_name" in data:
        full = _clean(data["full_name"])
        if not full or len(full) < 2:
            raise HTTPException(400, "Укажите полное название юрлица (минимум 2 символа)")
        row.full_name = full
    if "short_name" in data:
        row.short_name = _clean(data["short_name"]) or row.full_name[:200]
    if "bin" in data:
        raw = _clean(data["bin"])
        if raw:
            digits = normalize_bin(raw)
            if not is_valid_bin(digits):
                raise HTTPException(400, "БИН указан с ошибкой: нужно 12 цифр, проверьте номер")
            row.bin = digits
        else:
            row.bin = None
    for f in ("address", "director_name", "director_position"):
        if f in data:
            setattr(row, f, _clean(data[f]))
    if "currency" in data:
        cur = (_clean(data["currency"]) or "KZT").upper()
        if len(cur) != 3 or not cur.isalpha():
            raise HTTPException(400, "Валюта указывается тремя буквами, например KZT")
        row.currency = cur


def _make_default(db: Session, tenant_id: int, row: LegalEntity) -> None:
    db.query(LegalEntity).filter(
        LegalEntity.tenant_id == tenant_id, LegalEntity.id != row.id, LegalEntity.is_default.is_(True),
    ).update({LegalEntity.is_default: False}, synchronize_session=False)
    row.is_default = True
    row.is_active = True


@router.get("", response_model=list[LegalEntityOut])
def list_legal_entities(
    include_inactive: bool = True,
    ctx: TenantContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    # У компании всегда есть юрлицо по умолчанию (старые базы, компании без него).
    get_default_legal_entity(db, ctx.tenant.id)
    db.commit()
    q = db.query(LegalEntity).filter(LegalEntity.tenant_id == ctx.tenant.id)
    if not include_inactive:
        q = q.filter(LegalEntity.is_active.is_(True))
    return q.order_by(LegalEntity.is_default.desc(), LegalEntity.short_name).all()


@router.get("/{eid}", response_model=LegalEntityOut)
def get_legal_entity(eid: int, ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    return _load(db, ctx, eid)


@router.post("", response_model=LegalEntityOut, status_code=201)
def create_legal_entity(
    payload: LegalEntityIn,
    ctx: TenantContext = Depends(require("settings.dictionaries")),
    db: Session = Depends(get_db),
):
    if not _clean(payload.full_name):
        raise HTTPException(400, "Укажите полное название юрлица")
    row = LegalEntity(tenant_id=ctx.tenant.id, full_name="", short_name="", currency="KZT", is_default=False, is_active=True)
    _apply(row, payload)
    if not row.short_name:
        row.short_name = row.full_name[:200]
    has_default = get_default_legal_entity(db, ctx.tenant.id, create=False)
    db.add(row)
    db.flush()
    if payload.is_default or has_default is None:
        _make_default(db, ctx.tenant.id, row)
    elif payload.is_active is False:
        row.is_active = False
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="create", entity="legal_entity", entity_id=row.id, detail=row.short_name)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{eid}", response_model=LegalEntityOut)
def update_legal_entity(
    eid: int,
    payload: LegalEntityIn,
    ctx: TenantContext = Depends(require("settings.dictionaries")),
    db: Session = Depends(get_db),
):
    row = _load(db, ctx, eid)
    _apply(row, payload)
    if payload.is_default is True:
        _make_default(db, ctx.tenant.id, row)
    elif payload.is_default is False and row.is_default:
        raise HTTPException(400, "Чтобы снять отметку «по умолчанию», сделайте основным другое юрлицо")
    if payload.is_active is not None and payload.is_active != row.is_active:
        if not payload.is_active and row.is_default:
            raise HTTPException(400, "Юрлицо по умолчанию нельзя отключить — сначала сделайте основным другое")
        row.is_active = payload.is_active
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="legal_entity", entity_id=row.id, detail=row.short_name)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{eid}", response_model=Message)
def delete_legal_entity(
    eid: int,
    ctx: TenantContext = Depends(require("settings.dictionaries")),
    db: Session = Depends(get_db),
):
    row = _load(db, ctx, eid)
    if row.is_default:
        raise HTTPException(400, "Юрлицо по умолчанию удалить нельзя — сначала сделайте основным другое юрлицо")
    total = db.query(func.count(LegalEntity.id)).filter(LegalEntity.tenant_id == ctx.tenant.id).scalar() or 0
    if total <= 1:
        raise HTTPException(400, "Нельзя удалить последнее юрлицо компании")

    used = []
    for model, label in ((Deal, "сделок"), (Project, "проектов"), (Document, "документов")):
        n = (
            db.query(func.count(model.id))
            .filter(model.tenant_id == ctx.tenant.id, model.legal_entity_id == row.id)
            .scalar() or 0
        )
        if n:
            used.append(f"{label}: {n}")
    if used:
        raise HTTPException(
            400,
            "К этому юрлицу привязаны записи (" + ", ".join(used) + "). "
            "Удалить его нельзя, но можно отключить: оно пропадёт из выбора, а история сохранится.",
        )

    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="delete", entity="legal_entity", entity_id=row.id, detail=row.short_name)
    db.delete(row)
    db.commit()
    return Message(message="Юрлицо удалено")


@router.post("/{eid}/logo", response_model=LegalEntityOut)
def upload_legal_entity_logo(
    eid: int,
    file: UploadFile = File(...),
    ctx: TenantContext = Depends(require("settings.dictionaries")),
    db: Session = Depends(get_db),
):
    row = _load(db, ctx, eid)
    if not file.content_type or file.content_type not in LOGO_EXT_BY_MIME:
        raise HTTPException(400, "Подойдёт картинка JPEG, PNG или WebP")
    ext = LOGO_EXT_BY_MIME[file.content_type]
    # Логотипы публичны так же, как логотип компании: /media/{tenant}/branding/...
    logo_dir = Path(settings.UPLOAD_DIR) / str(ctx.tenant.id) / "branding"
    logo_dir.mkdir(parents=True, exist_ok=True)
    stored = f"legal-{row.id}-{uuid.uuid4().hex[:8]}{ext}"
    dest = logo_dir / stored
    written = 0
    try:
        with dest.open("wb") as out:
            while True:
                chunk = file.file.read(256 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > LOGO_MAX_BYTES:
                    out.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(413, "Логотип слишком большой — до 2 МБ")
                out.write(chunk)
    except HTTPException:
        raise
    except Exception:
        dest.unlink(missing_ok=True)
        raise HTTPException(500, "Не удалось сохранить файл, попробуйте ещё раз")
    row.logo_url = f"/media/{ctx.tenant.id}/branding/{stored}"
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="legal_entity", entity_id=row.id, detail="logo")
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{eid}/logo", response_model=LegalEntityOut)
def delete_legal_entity_logo(
    eid: int,
    ctx: TenantContext = Depends(require("settings.dictionaries")),
    db: Session = Depends(get_db),
):
    row = _load(db, ctx, eid)
    row.logo_url = None
    db.commit()
    db.refresh(row)
    return row
