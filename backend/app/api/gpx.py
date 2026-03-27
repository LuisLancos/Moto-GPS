"""GPX export and import for routes and saved trips."""

import json
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from io import BytesIO
from uuid import UUID

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Query
from fastapi.responses import Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db

router = APIRouter()

GPX_NS = "http://www.topografix.com/GPX/1/1"
GPX_SCHEMA = "http://www.topografix.com/GPX/1/1/gpx.xsd"
XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"

# Valhalla maneuver types that represent navigation-relevant turns/junctions
_NAV_MANEUVER_TYPES = {
    1,   # kStart
    2,   # kStartRight
    3,   # kStartLeft
    4,   # kDestination
    5,   # kDestinationRight
    6,   # kDestinationLeft
    7,   # kBecomes
    9,   # kSlightRight
    10,  # kRight
    11,  # kSharpRight
    12,  # kUturnRight
    13,  # kUturnLeft
    14,  # kSharpLeft
    15,  # kLeft
    16,  # kSlightLeft
    17,  # kRampStraight
    18,  # kRampRight
    19,  # kRampLeft
    20,  # kExitRight
    21,  # kExitLeft
    22,  # kStayStraight
    23,  # kStayRight
    24,  # kStayLeft
    25,  # kMerge
    26,  # kRoundaboutEnter
    27,  # kRoundaboutExit
    28,  # kFerryEnter
    29,  # kFerryExit
}


# ---------- Export ----------

