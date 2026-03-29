"""Pydantic models for the AI trip planning assistant."""

from pydantic import BaseModel


class AIChatMessage(BaseModel):
    role: str  # "user" | "assistant" | "system"
    content: str


class AIChatRequest(BaseModel):
    messages: list[AIChatMessage]
    route_type: str = "balanced"
    # Optional: current route waypoints for "enhance existing route" mode
    current_route_waypoints: list[dict] | None = None  # [{lat, lng, label?}]


class POIResult(BaseModel):
    lat: float
    lng: float
    name: str
    category: str  # fuel, restaurant, pub, castle, viewpoint, biker_cafe, etc.
    description: str | None = None
    brand: str | None = None
    address: str | None = None
    is_biker_friendly: bool = False


class SuggestedWaypoint(BaseModel):
    lat: float
    lng: float
    label: str


class SuggestedDaySplit(BaseModel):
    day: int
    name: str
    description: str | None = None
    start_waypoint_idx: int
    end_waypoint_idx: int


class AISuggestions(BaseModel):
    waypoints: list[SuggestedWaypoint] = []
    day_splits: list[SuggestedDaySplit] = []
    pois: list[POIResult] = []


class AIChatResponse(BaseModel):
    reply: str
    suggestions: AISuggestions | None = None


class EnrichPOIsRequest(BaseModel):
    waypoints: list[SuggestedWaypoint]
    categories: list[str] = ["fuel", "restaurant", "attraction"]
    buffer_km: float = 5.0
