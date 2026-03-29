"""Overpass API client for fetching real POIs from OpenStreetMap.

Queries fuel stations, restaurants, pubs, tourist attractions, etc.
along a route corridor defined by waypoints.
"""

import logging

import httpx

log = logging.getLogger("moto-gps.overpass")

OVERPASS_URLS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]

# Overpass QL category mapping
CATEGORY_QUERIES = {
    "fuel": '[amenity=fuel]',
    "restaurant": '[amenity~"restaurant|cafe"]',
    "pub": '[amenity=pub]',
    "hotel": '[tourism~"hotel|motel|guest_house"]',
    "castle": '[historic=castle]',
    "museum": '[tourism=museum]',
    "viewpoint": '[tourism=viewpoint]',
    "attraction": '[tourism=attraction]',
    "campsite": '[tourism=camp_site]',
}

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(60.0, connect=10.0),
            limits=httpx.Limits(max_connections=2, max_keepalive_connections=1),
        )
    return _client


async def close_overpass_client():
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
        _client = None


async def find_pois_near_waypoints(
    waypoints: list[dict],
    categories: list[str],
    buffer_km: float = 5.0,
) -> list[dict]:
    """Query Overpass API for POIs along a route corridor.

    Uses the `around` filter to search within buffer_km of the sample points,
    which is much more efficient than a giant bounding box.

    Args:
        waypoints: List of {lat, lng} dicts defining the route corridor
        categories: List of category keys (fuel, restaurant, pub, etc.)
        buffer_km: Search radius around the corridor in km

    Returns:
        List of {lat, lng, name, category, osm_id} dicts
    """
    if not waypoints or not categories:
        return []

    # Build per-point small bboxes (much more reliable than around filter)
    deg_buffer = buffer_km * 0.009  # ~0.009 deg/km at UK latitudes
    bbox_filters = []
    for cat in categories:
        ql = CATEGORY_QUERIES.get(cat)
        if not ql:
            continue
        for w in waypoints:
            s = w["lat"] - deg_buffer
            n = w["lat"] + deg_buffer
            we = w["lng"] - deg_buffer
            e = w["lng"] + deg_buffer
            bbox_filters.append(f"node{ql}({s},{we},{n},{e});")

    if not bbox_filters:
        return []

    query = f"""
    [out:json][timeout:25];
    (
      {"".join(bbox_filters)}
    );
    out 500;
    """

    log.info(f"Overpass query: {len(categories)} categories, {len(waypoints)} points, {buffer_km}km radius, {len(bbox_filters)} bboxes")

    # Try multiple Overpass servers with fallback
    data = None
    client = _get_client()
    for url in OVERPASS_URLS:
        try:
            resp = await client.post(url, data={"data": query})
            resp.raise_for_status()
            text = resp.text
            if not text or text.startswith("<"):
                log.warning(f"Overpass ({url}): got HTML/empty instead of JSON")
                continue
            data = resp.json()
            if "elements" in data:
                break  # Valid response
            log.warning(f"Overpass ({url}): no 'elements' in response")
            data = None
        except Exception as e:
            log.warning(f"Overpass API error ({url}): {e}")
            continue

    if data is None:
        log.error("All Overpass servers failed")
        return []

    # Parse results
    pois = []
    seen_ids: set[int] = set()

    for element in data.get("elements", []):
        osm_id = element.get("id")
        if osm_id in seen_ids:
            continue
        seen_ids.add(osm_id)

        tags = element.get("tags", {})
        name = tags.get("name", "")
        if not name:
            continue  # Skip unnamed POIs

        # Get coordinates (node has lat/lon directly, way has center)
        lat = element.get("lat") or element.get("center", {}).get("lat")
        lng = element.get("lon") or element.get("center", {}).get("lon")
        if not lat or not lng:
            continue

        # Determine category from tags
        category = _classify_poi(tags, categories)
        if not category:
            continue

        pois.append({
            "lat": lat,
            "lng": lng,
            "name": name,
            "category": category,
            "description": tags.get("description") or tags.get("cuisine") or None,
            "osm_id": osm_id,
            "is_biker_friendly": False,
        })

    log.info(f"Overpass returned {len(pois)} POIs")
    return pois


async def find_pois_along_route(
    shape: list[list[float]],
    categories: list[str],
    buffer_km: float = 3.0,
    max_sample_points: int = 6,
) -> list[dict]:
    """Query POIs along a route shape (sampled at even intervals).

    Args:
        shape: Route shape as [[lat, lng], ...] — can be thousands of points
        categories: Category keys to query
        buffer_km: Corridor radius in km
        max_sample_points: Max points to sample from shape for bounding

    Returns:
        Deduplicated list of POI dicts
    """
    if not shape or not categories:
        return []

    # Sample evenly from the shape to avoid overwhelming the bbox
    step = max(1, len(shape) // max_sample_points)
    sampled = shape[::step]
    # Always include last point
    if sampled[-1] != shape[-1]:
        sampled.append(shape[-1])

    # Convert to waypoint format for reuse
    waypoints = [{"lat": p[0], "lng": p[1]} for p in sampled]
    return await find_pois_near_waypoints(waypoints, categories, buffer_km)


def _classify_poi(tags: dict, requested_categories: list[str]) -> str | None:
    """Classify an OSM element into one of the requested categories."""
    amenity = tags.get("amenity", "")
    tourism = tags.get("tourism", "")
    historic = tags.get("historic", "")

    if "fuel" in requested_categories and amenity == "fuel":
        return "fuel"
    if "restaurant" in requested_categories and amenity in ("restaurant", "cafe"):
        return "restaurant"
    if "pub" in requested_categories and amenity == "pub":
        return "pub"
    if "hotel" in requested_categories and tourism in ("hotel", "motel", "guest_house"):
        return "hotel"
    if "castle" in requested_categories and historic == "castle":
        return "castle"
    if "museum" in requested_categories and tourism == "museum":
        return "museum"
    if "viewpoint" in requested_categories and tourism == "viewpoint":
        return "viewpoint"
    if "attraction" in requested_categories and tourism == "attraction":
        return "attraction"
    if "campsite" in requested_categories and tourism == "camp_site":
        return "campsite"
    return None
