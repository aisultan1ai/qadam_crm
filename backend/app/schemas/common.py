from pydantic import BaseModel


class Message(BaseModel):
    message: str


class IdOnly(BaseModel):
    id: int
