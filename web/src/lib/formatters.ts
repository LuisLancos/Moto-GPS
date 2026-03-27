/**
 * Shared formatting utilities for distance, time, and dates.
 * Used across RoutePanel, RouteStats, DayPlannerPanel, SavedTrips.
 */

export function formatDistance(meters: number | null | undefined): string {
  if (!meters) return "—";
  if (meters < 1000) return `${Math.round(meters)}m`;
  const km = meters / 1000;
  if (km >= 100) return `${Math.round(km)}km`;
  return `${km.toFixed(1)}km`;
}

export function formatMiles(meters: number | null | undefined): string {
  if (!meters) return "—";
  const miles = meters / 1609.344;
  if (miles >= 100) return `${Math.round(miles)}mi`;
  return `${miles.toFixed(1)}mi`;
}

export function formatTime(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Map anomaly severity to a hex colour for map rendering. */
export const SEVERITY_COLORS: Record<string, string> = {
  issue: "#ef4444",
  warning: "#f59e0b",
  suggestion: "#3b82f6",
};

/** Normalise route type for storage (custom → balanced). */
export function storableRouteType(routeType: string): string {
  return routeType === "custom" ? "balanced" : routeType;
}
