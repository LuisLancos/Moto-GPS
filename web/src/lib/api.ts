import type {
  Waypoint,
  RouteType,
  RoutePreferences,
  RouteResponse,
  RouteResult,
  RouteAnalysisResponse,
  TripSummary,
  TripDetail,
  DayOverlay,
  DayOverlayWithStats,
  MultiDayTripSummary,
  MultiDayTripDetail,
} from "./types";
import { authFetch } from "./authApi";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ---------- Geocoding (Nominatim / OSM free) ----------

export interface GeocodingResult {
  lat: number;
  lng: number;
  display_name: string;
  type: string;
}

export async function geocodeSearch(query: string): Promise<GeocodingResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: "5",
    countrycodes: "gb",
    addressdetails: "1",
  });
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    { headers: { "User-Agent": "MotoGPS/1.0" } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.map((r: Record<string, string>) => ({
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    display_name: r.display_name,
    type: r.type || "place",
  }));
}

// ---------- Route Planning ----------

export async function planRoute(
  waypoints: Waypoint[],
  routeType: RouteType,
  customPreferences?: RoutePreferences
): Promise<RouteResponse> {
  const body: Record<string, unknown> = {
    waypoints,
    route_type: routeType === "custom" ? "balanced" : routeType,
  };

  if (routeType === "custom" && customPreferences) {
    body.preferences = customPreferences;
  }

  const res = await authFetch("/api/route", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Route planning failed");
  }

  return res.json();
}

// ---------- Saved Trips ----------

export async function listTrips(): Promise<TripSummary[]> {
  const res = await authFetch("/api/trips");
  if (!res.ok) throw new Error("Failed to load trips");
  return res.json();
}

export async function getTrip(id: string): Promise<TripDetail> {
  const res = await authFetch(`/api/trips/${id}`);
  if (!res.ok) throw new Error("Trip not found");
  return res.json();
}

