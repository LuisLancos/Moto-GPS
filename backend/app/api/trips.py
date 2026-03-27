"""Saved trips CRUD API."""

import json
from uuid import UUID

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db

router = APIRouter()


# ---------- Models ----------

class SaveTripRequest(BaseModel):
    name: str
    description: str | None = None
    route_type: str = "balanced"
    waypoints: list[dict]  # [{lat, lng, label?}]
    preferences: dict  # full RoutePreferences dict
    selected_route: dict | None = None  # the chosen RouteResult
    total_distance_m: float | None = None
    total_time_s: float | None = None
    total_moto_score: float | None = None


class UpdateTripRequest(BaseModel):
    name: str | None = None
    description: str | None = None


class TripSummary(BaseModel):
    id: str
    name: str
    description: str | None
    route_type: str
    total_distance_m: float | None
    total_time_s: float | None
    total_moto_score: float | None
    waypoint_count: int
    created_at: str
    updated_at: str


class TripDetail(TripSummary):
    waypoints: list[dict]
    preferences: dict
    route_data: dict | None


# ---------- Endpoints ----------

@router.get("/trips", response_model=list[TripSummary])
async def list_trips(db: AsyncSession = Depends(get_db)):
    """List all saved trips, newest first."""
    result = await db.execute(text("""
        SELECT id, name, description, route_type,
               total_distance_m, total_time_s, total_moto_score,
               waypoints, created_at, updated_at
        FROM saved_routes
        ORDER BY created_at DESC
    """))
    rows = result.fetchall()
    return [
        TripSummary(
            id=str(row.id),
            name=row.name,
            description=row.description,
            route_type=row.route_type or "balanced",
            total_distance_m=row.total_distance_m,
            total_time_s=row.total_time_s,
            total_moto_score=row.total_moto_score,
            waypoint_count=len(row.waypoints) if row.waypoints else 0,
            created_at=row.created_at.isoformat() if row.created_at else "",
            updated_at=row.updated_at.isoformat() if row.updated_at else "",
        )
        for row in rows
    ]


@router.get("/trips/{trip_id}", response_model=TripDetail)
async def get_trip(trip_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get a single trip with full route data."""
    result = await db.execute(
        text("""
            SELECT id, name, description, route_type,
                   total_distance_m, total_time_s, total_moto_score,
                   waypoints, preferences, route_data,
                   created_at, updated_at
            FROM saved_routes WHERE id = :id
        """),
        {"id": str(trip_id)},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Trip not found")

    return TripDetail(
        id=str(row.id),
        name=row.name,
        description=row.description,
        route_type=row.route_type or "balanced",
        total_distance_m=row.total_distance_m,
        total_time_s=row.total_time_s,
        total_moto_score=row.total_moto_score,
        waypoint_count=len(row.waypoints) if row.waypoints else 0,
        waypoints=row.waypoints or [],
        preferences=row.preferences or {},
        route_data=row.route_data,
        created_at=row.created_at.isoformat() if row.created_at else "",
        updated_at=row.updated_at.isoformat() if row.updated_at else "",
    )


@router.post("/trips", response_model=TripDetail)
async def save_trip(req: SaveTripRequest, db: AsyncSession = Depends(get_db)):
    """Save a new trip."""
    result = await db.execute(
        text("""
            INSERT INTO saved_routes (name, description, route_type, waypoints, preferences,
                                      route_data, total_distance_m, total_time_s, total_moto_score)
            VALUES (:name, :description, :route_type, CAST(:waypoints AS jsonb), CAST(:preferences AS jsonb),
                    CAST(:route_data AS jsonb), :distance, :time, :score)
            RETURNING id, name, description, route_type,
                      total_distance_m, total_time_s, total_moto_score,
                      waypoints, preferences, route_data,
                      created_at, updated_at
        """),
        {
            "name": req.name.strip(),
            "description": (req.description or "").strip() or None,
            "route_type": req.route_type,
            "waypoints": json.dumps(req.waypoints),
            "preferences": json.dumps(req.preferences),
            "route_data": json.dumps(req.selected_route) if req.selected_route else None,
            "distance": req.total_distance_m,
            "time": req.total_time_s,
            "score": req.total_moto_score,
        },
    )
    await db.commit()
    row = result.fetchone()

    return TripDetail(
        id=str(row.id),
        name=row.name,
        description=row.description,
        route_type=row.route_type or "balanced",
        total_distance_m=row.total_distance_m,
        total_time_s=row.total_time_s,
        total_moto_score=row.total_moto_score,
        waypoint_count=len(row.waypoints) if row.waypoints else 0,
        waypoints=row.waypoints or [],
        preferences=row.preferences or {},
        route_data=row.route_data,
        created_at=row.created_at.isoformat() if row.created_at else "",
        updated_at=row.updated_at.isoformat() if row.updated_at else "",
    )


@router.patch("/trips/{trip_id}", response_model=TripSummary)
async def update_trip(trip_id: UUID, req: UpdateTripRequest, db: AsyncSession = Depends(get_db)):
    """Update trip name/description."""
    sets = []
    params: dict = {"id": str(trip_id)}
    if req.name is not None:
        sets.append("name = :name")
        params["name"] = req.name.strip()
    if req.description is not None:
        sets.append("description = :description")
        params["description"] = req.description.strip() or None
    if not sets:
        raise HTTPException(status_code=400, detail="Nothing to update")

    sets.append("updated_at = NOW()")
    result = await db.execute(
        text(f"""
            UPDATE saved_routes SET {', '.join(sets)}
            WHERE id = :id
            RETURNING id, name, description, route_type,
                      total_distance_m, total_time_s, total_moto_score,
                      waypoints, created_at, updated_at
        """),
        params,
    )
    await db.commit()
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Trip not found")

    return TripSummary(
        id=str(row.id),
        name=row.name,
        description=row.description,
        route_type=row.route_type or "balanced",
        total_distance_m=row.total_distance_m,
        total_time_s=row.total_time_s,
        total_moto_score=row.total_moto_score,
        waypoint_count=len(row.waypoints) if row.waypoints else 0,
        created_at=row.created_at.isoformat() if row.created_at else "",
        updated_at=row.updated_at.isoformat() if row.updated_at else "",
    )


@router.delete("/trips/{trip_id}")
async def delete_trip(trip_id: UUID, db: AsyncSession = Depends(get_db)):
    """Delete a saved trip."""
    result = await db.execute(
        text("DELETE FROM saved_routes WHERE id = :id RETURNING id"),
        {"id": str(trip_id)},
    )
    await db.commit()
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Trip not found")
    return {"deleted": str(row.id)}
