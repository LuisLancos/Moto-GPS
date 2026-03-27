"""Multi-day trip planning API — trips with day overlays."""

import json
import math
from uuid import UUID

from io import BytesIO

from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models.route import (
    AutoSplitRequest,
    AutoSplitResponse,
    DayOverlay,
    DayOverlayWithStats,
    SaveTripRequest,
    TripDetailResponse,
    TripSummaryResponse,
    Waypoint,
)

router = APIRouter()


# ---------- Auto-Split Algorithm ----------


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def compute_day_stats(
    day_overlays: list[dict],
    legs: list[dict],
    waypoints: list[dict],
) -> list[dict]:
    """Compute per-day stats from overlays + route legs.

    Each leg[i] corresponds to waypoint[i] → waypoint[i+1].
    A day spanning waypoints[start..end] uses legs[start..end-1].
    """
    results = []
    for overlay in day_overlays:
        start = overlay["start_waypoint_idx"]
        end = overlay["end_waypoint_idx"]
        leg_slice = legs[start:end] if legs else []

        distance_m = sum(l.get("distance_m", 0) for l in leg_slice)
        time_s = sum(l.get("time_s", 0) for l in leg_slice)

        shape_start = leg_slice[0].get("shape_start_idx", 0) if leg_slice else 0
        shape_end = leg_slice[-1].get("shape_end_idx", 0) if leg_slice else 0

        results.append({
            **overlay,
            "distance_m": distance_m,
            "time_s": time_s,
            "waypoint_count": end - start + 1,
            "shape_start_idx": shape_start,
            "shape_end_idx": shape_end,
            "moto_score": None,
        })
    return results


def auto_split(
    waypoints: list[dict],
    legs: list[dict],
    daily_target_m: float,
) -> list[dict]:
    """Suggest day overlays based on target daily distance.

    Greedy algorithm: accumulate leg distances, split when target reached.
    Prefers labeled waypoints as day boundaries (within 80-120% of target).
    """
    if not legs or len(waypoints) < 2:
        return [{
            "day": 1,
            "name": _day_label(1, waypoints, 0, len(waypoints) - 1),
            "description": None,
            "start_waypoint_idx": 0,
            "end_waypoint_idx": len(waypoints) - 1,
        }]

    overlays = []
    current_day = 1
    day_start_idx = 0
    accumulated_dist = 0.0

    for i in range(len(legs)):
        accumulated_dist += legs[i].get("distance_m", 0)

        # Check if we should split here (at waypoint i+1)
        at_last_leg = (i == len(legs) - 1)
        if at_last_leg:
            continue  # Don't split at the very end — that's the final day

        past_target = accumulated_dist >= daily_target_m
        near_target = accumulated_dist >= daily_target_m * 0.8

        # Prefer labeled waypoints as overnight stops
        wp_idx = i + 1
        wp = waypoints[wp_idx] if wp_idx < len(waypoints) else {}
        has_label = bool(wp.get("label"))

        should_split = past_target or (near_target and has_label)

        if should_split:
            overlays.append({
                "day": current_day,
                "name": _day_label(current_day, waypoints, day_start_idx, wp_idx),
                "description": None,
                "start_waypoint_idx": day_start_idx,
                "end_waypoint_idx": wp_idx,
            })
            current_day += 1
            day_start_idx = wp_idx
            accumulated_dist = 0.0

    # Final day: from last split to end
    last_wp_idx = len(waypoints) - 1
    overlays.append({
        "day": current_day,
        "name": _day_label(current_day, waypoints, day_start_idx, last_wp_idx),
        "description": None,
        "start_waypoint_idx": day_start_idx,
        "end_waypoint_idx": last_wp_idx,
    })

    return overlays


def _day_label(day: int, waypoints: list[dict], start_idx: int, end_idx: int) -> str:
    """Generate a label like 'Day 1: London → Bath'."""
    start_label = waypoints[start_idx].get("label") if start_idx < len(waypoints) else None
    end_label = waypoints[end_idx].get("label") if end_idx < len(waypoints) else None

    if start_label and end_label:
        return f"Day {day}: {start_label} → {end_label}"
    elif start_label:
        return f"Day {day}: From {start_label}"
    elif end_label:
        return f"Day {day}: To {end_label}"
    return f"Day {day}"


