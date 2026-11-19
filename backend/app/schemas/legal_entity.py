from pydantic import BaseModel, ConfigDict


class LegalEntityBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    short_name: str
