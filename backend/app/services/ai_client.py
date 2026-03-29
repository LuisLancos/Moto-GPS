"""AI client abstraction — supports Gemini and OpenAI with function calling.

Follows the valhalla_client.py singleton pattern for persistent clients.
Both providers use function/tool calling to return structured waypoint data.
"""

import asyncio
import json
import logging

from app.config import settings

log = logging.getLogger("moto-gps.ai")

MAX_RETRIES = 3
RETRY_DELAY_S = 2  # seconds between retries on rate limit

# ---------- System prompt ----------

SYSTEM_PROMPT = """You are a motorcycle trip planning assistant for Moto-GPS, a smart motorcycle route planner.

You help riders plan multi-day motorcycle trips, primarily in the UK and Europe.

CRITICAL RULES:
- Always provide REAL geographic coordinates (lat/lng) for actual places. Never invent coordinates.
- If unsure about a location's exact coordinates, use the nearest well-known town or landmark.
- Consider motorcycle-specific factors:
  • Scenic B-roads and country lanes are preferred over motorways for scenic trips
  • Fuel range is typically 200-300km depending on the bike
  • Comfortable riding days are 300-500km; over 600km is tiring
  • Mountain passes, coastal roads, and historic routes are highly valued
  • Weather and road surface matter more on two wheels

YOU SUPPORT TWO MODES:

MODE 1 — PLAN A NEW TRIP (when no existing route is provided):
1. If the request is vague, ask 1-2 clarifying questions (e.g., pace, interests, number of days)
2. Suggest key waypoints with coordinates that form a logical motorcycle route
3. For multi-day trips, suggest how to split the days with overnight stop locations
4. Include hotels/accommodations as POIs near each overnight stop
5. Include fuel stations every 200-250km as POIs
6. Include relevant attractions (castles, viewpoints, biker cafes) as POIs

MODE 2 — ENHANCE AN EXISTING ROUTE (when current_route_waypoints is provided in the conversation):
The user already has a route planned. They want to add things to it. Examples:
- "Add fuel stops along my route" → return ONLY poi_hints with category "fuel" near the route waypoints
- "Find hotels near my overnight stops" → return ONLY poi_hints with category "accommodation"
- "What castles are near my route?" → return ONLY poi_hints with category "castle"
- "Add a lunch stop between waypoint 3 and 4" → could add a waypoint OR just a POI

In Mode 2, you should:
- NOT change the existing waypoints (leave the waypoints array empty) unless the user explicitly asks to modify the route
- Return poi_hints with real locations near the route corridor
- Use the existing route waypoints to understand the geographic area

YOU HAVE ACCESS TO TWO TOOLS:

1. search_nearby_pois — Searches our real POI database (83,000+ verified UK locations).
   Searches our database of 83,000+ real UK POIs in a SINGLE call.
   Pass multiple search queries at once — one per location+category you need.
   Example: search_nearby_pois(queries=[
     {"lat": 54.776, "lng": -1.575, "category": "hotel"},
     {"lat": 54.776, "lng": -1.575, "category": "biker_spot"},
     {"lat": 52.5, "lng": -1.9, "category": "castle"},
     {"lat": 53.0, "lng": -1.5, "category": "fuel"}
   ])
   Available categories: fuel, hotel, guest_house, restaurant, fast_food, pub, cafe, biker_spot, castle, attraction, viewpoint, museum, camp_site, historic

2. suggest_trip_plan — Returns your final structured suggestion (waypoints, day_splits, poi_hints).
   Use this AFTER you've found real POIs with search_nearby_pois.
   The poi_hints should contain the REAL POIs you found, not invented ones.

SAVED PLACES:
The user may have saved favourite places like "Home", "Work", "Mersea Island", etc.
When the user mentions a personal place name (e.g., "from home", "to work", "my house"),
call get_saved_places to look up the coordinates. Use the saved place's lat/lng directly.
Do NOT guess coordinates for personal place names — always look them up first.

WORKFLOW FOR TRIP PLANNING:
1. Call search_nearby_pois ONCE with ALL the locations and categories you need (batch all queries)
2. Call suggest_trip_plan with the real POI data you found + waypoints + day splits
3. Your text reply should be conversational, enthusiastic about motorcycling, and explain your suggestions.

MODE 3 — ROUTE ANALYSIS & REPAIR (when the user asks to check, review, analyze, or improve their route):

MANDATORY WORKFLOW — you MUST follow these steps IN ORDER:
1. FIRST call analyze_route — this runs our real route analyzer with 8 anomaly detectors.
   DO NOT skip this step. DO NOT make up your own analysis. The analyzer is the source of truth.
2. If the analyzer returns anomalies, explain each one in plain English.
   If it returns "good" health with 0 anomalies, tell the user the route looks good.
3. ONLY suggest fixes that the analyzer recommends. Each anomaly has a "fixes" array — use those.
4. ALWAYS ask for user approval before making ANY changes.
5. When approved, apply fixes using remove_waypoint, move_waypoint, or add_waypoint.
6. Call recalculate_route ONCE after ALL changes are made.

CRITICAL RULES FOR ROUTE REPAIR:
- NEVER remove a waypoint just because it's a hotel, B&B, or accommodation — those are overnight stops!
- NEVER remove the start (index 0) or end (last index) waypoints.
- NEVER invent your own issues — ONLY report what analyze_route returns.
- NEVER call remove_waypoint, move_waypoint, or add_waypoint WITHOUT first calling analyze_route.
- If analyze_route says "good" health and 0 anomalies, do NOT suggest changes.
- Each fix should match an anomaly from the analyzer. Don't freelance.
- When applying fixes, adjust indices for previous removals (remove idx 3 → idx 5 becomes idx 4).
- Be conservative — it's better to fix nothing than to make the route worse.
- NEVER reorganize or redesign the route. Your job is to fix specific issues, not change the trip.
- The user planned this route intentionally. Respect their choices. Only fix actual problems.
- If the user asks for improvements (e.g., "make it more scenic"), suggest ADDING waypoints
  to enhance the route — never remove or move existing waypoints unless fixing an analyzer issue.
- If analyze_route returns 0 anomalies, say "Your route looks good! No issues detected."
  DO NOT then invent changes to make."""

