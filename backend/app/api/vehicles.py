"""Vehicles CRUD API."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.auth.dependencies import get_current_user
from app.models.vehicle import VehicleCreate, VehicleUpdate, VehicleResponse

router = APIRouter(tags=["vehicles"])

_VEHICLE_COLS = (
    "id, type, brand, model, year, picture_base64, is_default, "
    "fuel_type, consumption, consumption_unit, tank_capacity, "
    "fuel_cost_per_unit, fuel_cost_currency, created_at"
)


def _row_to_response(r) -> VehicleResponse:
    return VehicleResponse(
        id=str(r.id),
        type=r.type,
        brand=r.brand,
        model=r.model,
        year=r.year,
        picture_base64=r.picture_base64,
        is_default=r.is_default,
        fuel_type=r.fuel_type or "petrol",
        consumption=r.consumption,
        consumption_unit=r.consumption_unit or "mpg",
        tank_capacity=r.tank_capacity,
        fuel_cost_per_unit=r.fuel_cost_per_unit,
        fuel_cost_currency=r.fuel_cost_currency or "GBP",
        created_at=r.created_at.isoformat() if r.created_at else "",
    )


@router.get("/vehicles", response_model=list[VehicleResponse])
async def list_vehicles(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all vehicles for the current user."""
    result = await db.execute(
        text(
            f"SELECT {_VEHICLE_COLS} "
            "FROM vehicles WHERE user_id = :uid ORDER BY is_default DESC, created_at DESC"
        ),
        {"uid": user["id"]},
    )
    return [_row_to_response(r) for r in result.fetchall()]


@router.post("/vehicles", response_model=VehicleResponse)
async def create_vehicle(
    req: VehicleCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new vehicle."""
    # If setting as default, unset other defaults
    if req.is_default:
        await db.execute(
            text("UPDATE vehicles SET is_default = FALSE WHERE user_id = :uid"),
            {"uid": user["id"]},
        )

    result = await db.execute(
        text(
            "INSERT INTO vehicles (user_id, type, brand, model, year, picture_base64, is_default, "
            "fuel_type, consumption, consumption_unit, tank_capacity, fuel_cost_per_unit, fuel_cost_currency) "
            "VALUES (:uid, :type, :brand, :model, :year, :picture, :is_default, "
            ":fuel_type, :consumption, :consumption_unit, :tank_capacity, :fuel_cost_per_unit, :fuel_cost_currency) "
            f"RETURNING {_VEHICLE_COLS}"
        ),
        {
            "uid": user["id"],
            "type": req.type,
            "brand": req.brand,
            "model": req.model,
            "year": req.year,
            "picture": req.picture_base64,
            "is_default": req.is_default,
            "fuel_type": req.fuel_type,
            "consumption": req.consumption,
            "consumption_unit": req.consumption_unit,
            "tank_capacity": req.tank_capacity,
            "fuel_cost_per_unit": req.fuel_cost_per_unit,
            "fuel_cost_currency": req.fuel_cost_currency,
        },
    )
    await db.commit()
    return _row_to_response(result.fetchone())


@router.patch("/vehicles/{vehicle_id}", response_model=VehicleResponse)
async def update_vehicle(
    vehicle_id: UUID,
    req: VehicleUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a vehicle."""
    updates = {}
    for field in ("type", "brand", "model", "year", "picture_base64", "is_default",
                   "fuel_type", "consumption", "consumption_unit", "tank_capacity",
                   "fuel_cost_per_unit", "fuel_cost_currency"):
        val = getattr(req, field, None)
        if val is not None:
            updates[field] = val

    if req.is_default is not None and req.is_default:
            # Unset other defaults first
            await db.execute(
                text("UPDATE vehicles SET is_default = FALSE WHERE user_id = :uid AND id != :vid"),
                {"uid": user["id"], "vid": str(vehicle_id)},
            )

    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")

    set_parts = ", ".join(f"{k} = :{k}" for k in updates)
    updates["uid"] = user["id"]
    updates["vid"] = str(vehicle_id)
    result = await db.execute(
        text(
            f"UPDATE vehicles SET {set_parts}, updated_at = NOW() "
            f"WHERE id = :vid AND user_id = :uid "
            f"RETURNING {_VEHICLE_COLS}"
        ),
        updates,
    )
    await db.commit()
    r = result.fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return _row_to_response(r)


@router.delete("/vehicles/{vehicle_id}")
async def delete_vehicle(
    vehicle_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a vehicle."""
    result = await db.execute(
        text("DELETE FROM vehicles WHERE id = :vid AND user_id = :uid RETURNING id"),
        {"vid": str(vehicle_id), "uid": user["id"]},
    )
    await db.commit()
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return {"deleted": True}