export async function saveTrip(data: {
  name: string;
  description?: string;
  route_type: string;
  waypoints: Waypoint[];
  preferences: RoutePreferences;
  route_data?: RouteResult;
  total_distance_m?: number;
  total_time_s?: number;
  total_moto_score?: number;
}): Promise<TripDetail> {
  const res = await authFetch("/api/trips", {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Save failed" }));
    throw new Error(err.detail || "Save failed");
  }
  return res.json();
}

export async function updateTripMeta(
  id: string,
  data: { name?: string; description?: string }
): Promise<TripSummary> {
  const res = await authFetch(`/api/trips/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Update failed");
  return res.json();
}

export async function deleteTrip(id: string): Promise<void> {
  const res = await authFetch(`/api/trips/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Delete failed");
}

// ---------- Route Analysis ----------

export async function analyzeRoute(
  route: RouteResult,
  waypoints: Waypoint[],
): Promise<RouteAnalysisResponse> {
  const res = await authFetch("/api/route/analyze", {
    method: "POST",
    body: JSON.stringify({ route, waypoints }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Route analysis failed");
  }
  return res.json();
}

// ---------- Snap to Road ----------

export async function snapToRoad(lat: number, lng: number): Promise<{ lat: number; lng: number; snapped: boolean }> {
  const res = await authFetch("/api/route/snap", {
    method: "POST",
    body: JSON.stringify({ lat, lng }),
  });
  if (!res.ok) return { lat, lng, snapped: false };
  return res.json();
}

// ---------- GPX Export/Import ----------

export function exportTripGpxUrl(tripId: string): string {
  return `${API_URL}/api/trips/${tripId}/gpx`;
}

// ---------- Multi-Day Trip Planner ----------

export async function autoSplitTrip(
  waypoints: Waypoint[],
  legs: { distance_m: number; time_s: number; shape_start_idx: number; shape_end_idx: number }[],
  dailyTargetM: number,
): Promise<{ day_overlays: DayOverlayWithStats[] }> {
  const res = await authFetch("/api/trip-planner/auto-split", {
    method: "POST",
    body: JSON.stringify({
      waypoints,
      legs: legs.map(l => ({ ...l, shape: [] })),
      daily_target_m: dailyTargetM,
    }),
  });
  if (!res.ok) throw new Error("Auto-split failed");
  return res.json();
}

export async function listMultiDayTrips(): Promise<MultiDayTripSummary[]> {
  const res = await authFetch("/api/trip-planner/trips");
  if (!res.ok) throw new Error("Failed to load trips");
  return res.json();
}

export async function getMultiDayTrip(id: string): Promise<MultiDayTripDetail> {
  const res = await authFetch(`/api/trip-planner/trips/${id}`);
  if (!res.ok) throw new Error("Trip not found");
  return res.json();
}

export async function saveMultiDayTrip(data: {
  name: string;
  description?: string;
  route_type: string;
  preferences: RoutePreferences;
  waypoints: Waypoint[];
  route_data?: RouteResult;
  day_overlays: DayOverlay[];
  daily_target_m: number;
  total_distance_m: number;
  total_time_s: number;
  total_moto_score?: number;
}): Promise<{ id: string }> {
  const res = await authFetch("/api/trip-planner/trips", {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Save failed" }));
    throw new Error(err.detail || "Save failed");
  }
  return res.json();
}

export async function updateTrip(id: string, data: {
  name: string;
  description?: string;
  route_type: string;
  waypoints: Waypoint[];
  preferences: RoutePreferences;
  route_data?: RouteResult;
  total_distance_m: number;
  total_time_s: number;
  total_moto_score?: number;
}): Promise<{ id: string }> {
  const res = await authFetch(`/api/trips/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Update failed");
  return res.json();
}

export async function updateMultiDayTrip(id: string, data: {
  name: string;
  description?: string;
  route_type: string;
  preferences: RoutePreferences;
  waypoints: Waypoint[];
  route_data?: RouteResult;
  day_overlays: DayOverlay[];
  daily_target_m: number;
  total_distance_m: number;
  total_time_s: number;
  total_moto_score?: number;
}): Promise<{ id: string }> {
  const res = await authFetch(`/api/trip-planner/trips/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Update failed");
  return res.json();
}

export async function deleteMultiDayTrip(id: string): Promise<void> {
  const res = await authFetch(`/api/trip-planner/trips/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Delete failed");
}

export function exportAllDaysGpxUrl(tripId: string): string {
  return `${API_URL}/api/trip-planner/trips/${tripId}/gpx/all`;
}

// ---------- GPX Import ----------

export async function importGpx(file: File): Promise<{
  name: string;
  description: string;
  waypoints: Waypoint[];
  track_shape: [number, number][];
  waypoint_count: number;
  track_point_count: number;
}> {
  const form = new FormData();
  form.append("file", file);
  const res = await authFetch("/api/gpx/import", {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Import failed" }));
    throw new Error(err.detail || "GPX import failed");
  }
  return res.json();
}

export async function importTripZip(file: File): Promise<{
  name: string;
  waypoints: Waypoint[];
  day_overlays: DayOverlay[];
  day_count: number;
  waypoint_count: number;
}> {
  const form = new FormData();
  form.append("file", file);
  const res = await authFetch("/api/trip-planner/import-trip", {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Import failed" }));
    throw new Error(err.detail || "Trip import failed");
  }
  return res.json();
}

export function exportDayGpxUrl(tripId: string, dayNumber: number): string {
  return `${API_URL}/api/trip-planner/trips/${tripId}/gpx/day/${dayNumber}`;
}

// ---------- Sharing ----------

export interface UserGroup {
  id: string;
  name: string;
  my_role: string;
  shared_item_count: number;
}

export async function listMyGroups(): Promise<UserGroup[]> {
  const res = await authFetch("/api/groups");
  if (!res.ok) return [];
  return res.json();
}

export async function shareItemWithGroup(
  groupId: string,
  itemType: "route" | "trip",
  itemId: string,
): Promise<void> {
  const res = await authFetch(`/api/groups/${groupId}/share`, {
    method: "POST",
    body: JSON.stringify({ item_type: itemType, item_id: itemId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Share failed" }));
    throw new Error(err.detail || "Share failed");
  }
}

export async function unshareItem(
  groupId: string,
  sharedItemId: string,
): Promise<void> {
  const res = await authFetch(`/api/groups/${groupId}/shared/${sharedItemId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unshare failed" }));
    throw new Error(err.detail || "Unshare failed");
  }
}

// ---------- Day GPX ----------

export async function importDayIntoTrip(tripId: string, dayNumber: number, file: File): Promise<{
  waypoints: Waypoint[];
  day_overlays: DayOverlay[];
  day_count: number;
  message: string;
}> {
  const form = new FormData();
  form.append("file", file);
  const res = await authFetch(
    `/api/trip-planner/trips/${tripId}/import-day?day_number=${dayNumber}`,
    { method: "POST", body: form },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Import failed" }));
    throw new Error(err.detail || "Day import failed");
  }
  return res.json();
}
