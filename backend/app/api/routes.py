import asyncio
import logging
import time

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.route import (
    RouteRequest, RouteResponse, RouteResult, RouteType, RoutePreferences,
    ROUTE_TYPE_PRESETS, RouteAnalysisRequest, RouteAnalysisResponse,
    MultiModeRouteRequest, DayOverlay, Waypoint, RouteLeg, RouteManeuver,
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


# ---------- Core routing helper (reused by both endpoints) ----------

async def _route_segment(
    waypoints: list[Waypoint],
    route_type: RouteType,
    prefs: RoutePreferences,
) -> RouteResult:
    """Route a single segment: fan-out → deduplicate → score → return top-1."""
    # Check cache
    cached = get_cached(waypoints, prefs)
    if cached is not None:
        return cached.routes[0]

    route_configs = _valhalla_configs(route_type, prefs)

    results = await asyncio.gather(
        *[get_routes(waypoints, **cfg) for cfg in route_configs],
        return_exceptions=True,
    )

    all_routes: list[RouteResult] = []
    for result in results:
        if isinstance(result, Exception):
            logger.warning(f"Valhalla call failed: {result}")
            continue
        all_routes.extend(result)

    if not all_routes:
        raise HTTPException(status_code=502, detail="All routing calls failed for segment")

    unique = _deduplicate_routes(all_routes)

    # Score in parallel
    async def _score_one(route: RouteResult):
        try:
            async with async_session() as session:
                route.moto_score = await score_route(session, route, prefs)
        except Exception as e:
            logger.warning(f"Scoring failed: {e}")
            route.moto_score = None

    await asyncio.gather(*[_score_one(r) for r in unique])

    scored = sorted(
        [r for r in unique if r.moto_score is not None],
        key=lambda r: r.moto_score or 0,
        reverse=True,
    )
    return scored[0] if scored else unique[0]


def _compose_day_routes(day_results: list[RouteResult]) -> RouteResult:
    """Stitch per-day RouteResults into a single composed route."""
    if len(day_results) == 1:
        return day_results[0]

    composed_shape: list[list[float]] = []
    composed_legs: list[RouteLeg] = []
    composed_maneuvers: list[RouteManeuver] = []
    total_distance = 0.0
    total_time = 0.0
    score_sum = 0.0
    score_dist = 0.0

    for day_route in day_results:
        offset = len(composed_shape)
        day_shape = day_route.shape

        if composed_shape and day_shape:
            # Skip first point (duplicate of previous day's last)
            day_shape = day_shape[1:]
            offset -= 1

        composed_shape.extend(day_shape)

        for leg in day_route.legs:
            composed_legs.append(RouteLeg(
                distance_m=leg.distance_m,
                time_s=leg.time_s,
                shape=[],
                shape_start_idx=leg.shape_start_idx + offset,
                shape_end_idx=leg.shape_end_idx + offset,
            ))

        for m in day_route.maneuvers:
            composed_maneuvers.append(RouteManeuver(
                instruction=m.instruction,
                type=m.type,
                street_names=m.street_names,
                length=m.length,
                time=m.time,
                begin_shape_index=m.begin_shape_index + offset,
                end_shape_index=m.end_shape_index + offset,
            ))

        total_distance += day_route.distance_m
        total_time += day_route.time_s
        if day_route.moto_score is not None:
            score_sum += day_route.moto_score * day_route.distance_m
            score_dist += day_route.distance_m

    avg_score = score_sum / score_dist if score_dist > 0 else None

    return RouteResult(
        distance_m=total_distance,
        time_s=total_time,
        shape=composed_shape,
        legs=composed_legs,
        maneuvers=composed_maneuvers,
        moto_score=avg_score,
        valhalla_params={"multi_mode": True},
    )


# ---------- Multi-Mode Endpoint ----------

@router.post("/route/multi-mode", response_model=RouteResponse)
async def plan_multi_mode_route(request: MultiModeRouteRequest):
    """Plan a route with per-day route modes. Each day can use a different route type."""
    if len(request.waypoints) < 2:
        raise HTTPException(status_code=400, detail="At least 2 waypoints required")
    if not request.day_overlays:
        raise HTTPException(status_code=400, detail="At least 1 day overlay required")

    # Validate overlays are contiguous
    sorted_days = sorted(request.day_overlays, key=lambda d: d.day)
    for i, day in enumerate(sorted_days):
        if i == 0 and day.start_waypoint_idx != 0:
            raise HTTPException(status_code=400, detail="First day must start at waypoint 0")
        if i > 0 and day.start_waypoint_idx != sorted_days[i - 1].end_waypoint_idx:
            raise HTTPException(status_code=400, detail=f"Day {day.day} doesn't connect to previous day")
    if sorted_days[-1].end_waypoint_idx != len(request.waypoints) - 1:
        raise HTTPException(status_code=400, detail="Last day must end at final waypoint")

    t0 = time.perf_counter()

    # Resolve per-day route types and calculate each segment in parallel
    async def _calc_day(day: DayOverlay) -> RouteResult:
        day_wps = request.waypoints[day.start_waypoint_idx : day.end_waypoint_idx + 1]
        if len(day_wps) < 2:
            raise HTTPException(status_code=400, detail=f"Day {day.day} needs at least 2 waypoints")

        # Resolve: day override → trip default
        day_type_str = day.route_type or request.route_type.value
        try:
            day_type = RouteType(day_type_str)
        except ValueError:
            day_type = request.route_type
        day_prefs = day.preferences or request.preferences or ROUTE_TYPE_PRESETS[day_type]

        return await _route_segment(day_wps, day_type, day_prefs)

    day_results = await asyncio.gather(
        *[_calc_day(day) for day in sorted_days],
        return_exceptions=True,
    )

    # Check for failures
    errors = [r for r in day_results if isinstance(r, Exception)]
    if len(errors) == len(day_results):
        raise HTTPException(status_code=502, detail="All day routing calls failed")
    for i, r in enumerate(day_results):
        if isinstance(r, Exception):
            logger.error(f"Day {sorted_days[i].day} routing failed: {r}")
            raise HTTPException(status_code=502, detail=f"Day {sorted_days[i].day} routing failed: {r}")

    # Compose into single route
    composed = _compose_day_routes(day_results)  # type: ignore[arg-type]
    response = RouteResponse(routes=[composed], waypoints=request.waypoints)

    t1 = time.perf_counter()
    day_types = [d.route_type or request.route_type.value for d in sorted_days]
    logger.info(f"Multi-mode routing: {t1-t0:.2f}s ({len(sorted_days)} days: {day_types})")

    return response


# ---------- Route POI Overlay ----------

from pydantic import BaseModel as _BaseModel

class RoutePOIRequest(_BaseModel):
    shape: list[list[float]]      # [[lat, lng], ...] from route
    categories: list[str]          # ["fuel", "hotel", "restaurant", ...]

@router.post("/route/pois")
async def get_route_pois(request: RoutePOIRequest, db: AsyncSession = Depends(get_db)):
    """Fetch real POIs along a route corridor from local PostGIS database."""
    if not request.shape or len(request.shape) < 2:
        raise HTTPException(status_code=400, detail="Route shape required")
    if not request.categories:
        raise HTTPException(status_code=400, detail="At least one category required")

    from app.services.poi_service import find_pois_along_route

    t0 = time.perf_counter()
    pois = await find_pois_along_route(db, request.shape, request.categories)
    t1 = time.perf_counter()

    logger.info(f"Route POI overlay: {len(pois)} POIs in {(t1-t0)*1000:.0f}ms ({request.categories})")
    return {"pois": pois}


@router.post("/route/poi-detail")
async def get_poi_detail(request: dict):
    """Fetch rich details for a specific POI (Google Places + Wikipedia)."""
    name = request.get("name")
    lat = request.get("lat")
    lng = request.get("lng")
    wikidata = request.get("wikidata")

    if not name or lat is None or lng is None:
        raise HTTPException(status_code=400, detail="name, lat, lng required")

    result: dict = {}

    # Try Google Places (if API key is set)
    try:
        from app.services.google_places import find_place
        google_data = await find_place(name, lat, lng)
        if google_data:
            result["google"] = google_data
    except Exception as e:
        logger.warning(f"Google Places enrichment failed: {e}")

    # Try Wikipedia (if wikidata ID available — free, no key needed)
    if wikidata:
        try:
            from app.services.valhalla_client import _get_client as _get_http
            client = _get_http()
            wiki_resp = await client.get(
                f"https://www.wikidata.org/w/api.php",
                params={
                    "action": "wbgetentities",
                    "ids": wikidata,
                    "props": "sitelinks",
                    "sitefilter": "enwiki",
                    "format": "json",
                },
            )
            wiki_data = wiki_resp.json()
            entities = wiki_data.get("entities", {})
            entity = entities.get(wikidata, {})
            en_title = entity.get("sitelinks", {}).get("enwiki", {}).get("title")

            if en_title:
                # Get Wikipedia summary + image
                summary_resp = await client.get(
                    f"https://en.wikipedia.org/api/rest_v1/page/summary/{en_title}"
                )
                if summary_resp.status_code == 200:
                    summary = summary_resp.json()
                    result["wikipedia"] = {
                        "title": summary.get("title"),
                        "extract": summary.get("extract", "")[:300],
                        "thumbnail": summary.get("thumbnail", {}).get("source"),
                        "url": summary.get("content_urls", {}).get("desktop", {}).get("page"),
                    }
        except Exception as e:
            logger.warning(f"Wikipedia enrichment failed: {e}")

    return result


@router.get("/poi-search")
async def search_pois_endpoint(q: str = "", db: AsyncSession = Depends(get_db)):
    """Search POIs by name (for waypoint search bar)."""
    if len(q) < 2:
        return {"results": []}
    from app.services.poi_service import search_pois
    results = await search_pois(db, q, limit=8)
    return {"results": results}


@router.get("/poi-categories")
async def list_poi_categories(db: AsyncSession = Depends(get_db)):
    """List enabled POI categories for map toggles."""
    result = await db.execute(text(
        "SELECT id, label, icon, display_order FROM poi_categories WHERE enabled = TRUE ORDER BY display_order"
    ))
    return [
        {"id": r.id, "label": r.label, "icon": r.icon}
        for r in result.fetchall()
    ]


# ---------- Route Analysis Endpoint ----------

@router.post("/route/snap")
async def snap_to_road(waypoint: dict):
    """Snap a coordinate to the nearest road using Valhalla's locate API.

    Returns the snapped lat/lng on the nearest motorcycle-routable road.
    """
    from app.services.valhalla_client import _get_client
    from app.config import settings
    import json as _json

    lat = waypoint.get("lat")
    lng = waypoint.get("lng")
    if lat is None or lng is None:
        raise HTTPException(status_code=400, detail="lat and lng required")

    try:
        client = _get_client()
        resp = await client.post(
            f"{settings.valhalla_url}/locate",
            content=_json.dumps({
                "locations": [{"lat": lat, "lon": lng}],
                "costing": "motorcycle",
                "verbose": False,
            }),
            headers={"Content-Type": "application/json"},
        )
        resp.raise_for_status()
        data = resp.json()

        # Valhalla returns array of results, one per input location
        if data and len(data) > 0:
            result = data[0]
            # Prefer edge snap (more accurate road position)
            edges = result.get("edges", [])
            if edges:
                snapped = {
                    "lat": edges[0].get("correlated_lat", lat),
                    "lng": edges[0].get("correlated_lon", lng),
                    "snapped": True,
                    "way_id": edges[0].get("way_id"),
                }
                return snapped

            # Fallback to node snap
            nodes = result.get("nodes", [])
            if nodes:
                return {
                    "lat": nodes[0].get("lat", lat),
                    "lng": nodes[0].get("lon", lng),
                    "snapped": True,
                }

        # No snap found — return original
        return {"lat": lat, "lng": lng, "snapped": False}

    except Exception as e:
        logger.warning(f"Snap-to-road failed: {e}")
        return {"lat": lat, "lng": lng, "snapped": False}


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
