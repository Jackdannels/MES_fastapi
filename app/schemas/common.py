from typing import Optional

from pydantic import BaseModel, Field


class EntityBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    code: Optional[str] = Field(default=None, max_length=50)
    description: Optional[str] = Field(default=None, max_length=500)
    status: Optional[str] = Field(default="active", max_length=20)


class EntityCreate(EntityBase):
    pass


class EntityUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    code: Optional[str] = Field(default=None, max_length=50)
    description: Optional[str] = Field(default=None, max_length=500)
    status: Optional[str] = Field(default=None, max_length=20)


class EntityOut(EntityBase):
    id: int
