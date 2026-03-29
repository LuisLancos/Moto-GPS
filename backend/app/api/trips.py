"""Saved trips CRUD API."""

import json
from uuid import UUID

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.auth.dependencies import get_optional_user

router = APIRouter()


# ---------- Models ----------

class SaveTripRequest(BaseModel):
    name: str
    description: str | None = None
    route_type: str = "balanced"
    waypoints: list[dict]  # [{lat, lng, label?}]
    preferences: dict  # full RoutePreferences dict
    route_data: dict | None = None  # full RouteResult as dict
    total_distance_m: float | None = None
    total_time_s: float | None = None
    total_moto_score: float | None = None


class UpdateTripRequest(BaseModel):
    name: str | None = None
    description: str | None = None


class SharedGroupInfo(BaseModel):
    id: str
    name: str
    shared_item_id: str  # needed for unshare


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
    shared_with_groups: list[SharedGroupInfo] = []
    ownership: str = "owned"  # "owned" | "shared_editor" | "shared_viewer"
    owner_name: str | None = None  # shown for shared trips


class TripDetail(TripSummary):
    waypoints: list[dict]
    preferences: dict
    route_data: dict | None


# ---------- Endpoints ----------

@router.get("/trips", response_model=list[TripSummary])
async def list_trips(
    db: AsyncSession = Depends(get_db),
    user: dict | None = Depends(get_optional_user),
):
    """List saved trips: user's own + group-shared trips."""
    if user:
        # Own trips + trips shared via groups (with best role per trip)
        result = await db.execute(
            text("""
                SELECT id, name, description, route_type,
                       total_distance_m, total_time_s, total_moto_score,
                       waypoints, created_at, updated_at, user_id, ownership, owner_name
                FROM (
                    SELECT sr.id, sr.name, sr.description, sr.route_type,
                           sr.total_distance_m, sr.total_time_s, sr.total_moto_score,
                           sr.waypoints, sr.created_at, sr.updated_at, sr.user_id,
                           'owned'::text AS ownership, NULL::text AS owner_name
                    FROM saved_routes sr
                    WHERE sr.user_id = :uid
                ) owned
                UNION ALL
                SELECT id, name, description, route_type,
                       total_distance_m, total_time_s, total_moto_score,
                       waypoints, created_at, updated_at, user_id, ownership, owner_name
                FROM (
                    SELECT DISTINCT ON (sr.id)
                           sr.id, sr.name, sr.description, sr.route_type,
                           sr.total_distance_m, sr.total_time_s, sr.total_moto_score,
                           sr.waypoints, sr.created_at, sr.updated_at, sr.user_id,
                           CASE WHEN gm.role IN ('owner', 'editor') THEN 'shared_editor'
                                ELSE 'shared_viewer' END AS ownership,
                           owner_user.name AS owner_name
                    FROM saved_routes sr
                    JOIN group_shared_items gsi ON gsi.item_id = sr.id AND gsi.item_type = 'route'
                    JOIN group_members gm ON gm.group_id = gsi.group_id AND gm.user_id = :uid
                    LEFT JOIN users owner_user ON owner_user.id = sr.user_id
                    WHERE (sr.user_id IS NULL OR sr.user_id != :uid)
                    ORDER BY sr.id, ownership ASC
                ) shared
            """),
            {"uid": user["id"]},
        )
    else:
        result = await db.execute(text("""
            SELECT id, name, description, route_type,
                   total_distance_m, total_time_s, total_moto_score,
                   waypoints, created_at, updated_at, user_id,
                   'owned' AS ownership, NULL AS owner_name
            FROM saved_routes
            ORDER BY created_at DESC
        """))
    rows = result.fetchall()

    # Deduplicate (UNION ALL might return same trip if shared in multiple groups)
    seen: set[str] = set()
    unique_rows = []
    for row in rows:
        rid = str(row.id)
        if rid not in seen:
            seen.add(rid)
            unique_rows.append(row)

    # Sort: owned first, then shared, by created_at desc
    unique_rows.sort(key=lambda r: (0 if r.ownership == "owned" else 1, r.created_at or ""), reverse=False)
    unique_rows.sort(key=lambda r: r.created_at or "", reverse=True)

    # Batch-fetch shared groups for all routes
    route_ids = [str(row.id) for row in unique_rows]
    shared_map: dict[str, list[SharedGroupInfo]] = {rid: [] for rid in route_ids}
    if route_ids:
        shared_result = await db.execute(
            text("""
                SELECT gsi.item_id, gsi.id AS shared_item_id,
                       g.id AS group_id, g.name AS group_name
                FROM group_shared_items gsi
                JOIN adventure_groups g ON g.id = gsi.group_id
                WHERE gsi.item_type = 'route' AND gsi.item_id = ANY(:ids)
            """),
            {"ids": route_ids},
        )
        for s in shared_result.fetchall():
            item_id = str(s.item_id)
            if item_id in shared_map:
                shared_map[item_id].append(SharedGroupInfo(
                    id=str(s.group_id), name=s.group_name,
                    shared_item_id=str(s.shared_item_id),
                ))

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
            shared_with_groups=shared_map.get(str(row.id), []),
            ownership=row.ownership,
            owner_name=row.owner_name,
        )
        for row in unique_rows
    ]