# ---------- API Endpoints ----------


@router.post("/trip-planner/auto-split", response_model=AutoSplitResponse)
async def auto_split_endpoint(request: AutoSplitRequest):
    """Suggest day splits based on target daily distance. Stateless."""
    legs_data = [l.model_dump() for l in request.legs]
    wp_data = [w.model_dump() for w in request.waypoints]

    overlays = auto_split(wp_data, legs_data, request.daily_target_m)
    stats = compute_day_stats(overlays, legs_data, wp_data)

    return AutoSplitResponse(
        day_overlays=[DayOverlayWithStats(**s) for s in stats],
    )


@router.get("/trip-planner/trips")
async def list_trips(db: AsyncSession = Depends(get_db)):
    """List all saved trips."""
    result = await db.execute(text("""
        SELECT id, name, description, route_type,
               COALESCE(jsonb_array_length(day_overlays), 0) AS day_count,
               total_distance_m, total_time_s, total_moto_score, created_at
        FROM trips ORDER BY created_at DESC
    """))
    rows = result.fetchall()
    return [
        TripSummaryResponse(
            id=str(r.id),
            name=r.name,
            description=r.description,
            route_type=r.route_type or "balanced",
            day_count=r.day_count,
            total_distance_m=r.total_distance_m or 0,
            total_time_s=r.total_time_s or 0,
            total_moto_score=r.total_moto_score,
            created_at=r.created_at.isoformat() if r.created_at else "",
        )
        for r in rows
    ]


@router.post("/trip-planner/trips")
async def save_trip(request: SaveTripRequest, db: AsyncSession = Depends(get_db)):
    """Save a new multi-day trip."""
    result = await db.execute(
        text("""
            INSERT INTO trips (name, description, route_type, preferences, waypoints,
                               route_data, day_overlays, daily_target_m,
                               total_distance_m, total_time_s, total_moto_score)
            VALUES (:name, :description, :route_type, :preferences, :waypoints,
                    :route_data, :day_overlays, :daily_target_m,
                    :total_distance_m, :total_time_s, :total_moto_score)
            RETURNING id, created_at
        """),
        {
            "name": request.name,
            "description": request.description,
            "route_type": request.route_type,
            "preferences": json.dumps(request.preferences),
            "waypoints": json.dumps([w.model_dump() for w in request.waypoints]),
            "route_data": json.dumps(request.route_data) if request.route_data else None,
            "day_overlays": json.dumps([d.model_dump() for d in request.day_overlays]),
            "daily_target_m": request.daily_target_m,
            "total_distance_m": request.total_distance_m,
            "total_time_s": request.total_time_s,
            "total_moto_score": request.total_moto_score,
        },
    )
    await db.commit()
    row = result.fetchone()
    return {"id": str(row.id), "created_at": row.created_at.isoformat()}


