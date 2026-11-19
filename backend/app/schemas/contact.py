from datetime import datetime
from typing import Literal, Optional, List
from pydantic import BaseModel, ConfigDict, EmailStr, field_validator

# Типы контрагента (можно несколько) и статусы — коды; подписи на клиенте.
COMPANY_TYPES = ("buyer", "epc", "supplier", "consultant", "bank", "government")
CompanyStatus = Literal["potential", "nda", "active", "blocked"]


def _check_types(v: Optional[List[str]]) -> Optional[List[str]]:
    if v is None:
        return v
    out: List[str] = []
    for t in v:
        if t not in COMPANY_TYPES:
            raise ValueError("Неизвестный тип контрагента")
        if t not in out:
            out.append(t)
    return out


class UserBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: str
    avatar_url: Optional[str] = None


# --- Company ---

class CompanyBase(BaseModel):
    name: str
    industry: Optional[str] = None
    website: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    tax_id: Optional[str] = None
    address: Optional[str] = None
    note: Optional[str] = None
    owner_id: Optional[int] = None
    country: Optional[str] = "Казахстан"
    registration_number: Optional[str] = None
    types: List[str] = []
    responsible_user_id: Optional[int] = None
    status: CompanyStatus = "potential"

    _v_types = field_validator("types")(_check_types)


class CompanyCreate(CompanyBase):
    pass


class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    industry: Optional[str] = None
    website: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    tax_id: Optional[str] = None
    address: Optional[str] = None
    note: Optional[str] = None
    owner_id: Optional[int] = None
    country: Optional[str] = None
    registration_number: Optional[str] = None
    types: Optional[List[str]] = None
    responsible_user_id: Optional[int] = None  # 0 — снять ответственного
    status: Optional[CompanyStatus] = None

    _v_types = field_validator("types")(_check_types)


class CompanyOut(CompanyBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    owner: Optional[UserBrief] = None
    responsible: Optional[UserBrief] = None
    contacts_count: int = 0
    created_at: datetime


# --- Contact ---

class ContactBase(BaseModel):
    first_name: str
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    position: Optional[str] = None
    note: Optional[str] = None
    source: Optional[str] = None
    company_id: Optional[int] = None
    owner_id: Optional[int] = None


class ContactCreate(ContactBase):
    pass


class ContactUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    position: Optional[str] = None
    note: Optional[str] = None
    source: Optional[str] = None
    company_id: Optional[int] = None
    owner_id: Optional[int] = None


class CompanyBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class ContactOut(ContactBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company: Optional[CompanyBrief] = None
    owner: Optional[UserBrief] = None
    created_at: datetime
