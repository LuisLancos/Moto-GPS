import httpx
import json

from app.config import settings
from app.models.route import Waypoint, RouteResult, RouteLeg, RouteManeuver

# ---------- Persistent HTTP client (Step 2) ----------
# Reuses TCP connections across requests — eliminates per-call handshake overhead.
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=5.0),
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
    return _client


async def close_client():
    """Shut down the persistent client (called from app lifespan)."""
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
        _client = None


def _decode_polyline(encoded: str, precision: int = 6) -> list[list[float]]:
    """Decode a Valhalla encoded polyline into [[lng, lat], ...] pairs."""
    inv = 1.0 / (10**precision)
    decoded = []
    previous = [0, 0]
    i = 0
    while i < len(encoded):
        for dim in range(2):
            shift = 0
            result = 0
            while True:
                char_code = ord(encoded[i]) - 63
                i += 1
                result |= (char_code & 0x1F) << shift
                shift += 5
                if char_code < 0x20:
                    break
            if result & 1:
                result = ~result
            result >>= 1
            previous[dim] += result
        # Valhalla encodes as lat,lng — we return [lng, lat] for GeoJSON compat
        decoded.append([previous[1] * inv, previous[0] * inv])
    return decoded


async def get_routes(
    waypoints: list[Waypoint],
    use_highways: float = 0.5,
    use_trails: float = 0.0,
    use_hills: float = 0.5,
    alternates: int = 0,
) -> list[RouteResult]:
    """Request routes from Valhalla with motorcycle costing."""
    locations = [{"lat": wp.lat, "lon": wp.lng} for wp in waypoints]

    request_body = {
        "locations": locations,
        "costing": "motorcycle",
        "costing_options": {
            "motorcycle": {
                "use_highways": use_highways,
                "use_trails": use_trails,
                "use_hills": use_hills,
            }
        },
        "alternates": alternates,
        "units": "kilometers",
        "language": "en-GB",
    }

    client = _get_client()
    resp = await client.post(
        f"{settings.valhalla_url}/route",
        content=json.dumps(request_body),
        headers={"Content-Type": "application/json"},
    )
    resp.raise_for_status()
    data = resp.json()

    routes = []

    # Valhalla returns the primary trip + alternates
    trips = [data.get("trip", {})]
    for alt in data.get("alternates", []):
        trips.append(alt.get("trip", {}))

    for trip in trips:
        if not trip:
            continue

        summary = trip.get("summary", {})
        legs_data = trip.get("legs", [])

        # Concatenate shapes from ALL legs, tracking per-leg offsets
        # for day-slicing support
        shape: list[list[float]] = []
        leg_shape_offsets: list[tuple[int, int]] = []  # (start_idx, end_idx) per leg
        for leg in legs_data:
            leg_shape = _decode_polyline(leg.get("shape", ""))
            start_idx = len(shape)
            if shape and leg_shape:
                # Skip first point of subsequent legs (duplicate of previous leg's last point)
                leg_shape = leg_shape[1:]
            shape.extend(leg_shape)
            end_idx = len(shape) - 1
            leg_shape_offsets.append((start_idx, max(start_idx, end_idx)))

        legs = []
        maneuvers = []
        for leg_idx, leg in enumerate(legs_data):
            s_start, s_end = leg_shape_offsets[leg_idx] if leg_idx < len(leg_shape_offsets) else (0, 0)
            legs.append(
                RouteLeg(
                    distance_m=leg.get("summary", {}).get("length", 0) * 1000,
                    time_s=leg.get("summary", {}).get("time", 0),
                    shape=[],
                    shape_start_idx=s_start,
                    shape_end_idx=s_end,
                )
            )
            for m in leg.get("maneuvers", []):
                maneuvers.append(
                    RouteManeuver(
                        instruction=m.get("instruction", ""),
                        type=m.get("type", 0),
                        street_names=m.get("street_names", []),
                        length=m.get("length", 0),
                        time=m.get("time", 0),
                        begin_shape_index=m.get("begin_shape_index", 0),
                        end_shape_index=m.get("end_shape_index", 0),
                    )
                )

        routes.append(
            RouteResult(
                distance_m=summary.get("length", 0) * 1000,
                time_s=summary.get("time", 0),
                shape=shape,
                legs=legs,
                maneuvers=maneuvers,
                valhalla_params={
                    "use_highways": use_highways,
                    "use_trails": use_trails,
                    "use_hills": use_hills,
                },
            )
        )

    return routes
