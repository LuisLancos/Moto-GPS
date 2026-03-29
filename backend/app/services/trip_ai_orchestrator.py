"""Trip AI orchestrator — ties together AI client, PostGIS POIs, and validation.

Takes a user conversation, gets AI suggestions, validates coordinates,
and enriches with real POI data from our PostGIS database.
"""

import logging
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_planner import (
    AIChatResponse,
    AISuggestions,
    SuggestedWaypoint,
    SuggestedDaySplit,
    POIResult,
)
from app.services.ai_client import chat_with_tools
from app.services.poi_service import find_pois_near_point

log = logging.getLogger("moto-gps.ai-orchestrator")


async def process_chat(
    messages: list[dict],
    route_type: str = "balanced",
    current_route_waypoints: list[dict] | None = None,
    current_route_data: dict | None = None,
    db: Optional[AsyncSession] = None,
    user_id: str | None = None,
) -> AIChatResponse:
    """Process a user message through the AI and return structured suggestions.

    Args:
        messages: Conversation history [{role, content}, ...]
        route_type: Current route type preference for context
        current_route_waypoints: If the user already has a route, pass waypoints
            so the AI can suggest POIs along it instead of planning from scratch.

    Returns:
        AIChatResponse with reply text and optional structured suggestions
    """
    enriched_messages = list(messages)

    # If there's an existing route, inject it as context so the AI knows the geography
    if current_route_waypoints and len(current_route_waypoints) >= 2:
        wp_desc = ", ".join(
            f"{wp.get('label', f'Point {i+1}')} ({wp['lat']:.3f}, {wp['lng']:.3f})"
            for i, wp in enumerate(current_route_waypoints)
        )
        context_msg = (
            f"[SYSTEM CONTEXT — the user already has a route planned with these waypoints: {wp_desc}. "
            f"Route type: {route_type}. When the user asks to add fuel stops, hotels, restaurants, or "
            f"other POIs, find real locations NEAR these waypoints. Do NOT replace the existing waypoints — "
            f"return them as poi_hints only, unless the user explicitly asks to change the route.]"
        )
        # Insert as the first user-role message for context
        enriched_messages.insert(0, {"role": "user", "content": context_msg})
        enriched_messages.insert(1, {"role": "assistant", "content": "Understood — I can see your existing route. How can I help enhance it?"})

    # Call the AI with route context for analysis tools
    try:
        result = await chat_with_tools(
            enriched_messages, db=db,
            current_route=current_route_data,
            current_waypoints=current_route_waypoints,
            user_id=user_id,
        )
    except Exception as e:
        log.error(f"AI call failed: {e}")
        return AIChatResponse(
            reply=f"Sorry, I'm having trouble connecting to the AI service. Please try again. ({type(e).__name__})",
            suggestions=None,
        )

    reply_text = result.get("reply", "")
    raw_suggestions = result.get("suggestions")
    route_actions = result.get("route_actions", [])

    if not raw_suggestions and not route_actions:
        return AIChatResponse(reply=reply_text, suggestions=None, route_actions=route_actions)

    if not raw_suggestions:
        return AIChatResponse(reply=reply_text, suggestions=None, route_actions=route_actions)

    # Parse and validate suggestions
    suggestions = _parse_suggestions(raw_suggestions)

    # Validate coordinates are sensible (within Europe/UK roughly)
    if suggestions.waypoints:
        valid_waypoints = []
        for wp in suggestions.waypoints:
            if _is_valid_coordinate(wp.lat, wp.lng):
                valid_waypoints.append(wp)
            else:
                log.warning(f"Filtered out invalid waypoint: {wp.label} ({wp.lat}, {wp.lng})")
        suggestions.waypoints = valid_waypoints

    # Replace AI-hallucinated POIs with real ones from PostGIS
    if suggestions.pois and db:
        real_pois = await _replace_with_real_pois(suggestions.pois, db)
        suggestions.pois = real_pois
        log.info(f"Enriched {len(real_pois)} POIs from PostGIS")
    elif suggestions.pois:
        # No DB session — just filter invalid coordinates
        suggestions.pois = [
            poi for poi in suggestions.pois
            if _is_valid_coordinate(poi.lat, poi.lng)
        ]

    return AIChatResponse(reply=reply_text, suggestions=suggestions, route_actions=route_actions)


