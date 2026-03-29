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

WORKFLOW (always 2 calls, never more):
1. Call search_nearby_pois ONCE with ALL the locations and categories you need (batch all queries)
2. Call suggest_trip_plan with the real POI data you found + waypoints + day splits
3. Your text reply should be conversational, enthusiastic about motorcycling, and explain your suggestions."""

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

# ---------- Provider implementations ----------


async def _gemini_chat(messages: list[dict], db=None) -> dict:
    """Call Google Gemini with multi-turn function calling.

    Supports two tools:
    1. search_nearby_pois — queries our PostGIS POI database (executed locally)
    2. suggest_trip_plan — returns the final structured trip suggestion

    When Gemini calls search_nearby_pois, we execute the query locally and
    return results so Gemini can use real POI data in its final response.
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

    # Define both tools
    tool_declarations = [
        genai.types.FunctionDeclaration(
            name=SEARCH_POIS_TOOL["name"],
            description=SEARCH_POIS_TOOL["description"],
            parameters=SEARCH_POIS_TOOL["parameters"],
        ),
        genai.types.FunctionDeclaration(
            name=TRIP_PLAN_TOOL["name"],
            description=TRIP_PLAN_TOOL["description"],
            parameters=TRIP_PLAN_TOOL["parameters"],
        ),
    ]
    tool = genai.types.Tool(function_declarations=tool_declarations)

    config = genai.types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        tools=[tool],
        temperature=0.7,
    )

    # Multi-turn loop: Gemini may call search_nearby_pois multiple times
    MAX_TOOL_ROUNDS = 5  # Prevent infinite loops
    reply_text = ""
    suggestions = None

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

        if not has_search_call:
            # Only had suggest_trip_plan (no more searches needed) — we're done
            break

        # Feed ALL function responses back to Gemini for the next round
        gemini_contents.append(response.candidates[0].content)
        gemini_contents.append({"role": "user", "parts": function_response_parts})

    return {"reply": reply_text, "suggestions": suggestions}


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


async def chat_with_tools(messages: list[dict], db=None) -> dict:
    """Send a conversation to the configured AI provider and get a response.

    Retries on rate limit (429) errors with exponential backoff.

    Args:
        messages: List of {role: "user"|"assistant", content: str}
        db: Optional AsyncSession for PostGIS POI queries (Gemini tool calls)

    Returns:
        {reply: str, suggestions: dict|None}
        suggestions has keys: waypoints, day_splits, poi_hints (all optional)
    """
    provider = settings.ai_provider.lower()

    if provider == "gemini":
        if not settings.gemini_api_key:
            raise ValueError("GEMINI_API_KEY not configured")
        call = lambda msgs: _gemini_chat(msgs, db=db)
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
