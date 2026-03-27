"""Vehicles CRUD API."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.auth.dependencies import get_current_user
from app.models.vehicle import VehicleCreate, VehicleUpdate, VehicleResponse

router = APIRouter(tags=["vehicles"])


@router.get("/vehicles", response_model=list[VehicleResponse])
async def list_vehicles(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all vehicles for the current user."""
    result = await db.execute(
        text(
            "SELECT id, type, brand, model, year, picture_base64, is_default, created_at "
            "FROM vehicles WHERE user_id = :uid ORDER BY is_default DESC, created_at DESC"
        ),
        {"uid": user["id"]},
    )
    return [
        VehicleResponse(
            id=str(r.id),
            type=r.type,
            brand=r.brand,
            model=r.model,
            year=r.year,
            picture_base64=r.picture_base64,
            is_default=r.is_default,
            created_at=r.created_at.isoformat() if r.created_at else "",
        )
        for r in result.fetchall()
    ]


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
            "INSERT INTO vehicles (user_id, type, brand, model, year, picture_base64, is_default) "
            "VALUES (:uid, :type, :brand, :model, :year, :picture, :is_default) "
            "RETURNING id, type, brand, model, year, picture_base64, is_default, created_at"
        ),
        {
            "uid": user["id"],
            "type": req.type,
            "brand": req.brand,
            "model": req.model,
            "year": req.year,
            "picture": req.picture_base64,
            "is_default": req.is_default,
        },
    )
    await db.commit()
    r = result.fetchone()

    return VehicleResponse(
        id=str(r.id),
        type=r.type,
        brand=r.brand,
        model=r.model,
        year=r.year,
        picture_base64=r.picture_base64,
        is_default=r.is_default,
        created_at=r.created_at.isoformat() if r.created_at else "",
    )


@router.patch("/vehicles/{vehicle_id}", response_model=VehicleResponse)
async def update_vehicle(
    vehicle_id: UUID,
    req: VehicleUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a vehicle."""
    updates = {}
    if req.type is not None:
        updates["type"] = req.type
    if req.brand is not None:
        updates["brand"] = req.brand
    if req.model is not None:
        updates["model"] = req.model
    if req.year is not None:
        updates["year"] = req.year
    if req.picture_base64 is not None:
        updates["picture_base64"] = req.picture_base64
    if req.is_default is not None:
        updates["is_default"] = req.is_default
        if req.is_default:
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
            f"RETURNING id, type, brand, model, year, picture_base64, is_default, created_at"
        ),
        updates,
    )
    await db.commit()
    r = result.fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    return VehicleResponse(
        id=str(r.id),
        type=r.type,
        brand=r.brand,
        model=r.model,
        year=r.year,
        picture_base64=r.picture_base64,
        is_default=r.is_default,
        created_at=r.created_at.isoformat() if r.created_at else "",
    )


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
