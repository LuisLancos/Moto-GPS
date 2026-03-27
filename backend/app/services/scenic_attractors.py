"""Find high-scoring road segments to use as intermediate waypoints."""

import math
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.route import Waypoint


async def find_scenic_attractors(
    db: AsyncSession,
    waypoints: list[Waypoint],
    top_n: int = 3,
    buffer_factor: float = 0.3,
) -> list[Waypoint]:
    """Find the highest-scored road segments within the route corridor.

    Creates a bounding box between start and end (expanded by buffer_factor),
    then finds the top-N scoring road midpoints as candidate via-waypoints.
    """
    if len(waypoints) < 2:
        return []

    start = waypoints[0]
    end = waypoints[-1]

    # Create expanded bounding box
    min_lat = min(start.lat, end.lat)
    max_lat = max(start.lat, end.lat)
    min_lng = min(start.lng, end.lng)
    max_lng = max(start.lng, end.lng)

    lat_range = max_lat - min_lat
    lng_range = max_lng - min_lng

    # Expand by buffer factor (30% default)
    min_lat -= lat_range * buffer_factor
    max_lat += lat_range * buffer_factor
    min_lng -= lng_range * buffer_factor
    max_lng += lng_range * buffer_factor

    query = text("""
        SELECT
            ST_Y(ST_Centroid(geometry)) AS lat,
            ST_X(ST_Centroid(geometry)) AS lng,
            composite_moto_score,
            name,
            ref,
            road_class
        FROM road_segments
        WHERE geometry && ST_MakeEnvelope(:min_lng, :min_lat, :max_lng, :max_lat, 4326)
          AND composite_moto_score > 0.5
          AND road_class IN ('scenic_rural', 'b_road', 'minor_road')
          AND length_m > 500
        ORDER BY composite_moto_score DESC
        LIMIT :limit
    """)

    result = await db.execute(
        query,
        {
            "min_lat": min_lat,
            "max_lat": max_lat,
            "min_lng": min_lng,
            "max_lng": max_lng,
            "limit": top_n * 3,  # Fetch more than needed for spatial diversity
        },
    )
    rows = result.fetchall()

    if not rows:
        return []

    # Select spatially diverse attractors (don't cluster them)
    selected = []
    min_distance_km = 5.0  # At least 5km apart

    for row in rows:
        if len(selected) >= top_n:
            break

        too_close = False
        for existing in selected:
            dist = _haversine_km(row.lat, row.lng, existing.lat, existing.lng)
            if dist < min_distance_km:
                too_close = True
                break

        if not too_close:
            selected.append(
                Waypoint(
                    lat=row.lat,
                    lng=row.lng,
                    label=row.name or row.ref or f"Scenic ({row.composite_moto_score:.2f})",
                )
            )

    return selected


def _haversine_km(lat1, lon1, lat2, lon2):
    R = 6371
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))