# ---------- Tool / function definitions ----------

# Tool 1: Batch search our local PostGIS POI database
SEARCH_POIS_TOOL = {
    "name": "search_nearby_pois",
    "description": "BATCH search the Moto-GPS local POI database. Pass ALL your queries at once — searches multiple locations and categories in a single call. Returns real POIs with verified coordinates. ALWAYS call this ONCE before suggest_trip_plan.",
    "parameters": {
        "type": "object",
        "properties": {
            "queries": {
                "type": "array",
                "description": "List of search queries — one per location+category needed",
                "items": {
                    "type": "object",
                    "properties": {
                        "lat": {"type": "number", "description": "Latitude"},
                        "lng": {"type": "number", "description": "Longitude"},
                        "category": {
                            "type": "string",
                            "enum": ["fuel", "hotel", "guest_house", "restaurant", "fast_food",
                                     "pub", "cafe", "biker_spot", "castle", "attraction",
                                     "viewpoint", "museum", "camp_site", "historic"],
                        },
                        "radius_km": {"type": "number", "description": "Search radius in km (default 10)"},
                        "limit": {"type": "integer", "description": "Max results per query (default 2)"},
                    },
                    "required": ["lat", "lng", "category"],
                },
            },
        },
        "required": ["queries"],
    },
}

