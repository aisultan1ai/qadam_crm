from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, EmailStr


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


class CompanyOut(CompanyBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    owner: Optional[UserBrief] = None
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
