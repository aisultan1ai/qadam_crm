from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from datetime import datetime, date, timezone
from decimal import Decimal, ROUND_HALF_UP
from pydantic import BaseModel, ConfigDict, Field

from ..database import get_db
from ..models import Company, Contact, Deal, DealStage, DealStatus
from ..models.deal import (
    STAGE_PROBABILITY, DEAL_DOC_KINDS, INCOTERMS, LOSS_REASONS, OFFTAKE_REQUIRED_DOCS, OFFTAKE_STAGE_LABEL,
    OFFTAKE_STAGE_ORDER, OFFTAKE_STAGE_PROBABILITY, OFFTAKE_TO_SALES_STAGE, DealPipeline, OfftakeProduct, OfftakeStage,
)
from ..models.p4 import Document
from ..models.tenant import Tenant
from ..core.tenant_refs import ensure_member, ensure_owned
from ..core.legal_entities import resolve_legal_entity_id
from ..schemas.legal_entity import LegalEntityBrief
from ..schemas.common import Message, Page, PageParams, page_params, paginate
from .deps import TenantContext, get_current_context, require, log_action


router = APIRouter(prefix="/api/deals", tags=["deals"])


class UserBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    avatar_url: Optional[str] = None


class RelBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None


class DealCompanyBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class ProductBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    is_active: bool = True


class DealOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    amount_cents: int
    currency: str
    stage: DealStage
    status: DealStatus
    probability: int
    close_date: Optional[date] = None
    note: Optional[str] = None
    order_index: int
    created_at: datetime
    owner: Optional[UserBrief] = None
    contact_id: Optional[int] = None
    company_id: Optional[int] = None
    company: Optional["DealCompanyBrief"] = None
    legal_entity_id: Optional[int] = None
    legal_entity: Optional[LegalEntityBrief] = None
    # Offtake
    pipeline: str = "sales"
    offtake_stage: Optional[OfftakeStage] = None
    probability_manual: bool = False
    loss_reason: Optional[str] = None
    loss_comment: Optional[str] = None
    product_id: Optional[int] = None
    product: Optional[ProductBrief] = None
    volume_tpy: Optional[float] = None
    term_years: Optional[int] = None
    start_year: Optional[int] = None
    total_volume: Optional[float] = None
    price_type: Optional[str] = None
    price_value: Optional[float] = None
    index_name: Optional[str] = None
    discount_value: Optional[float] = None
    discount_unit: Optional[str] = None
    incoterms: Optional[str] = None
    delivery_point: Optional[str] = None


class OfftakeFields(BaseModel):
    """Поля offtake-сделки. В PATCH явный null очищает поле."""
    offtake_stage: Optional[OfftakeStage] = None
    loss_reason: Optional[str] = None  # price | volume | timing | logistics | other
    loss_comment: Optional[str] = Field(default=None, max_length=5000)
    product_id: Optional[int] = None
    volume_tpy: Optional[Decimal] = Field(default=None, ge=0, le=Decimal("1e14"))
    term_years: Optional[int] = Field(default=None, ge=1, le=100)
    start_year: Optional[int] = Field(default=None, ge=1900, le=2200)
    price_type: Optional[str] = None  # fixed | index
    price_value: Optional[Decimal] = Field(default=None, ge=0, le=Decimal("1e12"))
    index_name: Optional[str] = Field(default=None, max_length=200)
    discount_value: Optional[Decimal] = Field(default=None, ge=0, le=Decimal("1e12"))
    discount_unit: Optional[str] = None  # per_t (за тонну, в валюте сделки) | pct (% от индекса)
    incoterms: Optional[str] = None
    delivery_point: Optional[str] = Field(default=None, max_length=300)


OFFTAKE_FIELD_NAMES = tuple(OfftakeFields.model_fields.keys())