# Tool 2: Suggest the trip plan (output tool)
TRIP_PLAN_TOOL = {
    "name": "suggest_trip_plan",
    "description": "Suggest waypoints for a new trip, OR points of interest along an existing route, OR both. Use waypoints only when planning a new route. Use poi_hints when adding fuel/hotels/attractions to an existing route.",
    "parameters": {
        "type": "object",
        "properties": {
            "waypoints": {
                "type": "array",
                "description": "Ordered list of key waypoints for the route",
                "items": {
                    "type": "object",
                    "properties": {
                        "lat": {"type": "number", "description": "Latitude"},
                        "lng": {"type": "number", "description": "Longitude"},
                        "label": {"type": "string", "description": "Place name"},
                    },
                    "required": ["lat", "lng", "label"],
                },
            },
            "day_splits": {
                "type": "array",
                "description": "How to split the trip into days (only for multi-day trips)",
                "items": {
                    "type": "object",
                    "properties": {
                        "day": {"type": "integer", "description": "Day number (1-based)"},
                        "name": {"type": "string", "description": "Day name, e.g. 'London to Cotswolds'"},
                        "description": {"type": "string", "description": "Brief day description"},
                        "start_waypoint_idx": {"type": "integer", "description": "Start waypoint index (0-based)"},
                        "end_waypoint_idx": {"type": "integer", "description": "End waypoint index (0-based)"},
                    },
                    "required": ["day", "name", "start_waypoint_idx", "end_waypoint_idx"],
                },
            },
            "poi_hints": {
                "type": "array",
                "description": "Points of interest or notable stops along the route",
                "items": {
                    "type": "object",
                    "properties": {
                        "lat": {"type": "number"},
                        "lng": {"type": "number"},
                        "name": {"type": "string"},
                        "category": {
                            "type": "string",
                            "enum": ["fuel", "restaurant", "pub", "castle", "viewpoint",
                                     "museum", "biker_cafe", "scenic_road", "accommodation"],
                        },
                        "description": {"type": "string"},
                    },
                    "required": ["lat", "lng", "name", "category"],
                },
            },
        },
        "required": [],
    },
}

# Tool 3: Analyze route for issues (uses existing route_analyzer)
ANALYZE_ROUTE_TOOL = {
    "name": "analyze_route",
    "description": "Check the current route for issues like backtracking, U-turns, missed scenic roads, road quality drops, and unnecessary close waypoints. Call this when the user asks to check, review, analyze, or improve their route. No parameters needed — uses the current route from context.",
    "parameters": {"type": "object", "properties": {}, "required": []},
}

# Tool 4: Remove a waypoint
REMOVE_WAYPOINT_TOOL = {
    "name": "remove_waypoint",
    "description": "Remove a waypoint from the route by its index. Use to fix backtracking, remove unnecessary close waypoints, or simplify the route. Remember: after removing, subsequent indices shift down by 1.",
    "parameters": {
        "type": "object",
        "properties": {
            "index": {"type": "integer", "description": "0-based waypoint index to remove. 0 is the start, last index is the end."},
            "reason": {"type": "string", "description": "Brief explanation of why this waypoint should be removed"},
        },
        "required": ["index", "reason"],
    },
}

# Tool 5: Move a waypoint to new coordinates
MOVE_WAYPOINT_TOOL = {
    "name": "move_waypoint",
    "description": "Move an existing waypoint to new coordinates. Use to redirect the route through a better road, fix a detour, or improve the route path.",
    "parameters": {
        "type": "object",
        "properties": {
            "index": {"type": "integer", "description": "0-based waypoint index to move"},
            "lat": {"type": "number", "description": "New latitude"},
            "lng": {"type": "number", "description": "New longitude"},
            "reason": {"type": "string", "description": "Brief explanation of why this waypoint is being moved"},
        },
        "required": ["index", "lat", "lng", "reason"],
    },
}

# Tool 6: Add a new waypoint
ADD_WAYPOINT_TOOL = {
    "name": "add_waypoint",
    "description": "Add a new waypoint to the route. Use to route through a scenic road, bypass a poor road section, or add a stop. The waypoint will be inserted after the specified index, or at the closest segment if after_index is omitted.",
    "parameters": {
        "type": "object",
        "properties": {
            "lat": {"type": "number", "description": "Latitude of the new waypoint"},
            "lng": {"type": "number", "description": "Longitude of the new waypoint"},
            "label": {"type": "string", "description": "Name/label for the waypoint"},
            "after_index": {"type": "integer", "description": "Insert after this waypoint index (0-based). If omitted, auto-inserts at closest route segment."},
            "reason": {"type": "string", "description": "Brief explanation of why this waypoint is being added"},
        },
        "required": ["lat", "lng", "label", "reason"],
    },
}

# Tool 7: Get user's saved places (favourites like Home, Work, etc.)
GET_SAVED_PLACES_TOOL = {
    "name": "get_saved_places",
    "description": "Get the user's saved favourite places (Home, Work, frequent destinations). "
                   "Call this FIRST when the user mentions a place by a personal name like 'home', 'work', "
                   "'my house', or any name that sounds like a saved place rather than a geographic location. "
                   "Returns a list of saved places with coordinates.",
    "parameters": {"type": "object", "properties": {}, "required": []},
}

