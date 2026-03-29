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
    # Optional: current route data for analysis tools (shape, legs, maneuvers)
    current_route_data: dict | None = None


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


class RouteAction(BaseModel):
    type: str  # remove_waypoint | move_waypoint | add_waypoint | recalculate
    index: int | None = None
    lat: float | None = None
    lng: float | None = None
    label: str | None = None
    after_index: int | None = None
    reason: str = ""


class AIChatResponse(BaseModel):
    reply: str
    suggestions: AISuggestions | None = None
    route_actions: list[dict] = []  # Granular route modifications from AI


class EnrichPOIsRequest(BaseModel):
    waypoints: list[SuggestedWaypoint]
    categories: list[str] = ["fuel", "restaurant", "attraction"]
    buffer_km: float = 5.0