class DealCreate(OfftakeFields):
    title: str
    amount_cents: int = Field(default=0, ge=0, le=10**17)  # до 1 трлн ₸ в тиынах
    currency: str = "KZT"
    stage: DealStage = DealStage.new
    probability: Optional[int] = None
    close_date: Optional[date] = None
    contact_id: Optional[int] = None
    company_id: Optional[int] = None
    owner_id: Optional[int] = None
    note: Optional[str] = None
    legal_entity_id: Optional[int] = None  # пусто — юрлицо по умолчанию
    pipeline: DealPipeline = DealPipeline.sales


class DealUpdate(OfftakeFields):
    title: Optional[str] = None
    amount_cents: Optional[int] = Field(default=None, ge=0, le=10**17)
    currency: Optional[str] = None
    stage: Optional[DealStage] = None
    probability: Optional[int] = None
    close_date: Optional[date] = None
    contact_id: Optional[int] = None
    company_id: Optional[int] = None
    owner_id: Optional[int] = None
    note: Optional[str] = None
    order_index: Optional[int] = None
    legal_entity_id: Optional[int] = None
    # true — вернуть вероятность по стадии (снять ручное значение), только offtake
    probability_auto: Optional[bool] = None


class ForecastOut(BaseModel):
    currency: str
    total_amount_cents: int
    weighted_amount_cents: int
    won_amount_cents: int
    lost_amount_cents: int = 0
    open_count: int
    won_count: int
    lost_count: int
    by_stage: dict[str, dict]  # {stage: {count, amount_cents, weighted_amount_cents}}


@router.get("", response_model=Page[DealOut])
def list_deals(
    stage: Optional[DealStage] = None,
    owner_id: Optional[int] = None,
    status: Optional[DealStatus] = None,
    company_id: Optional[int] = None,
    legal_entity_id: Optional[int] = None,
    pipeline: Optional[DealPipeline] = None,
    pagination: PageParams = Depends(page_params),
    ctx: TenantContext = Depends(require("deals.view")),
    db: Session = Depends(get_db),
):
    q = db.query(Deal).filter(Deal.tenant_id == ctx.tenant.id)
    if stage is not None:
        q = q.filter(Deal.stage == stage.value)
    if owner_id is not None:
        q = q.filter(Deal.owner_id == owner_id)
    if status is not None:
        q = q.filter(Deal.status == status.value)
    if company_id is not None:
        q = q.filter(Deal.company_id == company_id)
    if legal_entity_id is not None:
        q = q.filter(Deal.legal_entity_id == legal_entity_id)
    if pipeline is not None:
        q = q.filter(Deal.pipeline == pipeline.value)
    q = q.order_by(Deal.order_index.asc(), Deal.created_at.desc())
    return paginate(q, pagination)


@router.get("/forecast", response_model=ForecastOut)
def forecast(
    currency: str = "KZT",
    pipeline: Optional[DealPipeline] = None,
    ctx: TenantContext = Depends(require("deals.view")),
    db: Session = Depends(get_db),
):
    q = db.query(Deal).filter(Deal.tenant_id == ctx.tenant.id, Deal.currency == currency)
    if pipeline is not None:
        q = q.filter(Deal.pipeline == pipeline.value)
    rows = q.all()
    total = sum(d.amount_cents for d in rows if d.status == DealStatus.open.value)
    weighted = sum(int(d.amount_cents * d.probability / 100) for d in rows if d.status == DealStatus.open.value)
    won = sum(d.amount_cents for d in rows if d.status == DealStatus.won.value)
    lost = sum(d.amount_cents for d in rows if d.status == DealStatus.lost.value)

    by_stage: dict[str, dict] = {}
    for d in rows:
        s = d.stage  # уже строка
        if s not in by_stage:
            by_stage[s] = {"count": 0, "amount_cents": 0, "weighted_amount_cents": 0}
        by_stage[s]["count"] += 1
        by_stage[s]["amount_cents"] += d.amount_cents
        by_stage[s]["weighted_amount_cents"] += int(d.amount_cents * d.probability / 100)

    return ForecastOut(
        currency=currency,
        total_amount_cents=total,
        weighted_amount_cents=weighted,
        won_amount_cents=won,
        lost_amount_cents=lost,
        open_count=sum(1 for d in rows if d.status == DealStatus.open.value),
        won_count=sum(1 for d in rows if d.status == DealStatus.won.value),
        lost_count=sum(1 for d in rows if d.status == DealStatus.lost.value),
        by_stage=by_stage,
    )