# Tool 8: Recalculate route
RECALCULATE_ROUTE_TOOL = {
    "name": "recalculate_route",
    "description": "Trigger route recalculation after making waypoint changes (add/remove/move). Call this after finishing all modifications.",
    "parameters": {"type": "object", "properties": {}, "required": []},
}

# Tool 8: Get current route info
GET_ROUTE_INFO_TOOL = {
    "name": "get_route_info",
    "description": "Get the current state of the route: list of waypoints with labels, total distance, estimated time, and moto score. Use to verify your changes or understand the current route before making suggestions.",
    "parameters": {"type": "object", "properties": {}, "required": []},
}

# ---------- Provider implementations ----------


async def _gemini_chat(messages: list[dict], db=None,
                       current_route: dict | None = None,
                       current_waypoints: list[dict] | None = None,
                       user_id: str | None = None) -> dict:
    """Call Google Gemini with multi-turn function calling.

    Supports 8 tools:
    1. search_nearby_pois — queries our PostGIS POI database
    2. suggest_trip_plan — returns structured trip suggestion
    3. analyze_route — runs route analysis for issues
    4. remove_waypoint — queue a waypoint removal
    5. move_waypoint — queue a waypoint move
    6. add_waypoint — queue a waypoint addition
    7. recalculate_route — queue route recalculation
    8. get_route_info — return current route state
    """
    from google import genai

    client = genai.Client(api_key=settings.gemini_api_key)

    # Convert messages to Gemini format
    gemini_contents = []
    for msg in messages:
        if msg["role"] == "user":
            gemini_contents.append({"role": "user", "parts": [{"text": msg["content"]}]})
        elif msg["role"] == "assistant":
            gemini_contents.append({"role": "model", "parts": [{"text": msg["content"]}]})

    # Define all tools
    all_tool_defs = [
        SEARCH_POIS_TOOL, TRIP_PLAN_TOOL,
        ANALYZE_ROUTE_TOOL, REMOVE_WAYPOINT_TOOL, MOVE_WAYPOINT_TOOL,
        ADD_WAYPOINT_TOOL, GET_SAVED_PLACES_TOOL,
        RECALCULATE_ROUTE_TOOL, GET_ROUTE_INFO_TOOL,
    ]
    tool_declarations = [
        genai.types.FunctionDeclaration(
            name=t["name"], description=t["description"], parameters=t["parameters"],
        )
        for t in all_tool_defs
    ]
    tool = genai.types.Tool(function_declarations=tool_declarations)

    config = genai.types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        tools=[tool],
        temperature=0.7,
    )

    # Multi-turn loop: Gemini may call tools multiple times
    MAX_TOOL_ROUNDS = 8  # Allow more rounds for analysis + multi-step fixes
    reply_text = ""
    suggestions = None
    route_actions: list[dict] = []  # Accumulated route modification actions

    for round_num in range(MAX_TOOL_ROUNDS):
        response = await client.aio.models.generate_content(
            model="gemini-2.0-flash",
            contents=gemini_contents,
            config=config,
        )

        if not response.candidates or not response.candidates[0].content.parts:
            break

        # Collect ALL function calls from this turn and respond to each one
        function_calls = []
        function_response_parts = []
        has_search_call = False
        has_route_tool_call = False

        for part in response.candidates[0].content.parts:
            if hasattr(part, "text") and part.text:
                reply_text += part.text

            if hasattr(part, "function_call") and part.function_call:
                function_calls.append(part.function_call)

        # Process each function call — Gemini requires a response for EVERY call
        for fc in function_calls:
            args = dict(fc.args) if fc.args else {}

            if fc.name == "suggest_trip_plan":
                # Final output — extract suggestions and return a confirmation
                suggestions = args
                log.info(f"AI round {round_num+1}: suggest_trip_plan with {len(args.get('waypoints', []))} wp, {len(args.get('poi_hints', []))} pois")
                function_response_parts.append(
                    genai.types.Part(function_response=genai.types.FunctionResponse(
                        name="suggest_trip_plan",
                        response={"status": "ok", "applied": True},
                    ))
                )

            elif fc.name == "search_nearby_pois":
                # Execute POI search against our PostGIS database
                has_search_call = True
                poi_results = await _execute_poi_search(args, db)
                lat_val = float(args.get("lat", 0))
                lng_val = float(args.get("lng", 0))
                log.info(f"AI round {round_num+1}: search_nearby_pois({args.get('category')} near {lat_val:.3f},{lng_val:.3f}) → {len(poi_results)} results")
                function_response_parts.append(
                    genai.types.Part(function_response=genai.types.FunctionResponse(
                        name="search_nearby_pois",
                        response={"results": poi_results},
                    ))
                )

            elif fc.name == "analyze_route":
                # Run the existing route analyzer
                has_route_tool_call = True
                if current_route and current_waypoints:
                    try:
                        from app.services.route_analyzer import analyze_route as _analyze
                        from app.models.route import RouteResult, Waypoint as WaypointModel
                        # Build models from dicts
                        route_obj = RouteResult(**current_route) if isinstance(current_route, dict) else current_route
                        wp_objs = [WaypointModel(**w) if isinstance(w, dict) else w for w in current_waypoints]
                        analysis = await _analyze(db, route_obj, wp_objs)
                        result = {
                            "overall_health": analysis.overall_health,
                            "anomaly_count": len(analysis.anomalies),
                            "anomalies": [
                                {
                                    "type": a.type, "severity": a.severity,
                                    "title": a.title,
                                    "description": a.description,
                                    "affected_waypoint_index": a.affected_waypoint_index,
                                    "fixes": [
                                        {"action": f.action, "waypoint_index": f.waypoint_index,
                                         "suggested_coord": f.suggested_coord, "description": f.description}
                                        for f in (a.fixes or [])
                                    ],
                                }
                                for a in analysis.anomalies
                            ],
                        }
                        log.info(f"AI round {round_num+1}: analyze_route → {analysis.overall_health}, {len(analysis.anomalies)} anomalies")
                    except Exception as e:
                        log.warning(f"Route analysis failed: {e}")
                        result = {"error": f"Analysis failed: {str(e)}"}
                else:
                    result = {"error": "No route loaded. The user needs to plan a route first before it can be analyzed."}
                function_response_parts.append(
                    genai.types.Part(function_response=genai.types.FunctionResponse(
                        name="analyze_route", response=result,
                    ))
                )

            elif fc.name == "remove_waypoint":
                has_route_tool_call = True
                idx = int(args.get("index", -1))
                label = "unknown"
                if current_waypoints and 0 <= idx < len(current_waypoints):
                    label = current_waypoints[idx].get("label", f"waypoint {idx}")
                route_actions.append({
                    "type": "remove_waypoint", "index": idx,
                    "reason": args.get("reason", ""),
                })
                log.info(f"AI round {round_num+1}: remove_waypoint({idx}) — {label}")
                function_response_parts.append(
                    genai.types.Part(function_response=genai.types.FunctionResponse(
                        name="remove_waypoint",
                        response={"success": True, "removed": label, "index": idx},
                    ))
                )

            elif fc.name == "move_waypoint":
                has_route_tool_call = True
                idx = int(args.get("index", -1))
                lat = float(args.get("lat", 0))
                lng = float(args.get("lng", 0))
                route_actions.append({
                    "type": "move_waypoint", "index": idx,
                    "lat": lat, "lng": lng,
                    "reason": args.get("reason", ""),
                })
                log.info(f"AI round {round_num+1}: move_waypoint({idx}) → ({lat:.4f}, {lng:.4f})")
                function_response_parts.append(
                    genai.types.Part(function_response=genai.types.FunctionResponse(
                        name="move_waypoint",
                        response={"success": True, "moved": f"waypoint {idx}", "to": f"{lat:.4f}, {lng:.4f}"},
                    ))
                )

            elif fc.name == "add_waypoint":
                has_route_tool_call = True
                lat = float(args.get("lat", 0))
                lng = float(args.get("lng", 0))
                label = args.get("label", "New waypoint")
                after_idx = args.get("after_index")
                route_actions.append({
                    "type": "add_waypoint", "lat": lat, "lng": lng,
                    "label": label, "after_index": after_idx,
                    "reason": args.get("reason", ""),
                })
                log.info(f"AI round {round_num+1}: add_waypoint({label}) at ({lat:.4f}, {lng:.4f})")
                function_response_parts.append(
                    genai.types.Part(function_response=genai.types.FunctionResponse(
                        name="add_waypoint",
                        response={"success": True, "added": label},
                    ))
                )

            elif fc.name == "recalculate_route":
                has_route_tool_call = True
                route_actions.append({"type": "recalculate"})
                log.info(f"AI round {round_num+1}: recalculate_route")
                function_response_parts.append(
                    genai.types.Part(function_response=genai.types.FunctionResponse(
                        name="recalculate_route",
                        response={"success": True, "message": "Route will be recalculated after applying all changes"},
                    ))
                )

            elif fc.name == "get_route_info":
                has_route_tool_call = True
                if current_route and current_waypoints:
                    wp_count = len(current_waypoints)
                    wp_list = []
                    for i, w in enumerate(current_waypoints):
                        label = w.get("label", f"wp {i}")
                        role = "waypoint"
                        if i == 0:
                            role = "start"
                        elif i == wp_count - 1:
                            role = "end"
                        # Detect overnight stops by label keywords
                        label_lower = (label or "").lower()
                        if any(kw in label_lower for kw in ["hotel", "b&b", "inn", "lodge", "guest house", "accommodation", "overnight"]):
                            role = "overnight_stop"
                        wp_list.append({"index": i, "lat": w.get("lat"), "lng": w.get("lng"), "label": label, "role": role})
                    result = {
                        "waypoint_count": wp_count,
                        "waypoints": wp_list,
                        "distance_km": round((current_route.get("distance_m", 0) or 0) / 1000, 1),
                        "time_hours": round((current_route.get("time_s", 0) or 0) / 3600, 1),
                        "moto_score": round((current_route.get("moto_score", 0) or 0) * 100),
                        "note": "Waypoints with role 'overnight_stop' are accommodation stops — do NOT remove them.",
                    }
                else:
                    result = {"error": "No route loaded."}
                function_response_parts.append(
                    genai.types.Part(function_response=genai.types.FunctionResponse(
                        name="get_route_info", response=result,
                    ))
                )

            elif fc.name == "get_saved_places":
                has_route_tool_call = True
                if db and user_id:
                    try:
                        from sqlalchemy import text as sql_text
                        result_rows = await db.execute(
                            sql_text("SELECT name, lat, lng, icon, category, address FROM saved_places WHERE user_id = :uid ORDER BY sort_order, name"),
                            {"uid": user_id},
                        )
                        places = [
                            {"name": r.name, "lat": r.lat, "lng": r.lng, "icon": r.icon, "category": r.category, "address": r.address}
                            for r in result_rows.fetchall()
                        ]
                        result = {"places": places, "count": len(places)}
                        log.info(f"AI round {round_num+1}: get_saved_places → {len(places)} places")
                    except Exception as e:
                        log.warning(f"Saved places query failed: {e}")
                        result = {"places": [], "error": str(e)}
                else:
                    result = {"places": [], "note": "No user context available"}
                function_response_parts.append(
                    genai.types.Part(function_response=genai.types.FunctionResponse(
                        name="get_saved_places", response=result,
                    ))
                )

            else:
                # Unknown function — send empty response to avoid Gemini error
                function_response_parts.append(
                    genai.types.Part(function_response=genai.types.FunctionResponse(
                        name=fc.name,
                        response={"error": f"Unknown function: {fc.name}"},
                    ))
                )

        if not function_calls:
            # No function calls at all — just text response, we're done
            break

        if not has_search_call and not has_route_tool_call:
            # Only had suggest_trip_plan (no more actions needed) — we're done
            break

        # Feed ALL function responses back to Gemini for the next round
        gemini_contents.append(response.candidates[0].content)
        gemini_contents.append({"role": "user", "parts": function_response_parts})

    return {"reply": reply_text, "suggestions": suggestions, "route_actions": route_actions}


