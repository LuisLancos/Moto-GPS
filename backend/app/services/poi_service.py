"""Local PostGIS POI query service.

Queries the `pois` table (populated from OSM data) for POIs along a route corridor.
Uses the same ST_DWithin + GIST index pattern as road_scorer.py — <100ms response.
"""

import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger("moto-gps.pois")


def _build_address(tags: dict) -> str | None:
    """Build a readable address from OSM addr:* tags."""
    parts = []
    for key in ("addr:housenumber", "addr:street", "addr:city", "addr:postcode"):
        val = tags.get(key)
        if val:
            parts.append(val)
    return ", ".join(parts) if parts else None


async def find_pois_along_route(
    db: AsyncSession,
    shape: list[list[float]],
    categories: list[str],
    buffer_deg: float = 0.1,  # ~10km at UK latitudes
    max_results: int = 500,
) -> list[dict]:
    """Query POIs within a corridor around the route shape.

    Args:
        db: Async database session
        shape: Route shape as [[lat, lng], ...] — can be thousands of points
        categories: List of category IDs to include (e.g., ["fuel", "hotel"])
        buffer_deg: Search corridor radius in degrees (~0.01 ≈ 1km)
        max_results: Maximum POIs to return

    Returns:
        List of POI dicts with lat, lng, name, category, subcategory, description
    """
    if not shape or not categories:
        return []

    # Sample shape points (every 200th, or fewer for short routes)
    step = max(1, len(shape) // 15)
    sampled = shape[::step]
    if sampled[-1] != shape[-1]:
        sampled.append(shape[-1])

    # Shape from Valhalla is [lng, lat] — ST_MakePoint takes (lng, lat)
    point_values = ", ".join(
        f"(ST_SetSRID(ST_MakePoint({p[0]}, {p[1]}), 4326))"
        for p in sampled
    )

    # Build category IN clause with explicit values (ANY doesn't work with text() binds)
    import re as _re
    cat_list = ", ".join(f"'{c}'" for c in categories if _re.match(r'^[a-zA-Z0-9_]+$', c))

    query = text(f"""
        WITH route_points(pt) AS (
            VALUES {point_values}
        )
        SELECT DISTINCT ON (p.osm_id)
               p.osm_id, p.name, p.category, p.subcategory, p.lat, p.lng, p.tags
        FROM pois p, route_points rp
        WHERE ST_DWithin(p.geometry, rp.pt, :buffer)
          AND p.category IN ({cat_list})
        ORDER BY p.osm_id
        LIMIT :max_results
    """)

    log.info(f"POI SQL debug: {len(sampled)} points, buffer={buffer_deg}, cats={cat_list}")
    if sampled:
        log.info(f"POI first point: lat={sampled[0][0]}, lng={sampled[0][1]} → MakePoint({sampled[0][1]}, {sampled[0][0]})")

    result = await db.execute(
        query,
        {"buffer": buffer_deg, "max_results": max_results},
    )

    pois = []
    for r in result.fetchall():
        tags = r.tags if isinstance(r.tags, dict) else {}
        pois.append({
            "lat": float(r.lat),
            "lng": float(r.lng),
            "name": r.name,
            "category": r.category,
            "description": r.subcategory,
            # Rich detail fields from OSM tags
            "brand": tags.get("brand"),
            "address": _build_address(tags),
            "phone": tags.get("phone") or tags.get("contact:phone"),
            "website": tags.get("website") or tags.get("contact:website"),
            "opening_hours": tags.get("opening_hours"),
            "cuisine": tags.get("cuisine"),
            "wikidata": tags.get("wikidata") or tags.get("brand:wikidata"),
        })

    log.info(f"POI query: {len(pois)} results for {categories} ({len(sampled)} sample points)")
    return pois


async def find_pois_near_point(
    db: AsyncSession,
    lat: float,
    lng: float,
    categories: list[str],
    buffer_deg: float = 0.05,  # ~5km
    limit: int = 3,
) -> list[dict]:
    """Find nearest POIs to a single point, sorted by distance."""
    if not categories:
        return []

    import re as _re
    cat_list = ", ".join(f"'{c}'" for c in categories if _re.match(r'^[a-zA-Z0-9_]+$', c))
    if not cat_list:
        return []

    result = await db.execute(
        text(f"""
            SELECT osm_id, name, category, subcategory, lat, lng, tags,
                   ST_Distance(geometry, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)) as dist
            FROM pois
            WHERE ST_DWithin(geometry, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), :buffer)
              AND category IN ({cat_list})
            ORDER BY dist
            LIMIT :lim
        """),
        {"lng": lng, "lat": lat, "buffer": buffer_deg, "lim": limit},
    )

    pois = []
    for r in result.fetchall():
        tags = r.tags if isinstance(r.tags, dict) else {}
        pois.append({
            "lat": float(r.lat),
            "lng": float(r.lng),
            "name": r.name,
            "category": r.category,
            "description": r.subcategory,
            "brand": tags.get("brand"),
            "address": _build_address(tags),
            "distance_deg": float(r.dist),
            "distance_km": float(r.dist) * 111,  # rough deg→km at UK latitudes
        })
    return pois


async def search_pois(
    db: AsyncSession,
    query: str,
    limit: int = 10,
) -> list[dict]:
    """Full-text search POIs by name. Returns matching POIs sorted by relevance."""
    if not query or len(query) < 2:
        return []

    # Use ILIKE for simple substring matching (fast with GIN index if added later)
    search_term = f"%{query}%"

    result = await db.execute(
        text("""
            SELECT osm_id, name, category, subcategory, lat, lng, tags
            FROM pois
            WHERE name ILIKE :q
            ORDER BY
                CASE WHEN name ILIKE :exact THEN 0 ELSE 1 END,
                length(name)
            LIMIT :lim
        """),
        {"q": search_term, "exact": f"{query}%", "lim": limit},
    )

    pois = []
    for r in result.fetchall():
        tags = r.tags if isinstance(r.tags, dict) else {}
        pois.append({
            "lat": float(r.lat),
            "lng": float(r.lng),
            "name": r.name,
            "category": r.category,
            "description": r.subcategory,
            "address": _build_address(tags),
        })
    return pois


async def get_poi_stats(db: AsyncSession) -> dict:
    """Get POI counts by category for admin dashboard."""
    result = await db.execute(text(
        "SELECT category, count(*) as cnt FROM pois GROUP BY category ORDER BY cnt DESC"
    ))
    categories = {r.category: r.cnt for r in result.fetchall()}

    total_result = await db.execute(text("SELECT count(*) FROM pois"))
    total = total_result.scalar() or 0

    return {"total": total, "by_category": categories}