@router.get("/trip-planner/trips/{trip_id}")
async def get_trip(trip_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get full trip detail including day overlays."""
    result = await db.execute(
        text("SELECT * FROM trips WHERE id = :id"),
        {"id": str(trip_id)},
    )
    r = result.fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="Trip not found")

    day_overlays = r.day_overlays if isinstance(r.day_overlays, list) else []

    return TripDetailResponse(
        id=str(r.id),
        name=r.name,
        description=r.description,
        route_type=r.route_type or "balanced",
        day_count=len(day_overlays),
        total_distance_m=r.total_distance_m or 0,
        total_time_s=r.total_time_s or 0,
        total_moto_score=r.total_moto_score,
        created_at=r.created_at.isoformat() if r.created_at else "",
        preferences=r.preferences or {},
        waypoints=[Waypoint(**w) for w in (r.waypoints or [])],
        route_data=r.route_data,
        day_overlays=[DayOverlay(**d) for d in day_overlays],
        daily_target_m=r.daily_target_m,
    )


@router.patch("/trip-planner/trips/{trip_id}")
async def update_trip(trip_id: UUID, body: dict, db: AsyncSession = Depends(get_db)):
    """Update trip metadata, day overlays, or route data."""
    allowed = {"name", "description", "day_overlays", "daily_target_m",
               "waypoints", "route_data", "total_distance_m", "total_time_s", "total_moto_score"}
    updates = {k: v for k, v in body.items() if k in allowed}

    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    # Serialize JSONB fields
    for key in ("day_overlays", "waypoints", "route_data", "preferences"):
        if key in updates and not isinstance(updates[key], str):
            updates[key] = json.dumps(updates[key])

    set_clauses = ", ".join(f"{k} = :{k}" for k in updates)
    updates["id"] = str(trip_id)
    updates["now"] = "now()"

    await db.execute(
        text(f"UPDATE trips SET {set_clauses}, updated_at = NOW() WHERE id = :id"),
        updates,
    )
    await db.commit()
    return {"status": "updated"}


@router.put("/trip-planner/trips/{trip_id}")
async def overwrite_trip(trip_id: UUID, request: SaveTripRequest, db: AsyncSession = Depends(get_db)):
    """Full overwrite of a multi-day trip."""
    result = await db.execute(
        text("""
            UPDATE trips SET
                name = :name, description = :description, route_type = :route_type,
                preferences = :preferences, waypoints = :waypoints,
                route_data = :route_data, day_overlays = :day_overlays,
                daily_target_m = :daily_target_m,
                total_distance_m = :total_distance_m, total_time_s = :total_time_s,
                total_moto_score = :total_moto_score,
                updated_at = NOW()
            WHERE id = :id
            RETURNING id
        """),
        {
            "id": str(trip_id),
            "name": request.name,
            "description": request.description,
            "route_type": request.route_type,
            "preferences": json.dumps(request.preferences),
            "waypoints": json.dumps([w.model_dump() for w in request.waypoints]),
            "route_data": json.dumps(request.route_data) if request.route_data else None,
            "day_overlays": json.dumps([d.model_dump() for d in request.day_overlays]),
            "daily_target_m": request.daily_target_m,
            "total_distance_m": request.total_distance_m,
            "total_time_s": request.total_time_s,
            "total_moto_score": request.total_moto_score,
        },
    )
    await db.commit()
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Trip not found")
    return {"id": str(row.id), "updated": True}


@router.delete("/trip-planner/trips/{trip_id}")
async def delete_trip(trip_id: UUID, db: AsyncSession = Depends(get_db)):
    """Delete a trip."""
    await db.execute(text("DELETE FROM trips WHERE id = :id"), {"id": str(trip_id)})
    await db.commit()
    return {"status": "deleted"}


# ---------- Per-Day GPX Export ----------

@router.get("/trip-planner/trips/{trip_id}/gpx/day/{day_number}")
async def export_day_gpx(trip_id: UUID, day_number: int, db: AsyncSession = Depends(get_db)):
    """Export a single day's route as GPX."""
    from app.api.gpx import _build_gpx
    from fastapi.responses import Response

    result = await db.execute(
        text("SELECT * FROM trips WHERE id = :id"),
        {"id": str(trip_id)},
    )
    r = result.fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="Trip not found")

    day_overlays = r.day_overlays if isinstance(r.day_overlays, list) else []
    day = next((d for d in day_overlays if d["day"] == day_number), None)
    if not day:
        raise HTTPException(status_code=404, detail=f"Day {day_number} not found")

    all_waypoints = r.waypoints or []
    route_data = r.route_data or {}

    # Slice waypoints for this day
    start_idx = day["start_waypoint_idx"]
    end_idx = day["end_waypoint_idx"]
    day_waypoints = all_waypoints[start_idx:end_idx + 1]

    # Slice route shape and maneuvers for this day
    legs = route_data.get("legs", [])
    day_legs = legs[start_idx:end_idx] if legs else []

    # Get shape range from legs
    shape_start = day_legs[0].get("shape_start_idx", 0) if day_legs else 0
    shape_end = day_legs[-1].get("shape_end_idx", 0) if day_legs else 0

    full_shape = route_data.get("shape", [])
    day_shape = full_shape[shape_start:shape_end + 1] if full_shape else []

    # Filter maneuvers to this day's shape range
    all_maneuvers = route_data.get("maneuvers", [])
    day_maneuvers = [
        m for m in all_maneuvers
        if shape_start <= m.get("begin_shape_index", 0) <= shape_end
    ]

    day_route_data = {
        "shape": day_shape,
        "maneuvers": day_maneuvers,
    }

    day_name = day.get("name") or f"Day {day_number}"
    day_desc = day.get("description") or f"Day {day_number} of {r.name}"

    # Compute day stats
    day_distance = sum(l.get("distance_m", 0) for l in day_legs)
    day_time = sum(l.get("time_s", 0) for l in day_legs)

    gpx_xml = _build_gpx(
        name=day_name,
        description=day_desc,
        waypoints=day_waypoints,
        route_data=day_route_data,
        distance_m=day_distance,
        time_s=day_time,
        route_type=r.route_type,
    )

    slug = day_name.lower().replace(" ", "-").replace(":", "")[:40]
    filename = f"motogps-{slug}.gpx"
    return Response(
        content=gpx_xml,
        media_type="application/gpx+xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/trip-planner/trips/{trip_id}/gpx/all")