# =============================================================================
# Offtake
# =============================================================================

def _stage_index(stage: str) -> int:
    return [s.value for s in OFFTAKE_STAGE_ORDER].index(stage)


def _check_required_docs(db: Session, tenant_id: int, deal_id: Optional[int], target: str) -> None:
    """В «NDA подписан» и дальше — только с файлом NDA, в «Term Sheet согласован» и дальше — с Term Sheet.
    «Отказ» документов не требует."""
    if target == OfftakeStage.refused.value:
        return
    ti = _stage_index(target)
    for stage, kind in OFFTAKE_REQUIRED_DOCS:
        if ti < _stage_index(stage):
            continue
        has = False
        if deal_id:
            has = db.query(Document.id).filter(
                Document.tenant_id == tenant_id, Document.deal_id == deal_id, Document.doc_kind == kind,
            ).first() is not None
        if not has:
            raise HTTPException(
                400,
                f"Чтобы перейти в «{OFFTAKE_STAGE_LABEL[target]}», прикрепите к сделке файл {DEAL_DOC_KINDS[kind]}",
            )


def _apply_offtake(
    db: Session,
    ctx: TenantContext,
    row: Deal,
    data: dict,
    *,
    probability: Optional[int],
    probability_auto: bool,
) -> None:
    """Применяет поля offtake к сделке и проверяет правила стадий. Не коммитит.

    Вероятность: у «Подписан» всегда 100, у «Отказ» — 0. На остальных стадиях — значение
    по стадии, пока пользователь не задал своё (probability_manual=True); ручное значение
    смена стадии не перезаписывает. probability_auto=True возвращает значение по стадии.
    """
    if data.get("product_id"):
        ensure_owned(db, OfftakeProduct, data["product_id"], ctx.tenant.id, "Продукт")
    if data.get("price_type") not in (None, "fixed", "index"):
        raise HTTPException(400, "Неизвестный тип цены")
    if data.get("discount_unit") not in (None, "per_t", "pct"):
        raise HTTPException(400, "Скидка указывается за тонну или в процентах")
    if data.get("incoterms") is not None:
        data["incoterms"] = str(data["incoterms"]).strip().upper() or None
        if data["incoterms"] is not None and data["incoterms"] not in INCOTERMS:
            raise HTTPException(400, "Выберите условия поставки из списка Incoterms")
    if data.get("loss_reason") not in (None, *LOSS_REASONS.keys()):
        raise HTTPException(400, "Неизвестная причина отказа")

    target = data.pop("offtake_stage", None)
    target_v = target.value if isinstance(target, OfftakeStage) else target

    for f in ("product_id", "volume_tpy", "term_years", "start_year", "price_type", "price_value", "index_name",
              "discount_value", "discount_unit", "incoterms", "delivery_point", "loss_reason", "loss_comment"):
        if f in data:
            v = data[f]
            if isinstance(v, str):
                v = v.strip() or None
            if f == "product_id" and v == 0:
                v = None
            setattr(row, f, v)

    # Общий объём считает сервер
    if row.volume_tpy is not None and row.term_years:
        row.total_volume = (Decimal(row.volume_tpy) * row.term_years).quantize(Decimal("0.001"))
    else:
        row.total_volume = None
    # Сумма контракта при фиксированной цене: общий объём × цена за тонну
    if row.price_type == "fixed" and row.price_value is not None and row.total_volume is not None:
        cents = (Decimal(row.total_volume) * Decimal(row.price_value) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        row.amount_cents = min(int(cents), 10**17)

    if target_v is not None and target_v != row.offtake_stage:
        _check_required_docs(db, ctx.tenant.id, row.id, target_v)
        if target_v != OfftakeStage.refused.value and row.offtake_stage == OfftakeStage.refused.value:
            # Сделка вернулась в работу — причина отказа больше не актуальна
            row.loss_reason = None
            row.loss_comment = None
        row.offtake_stage = target_v
        row.stage = OFFTAKE_TO_SALES_STAGE[target_v]
        row.status = (
            DealStatus.won.value if target_v == OfftakeStage.signed.value
            else DealStatus.lost.value if target_v == OfftakeStage.refused.value
            else DealStatus.open.value
        )

    if row.offtake_stage == OfftakeStage.refused.value:
        if not row.loss_reason:
            raise HTTPException(400, "Укажите причину отказа")
        if row.loss_reason == "other" and not (row.loss_comment or "").strip():
            raise HTTPException(400, "Опишите причину отказа в комментарии")

    stage_default = OFFTAKE_STAGE_PROBABILITY[row.offtake_stage]
    if row.offtake_stage in (OfftakeStage.signed.value, OfftakeStage.refused.value) or probability_auto:
        row.probability = stage_default
        row.probability_manual = False
    elif probability is not None:
        p = max(0, min(100, probability))
        row.probability = p
        row.probability_manual = p != stage_default
    elif not row.probability_manual:
        row.probability = stage_default


class OfftakeStageOut(BaseModel):
    key: str
    label: str
    probability: int


class OfftakeSettingsOut(BaseModel):
    enabled: bool
    stages: list[OfftakeStageOut]
    loss_reasons: dict[str, str]
    doc_kinds: dict[str, str]
    incoterms: list[str]


class OfftakeSettingsIn(BaseModel):
    enabled: bool


def _offtake_settings(tenant: Tenant) -> OfftakeSettingsOut:
    return OfftakeSettingsOut(
        enabled=bool(tenant.offtake_enabled),
        stages=[
            OfftakeStageOut(key=s.value, label=OFFTAKE_STAGE_LABEL[s.value], probability=OFFTAKE_STAGE_PROBABILITY[s.value])
            for s in OFFTAKE_STAGE_ORDER
        ],
        loss_reasons=LOSS_REASONS,
        doc_kinds=DEAL_DOC_KINDS,
        incoterms=list(INCOTERMS),
    )


@router.get("/offtake/settings", response_model=OfftakeSettingsOut)
def get_offtake_settings(ctx: TenantContext = Depends(get_current_context)):
    return _offtake_settings(ctx.tenant)


@router.put("/offtake/settings", response_model=OfftakeSettingsOut)
def set_offtake_settings(
    payload: OfftakeSettingsIn,
    ctx: TenantContext = Depends(require("settings.system")),
    db: Session = Depends(get_db),
):
    tenant = db.get(Tenant, ctx.tenant.id)
    tenant.offtake_enabled = payload.enabled
    log_action(
        db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="tenant", entity_id=tenant.id,
        detail="Воронка offtake включена" if payload.enabled else "Воронка offtake выключена",
    )
    db.commit()
    db.refresh(tenant)
    return _offtake_settings(tenant)


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    is_active: bool
    order_index: int


class ProductIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ProductPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    is_active: Optional[bool] = None
    order_index: Optional[int] = None


@router.get("/offtake/products", response_model=list[ProductOut])
def list_products(ctx: TenantContext = Depends(get_current_context), db: Session = Depends(get_db)):
    return (
        db.query(OfftakeProduct)
        .filter(OfftakeProduct.tenant_id == ctx.tenant.id)
        .order_by(OfftakeProduct.order_index.asc(), OfftakeProduct.id.asc())
        .all()
    )


@router.post("/offtake/products", response_model=ProductOut, status_code=201)
def create_product(
    payload: ProductIn,
    ctx: TenantContext = Depends(require("settings.dictionaries")),
    db: Session = Depends(get_db),
):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Укажите название продукта")
    last = db.query(func.max(OfftakeProduct.order_index)).filter(OfftakeProduct.tenant_id == ctx.tenant.id).scalar()
    row = OfftakeProduct(tenant_id=ctx.tenant.id, name=name, is_active=True, order_index=(last or 0) + 1)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/offtake/products/{pid}", response_model=ProductOut)
def update_product(
    pid: int,
    payload: ProductPatch,
    ctx: TenantContext = Depends(require("settings.dictionaries")),
    db: Session = Depends(get_db),
):
    row = db.get(OfftakeProduct, pid)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Продукт не найден")
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(400, "Укажите название продукта")
        row.name = name
    if payload.is_active is not None:
        row.is_active = payload.is_active
    if payload.order_index is not None:
        row.order_index = payload.order_index
    db.commit()
    db.refresh(row)
    return row


class VolumeYear(BaseModel):
    year: int
    total: float
    by_product: dict[str, float]  # ключ — id продукта или "none" (продукт не указан)


class ContractedVolumeOut(BaseModel):
    years: list[VolumeYear]
    products: list[ProductBrief]
    deals_count: int


@router.get("/offtake/contracted-volume", response_model=ContractedVolumeOut)
def contracted_volume(
    legal_entity_id: Optional[int] = None,
    ctx: TenantContext = Depends(require("deals.view")),
    db: Session = Depends(get_db),
):
    """Законтрактованный объём (т) по календарным годам: подписанные offtake-сделки,
    volume_tpy за каждый год с start_year по start_year + term_years − 1."""
    q = db.query(Deal).filter(
        Deal.tenant_id == ctx.tenant.id,
        Deal.pipeline == DealPipeline.offtake.value,
        Deal.offtake_stage == OfftakeStage.signed.value,
        Deal.volume_tpy.isnot(None),
        Deal.start_year.isnot(None),
        Deal.term_years.isnot(None),
    )
    if legal_entity_id is not None:
        q = q.filter(Deal.legal_entity_id == legal_entity_id)
    rows = q.all()
    years: dict[int, dict[str, Decimal]] = {}
    used_products: set[int] = set()
    for d in rows:
        key = str(d.product_id) if d.product_id else "none"
        if d.product_id:
            used_products.add(d.product_id)
        for y in range(d.start_year, d.start_year + max(0, min(d.term_years, 100))):
            bucket = years.setdefault(y, {})
            bucket[key] = bucket.get(key, Decimal(0)) + Decimal(d.volume_tpy)
    out_years: list[VolumeYear] = []
    if years:
        for y in range(min(years), max(years) + 1):  # без пропусков между годами
            b = years.get(y, {})
            out_years.append(VolumeYear(
                year=y,
                total=float(sum(b.values(), Decimal(0))),
                by_product={k: float(v) for k, v in b.items()},
            ))
    products = []
    if used_products:
        products = (
            db.query(OfftakeProduct)
            .filter(OfftakeProduct.tenant_id == ctx.tenant.id, OfftakeProduct.id.in_(used_products))
            .order_by(OfftakeProduct.order_index.asc(), OfftakeProduct.id.asc())
            .all()
        )
    return ContractedVolumeOut(years=out_years, products=products, deals_count=len(rows))


@router.post("", response_model=DealOut, status_code=201)
def create_deal(
    payload: DealCreate,
    ctx: TenantContext = Depends(require("deals.create")),
    db: Session = Depends(get_db),
):
    prob = payload.probability if payload.probability is not None else STAGE_PROBABILITY.get(payload.stage, 10)
    status_v = DealStatus.open.value
    if payload.stage == DealStage.won:
        status_v = DealStatus.won.value
    elif payload.stage == DealStage.lost:
        status_v = DealStatus.lost.value

    is_offtake = payload.pipeline == DealPipeline.offtake
    if is_offtake and not ctx.tenant.offtake_enabled:
        raise HTTPException(400, "Воронка offtake выключена в настройках компании")

    ensure_owned(db, Contact, payload.contact_id, ctx.tenant.id, "Контакт")
    ensure_owned(db, Company, payload.company_id, ctx.tenant.id, "Компания")
    ensure_member(db, ctx.tenant.id, payload.owner_id, "Ответственный")
    row = Deal(
        tenant_id=ctx.tenant.id,
        title=payload.title,
        amount_cents=payload.amount_cents,
        currency=payload.currency,
        stage=payload.stage.value,
        status=status_v,
        probability=prob,
        close_date=payload.close_date,
        contact_id=payload.contact_id or None,
        company_id=payload.company_id or None,
        owner_id=payload.owner_id or ctx.user.id,
        note=payload.note,
        legal_entity_id=resolve_legal_entity_id(db, ctx.tenant.id, payload.legal_entity_id),
        pipeline=payload.pipeline.value,
    )
    if is_offtake:
        if "currency" not in payload.model_fields_set:
            row.currency = "USD"
        data = payload.model_dump(include=set(OFFTAKE_FIELD_NAMES), exclude_unset=True)
        if data.get("offtake_stage") is None:
            data["offtake_stage"] = OfftakeStage.initial_contact
        row.probability_manual = False
        _apply_offtake(db, ctx, row, data, probability=payload.probability, probability_auto=False)
    db.add(row)
    db.flush()
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="create", entity="deal", entity_id=row.id, detail=row.title)
    db.commit()
    db.refresh(row)
    return row