@router.get("/trips/{trip_id}", response_model=TripDetail)
async def get_trip(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: dict | None = Depends(get_optional_user),
):
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
async def save_trip(
    req: SaveTripRequest,
    db: AsyncSession = Depends(get_db),
    user: dict | None = Depends(get_optional_user),
):
    """Save a new trip."""
    result = await db.execute(
        text("""
            INSERT INTO saved_routes (name, description, route_type, waypoints, preferences,
                                      route_data, total_distance_m, total_time_s, total_moto_score, user_id)
            VALUES (:name, :description, :route_type, CAST(:waypoints AS jsonb), CAST(:preferences AS jsonb),
                    CAST(:route_data AS jsonb), :distance, :time, :score, :uid)
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
            "route_data": json.dumps(req.route_data) if req.route_data else None,
            "distance": req.total_distance_m,
            "time": req.total_time_s,
            "score": req.total_moto_score,
            "uid": user["id"] if user else None,
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
async def update_trip(
    trip_id: UUID,
    req: UpdateTripRequest,
    db: AsyncSession = Depends(get_db),
    user: dict | None = Depends(get_optional_user),
):
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
    # Ownership check: only trip owner (or unowned trips) can update
    ownership = " AND (user_id = :uid OR user_id IS NULL)" if user else ""
    if user:
        params["uid"] = user["id"]
    result = await db.execute(
        text(f"""
            UPDATE saved_routes SET {', '.join(sets)}
            WHERE id = :id{ownership}
            RETURNING id, name, description, route_type,
                      total_distance_m, total_time_s, total_moto_score,
                      waypoints, created_at, updated_at
        """),
        params,
    )
    await db.commit()
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Trip not found or access denied")

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


@router.put("/trips/{trip_id}")
async def overwrite_trip(
    trip_id: UUID,
    req: SaveTripRequest,
    db: AsyncSession = Depends(get_db),
    user: dict | None = Depends(get_optional_user),
):
    """Full overwrite of a saved route (waypoints, route data, preferences, etc.)."""
    # Ownership check
    ownership = " AND (user_id = :uid OR user_id IS NULL)" if user else ""
    params: dict = {
        "id": str(trip_id),
        "name": req.name,
        "description": req.description,
        "route_type": req.route_type,
        "waypoints": json.dumps(req.waypoints),
        "preferences": json.dumps(req.preferences),
        "route_data": json.dumps(req.route_data) if req.route_data else None,
        "distance": req.total_distance_m,
        "time": req.total_time_s,
        "score": req.total_moto_score,
    }
    if user:
        params["uid"] = user["id"]
    result = await db.execute(
        text(f"""
            UPDATE saved_routes SET
                name = :name, description = :description, route_type = :route_type,
                waypoints = CAST(:waypoints AS jsonb), preferences = CAST(:preferences AS jsonb),
                route_data = CAST(:route_data AS jsonb),
                total_distance_m = :distance, total_time_s = :time, total_moto_score = :score,
                updated_at = NOW()
            WHERE id = :id{ownership}
            RETURNING id
        """),
        params,
    )
    await db.commit()
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Trip not found or access denied")
    return {"id": str(row.id), "updated": True}


@router.delete("/trips/{trip_id}")
async def delete_trip(
    trip_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: dict | None = Depends(get_optional_user),
):
    """Delete a saved trip."""
    # Ownership check
    ownership = " AND (user_id = :uid OR user_id IS NULL)" if user else ""
    params: dict = {"id": str(trip_id)}
    if user:
        params["uid"] = user["id"]
    result = await db.execute(
        text(f"DELETE FROM saved_routes WHERE id = :id{ownership} RETURNING id"),
        params,
    )
    await db.commit()
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Trip not found")
    return {"deleted": str(row.id)}