async def export_all_days_gpx(trip_id: UUID, db: AsyncSession = Depends(get_db)):
    """Export all days as a ZIP file of GPX files."""
    import zipfile
    from io import BytesIO
    from app.api.gpx import _build_gpx
    from fastapi.responses import Response

    result = await db.execute(
        text("SELECT * FROM trips WHERE id = :id"),
        {"id": str(trip_id)},
    )
    r = result.fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="Trip not found")

    day_overlays = r.day_overlays if isinstance(r.day_overlays, list) else []
    if not day_overlays:
        raise HTTPException(status_code=400, detail="Trip has no day splits")

    all_waypoints = r.waypoints or []
    route_data = r.route_data or {}
    legs = route_data.get("legs", [])
    full_shape = route_data.get("shape", [])
    all_maneuvers = route_data.get("maneuvers", [])

    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for day in day_overlays:
            start_idx = day["start_waypoint_idx"]
            end_idx = day["end_waypoint_idx"]
            day_waypoints = all_waypoints[start_idx:end_idx + 1]
            day_legs = legs[start_idx:end_idx] if legs else []

            shape_start = day_legs[0].get("shape_start_idx", 0) if day_legs else 0
            shape_end = day_legs[-1].get("shape_end_idx", 0) if day_legs else 0
            day_shape = full_shape[shape_start:shape_end + 1] if full_shape else []

            day_maneuvers = [
                m for m in all_maneuvers
                if shape_start <= m.get("begin_shape_index", 0) <= shape_end
            ]

            day_name = day.get("name") or f"Day {day['day']}"
            day_distance = sum(l.get("distance_m", 0) for l in day_legs)
            day_time = sum(l.get("time_s", 0) for l in day_legs)

            gpx_xml = _build_gpx(
                name=day_name,
                description=day.get("description") or f"Day {day['day']} of {r.name}",
                waypoints=day_waypoints,
                route_data={"shape": day_shape, "maneuvers": day_maneuvers},
                distance_m=day_distance,
                time_s=day_time,
                route_type=r.route_type,
            )

            slug = day_name.lower().replace(" ", "-").replace(":", "")[:40]
            zf.writestr(f"{slug}.gpx", gpx_xml)

    trip_slug = r.name.lower().replace(" ", "-")[:30]
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="motogps-{trip_slug}-all-days.zip"'},
    )


# ---------- Import Endpoints ----------

