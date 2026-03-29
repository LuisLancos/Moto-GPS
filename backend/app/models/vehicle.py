"""Vehicle models."""

from pydantic import BaseModel, field_validator


class VehicleCreate(BaseModel):
    type: str = "Motorcycle"
    brand: str
    model: str
    year: int | None = None
    picture_base64: str | None = None
    is_default: bool = False
    fuel_type: str = "petrol"                  # petrol, diesel, ev
    consumption: float | None = None           # raw value in consumption_unit
    consumption_unit: str = "mpg"              # mpg, l100km, kwhper100km
    tank_capacity: float | None = None         # litres or kWh
    fuel_cost_per_unit: float | None = None    # £/litre or £/kWh
    fuel_cost_currency: str = "GBP"            # GBP, EUR, USD

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
    fuel_type: str | None = None
    consumption: float | None = None
    consumption_unit: str | None = None
    tank_capacity: float | None = None
    fuel_cost_per_unit: float | None = None
    fuel_cost_currency: str | None = None

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
    fuel_type: str = "petrol"
    consumption: float | None = None
    consumption_unit: str = "mpg"
    tank_capacity: float | None = None
    fuel_cost_per_unit: float | None = None
    fuel_cost_currency: str = "GBP"
    created_at: str