@router.get("/trips/{trip_id}/gpx")
async def export_trip_gpx(trip_id: UUID, db: AsyncSession = Depends(get_db)):
    """Export a saved trip as a compact GPX file with waypoints + navigation points."""
    result = await db.execute(
        text("""
            SELECT id, name, description, waypoints, route_data,
                   total_distance_m, total_time_s, total_moto_score, route_type, created_at
            FROM saved_routes WHERE id = :id
        """),
        {"id": str(trip_id)},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Trip not found")

    gpx_xml = _build_gpx(
        name=row.name,
        description=row.description,
        waypoints=row.waypoints or [],
        route_data=row.route_data,
        distance_m=row.total_distance_m,
        time_s=row.total_time_s,
        moto_score=row.total_moto_score,
        route_type=row.route_type,
        created_at=row.created_at,
    )

    filename = f"motogps-{row.name.lower().replace(' ', '-')[:40]}.gpx"
    return Response(
        content=gpx_xml,
        media_type="application/gpx+xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/gpx/export")
async def export_route_gpx(
    name: str = Query("MotoGPS Route"),
    description: str = Query(""),
    waypoints: str = Query(..., description="JSON array of waypoints"),
    route_data: str = Query(..., description="JSON route object with shape + maneuvers"),
):
    """Export a current (unsaved) route as compact GPX."""
    try:
        wps = json.loads(waypoints)
        rd = json.loads(route_data)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON in waypoints or route_data")

    gpx_xml = _build_gpx(
        name=name,
        description=description or None,
        waypoints=wps,
        route_data=rd,
    )

    filename = f"motogps-{name.lower().replace(' ', '-')[:40]}.gpx"
    return Response(
        content=gpx_xml,
        media_type="application/gpx+xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------- Import ----------

@router.post("/gpx/import")
async def import_gpx(file: UploadFile = File(...)):
    """Import a GPX file — rebuild route from waypoints + route points.

    Strategy:
    1. Extract <wpt> elements (user waypoints: start, via, end)
    2. Extract <rte>/<rtept> elements (navigation points: turns, junctions)
    3. Extract <trk> track shape (for display, if present)
    4. Build smart waypoints: start with <wpt>, then sample key <rtept>
       points to rebuild the route shape without overwhelming Valhalla.
       Target: ~1 shaping point every 15-25km for routes with many nav points.
    """
    content = await file.read()
    if len(content) > 10_000_000:
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

    try:
        # Handle unbound namespace prefixes (e.g., motogps:route_type in our exports)
        # by replacing them with underscore-prefixed names
        content_str = content.decode("utf-8", errors="replace")
        content_str = content_str.replace("motogps:", "motogps_")
        root = ET.fromstring(content_str)
    except ET.ParseError as e:
        raise HTTPException(status_code=400, detail=f"Invalid GPX XML: {e}")

    ns = _gpx_ns(root)
    name = _text(root, f"{ns}metadata/{ns}name") or _text(root, f"{ns}name") or file.filename or "Imported Route"
    description = _text(root, f"{ns}metadata/{ns}desc") or _text(root, f"{ns}desc") or ""

    # Extract all GPX elements using shared helper
    wpt_points, rte_points, track_shape = _extract_gpx_elements(root, ns)

    # Build smart waypoints (internal fields auto-cleaned by _build_import_waypoints)
    waypoints = _build_import_waypoints(wpt_points, rte_points, track_shape)

    return {
        "name": name,
        "description": description,
        "waypoints": waypoints,
        "track_shape": track_shape,
        "waypoint_count": len(waypoints),
        "track_point_count": len(track_shape),
    }


def _build_import_waypoints(
    wpt_points: list[dict],
    rte_points: list[dict],
    track_shape: list[list[float]],
) -> list[dict]:
    """Build a smart waypoint list from GPX data for route reconstruction.

    Priority:
    1. If we have <wpt> + <rte> points: use <wpt> as anchors, sample <rte>
       points between them to preserve route shape (every ~20km)
    2. If we have only <rte> points: sample them directly
    3. If we have only <wpt>: use them as-is
    4. If we have only <trk>: sample key points from the track
    """
    import math

    def _haversine(lat1, lon1, lat2, lon2):
        R = 6_371_000
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dp = p2 - p1
        dl = math.radians(lon2 - lon1)
        a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    def _sample_by_distance(points: list[dict], min_spacing_m: float = 20_000) -> list[dict]:
        """Sample points ensuring minimum spacing between them."""
        if len(points) <= 2:
            return list(points)

        sampled = [points[0]]
        for pt in points[1:-1]:
            last = sampled[-1]
            dist = _haversine(last["lat"], last.get("lng", last.get("lon", 0)),
                              pt["lat"], pt.get("lng", pt.get("lon", 0)))
            if dist >= min_spacing_m:
                sampled.append(pt)
        # Always include the last point
        sampled.append(points[-1])
        return sampled

    # Check if <rte> points are just duplicates of <wpt> (old export format)
    rte_is_duplicate = False
    if wpt_points and rte_points and len(rte_points) <= len(wpt_points) + 2:
        # If rtept count is close to wpt count, they're likely just copies
        rte_is_duplicate = True

    # If rte is duplicate but we have a track, use track for shaping
    if rte_is_duplicate and track_shape and len(track_shape) > 10:
        # Sample track shape for intermediate waypoints between <wpt> anchors
        pts = [{"lat": s[1], "lng": s[0]} for s in track_shape]
        total_dist = sum(
            _haversine(pts[i]["lat"], pts[i]["lng"], pts[i + 1]["lat"], pts[i + 1]["lng"])
            for i in range(len(pts) - 1)
        )
        target_count = max(3, min(20, int(total_dist / 20_000)))
        spacing = total_dist / target_count if target_count > 0 else 20_000
        sampled_track = _sample_by_distance(pts, spacing)

        # Merge: keep <wpt> labels, add sampled track points between them
        wpt_coords = {(round(w["lat"], 4), round(w["lng"], 4)) for w in wpt_points}
        shaping_points = [
            p for p in sampled_track[1:-1]
            if (round(p["lat"], 4), round(p["lng"], 4)) not in wpt_coords
        ]

        waypoints = [wpt_points[0]]
        all_intermediate = wpt_points[1:-1] + shaping_points
        for pt in all_intermediate:
            pt["_dist_from_start"] = _haversine(
                wpt_points[0]["lat"], wpt_points[0]["lng"],
                pt["lat"], pt["lng"],
            )
        all_intermediate.sort(key=lambda p: p.get("_dist_from_start", 0))
        for pt in all_intermediate:
            pt.pop("_dist_from_start", None)
            waypoints.append(pt)
        waypoints.append(wpt_points[-1])
        return _clean_internal_fields(waypoints)

    # Case 1: <wpt> + <rte> — merge named waypoints with sampled route points
    if wpt_points and rte_points and not rte_is_duplicate:
        # Use <wpt> start/end as anchors, sample <rte> points between
        start_wp = wpt_points[0]
        end_wp = wpt_points[-1]
        via_wpts = wpt_points[1:-1]  # user's named via points

        # Calculate total route distance from rte_points
        total_dist = 0
        for i in range(1, len(rte_points)):
            total_dist += _haversine(
                rte_points[i - 1]["lat"], rte_points[i - 1].get("lng", rte_points[i - 1].get("lon", 0)),
                rte_points[i]["lat"], rte_points[i].get("lng", rte_points[i].get("lon", 0)),
            )

        # Target: ~1 shaping point every 20km, max 20 waypoints total
        target_count = max(3, min(20, int(total_dist / 20_000)))
        spacing = total_dist / target_count if target_count > 0 else 20_000

        # Sample route points at regular distance intervals
        sampled_rte = _sample_by_distance(rte_points, spacing)

        # Normalise lng field
        for pt in sampled_rte:
            if "lon" in pt and "lng" not in pt:
                pt["lng"] = pt.pop("lon")

        # Merge: start + sampled_rte (excluding first/last which duplicate start/end) + end
        # Remove rte points that are very close to existing <wpt> points
        wpt_coords = {(round(w["lat"], 4), round(w["lng"], 4)) for w in wpt_points}
        filtered_rte = [
            pt for pt in sampled_rte[1:-1]  # skip first/last (duplicate of start/end)
            if (round(pt["lat"], 4), round(pt["lng"], 4)) not in wpt_coords
        ]

        # Build final list: start, via wpts interleaved with rte shaping points, end
        waypoints = [start_wp]
        # Insert via waypoints and shaping points in geographic order
        all_intermediate = via_wpts + filtered_rte
        # Sort by distance from start
        for pt in all_intermediate:
            pt["_dist_from_start"] = _haversine(
                start_wp["lat"], start_wp["lng"],
                pt["lat"], pt["lng"],
            )
        all_intermediate.sort(key=lambda p: p.get("_dist_from_start", 0))
        for pt in all_intermediate:
            pt.pop("_dist_from_start", None)
            waypoints.append(pt)
        waypoints.append(end_wp)

        return _clean_internal_fields(waypoints)

    # Case 2: Only <rte> — sample directly
    if rte_points:
        for pt in rte_points:
            if "lon" in pt and "lng" not in pt:
                pt["lng"] = pt.pop("lon")
        return _sample_by_distance(rte_points, 20_000)

    # Case 3: Only <wpt>
    if wpt_points:
        return _clean_internal_fields(wpt_points)

    # Case 4: Only <trk> — sample track shape
    if track_shape:
        pts = [{"lat": s[1], "lng": s[0]} for s in track_shape]
        sampled = _sample_by_distance(pts, 20_000)
        if sampled:
            sampled[0]["label"] = "Start"
            sampled[-1]["label"] = "End"
        return _clean_internal_fields(sampled)

    return []


def _clean_internal_fields(waypoints: list[dict]) -> list[dict]:
    """Remove internal fields (_type, _desc, _dist_from_start) from waypoints."""
    for wp in waypoints:
        wp.pop("_type", None)
        wp.pop("_desc", None)
        wp.pop("_dist_from_start", None)
    return waypoints


# ---------- Helpers ----------

def _extract_nav_points(
    route_data: dict,
) -> list[dict]:
    """Extract navigation-relevant points from route maneuvers.

    Instead of dumping 17,000 track points, extract only the points where
    the rider needs to act: turns, junctions, roundabouts, ramp entries/exits,
    merges, and road changes.

    Returns a list of dicts with lat, lon, name, description.
    """
    shape = route_data.get("shape", [])
    maneuvers = route_data.get("maneuvers", [])

    if not maneuvers or not shape:
        return []

    nav_points = []
    for m in maneuvers:
        mtype = m.get("type", 0)

        # Skip "continue" (type 8) — not a navigation decision
        if mtype == 8:
            continue

        # Only include navigation-relevant maneuver types
        if mtype not in _NAV_MANEUVER_TYPES:
            continue

        idx = m.get("begin_shape_index", 0)
        if idx < len(shape):
            point = shape[idx]  # [lng, lat]
            street = ", ".join(m.get("street_names", [])) or None
            nav_points.append({
                "lat": point[1],
                "lon": point[0],
                "name": street or m.get("instruction", "")[:50],
                "desc": m.get("instruction", ""),
                "type": mtype,
            })

    return nav_points


def _build_gpx(
    name: str,
    description: str | None,
    waypoints: list[dict],
    route_data: dict | None = None,
    distance_m: float | None = None,
    time_s: float | None = None,
    moto_score: float | None = None,
    route_type: str | None = None,
    created_at: datetime | None = None,
) -> bytes:
    """Build a compact GPX 1.1 document.

    Structure:
    - <wpt> for each user waypoint (start, via, end)
    - <rte>/<rtept> for navigation points extracted from maneuvers
      (turns, junctions, roundabouts, merges — NOT every track point)
    - No <trk> section — keeps the file compact and compatible with
      GPS devices that re-route between route points
    """
    root = ET.Element("gpx")
    root.set("xmlns", GPX_NS)
    root.set("xmlns:xsi", XSI_NS)
    root.set("xsi:schemaLocation", f"{GPX_NS} {GPX_SCHEMA}")
    root.set("version", "1.1")
    root.set("creator", "MotoGPS - Smart Motorcycle Navigation")

    # Metadata
    metadata = ET.SubElement(root, "metadata")
    ET.SubElement(metadata, "name").text = name
    if description:
        ET.SubElement(metadata, "desc").text = description
    time_el = ET.SubElement(metadata, "time")
    time_el.text = (created_at or datetime.now(timezone.utc)).isoformat()

    # MotoGPS extensions
    if any(v is not None for v in [distance_m, time_s, moto_score, route_type]):
        extensions = ET.SubElement(metadata, "extensions")
        if route_type:
            ET.SubElement(extensions, "motogps_route_type").text = route_type
        if distance_m is not None:
            ET.SubElement(extensions, "motogps_distance_m").text = f"{distance_m:.0f}"
        if time_s is not None:
            ET.SubElement(extensions, "motogps_time_s").text = f"{time_s:.0f}"
        if moto_score is not None:
            ET.SubElement(extensions, "motogps_moto_score").text = f"{moto_score:.4f}"

    # Waypoints (<wpt>) — the user's planned stops
    for i, wp in enumerate(waypoints):
        wpt = ET.SubElement(root, "wpt")
        wpt.set("lat", f"{wp['lat']:.6f}")
        wpt.set("lon", f"{wp['lng']:.6f}")
        wpt_name = wp.get("label") or f"Waypoint {i + 1}"
        ET.SubElement(wpt, "name").text = wpt_name
        if i == 0:
            ET.SubElement(wpt, "type").text = "start"
        elif i == len(waypoints) - 1:
            ET.SubElement(wpt, "type").text = "end"
        else:
            ET.SubElement(wpt, "type").text = "via"

    # Route (<rte>) — navigation points only (turns, junctions, roundabouts)
    nav_points = _extract_nav_points(route_data) if route_data else []

    if nav_points:
        rte = ET.SubElement(root, "rte")
        ET.SubElement(rte, "name").text = name
        if description:
            ET.SubElement(rte, "desc").text = description

        for pt in nav_points:
            rtept = ET.SubElement(rte, "rtept")
            rtept.set("lat", f"{pt['lat']:.6f}")
            rtept.set("lon", f"{pt['lon']:.6f}")
            if pt.get("name"):
                ET.SubElement(rtept, "name").text = pt["name"]
            if pt.get("desc"):
                ET.SubElement(rtept, "desc").text = pt["desc"]
    elif waypoints:
        # Fallback: if no maneuvers available, use waypoints as route points
        rte = ET.SubElement(root, "rte")
        ET.SubElement(rte, "name").text = name
        if description:
            ET.SubElement(rte, "desc").text = description
        for i, wp in enumerate(waypoints):
            rtept = ET.SubElement(rte, "rtept")
            rtept.set("lat", f"{wp['lat']:.6f}")
            rtept.set("lon", f"{wp['lng']:.6f}")
            ET.SubElement(rtept, "name").text = wp.get("label") or f"Waypoint {i + 1}"

    # Serialize
    tree = ET.ElementTree(root)
    buf = BytesIO()
    tree.write(buf, encoding="utf-8", xml_declaration=True)
    return buf.getvalue()


def _gpx_ns(root: ET.Element) -> str:
    """Extract XML namespace prefix from GPX root element."""
    if root.tag.startswith("{"):
        return root.tag.split("}")[0] + "}"
    return ""


def _extract_gpx_elements(
    root: ET.Element, ns: str
) -> tuple[list[dict], list[dict], list[list[float]]]:
    """Extract waypoints, route points, and track shape from a GPX XML tree.

    Returns (wpt_points, rte_points, track_shape).
    Shared by single-route import, trip ZIP import, and day import.
    """
    wpt_points = []
    for wpt in root.findall(f"{ns}wpt"):
        lat, lon = wpt.get("lat"), wpt.get("lon")
        if lat and lon:
            wpt_points.append({
                "lat": float(lat),
                "lng": float(lon),
                "label": _text(wpt, f"{ns}name") or None,
                "_type": _text(wpt, f"{ns}type") or "",
            })

    rte_points = []
    for rte in root.findall(f"{ns}rte"):
        for rtept in rte.findall(f"{ns}rtept"):
            lat, lon = rtept.get("lat"), rtept.get("lon")
            if lat and lon:
                rte_points.append({
                    "lat": float(lat),
                    "lng": float(lon),
                    "label": _text(rtept, f"{ns}name") or None,
                    "_desc": _text(rtept, f"{ns}desc") or "",
                })

    track_shape: list[list[float]] = []
    for trk in root.findall(f"{ns}trk"):
        for seg in trk.findall(f"{ns}trkseg"):
            for trkpt in seg.findall(f"{ns}trkpt"):
                lat, lon = trkpt.get("lat"), trkpt.get("lon")
                if lat and lon:
                    track_shape.append([float(lon), float(lat)])

    return wpt_points, rte_points, track_shape


def _text(el: ET.Element, path: str) -> str | None:
    """Safely get text from an XML element path."""
    found = el.find(path)
    return found.text if found is not None and found.text else None