def _parse_suggestions(raw: dict) -> AISuggestions:
    """Parse raw AI tool call output into typed AISuggestions."""
    waypoints = []
    for wp in raw.get("waypoints", []):
        try:
            waypoints.append(SuggestedWaypoint(
                lat=float(wp["lat"]),
                lng=float(wp["lng"]),
                label=str(wp.get("label", "Waypoint")),
            ))
        except (KeyError, ValueError, TypeError) as e:
            log.warning(f"Skipping malformed waypoint: {wp} ({e})")

    day_splits = []
    for ds in raw.get("day_splits", []):
        try:
            day_splits.append(SuggestedDaySplit(
                day=int(ds["day"]),
                name=str(ds.get("name", f"Day {ds['day']}")),
                description=ds.get("description"),
                start_waypoint_idx=int(ds["start_waypoint_idx"]),
                end_waypoint_idx=int(ds["end_waypoint_idx"]),
            ))
        except (KeyError, ValueError, TypeError) as e:
            log.warning(f"Skipping malformed day split: {ds} ({e})")

    pois = []
    for poi in raw.get("poi_hints", []):
        try:
            pois.append(POIResult(
                lat=float(poi["lat"]),
                lng=float(poi["lng"]),
                name=str(poi.get("name", "POI")),
                category=str(poi.get("category", "attraction")),
                description=poi.get("description"),
                is_biker_friendly=poi.get("category") in ("biker_cafe", "scenic_road"),
            ))
        except (KeyError, ValueError, TypeError) as e:
            log.warning(f"Skipping malformed POI: {poi} ({e})")

    return AISuggestions(waypoints=waypoints, day_splits=day_splits, pois=pois)


async def _replace_with_real_pois(
    ai_pois: list[POIResult],
    db: AsyncSession,
) -> list[POIResult]:
    """Replace AI-hallucinated POIs with real ones from our PostGIS database.

    For each AI-suggested POI, find the closest real POI of the same category
    within ~10km. If no match, keep the AI suggestion if it has valid coordinates.
    """
    # Map AI categories to our DB categories
    CATEGORY_MAP = {
        "fuel": ["fuel"],
        "restaurant": ["restaurant", "fast_food"],
        "pub": ["pub"],
        "castle": ["castle", "attraction", "historic"],
        "viewpoint": ["viewpoint", "attraction"],
        "museum": ["museum", "attraction"],
        "biker_cafe": ["biker_spot", "cafe"],
        "scenic_road": ["scenic_road"],
        "accommodation": ["hotel", "guest_house", "hostel", "camp_site"],
    }

    real_pois: list[POIResult] = []
    seen_names: set[str] = set()

    for ai_poi in ai_pois:
        if not _is_valid_coordinate(ai_poi.lat, ai_poi.lng):
            continue

        # Look up real POIs near the AI's suggested location
        db_categories = CATEGORY_MAP.get(ai_poi.category, [ai_poi.category])
        try:
            nearby = await find_pois_near_point(
                db=db,
                lat=ai_poi.lat,
                lng=ai_poi.lng,
                categories=db_categories,
                buffer_deg=0.1,  # ~10km
                limit=1,
            )
        except Exception as e:
            log.warning(f"PostGIS POI lookup failed for {ai_poi.name}: {e}")
            nearby = []

        if nearby:
            real = nearby[0]
            name = real["name"] or ai_poi.name
            # Avoid duplicates
            if name in seen_names:
                continue
            seen_names.add(name)
            real_pois.append(POIResult(
                lat=real["lat"],
                lng=real["lng"],
                name=name,
                category=ai_poi.category,  # Keep AI's category for icon mapping
                description=ai_poi.description or real.get("description"),
                brand=real.get("brand"),
                address=real.get("address"),
                is_biker_friendly=ai_poi.category in ("biker_cafe", "scenic_road"),
            ))
        else:
            # No match in DB — keep AI suggestion as-is (approximate location)
            if ai_poi.name not in seen_names:
                seen_names.add(ai_poi.name)
                real_pois.append(ai_poi)

    return real_pois


def _is_valid_coordinate(lat: float, lng: float) -> bool:
    """Check if coordinates are within a reasonable range (Europe + UK + nearby)."""
    # Broad Europe bounding box: lat 35-72, lng -25 to 45
    return 30.0 <= lat <= 75.0 and -30.0 <= lng <= 50.0