@router.post("/trip-planner/import-trip")
async def import_trip_zip(file: UploadFile = File(...)):
    """Import a multi-day trip from a ZIP of GPX files.

    Each GPX file in the ZIP becomes one day. Files are sorted alphabetically
    (so day-1-*.gpx, day-2-*.gpx works naturally). Waypoints from each day
    are merged, with shared boundary points deduplicated.

    Returns the combined waypoints and day overlays ready to load into the planner.
    """
    from app.api.gpx import _build_import_waypoints, _text, _gpx_ns, _extract_gpx_elements
    import zipfile
    import xml.etree.ElementTree as ET

    content = await file.read()
    if len(content) > 50_000_000:  # 50MB limit for ZIP
        raise HTTPException(status_code=400, detail="File too large (max 50MB)")

    if not zipfile.is_zipfile(BytesIO(content)):
        raise HTTPException(status_code=400, detail="Not a valid ZIP file")

    zf = zipfile.ZipFile(BytesIO(content))

    # Find all .gpx files, sorted alphabetically
    gpx_files = sorted([n for n in zf.namelist() if n.lower().endswith(".gpx")])
    if not gpx_files:
        raise HTTPException(status_code=400, detail="No GPX files found in ZIP")

    # Parse each GPX file into day waypoints
    days = []
    for gpx_name in gpx_files:
        gpx_content = zf.read(gpx_name).decode("utf-8", errors="replace")
        gpx_content = gpx_content.replace("motogps:", "motogps_")

        try:
            root = ET.fromstring(gpx_content)
        except ET.ParseError:
            continue  # Skip invalid GPX files

        ns = _gpx_ns(root)
        day_name = _text(root, f"{ns}metadata/{ns}name") or gpx_name.replace(".gpx", "")
        day_desc = _text(root, f"{ns}metadata/{ns}desc") or ""

        # Extract all GPX elements using shared helper
        wpt_points, rte_points, track_shape = _extract_gpx_elements(root, ns)

        day_wps = _build_import_waypoints(wpt_points, rte_points, track_shape)

        if day_wps:
            days.append({
                "name": day_name,
                "description": day_desc,
                "waypoints": day_wps,
            })

    if not days:
        raise HTTPException(status_code=400, detail="No valid waypoints found in any GPX file")

    # Merge days into a single trip with day overlays
    # Day boundaries share the end/start waypoint
    all_waypoints = []
    day_overlays = []
    trip_name = file.filename.replace(".zip", "").replace("-all-days", "") if file.filename else "Imported Trip"

    for i, day in enumerate(days):
        start_idx = len(all_waypoints)

        if i == 0:
            # First day: add all waypoints
            all_waypoints.extend(day["waypoints"])
        else:
            # Subsequent days: skip first waypoint if it matches previous day's last
            prev_last = all_waypoints[-1]
            first_wp = day["waypoints"][0]
            if (abs(prev_last["lat"] - first_wp["lat"]) < 0.001 and
                    abs(prev_last["lng"] - first_wp["lng"]) < 0.001):
                # Shared boundary — skip the duplicate
                all_waypoints.extend(day["waypoints"][1:])
            else:
                all_waypoints.extend(day["waypoints"])

        end_idx = len(all_waypoints) - 1

        day_overlays.append({
            "day": i + 1,
            "name": day["name"],
            "description": day["description"],
            "start_waypoint_idx": start_idx,
            "end_waypoint_idx": end_idx,
        })

    return {
        "name": trip_name,
        "waypoints": all_waypoints,
        "day_overlays": day_overlays,
        "day_count": len(day_overlays),
        "waypoint_count": len(all_waypoints),
    }


