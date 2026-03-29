"""Saved Places API — personal favourite locations (Home, Work, frequent destinations)."""

import json
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.db.database import get_db

log = logging.getLogger("moto-gps.places")

router = APIRouter(tags=["places"])


class SavePlaceRequest(BaseModel):
    name: str
    lat: float
    lng: float
    icon: str = "📍"
    category: str = "favourite"  # favourite, home, work, frequent
    address: str | None = None


class UpdatePlaceRequest(BaseModel):
    name: str | None = None
    icon: str | None = None
    category: str | None = None
    address: str | None = None
    lat: float | None = None
    lng: float | None = None


@router.get("/places")
async def list_places(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all saved places for the current user, ordered by sort_order then name."""
    result = await db.execute(
        text("""
            SELECT id, name, lat, lng, icon, category, address, sort_order, created_at
            FROM saved_places WHERE user_id = :uid
            ORDER BY sort_order ASC, name ASC
        """),
        {"uid": user["id"]},
    )
    rows = result.fetchall()
    return [
        {
            "id": str(r.id),
            "name": r.name,
            "lat": r.lat,
            "lng": r.lng,
            "icon": r.icon,
            "category": r.category,
            "address": r.address,
        }
        for r in rows
    ]


@router.post("/places")
async def create_place(
    req: SavePlaceRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save a new favourite place."""
    result = await db.execute(
        text("""
            INSERT INTO saved_places (user_id, name, lat, lng, icon, category, address)
            VALUES (:uid, :name, :lat, :lng, :icon, :category, :address)
            RETURNING id
        """),
        {
            "uid": user["id"],
            "name": req.name.strip(),
            "lat": req.lat,
            "lng": req.lng,
            "icon": req.icon,
            "category": req.category,
            "address": req.address,
        },
    )
    await db.commit()
    row = result.fetchone()
    return {"id": str(row.id), "created": True}


@router.patch("/places/{place_id}")
async def update_place(
    place_id: UUID,
    req: UpdatePlaceRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a saved place."""
    updates = []
    params: dict = {"id": str(place_id), "uid": user["id"]}
    for field in ["name", "icon", "category", "address", "lat", "lng"]:
        val = getattr(req, field)
        if val is not None:
            updates.append(f"{field} = :{field}")
            params[field] = val

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    query = f"UPDATE saved_places SET {', '.join(updates)} WHERE id = :id AND user_id = :uid RETURNING id"
    result = await db.execute(text(query), params)
    await db.commit()
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Place not found")
    return {"updated": True}


@router.delete("/places/{place_id}")
async def delete_place(
    place_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a saved place."""
    result = await db.execute(
        text("DELETE FROM saved_places WHERE id = :id AND user_id = :uid RETURNING id"),
        {"id": str(place_id), "uid": user["id"]},
    )
    await db.commit()
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Place not found")
    return {"deleted": True}
