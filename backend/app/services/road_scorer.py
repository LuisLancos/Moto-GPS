"""Score a route against PostGIS road segment data."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.route import RouteResult, RoutePreferences


async def score_route(
    db: AsyncSession,
    route: RouteResult,
    preferences: RoutePreferences,
) -> float:
    """Score a route by matching it against pre-scored road segments in PostGIS.

    Key optimization: uses individual POINT-based ST_DWithin instead of
    LineString-based. Each point query hits the GIST index with a tiny
    ~100m bounding box, whereas a LineString query creates a corridor
    spanning the entire route (millions of false-positive index hits).
    """
    if not route.shape or len(route.shape) < 2:
        return 0.0

    # Aggressive sampling: every 50th point
    # A 170-mile route has ~1700 points → ~34 sample points.
    # Each point with 0.001° buffer (~100m) catches nearby road segments.
    # 34 tiny GIST lookups is FAR faster than 1 giant corridor scan.
    sampled = route.shape[::50]
    if len(sampled) < 2:
        sampled = route.shape[::10]
    if len(sampled) < 2:
        sampled = route.shape

    # Build individual point geometries for fast GIST index lookups
    point_values = ", ".join(
        f"(ST_SetSRID(ST_MakePoint({lng}, {lat}), 4326))"
        for lng, lat in sampled
    )

    query = text(f"""
        WITH route_points(pt) AS (
            VALUES {point_values}
        ),
        nearby AS (
            SELECT DISTINCT ON (rs.id)
                   rs.id, rs.curvature_score, rs.scenic_score, rs.surface_score,
                   rs.urban_density_score, rs.elevation_score, rs.length_m
            FROM road_segments rs, route_points rp
            WHERE ST_DWithin(rs.geometry, rp.pt, 0.001)
              AND rs.length_m > 10
        )
        SELECT
            COALESCE(SUM(length_m), 0) AS total_length,
            COALESCE(SUM(curvature_score * length_m) / NULLIF(SUM(length_m), 0), 0) AS avg_curvature,
            COALESCE(SUM(scenic_score * length_m) / NULLIF(SUM(length_m), 0), 0) AS avg_scenic,
            COALESCE(SUM(surface_score * length_m) / NULLIF(SUM(length_m), 0), 0) AS avg_surface,
            COALESCE(SUM(urban_density_score * length_m) / NULLIF(SUM(length_m), 0), 0) AS avg_urban,
            COALESCE(SUM(elevation_score * length_m) / NULLIF(SUM(length_m), 0), 0) AS avg_elevation,
            COUNT(*) AS segment_count
        FROM nearby
    """)

    result = await db.execute(query)
    row = result.fetchone()

    if not row or row.total_length == 0:
        return 0.0

    score = (
        row.avg_curvature * preferences.curvature_weight
        + row.avg_scenic * preferences.scenic_weight
        + row.avg_surface * preferences.surface_weight
        + (1.0 - row.avg_urban) * preferences.urban_avoidance_weight
        + row.avg_elevation * preferences.elevation_weight
    )

    return max(0.0, min(1.0, score))
