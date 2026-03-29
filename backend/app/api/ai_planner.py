"""AI Trip Planner API — conversational trip planning + POI enrichment."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.db.database import get_db
from app.models.ai_planner import (
    AIChatRequest,
    AIChatResponse,
    EnrichPOIsRequest,
    POIResult,
)
from app.services.trip_ai_orchestrator import process_chat
from app.services.overpass_client import find_pois_near_waypoints

log = logging.getLogger("moto-gps.ai-planner")

router = APIRouter(tags=["ai-planner"])


@router.post("/ai-planner/chat", response_model=AIChatResponse)
async def ai_chat(
    req: AIChatRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Conversational AI trip planning.

    Send conversation history and get back AI suggestions with waypoints,
    day splits, and points of interest — enriched with real POIs from PostGIS.
    """
    if not req.messages:
        raise HTTPException(status_code=400, detail="No messages provided")

    # Convert to simple dicts for the orchestrator
    messages = [{"role": m.role, "content": m.content} for m in req.messages]

    result = await process_chat(
        messages,
        route_type=req.route_type,
        current_route_waypoints=req.current_route_waypoints,
        current_route_data=req.current_route_data,
        db=db,
        user_id=user["id"],
    )

    log.info(
        f"AI chat: {len(req.messages)} msgs → "
        f"{len(result.suggestions.waypoints) if result.suggestions else 0} waypoints, "
        f"{len(result.suggestions.pois) if result.suggestions else 0} POIs"
    )

    return result


@router.post("/ai-planner/enrich-pois", response_model=list[POIResult])
async def enrich_pois(
    req: EnrichPOIsRequest,
    user: dict = Depends(get_current_user),
):
    """Enrich a route with real POIs from OpenStreetMap via Overpass API.

    Pass waypoints and desired categories to get nearby fuel stations,
    restaurants, attractions, etc.
    """
    if not req.waypoints:
        raise HTTPException(status_code=400, detail="No waypoints provided")

    waypoint_dicts = [{"lat": w.lat, "lng": w.lng} for w in req.waypoints]

    pois = await find_pois_near_waypoints(
        waypoints=waypoint_dicts,
        categories=req.categories,
        buffer_km=req.buffer_km,
    )

    return [
        POIResult(
            lat=p["lat"],
            lng=p["lng"],
            name=p["name"],
            category=p["category"],
            description=p.get("description"),
            is_biker_friendly=p.get("is_biker_friendly", False),
        )
        for p in pois
    ]
