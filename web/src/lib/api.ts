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
  // Search Nominatim, local POIs, and UK postcode lookup in parallel
  const [nominatimResults, poiResults, postcodeResults] = await Promise.all([
    _nominatimSearch(query),
    _poiSearch(query),
    _postcodeSearch(query),
  ]);

  // Deduplicate: if postcode result is within 500m of a Nominatim result, skip it
  const filtered = postcodeResults.filter((pc) =>
    !nominatimResults.some((nr) => _distM(pc.lat, pc.lng, nr.lat, nr.lng) < 500)
  );

  // POI results first, then postcode results, then address results
  return [...poiResults, ...filtered, ...nominatimResults];
}

// Haversine distance in meters (for dedup)
function _distM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function _nominatimSearch(query: string): Promise<GeocodingResult[]> {
  try {
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
  } catch {
    return [];
  }
}

async function _poiSearch(query: string): Promise<GeocodingResult[]> {
  if (query.length < 3) return []; // POI search needs at least 3 chars
  try {
    const res = await authFetch(`/api/poi-search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map((p: { lat: number; lng: number; name: string; category: string; address?: string }) => ({
      lat: p.lat,
      lng: p.lng,
      display_name: `${p.name}${p.address ? ` — ${p.address}` : ""} (${p.category})`,
      type: `poi:${p.category}`,
    }));
  } catch {
    return [];
  }
}

// UK postcode geocoding via postcodes.io (free, no key needed)
const UK_POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;

async function _postcodeSearch(query: string): Promise<GeocodingResult[]> {
  const match = query.match(UK_POSTCODE_RE);
  if (!match) return [];

  const postcode = match[1].trim().toUpperCase();
  try {
    // First try exact postcode lookup
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.status !== 200 || !data.result) return [];

    const r = data.result;
    const parts = query.replace(UK_POSTCODE_RE, "").trim();
    const label = parts
      ? `${parts}, ${r.postcode} — ${r.admin_ward}, ${r.admin_district}`
      : `${r.postcode} — ${r.admin_ward}, ${r.admin_district}`;

    return [{
      lat: r.latitude,
      lng: r.longitude,
      display_name: label,
      type: "postcode",
    }];
  } catch {
    return [];
  }
}

// ---------- Reverse Geocoding (coordinates → human label) ----------

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    // Try Nominatim reverse geocode
    const params = new URLSearchParams({
      lat: lat.toFixed(6),
      lon: lng.toFixed(6),
      format: "json",
      zoom: "17", // street-level detail
      addressdetails: "1",
    });
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?${params}`,
      { headers: { "User-Agent": "MotoGPS/1.0" } }
    );
    if (!res.ok) return _coordLabel(lat, lng);
    const data = await res.json();

    if (!data || data.error) return _coordLabel(lat, lng);

    const addr = data.address || {};
    // Build a short, human-readable label
    const road = addr.road || addr.pedestrian || addr.path || addr.cycleway || "";
    const village = addr.village || addr.hamlet || addr.suburb || addr.town || addr.city || "";
    const county = addr.county || addr.state_district || "";

    if (road && village) return `${road}, ${village}`;
    if (road && county) return `${road}, ${county}`;
    if (road) return road;
    if (village) return village;
    if (data.display_name) {
      // Take first 2 parts of the display name
      const parts = data.display_name.split(",").slice(0, 2).map((s: string) => s.trim());
      return parts.join(", ");
    }
    return _coordLabel(lat, lng);
  } catch {
    return _coordLabel(lat, lng);
  }
}

function _coordLabel(lat: number, lng: number): string {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
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

export async function fetchRoutePOIs(
  shape: number[][],
  categories: string[],
): Promise<import("@/lib/types").POIResult[]> {
  // Sample the shape to reduce payload size (send ~10 points, not 10000+)
  const step = Math.max(1, Math.floor(shape.length / 10));
  const sampled = shape.filter((_, i) => i % step === 0);
  if (sampled[sampled.length - 1] !== shape[shape.length - 1]) {
    sampled.push(shape[shape.length - 1]);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000); // 90s timeout for Overpass

  try {
    const res = await authFetch("/api/route/pois", {
      method: "POST",
      body: JSON.stringify({ shape: sampled, categories }),
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.pois || [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function planMultiModeRoute(
  waypoints: Waypoint[],
  routeType: RouteType,
  dayOverlays: DayOverlay[],
  customPreferences?: RoutePreferences,
): Promise<RouteResponse> {
  const body: Record<string, unknown> = {
    waypoints,
    route_type: routeType === "custom" ? "balanced" : routeType,
    day_overlays: dayOverlays,
  };

  if (routeType === "custom" && customPreferences) {
    body.preferences = customPreferences;
  }

  const res = await authFetch("/api/route/multi-mode", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Multi-mode route planning failed");
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

export async function fetchDaySuggestions(
  waypoints: Waypoint[],
  dayOverlays: DayOverlay[],
  shape: number[][],
  legs: { distance_m: number; time_s: number }[],
  vehicle?: { consumption: number | null; consumption_unit: string; tank_capacity: number | null } | null,
): Promise<{ suggestions: import("@/lib/types").DaySuggestion[] }> {
  const res = await authFetch("/api/trip-planner/day-suggestions", {
    method: "POST",
    body: JSON.stringify({ waypoints, day_overlays: dayOverlays, shape, legs, vehicle }),
  });
  if (!res.ok) return { suggestions: [] };
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
