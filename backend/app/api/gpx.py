"""GPX export and import for routes and saved trips."""

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
MOTOGPS_NS = "https://motogps.app/gpx/1"


# ---------- Export ----------

@router.get("/trips/{trip_id}/gpx")
async def export_trip_gpx(trip_id: UUID, db: AsyncSession = Depends(get_db)):
    """Export a saved trip as a GPX file with route track + waypoints."""
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
    route_shape: str = Query(..., description="JSON array of [lng,lat] pairs"),
):
    """Export a current (unsaved) route as GPX. Accepts waypoints + shape as query JSON."""
    import json

    try:
        wps = json.loads(waypoints)
        shape = json.loads(route_shape)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON in waypoints or route_shape")

    route_data = {"shape": shape} if shape else None
    gpx_xml = _build_gpx(
        name=name,
        description=description or None,
        waypoints=wps,
        route_data=route_data,
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
    """Import a GPX file → extract waypoints and track points.

    Returns waypoints (from <wpt> or <rte>/<rtept>) and the track shape
    (from <trk>/<trkseg>/<trkpt>) so the frontend can load them.
    """
    content = await file.read()
    if len(content) > 10_000_000:  # 10MB limit
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

    try:
        root = ET.fromstring(content)
    except ET.ParseError:
        raise HTTPException(status_code=400, detail="Invalid GPX XML")

    # Handle namespace
    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag.split("}")[0] + "}"

    name = _text(root, f"{ns}metadata/{ns}name") or _text(root, f"{ns}name") or file.filename or "Imported Route"
    description = _text(root, f"{ns}metadata/{ns}desc") or _text(root, f"{ns}desc") or ""

    # Extract waypoints from <wpt> elements
    waypoints = []
    for wpt in root.findall(f"{ns}wpt"):
        lat = wpt.get("lat")
        lon = wpt.get("lon")
        if lat and lon:
            wpt_name = _text(wpt, f"{ns}name") or ""
            waypoints.append({
                "lat": float(lat),
                "lng": float(lon),
                "label": wpt_name or None,
            })

    # Extract route points from <rte>/<rtept> (if no <wpt> found)
    if not waypoints:
        for rte in root.findall(f"{ns}rte"):
            for rtept in rte.findall(f"{ns}rtept"):
                lat = rtept.get("lat")
                lon = rtept.get("lon")
                if lat and lon:
                    pt_name = _text(rtept, f"{ns}name") or ""
                    waypoints.append({
                        "lat": float(lat),
                        "lng": float(lon),
                        "label": pt_name or None,
                    })

    # Extract track shape from <trk>/<trkseg>/<trkpt>
    track_shape: list[list[float]] = []
    for trk in root.findall(f"{ns}trk"):
        for seg in trk.findall(f"{ns}trkseg"):
            for trkpt in seg.findall(f"{ns}trkpt"):
                lat = trkpt.get("lat")
                lon = trkpt.get("lon")
                if lat and lon:
                    track_shape.append([float(lon), float(lat)])  # [lng, lat] for GeoJSON compat

    # If we have track but no waypoints, sample start/end as waypoints
    if not waypoints and track_shape:
        waypoints.append({"lat": track_shape[0][1], "lng": track_shape[0][0], "label": "Start"})
        if len(track_shape) > 1:
            waypoints.append({"lat": track_shape[-1][1], "lng": track_shape[-1][0], "label": "End"})

    return {
        "name": name,
        "description": description,
        "waypoints": waypoints,
        "track_shape": track_shape,
        "waypoint_count": len(waypoints),
        "track_point_count": len(track_shape),
    }


# ---------- Helpers ----------

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
    """Build a GPX 1.1 XML document."""
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

    # Extensions in metadata (moto-specific)
    if any(v is not None for v in [distance_m, time_s, moto_score, route_type]):
        extensions = ET.SubElement(metadata, "extensions")
        if route_type:
            ET.SubElement(extensions, "motogps:route_type").text = route_type
        if distance_m is not None:
            ET.SubElement(extensions, "motogps:distance_m").text = f"{distance_m:.0f}"
        if time_s is not None:
            ET.SubElement(extensions, "motogps:time_s").text = f"{time_s:.0f}"
        if moto_score is not None:
            ET.SubElement(extensions, "motogps:moto_score").text = f"{moto_score:.4f}"

    # Waypoints (<wpt>) — the user's planned stops
    for i, wp in enumerate(waypoints):
        wpt = ET.SubElement(root, "wpt")
        wpt.set("lat", f"{wp['lat']:.6f}")
        wpt.set("lon", f"{wp['lng']:.6f}")
        wpt_name = wp.get("label") or f"Waypoint {i + 1}"
        ET.SubElement(wpt, "name").text = wpt_name
        # Type: start/end/via
        if i == 0:
            ET.SubElement(wpt, "type").text = "start"
        elif i == len(waypoints) - 1:
            ET.SubElement(wpt, "type").text = "end"
        else:
            ET.SubElement(wpt, "type").text = "via"

    # Track (<trk>) — the actual route geometry
    if route_data and route_data.get("shape"):
        trk = ET.SubElement(root, "trk")
        ET.SubElement(trk, "name").text = name
        if description:
            ET.SubElement(trk, "desc").text = description
        ET.SubElement(trk, "type").text = "motorcycle"

        trkseg = ET.SubElement(trk, "trkseg")
        for point in route_data["shape"]:
            # shape is [[lng, lat], ...]
            trkpt = ET.SubElement(trkseg, "trkpt")
            trkpt.set("lat", f"{point[1]:.6f}")
            trkpt.set("lon", f"{point[0]:.6f}")

    # Also add as <rte> for devices that prefer routes over tracks
    if waypoints:
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


def _text(el: ET.Element, path: str) -> str | None:
    """Safely get text from an XML element path."""
    found = el.find(path)
    return found.text if found is not None and found.text else None