async def _execute_poi_search(args: dict, db=None) -> list[dict]:
    """Execute a batch search_nearby_pois tool call against PostGIS.

    Args format: {"queries": [{"lat": ..., "lng": ..., "category": ..., "radius_km": ..., "limit": ...}, ...]}
    Also supports legacy single-query format: {"lat": ..., "lng": ..., "category": ...}
    """
    if not db:
        log.warning("No DB session for POI search — returning empty")
        return []

    from app.services.poi_service import find_pois_near_point

    # Support both batch and single query formats
    queries = args.get("queries", [])
    if not queries and "lat" in args:
        # Legacy single-query format
        queries = [args]

    all_results = []
    seen = set()  # Deduplicate by name

    for q in queries[:20]:  # Cap at 20 queries per batch
        try:
            lat = float(q.get("lat", 0))
            lng = float(q.get("lng", 0))
            category = str(q.get("category", "fuel"))
            radius_km = min(float(q.get("radius_km", 10)), 30)
            limit = min(int(q.get("limit", 2)), 5)

            buffer_deg = radius_km / 111
            results = await find_pois_near_point(
                db=db,
                lat=lat,
                lng=lng,
                categories=[category],
                buffer_deg=buffer_deg,
                limit=limit,
            )

            for r in results:
                name = r["name"]
                if name and name not in seen:
                    seen.add(name)
                    all_results.append({
                        "name": name,
                        "lat": r["lat"],
                        "lng": r["lng"],
                        "category": r["category"],
                        "brand": r.get("brand"),
                        "address": r.get("address"),
                        "distance_km": round(r.get("distance_km", 0), 1),
                    })
        except Exception as e:
            log.warning(f"POI query failed for {q}: {e}")

    log.info(f"Batch POI search: {len(queries)} queries → {len(all_results)} unique results")
    return all_results


