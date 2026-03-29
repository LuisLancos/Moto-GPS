/**
 * AI Trip Planner API functions.
 */

import { authFetch } from "./authApi";
import type { AIChatMessage, AIChatResponse, POIResult, RouteResult, SuggestedWaypoint, Waypoint } from "./types";

export async function sendAIMessage(
  messages: AIChatMessage[],
  routeType: string = "balanced",
  currentRouteWaypoints?: Waypoint[],
  currentRouteData?: RouteResult,
): Promise<AIChatResponse> {
  const body: Record<string, unknown> = {
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    route_type: routeType,
  };
  // Pass current route for "enhance existing route" mode
  if (currentRouteWaypoints && currentRouteWaypoints.length >= 2) {
    body.current_route_waypoints = currentRouteWaypoints.map((w) => ({
      lat: w.lat, lng: w.lng, label: w.label,
    }));
  }
  // Pass full route data for AI route analysis/repair tools
  if (currentRouteData) {
    body.current_route_data = currentRouteData;
  }
  const res = await authFetch("/api/ai-planner/chat", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "AI request failed" }));
    throw new Error(err.detail || "AI request failed");
  }
  return res.json();
}

export async function enrichPOIs(
  waypoints: SuggestedWaypoint[],
  categories: string[] = ["fuel", "restaurant", "attraction"],
  bufferKm: number = 5.0,
): Promise<POIResult[]> {
  const res = await authFetch("/api/ai-planner/enrich-pois", {
    method: "POST",
    body: JSON.stringify({
      waypoints,
      categories,
      buffer_km: bufferKm,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "POI enrichment failed" }));
    throw new Error(err.detail || "POI enrichment failed");
  }
  return res.json();
}
