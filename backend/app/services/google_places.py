"""Google Places API client for POI enrichment (photos, ratings, reviews).

Optional — only works if GOOGLE_PLACES_API_KEY is set in .env.
Uses the Places API (New) — Nearby Search and Place Details.
"""

import os
import logging

import httpx

log = logging.getLogger("moto-gps.google-places")

PLACES_API_URL = "https://places.googleapis.com/v1/places:searchNearby"
PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places"
PLACE_PHOTO_URL = "https://places.googleapis.com/v1"

_client: httpx.AsyncClient | None = None


def _get_api_key() -> str | None:
    return os.getenv("GOOGLE_PLACES_API_KEY") or None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0))
    return _client


async def find_place(name: str, lat: float, lng: float) -> dict | None:
    """Find a place by name and location, return details with photo URL.

    Returns dict with: name, rating, user_ratings_total, photo_url, google_maps_url, types
    Returns None if API key not set or place not found.
    """
    api_key = _get_api_key()
    if not api_key:
        return None

    client = _get_client()

    try:
        # Use Text Search to find the specific place
        resp = await client.post(
            "https://places.googleapis.com/v1/places:searchText",
            headers={
                "X-Goog-Api-Key": api_key,
                "X-Goog-FieldMask": "places.displayName,places.rating,places.userRatingCount,places.photos,places.googleMapsUri,places.formattedAddress,places.currentOpeningHours",
            },
            json={
                "textQuery": name,
                "locationBias": {
                    "circle": {
                        "center": {"latitude": lat, "longitude": lng},
                        "radius": 500.0,
                    }
                },
                "maxResultCount": 1,
            },
        )
        resp.raise_for_status()
        data = resp.json()

        places = data.get("places", [])
        if not places:
            return None

        place = places[0]

        # Get photo URL if available
        photo_url = None
        photos = place.get("photos", [])
        if photos:
            photo_name = photos[0].get("name")
            if photo_name:
                photo_url = f"{PLACE_PHOTO_URL}/{photo_name}/media?key={api_key}&maxHeightPx=300&maxWidthPx=400"

        return {
            "name": place.get("displayName", {}).get("text", name),
            "rating": place.get("rating"),
            "user_ratings_total": place.get("userRatingCount"),
            "photo_url": photo_url,
            "google_maps_url": place.get("googleMapsUri"),
            "address": place.get("formattedAddress"),
            "opening_hours": (
                place.get("currentOpeningHours", {}).get("weekdayDescriptions", [])
                if place.get("currentOpeningHours")
                else None
            ),
        }

    except Exception as e:
        log.warning(f"Google Places API error: {e}")
        return None


async def close_client():
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
        _client = None
