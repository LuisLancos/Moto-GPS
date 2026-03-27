"""Simple in-memory route result cache with TTL."""

import hashlib
import json
import time

from app.models.route import Waypoint, RoutePreferences, RouteResponse

_cache: dict[str, tuple[float, RouteResponse]] = {}
_CACHE_TTL_S = 300  # 5 minutes
_MAX_CACHE_SIZE = 50


def _cache_key(waypoints: list[Waypoint], preferences: RoutePreferences) -> str:
    raw = json.dumps(
        {
            "wp": [(round(w.lat, 6), round(w.lng, 6)) for w in waypoints],
            "prefs": preferences.model_dump(),
        },
        sort_keys=True,
    )
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def get_cached(waypoints: list[Waypoint], preferences: RoutePreferences) -> RouteResponse | None:
    key = _cache_key(waypoints, preferences)
    if key in _cache:
        ts, response = _cache[key]
        if time.time() - ts < _CACHE_TTL_S:
            return response
        del _cache[key]
    return None


def set_cached(
    waypoints: list[Waypoint],
    preferences: RoutePreferences,
    response: RouteResponse,
):
    # Evict oldest if at capacity
    if len(_cache) >= _MAX_CACHE_SIZE:
        oldest_key = min(_cache, key=lambda k: _cache[k][0])
        del _cache[oldest_key]
    key = _cache_key(waypoints, preferences)
    _cache[key] = (time.time(), response)
