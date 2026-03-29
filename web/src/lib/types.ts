export interface Waypoint {
  lat: number;
  lng: number;
  label?: string;
}

export type RouteType = "scenic" | "balanced" | "fast" | "custom";

export interface RoutePreferences {
  scenic_weight: number;
  curvature_weight: number;
  surface_weight: number;
  elevation_weight: number;
  urban_avoidance_weight: number;
  max_detour_factor: number;
  avoid_motorways: boolean;
  avoid_dual_carriageways: boolean;
}

export const ROUTE_TYPE_META: Record<
  RouteType,
  { label: string; description: string; icon: string }
> = {
  scenic: {
    label: "Scenic",
    description: "Curvy roads, hills, avoid motorways",
    icon: "🏔️",
  },
  balanced: {
    label: "Balanced",
    description: "Smart mix of scenic and practical",
    icon: "⚖️",
  },
  fast: {
    label: "Fast",
    description: "Most direct, allow motorways",
    icon: "⚡",
  },
  custom: {
    label: "Custom",
    description: "Your own settings",
    icon: "🔧",
  },
};

export const ROUTE_TYPE_PRESETS: Record<
  Exclude<RouteType, "custom">,
  RoutePreferences
> = {
  scenic: {
    scenic_weight: 0.35,
    curvature_weight: 0.35,
    surface_weight: 0.15,
    elevation_weight: 0.1,
    urban_avoidance_weight: 0.05,
    max_detour_factor: 2.0,
    avoid_motorways: true,
    avoid_dual_carriageways: true,
  },
  balanced: {
    scenic_weight: 0.3,
    curvature_weight: 0.3,
    surface_weight: 0.2,
    elevation_weight: 0.1,
    urban_avoidance_weight: 0.1,
    max_detour_factor: 1.5,
    avoid_motorways: false,
    avoid_dual_carriageways: true,
  },
  fast: {
    scenic_weight: 0.05,
    curvature_weight: 0.05,
    surface_weight: 0.3,
    elevation_weight: 0.0,
    urban_avoidance_weight: 0.6,
    max_detour_factor: 1.1,
    avoid_motorways: false,
    avoid_dual_carriageways: false,
  },
};

export const DEFAULT_ROUTE_TYPE: RouteType = "balanced";

export const DEFAULT_PREFERENCES: RoutePreferences =
  ROUTE_TYPE_PRESETS.balanced;

export interface RouteManeuver {
  instruction: string;
  type: number;
  street_names: string[];
  length: number;
  time: number;
  begin_shape_index: number;
  end_shape_index: number;
}

export interface RouteLeg {
  distance_m: number;
  time_s: number;
  shape_start_idx: number;
  shape_end_idx: number;
}

export interface RouteResult {
  distance_m: number;
  time_s: number;
  shape: [number, number][]; // [lng, lat][]
  legs: RouteLeg[];
  maneuvers: RouteManeuver[];
  moto_score: number | null;
  valhalla_params: Record<string, number>;
}

export interface RouteResponse {
  routes: RouteResult[];
  waypoints: Waypoint[];
}

// ---------- Saved Trips ----------

export interface SharedGroupInfo {
  id: string;
  name: string;
  shared_item_id: string;
}

export interface TripSummary {
  id: string;
  name: string;
  description: string | null;
  route_type: string;
  total_distance_m: number | null;
  total_time_s: number | null;
  total_moto_score: number | null;
  waypoint_count: number;
  created_at: string;
  updated_at: string;
  // Multi-day fields (present when loaded from trips table)
  is_multiday?: boolean;
  day_count?: number;
  // Groups this trip is shared with
  shared_with_groups?: SharedGroupInfo[];
  // Ownership info for shared trips
  ownership?: "owned" | "shared_editor" | "shared_viewer";
  owner_name?: string | null;
}

export interface TripDetail extends TripSummary {
  waypoints: Waypoint[];
  preferences: RoutePreferences;
  route_data: RouteResult | null;
}

// ---------- Route Anomaly Detection ----------

export type AnomalySeverity = "issue" | "warning" | "suggestion";

export type AnomalyType =
  | "backtracking"
  | "close_proximity"
  | "detour_ratio"
  | "u_turn"
  | "urban_crawl"
  | "road_quality_drop"
  | "missed_high_scoring_road"
  | "better_parallel_road";

export interface AnomalySegment {
  start_shape_index: number;
  end_shape_index: number;
  start_coord: [number, number];
  end_coord: [number, number];
}

export interface AnomalyFix {
  action:
    | "remove_waypoint"
    | "move_waypoint"
    | "add_waypoint"
    | "reorder_waypoints"
    | "no_action";
  waypoint_index: number | null;
  suggested_coord: [number, number] | null;
  description: string;
}

export interface RouteAnomaly {
  type: AnomalyType;
  severity: AnomalySeverity;
  title: string;
  description: string;
  segment: AnomalySegment;
  affected_waypoint_index: number | null;
  metric_value: number | null;
  metric_threshold: number | null;
  fix: AnomalyFix;
  fixes: AnomalyFix[];  // Multiple fix options
}

export interface RouteAnalysisResponse {
  anomalies: RouteAnomaly[];
  overall_health: "good" | "fair" | "poor";
  analysis_time_ms: number;
}

// ---------- Multi-Day Trip Planning ----------

export interface DayOverlay {
  day: number;
  name?: string;
  description?: string;
  start_waypoint_idx: number;
  end_waypoint_idx: number;
  route_type?: RouteType;          // undefined = synced with trip default
  preferences?: RoutePreferences;   // undefined = use route_type preset
}

export interface DayOverlayWithStats extends DayOverlay {
  distance_m: number;
  time_s: number;
  moto_score: number | null;
  waypoint_count: number;
  shape_start_idx: number;
  shape_end_idx: number;
}

export interface MultiDayTripSummary {
  id: string;
  name: string;
  description: string | null;
  route_type: string;
  day_count: number;
  total_distance_m: number;
  total_time_s: number;
  total_moto_score: number | null;
  created_at: string;
  shared_with_groups?: SharedGroupInfo[];
}

export interface MultiDayTripDetail extends MultiDayTripSummary {
  preferences: RoutePreferences;
  waypoints: Waypoint[];
  route_data: RouteResult | null;
  day_overlays: DayOverlay[];
  daily_target_m: number | null;
}

// ---------- AI Trip Planner ----------

export interface AIChatMessage {
  role: "user" | "assistant";
  content: string;
  suggestions?: AISuggestions;
  timestamp?: string;
}

export interface POIResult {
  lat: number;
  lng: number;
  name: string;
  category: string;
  description?: string;
  is_biker_friendly?: boolean;
  // Rich detail fields from OSM tags
  brand?: string;
  address?: string;
  phone?: string;
  website?: string;
  opening_hours?: string;
  cuisine?: string;
  wikidata?: string;
  distance_km?: number;
}

export interface DaySuggestion {
  day: number;
  hotel: POIResult | null;
  fuel_stops: POIResult[];
}

export interface SuggestedWaypoint {
  lat: number;
  lng: number;
  label: string;
}

export interface SuggestedDaySplit {
  day: number;
  name: string;
  description?: string;
  start_waypoint_idx: number;
  end_waypoint_idx: number;
}

export interface AISuggestions {
  waypoints: SuggestedWaypoint[];
  day_splits: SuggestedDaySplit[];
  pois: POIResult[];
}

export interface AIChatResponse {
  reply: string;
  suggestions?: AISuggestions;
}