@router.get("/{did}", response_model=DealOut)
def get_deal(did: int, ctx: TenantContext = Depends(require("deals.view")), db: Session = Depends(get_db)):
    row = db.get(Deal, did)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Сделка не найдена")
    return row


@router.patch("/{did}", response_model=DealOut)
def update_deal(
    did: int,
    payload: DealUpdate,
    ctx: TenantContext = Depends(require("deals.update")),
    db: Session = Depends(get_db),
):
    row = db.get(Deal, did)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Сделка не найдена")

    changed_stage = payload.stage is not None and payload.stage.value != row.stage
    ensure_owned(db, Contact, payload.contact_id, ctx.tenant.id, "Контакт")
    ensure_owned(db, Company, payload.company_id, ctx.tenant.id, "Компания")
    ensure_member(db, ctx.tenant.id, payload.owner_id, "Ответственный")

    if payload.legal_entity_id is not None:
        row.legal_entity_id = resolve_legal_entity_id(db, ctx.tenant.id, payload.legal_entity_id, current_id=row.legal_entity_id)

    for f in ("title", "amount_cents", "currency", "close_date", "contact_id", "company_id", "owner_id", "note", "order_index"):
        v = getattr(payload, f)
        if v is not None:
            if f in ("contact_id", "company_id") and v == 0:
                v = None  # 0 — снять связь
            setattr(row, f, v)

    if row.pipeline == DealPipeline.offtake.value:
        # Стадии обычной воронки к offtake-сделке не применяются: stage выводится из offtake_stage.
        data = payload.model_dump(include=set(OFFTAKE_FIELD_NAMES), exclude_unset=True)
        if "offtake_stage" in data and data["offtake_stage"] is None:
            data.pop("offtake_stage")
        _apply_offtake(db, ctx, row, data, probability=payload.probability, probability_auto=bool(payload.probability_auto))
        log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="deal", entity_id=row.id)
        db.commit()
        db.refresh(row)
        return row

    if changed_stage:
        row.stage = payload.stage.value
        # авто-статус и авто-вероятность (если явно не указана)
        if payload.probability is None:
            row.probability = STAGE_PROBABILITY.get(payload.stage, row.probability)
        if payload.stage == DealStage.won:
            row.status = DealStatus.won.value
        elif payload.stage == DealStage.lost:
            row.status = DealStatus.lost.value
        else:
            row.status = DealStatus.open.value

    if payload.probability is not None:
        row.probability = max(0, min(100, payload.probability))

    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="update", entity="deal", entity_id=row.id)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{did}", response_model=Message)
def delete_deal(did: int, ctx: TenantContext = Depends(require("deals.delete")), db: Session = Depends(get_db)):
    row = db.get(Deal, did)
    if not row or row.tenant_id != ctx.tenant.id:
        raise HTTPException(404, "Сделка не найдена")
    log_action(db, tenant_id=ctx.tenant.id, user_id=ctx.user.id, action="delete", entity="deal", entity_id=row.id, detail=row.title)
    db.delete(row)
    db.commit()
    return Message(message="Сделка удалена")
