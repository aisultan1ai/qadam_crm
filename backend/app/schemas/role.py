from pydantic import BaseModel, ConfigDict
from typing import List, Optional


class PermissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    name: str
    group: str


class PermissionGroupOut(BaseModel):
    group: str
    items: List[PermissionOut]


class RoleBase(BaseModel):
    name: str
    description: Optional[str] = None


class RoleCreate(RoleBase):
    permission_codes: List[str] = []


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    permission_codes: Optional[List[str]] = None


class RoleOut(RoleBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    permissions: List[PermissionOut] = []
    users_count: int = 0