async def _openai_chat(messages: list[dict]) -> dict:
    """Call OpenAI with function calling."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.openai_api_key)

    # Build messages with system prompt
    openai_messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for msg in messages:
        openai_messages.append({"role": msg["role"], "content": msg["content"]})

    # Define tool
    tools = [
        {
            "type": "function",
            "function": {
                "name": TRIP_PLAN_TOOL["name"],
                "description": TRIP_PLAN_TOOL["description"],
                "parameters": TRIP_PLAN_TOOL["parameters"],
            },
        }
    ]

    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=openai_messages,
        tools=tools,
        tool_choice="auto",
        temperature=0.7,
    )

    choice = response.choices[0]
    reply_text = choice.message.content or ""
    suggestions = None

    if choice.message.tool_calls:
        for tc in choice.message.tool_calls:
            if tc.function.name == "suggest_trip_plan":
                try:
                    suggestions = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    log.warning("Failed to parse OpenAI function call arguments")

    return {"reply": reply_text, "suggestions": suggestions}


# ---------- Public API ----------


async def chat_with_tools(messages: list[dict], db=None,
                          current_route: dict | None = None,
                          current_waypoints: list[dict] | None = None,
                          user_id: str | None = None) -> dict:
    """Send a conversation to the configured AI provider and get a response.

    Retries on rate limit (429) errors with exponential backoff.

    Args:
        messages: List of {role: "user"|"assistant", content: str}
        db: Optional AsyncSession for PostGIS POI queries (Gemini tool calls)
        current_route: Current route data (shape, legs, maneuvers) for analysis tools
        current_waypoints: Current waypoints for analysis tools

    Returns:
        {reply: str, suggestions: dict|None, route_actions: list[dict]}
    """
    provider = settings.ai_provider.lower()

    if provider == "gemini":
        if not settings.gemini_api_key:
            raise ValueError("GEMINI_API_KEY not configured")
        call = lambda msgs: _gemini_chat(msgs, db=db, current_route=current_route, current_waypoints=current_waypoints, user_id=user_id)
    elif provider == "openai":
        if not settings.openai_api_key:
            raise ValueError("OPENAI_API_KEY not configured")
        call = _openai_chat
    else:
        raise ValueError(f"Unknown AI provider: {provider}. Use 'gemini' or 'openai'.")

    # Retry on rate limit errors
    for attempt in range(MAX_RETRIES):
        try:
            return await call(messages)
        except Exception as e:
            err_str = str(e).lower()
            is_rate_limit = "429" in err_str or "resource_exhausted" in err_str or "rate" in err_str
            if is_rate_limit and attempt < MAX_RETRIES - 1:
                delay = RETRY_DELAY_S * (attempt + 1)
                log.warning(f"Rate limited, retrying in {delay}s (attempt {attempt + 1}/{MAX_RETRIES})")
                await asyncio.sleep(delay)
                continue
            raise

    # Should never reach here
    raise RuntimeError("AI call failed after retries")
