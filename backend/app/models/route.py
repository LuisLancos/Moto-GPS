from enum import Enum
from pydantic import BaseModel


class RouteType(str, Enum):
    scenic = "scenic"
    balanced = "balanced"
    fast = "fast"


class Waypoint(BaseModel):
    lat: float
    lng: float
    label: str | None = None


class RoutePreferences(BaseModel):
    scenic_weight: float = 0.3
    curvature_weight: float = 0.3
    surface_weight: float = 0.2
    elevation_weight: float = 0.1
    urban_avoidance_weight: float = 0.1
    max_detour_factor: float = 1.5
    avoid_motorways: bool = False
    avoid_dual_carriageways: bool = True


# Presets that override preferences based on route type
ROUTE_TYPE_PRESETS: dict[RouteType, RoutePreferences] = {
    RouteType.scenic: RoutePreferences(
        scenic_weight=0.35,
        curvature_weight=0.35,
        surface_weight=0.15,
        elevation_weight=0.1,
        urban_avoidance_weight=0.05,
        max_detour_factor=2.0,
        avoid_motorways=True,
        avoid_dual_carriageways=True,
    ),
    RouteType.balanced: RoutePreferences(
        scenic_weight=0.3,
        curvature_weight=0.3,
        surface_weight=0.2,
        elevation_weight=0.1,
        urban_avoidance_weight=0.1,
        max_detour_factor=1.5,
        avoid_motorways=False,
        avoid_dual_carriageways=True,
    ),
    RouteType.fast: RoutePreferences(
        scenic_weight=0.05,
        curvature_weight=0.05,
        surface_weight=0.3,
        elevation_weight=0.0,
        urban_avoidance_weight=0.6,
        max_detour_factor=1.1,
        avoid_motorways=False,
        avoid_dual_carriageways=False,
    ),
}


class RouteRequest(BaseModel):
    waypoints: list[Waypoint]
    route_type: RouteType = RouteType.balanced
    preferences: RoutePreferences | None = None  # None = use route_type preset


class RouteLeg(BaseModel):
    distance_m: float
    time_s: float
    shape: list[list[float]]  # [[lat, lng], ...]


class RouteManeuver(BaseModel):
    instruction: str
    type: int
    street_names: list[str] = []
    length: float
    time: float
    begin_shape_index: int
    end_shape_index: int


class RouteResult(BaseModel):
    distance_m: float
    time_s: float
    shape: list[list[float]]  # decoded polyline as [[lng, lat], ...]
    legs: list[RouteLeg] = []
    maneuvers: list[RouteManeuver] = []
    moto_score: float | None = None  # filled in by scoring engine later
    valhalla_params: dict = {}  # which params generated this route


class RouteResponse(BaseModel):
    routes: list[RouteResult]
    waypoints: list[Waypoint]


# ---------- Route Anomaly Detection ----------

class AnomalySeverity(str, Enum):
    issue = "issue"
    warning = "warning"
    suggestion = "suggestion"


class AnomalyType(str, Enum):
    backtracking = "backtracking"
    close_proximity = "close_proximity"
    detour_ratio = "detour_ratio"
    u_turn = "u_turn"
    urban_crawl = "urban_crawl"
    road_quality_drop = "road_quality_drop"
    missed_high_scoring_road = "missed_high_scoring_road"
    better_parallel_road = "better_parallel_road"


class AnomalySegment(BaseModel):
    start_shape_index: int
    end_shape_index: int
    start_coord: list[float]  # [lng, lat]
    end_coord: list[float]


class AnomalyFix(BaseModel):
    action: str  # remove_waypoint | move_waypoint | add_waypoint | no_action
    waypoint_index: int | None = None
    suggested_coord: list[float] | None = None  # [lng, lat]
    description: str


class RouteAnomaly(BaseModel):
    type: AnomalyType
    severity: AnomalySeverity
    title: str
    description: str
    segment: AnomalySegment
    affected_waypoint_index: int | None = None
    metric_value: float | None = None
    metric_threshold: float | None = None
    fix: AnomalyFix


class RouteAnalysisRequest(BaseModel):
    route: RouteResult
    waypoints: list[Waypoint]


class RouteAnalysisResponse(BaseModel):
    anomalies: list[RouteAnomaly]
    overall_health: str  # good | fair | poor
    analysis_time_ms: int
