"""Vehicle models."""

from pydantic import BaseModel, field_validator


class VehicleCreate(BaseModel):
    type: str = "Motorcycle"
    brand: str
    model: str
    year: int | None = None
    picture_base64: str | None = None
    is_default: bool = False

    @field_validator("picture_base64")
    @classmethod
    def check_picture_size(cls, v: str | None) -> str | None:
        if v and len(v) > 2_700_000:  # ~2MB file as base64
            raise ValueError("Image too large (max ~2MB)")
        return v


class VehicleUpdate(BaseModel):
    type: str | None = None
    brand: str | None = None
    model: str | None = None
    year: int | None = None
    picture_base64: str | None = None
    is_default: bool | None = None

    @field_validator("picture_base64")
    @classmethod
    def check_picture_size(cls, v: str | None) -> str | None:
        if v and len(v) > 2_700_000:
            raise ValueError("Image too large (max ~2MB)")
        return v


class VehicleResponse(BaseModel):
    id: str
    type: str
    brand: str
    model: str
    year: int | None
    picture_base64: str | None
    is_default: bool
    created_at: str
