import asyncio
import logging
import time

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.route import (
    RouteRequest, RouteResponse, RouteResult, RouteType, RoutePreferences,
    ROUTE_TYPE_PRESETS, RouteAnalysisRequest, RouteAnalysisResponse,
)
from app.services.valhalla_client import get_routes
from app.services.road_scorer import score_route
from app.services.route_cache import get_cached, set_cached
from app.services.route_analyzer import analyze_route
from app.db.database import get_db, async_session

logger = logging.getLogger("moto-gps.routing")

router = APIRouter()


@router.post("/route", response_model=RouteResponse)
async def plan_route(request: RouteRequest, db: AsyncSession = Depends(get_db)):
    """Plan a motorcycle route with parallel fan-out + score + rerank."""
    if len(request.waypoints) < 2:
        raise HTTPException(status_code=400, detail="At least 2 waypoints required")

    # Resolve preferences: explicit overrides route_type preset
    prefs = request.preferences or ROUTE_TYPE_PRESETS[request.route_type]

    # ---------- Step 7: Check cache ----------
    cached = get_cached(request.waypoints, prefs)
    if cached is not None:
        logger.info("Cache hit — returning instantly")
        return cached

    try:
        t0 = time.perf_counter()

        # ---------- Valhalla configs per route type ----------
        route_configs = _valhalla_configs(request.route_type, prefs)

        # Fire ALL Valhalla calls in parallel
        results = await asyncio.gather(
            *[get_routes(request.waypoints, **cfg) for cfg in route_configs],
            return_exceptions=True,
        )

        all_routes: list[RouteResult] = []
        for result in results:
            if isinstance(result, Exception):
                logger.warning(f"Valhalla call failed: {result}")
                continue
            all_routes.extend(result)

        t1 = time.perf_counter()
        logger.info(f"Valhalla routing: {t1-t0:.2f}s ({len(all_routes)} candidates)")

        if not all_routes:
            raise HTTPException(status_code=502, detail="All routing calls failed")

        # Deduplicate
        unique = _deduplicate_routes(all_routes)

        t2 = time.perf_counter()

        # ---------- Step 5: Parallel PostGIS scoring ----------
        # Each route scored in its own DB session from the pool.
        async def _score_one(route: RouteResult):
            try:
                async with async_session() as session:
                    route.moto_score = await score_route(session, route, prefs)
            except Exception as e:
                logger.warning(f"Scoring failed: {e}")
                route.moto_score = None

        await asyncio.gather(*[_score_one(r) for r in unique])

        t3 = time.perf_counter()
        logger.info(f"PostGIS scoring: {t3-t2:.2f}s ({len(unique)} routes)")

        # Sort by score (best first), with unscored at the end
        scored = [r for r in unique if r.moto_score is not None]
        unscored = [r for r in unique if r.moto_score is None]
        scored.sort(key=lambda r: r.moto_score or 0, reverse=True)

        final = (scored + unscored)[:3]

        response = RouteResponse(routes=final, waypoints=request.waypoints)

        # ---------- Step 7: Populate cache ----------
        set_cached(request.waypoints, prefs, response)

        logger.info(f"Total route planning: {t3-t0:.2f}s")
        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Routing failed: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=f"Routing failed: {str(e)}")


def _valhalla_configs(route_type: RouteType, prefs: RoutePreferences) -> list[dict]:
    """Return Valhalla costing parameter sets for the given route type."""
    if route_type == RouteType.fast:
        # Fast: prioritize highways and directness
        return [
            {"use_highways": 0.8, "use_trails": 0.0, "use_hills": 0.1, "alternates": 0},
            {"use_highways": 0.5, "use_trails": 0.0, "use_hills": 0.2, "alternates": 0},
            {"use_highways": 1.0, "use_trails": 0.0, "use_hills": 0.0, "alternates": 0},
        ]
    elif route_type == RouteType.scenic:
        # Scenic: avoid highways, prefer hills and trails
        return [
            {"use_highways": 0.0, "use_trails": 0.1, "use_hills": 0.8, "alternates": 0},
            {"use_highways": 0.0, "use_trails": 0.2, "use_hills": 0.6, "alternates": 0},
            {"use_highways": 0.0, "use_trails": 0.0, "use_hills": 0.5, "alternates": 0},
            {"use_highways": 0.0, "use_trails": 0.3, "use_hills": 0.9, "alternates": 0},
        ]
    else:
        # Balanced: mix of direct and scenic options
        return [
            {"use_highways": 0.0 if prefs.avoid_motorways else 0.5, "use_trails": 0.0, "use_hills": 0.5, "alternates": 0},
            {"use_highways": 0.0, "use_trails": 0.1, "use_hills": 0.8, "alternates": 0},
            {"use_highways": 0.3, "use_trails": 0.0, "use_hills": 0.2, "alternates": 0},
            {"use_highways": 0.0, "use_trails": 0.2, "use_hills": 0.6, "alternates": 0},
        ]


def _deduplicate_routes(routes: list[RouteResult]) -> list[RouteResult]:
    """Remove near-duplicate routes based on distance similarity."""
    if not routes:
        return []

    unique = [routes[0]]
    for route in routes[1:]:
        is_duplicate = False
        for existing in unique:
            if existing.distance_m > 0:
                dist_ratio = abs(route.distance_m - existing.distance_m) / existing.distance_m
                time_ratio = abs(route.time_s - existing.time_s) / max(existing.time_s, 1)
                if dist_ratio < 0.02 and time_ratio < 0.05:
                    is_duplicate = True
                    break
        if not is_duplicate:
            unique.append(route)

    return unique


# ---------- Route Analysis Endpoint ----------

@router.post("/route/analyze", response_model=RouteAnalysisResponse)
async def analyze_route_endpoint(
    request: RouteAnalysisRequest,
    db: AsyncSession = Depends(get_db),
):
    """Analyze a calculated route for anomalies and suggest improvements."""
    if len(request.waypoints) < 2:
        raise HTTPException(status_code=400, detail="At least 2 waypoints required")
    if not request.route.shape or len(request.route.shape) < 2:
        raise HTTPException(status_code=400, detail="Route has no shape data")

    try:
        result = await analyze_route(db, request.route, request.waypoints)
        logger.info(
            f"Route analysis: {len(result.anomalies)} anomalies "
            f"(health={result.overall_health}) in {result.analysis_time_ms}ms"
        )
        return result
    except Exception as e:
        logger.error(f"Route analysis failed: {e}", exc_info=True)
        # Return empty analysis on failure — don't break the UI
        return RouteAnalysisResponse(anomalies=[], overall_health="good", analysis_time_ms=0)