@router.post("/trip-planner/trips/{trip_id}/import-day")
async def import_day_into_trip(
    trip_id: UUID,
    day_number: int = Query(..., description="Day number to replace/insert (1-indexed)"),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Import a GPX file as a day leg into an existing multi-day trip.

    If day_number matches an existing day, replaces that day's waypoints.
    If day_number is one more than the last day, appends a new day.
    The trip's master waypoint list and day overlays are updated accordingly.

    Returns the updated trip waypoints and day overlays.
    """
    from app.api.gpx import _build_import_waypoints, _text, _gpx_ns, _extract_gpx_elements
    import xml.etree.ElementTree as ET

    # Load existing trip
    result = await db.execute(
        text("SELECT * FROM trips WHERE id = :id"),
        {"id": str(trip_id)},
    )
    r = result.fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="Trip not found")

    # Parse the uploaded GPX
    content = await file.read()
    if len(content) > 10_000_000:
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

    content_str = content.decode("utf-8", errors="replace").replace("motogps:", "motogps_")
    try:
        root = ET.fromstring(content_str)
    except ET.ParseError as e:
        raise HTTPException(status_code=400, detail=f"Invalid GPX: {e}")

    ns = _gpx_ns(root)
    day_name = _text(root, f"{ns}metadata/{ns}name") or file.filename or f"Day {day_number}"
    day_desc = _text(root, f"{ns}metadata/{ns}desc") or ""

    # Extract all GPX elements using shared helper
    wpt_points, rte_points, track_shape = _extract_gpx_elements(root, ns)

    new_day_wps = _build_import_waypoints(wpt_points, rte_points, track_shape)

    if not new_day_wps:
        raise HTTPException(status_code=400, detail="No valid waypoints found in GPX file")

    # Rebuild the trip's waypoint list with the new day
    existing_overlays = r.day_overlays if isinstance(r.day_overlays, list) else []
    existing_wps = r.waypoints or []

    if day_number <= len(existing_overlays):
        # Replace existing day's waypoints
        day = existing_overlays[day_number - 1]
        old_start = day["start_waypoint_idx"]
        old_end = day["end_waypoint_idx"]

        # Build new waypoint list: before_day + new_day_wps + after_day
        before = existing_wps[:old_start]
        after = existing_wps[old_end + 1:]

        # Deduplicate boundary: if new first wp matches before's last
        if before and new_day_wps:
            prev_last = before[-1]
            if (abs(prev_last["lat"] - new_day_wps[0]["lat"]) < 0.001 and
                    abs(prev_last["lng"] - new_day_wps[0]["lng"]) < 0.001):
                new_day_wps = new_day_wps[1:]

        if after and new_day_wps:
            next_first = after[0]
            if (abs(new_day_wps[-1]["lat"] - next_first["lat"]) < 0.001 and
                    abs(new_day_wps[-1]["lng"] - next_first["lng"]) < 0.001):
                new_day_wps = new_day_wps[:-1]

        all_wps = before + new_day_wps + after

        # Recalculate all day overlay indices
        shift = len(new_day_wps) - (old_end - old_start + 1)
        new_overlays = []
        for ov in existing_overlays:
            if ov["day"] < day_number:
                new_overlays.append(ov)
            elif ov["day"] == day_number:
                new_overlays.append({
                    **ov,
                    "name": day_name,
                    "description": day_desc,
                    "start_waypoint_idx": old_start,
                    "end_waypoint_idx": old_start + len(new_day_wps) - 1,
                })
            else:
                new_overlays.append({
                    **ov,
                    "start_waypoint_idx": ov["start_waypoint_idx"] + shift,
                    "end_waypoint_idx": ov["end_waypoint_idx"] + shift,
                })

    elif day_number == len(existing_overlays) + 1:
        # Append new day
        # Deduplicate boundary with previous day's last waypoint
        if existing_wps and new_day_wps:
            prev_last = existing_wps[-1]
            if (abs(prev_last["lat"] - new_day_wps[0]["lat"]) < 0.001 and
                    abs(prev_last["lng"] - new_day_wps[0]["lng"]) < 0.001):
                new_day_wps = new_day_wps[1:]

        start_idx = len(existing_wps)
        all_wps = existing_wps + new_day_wps
        new_overlays = existing_overlays + [{
            "day": day_number,
            "name": day_name,
            "description": day_desc,
            "start_waypoint_idx": start_idx,
            "end_waypoint_idx": len(all_wps) - 1,
        }]
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Day {day_number} out of range (trip has {len(existing_overlays)} days)",
        )

    # Update the trip in DB
    await db.execute(
        text("""
            UPDATE trips SET
                waypoints = CAST(:waypoints AS jsonb),
                day_overlays = CAST(:day_overlays AS jsonb),
                route_data = NULL,
                updated_at = NOW()
            WHERE id = :id
        """),
        {
            "id": str(trip_id),
            "waypoints": json.dumps(all_wps),
            "day_overlays": json.dumps(new_overlays),
        },
    )
    await db.commit()

    return {
        "waypoints": all_wps,
        "day_overlays": new_overlays,
        "day_count": len(new_overlays),
        "waypoint_count": len(all_wps),
        "message": f"Day {day_number} {'replaced' if day_number <= len(existing_overlays) else 'added'}",
    }
