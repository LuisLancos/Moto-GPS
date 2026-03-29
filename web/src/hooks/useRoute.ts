"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type {
  Waypoint,
  RouteType,
  RoutePreferences,
  RouteResult,
  RouteResponse,
  RouteAnalysisResponse,
  RouteAnomaly,
} from "@/lib/types";
import {
  DEFAULT_ROUTE_TYPE,
  DEFAULT_PREFERENCES,
  ROUTE_TYPE_PRESETS,
} from "@/lib/types";
import { planRoute, planMultiModeRoute, analyzeRoute } from "@/lib/api";
import type { DayOverlay } from "@/lib/types";
import { findInsertIndex } from "@/lib/geo";

export function useRoute() {
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [routes, setRoutes] = useState<RouteResult[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [routeType, setRouteTypeState] = useState<RouteType>(DEFAULT_ROUTE_TYPE);
  const [preferences, setPreferences] =
    useState<RoutePreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setRouteType = useCallback((type: RouteType) => {
    setRouteTypeState(type);
    if (type !== "custom") {
      setPreferences(ROUTE_TYPE_PRESETS[type]);
    }
  }, []);

  const setCustomPreferences = useCallback((prefs: RoutePreferences) => {
    setPreferences(prefs);
    setRouteTypeState("custom");
  }, []);

  const addWaypoint = useCallback((wp: Waypoint) => {
    setWaypoints((prev) => [...prev, wp]);
  }, []);

  const removeWaypoint = useCallback((index: number) => {
    setWaypoints((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const insertWaypoint = useCallback((wp: Waypoint, atIndex?: number) => {
    setWaypoints((prev) => {
      if (atIndex !== undefined && atIndex >= 0 && atIndex <= prev.length) {
        const next = [...prev];
        next.splice(atIndex, 0, wp);
        return next;
      }
      return [...prev, wp];
    });
  }, []);

  const moveWaypoint = useCallback((index: number, newLat: number, newLng: number) => {
    setWaypoints((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const next = [...prev];
      next[index] = { ...next[index], lat: newLat, lng: newLng };
      return next;
    });
    // Auto-reroute is handled by the existing waypointsKey useEffect
  }, []);

  // Update a waypoint's label by matching lat/lng (for async reverse geocoding)
  const updateWaypointLabel = useCallback((lat: number, lng: number, label: string) => {
    setWaypoints((prev) =>
      prev.map((wp) =>
        Math.abs(wp.lat - lat) < 0.0001 && Math.abs(wp.lng - lng) < 0.0001
          ? { ...wp, label }
          : wp
      )
    );
  }, []);

  // Toggle overnight status on a waypoint
  const setWaypointOvernight = useCallback((index: number, isOvernight: boolean) => {
    setWaypoints((prev) =>
      prev.map((wp, i) => i === index ? { ...wp, is_overnight: isOvernight, type: isOvernight ? "overnight" : "waypoint" } : wp)
    );
  }, []);

  // Set waypoint type (normal, overnight, fuel, restaurant, attraction, biker_cafe)
  const setWaypointType = useCallback((index: number, type: import("@/lib/types").WaypointType) => {
    setWaypoints((prev) =>
      prev.map((wp, i) => i === index ? {
        ...wp,
        type,
        is_overnight: type === "overnight" || type === "hotel",
      } : wp)
    );
  }, []);

  const reorderWaypoints = useCallback((fromIndex: number, toIndex: number) => {
    setWaypoints((prev) => {
      if (fromIndex === toIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const clearWaypoints = useCallback(() => {
    setWaypoints([]);
    setRoutes([]);
    setSelectedRouteIndex(0);
    setError(null);
  }, []);

  const calculateRoute = useCallback(async () => {
    if (waypoints.length < 2) {
      setError("Add at least 2 waypoints");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response: RouteResponse = await planRoute(
        waypoints,
        routeType,
        routeType === "custom" ? preferences : undefined
      );
      setRoutes(response.routes);
      setSelectedRouteIndex(0);
      // Mark route as fresh
      lastCalcKeyRef.current = JSON.stringify(waypoints.map((w) => [w.lat, w.lng]));
      setRouteStale(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Route planning failed");
      setRoutes([]);
    } finally {
      setLoading(false);
    }
  }, [waypoints, routeType, preferences]);

  // ---------- Multi-mode route (per-day route types) ----------
  const calculateMultiModeRoute = useCallback(async (dayOverlays: DayOverlay[]) => {
    if (waypoints.length < 2) {
      setError("Add at least 2 waypoints");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await planMultiModeRoute(
        waypoints,
        routeType,
        dayOverlays,
        routeType === "custom" ? preferences : undefined,
      );
      setRoutes(response.routes);
      setSelectedRouteIndex(0);
      lastCalcKeyRef.current = JSON.stringify(waypoints.map((w) => [w.lat, w.lng]));
      setRouteStale(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Multi-mode route failed");
      setRoutes([]);
    } finally {
      setLoading(false);
    }
  }, [waypoints, routeType, preferences]);

  // ---------- Clear stale routes when waypoints drop below 2 ----------
  const hasRoutes = routes.length > 0;

  useEffect(() => {
    if (waypoints.length < 2 && hasRoutes) {
      setRoutes([]);
      setSelectedRouteIndex(0);
      setAnalysis(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypoints.length]);

  // Track whether waypoints changed since last calculation (show "Recalculate" hint)
  const [routeStale, setRouteStale] = useState(false);
  const waypointsKey = useMemo(
    () => JSON.stringify(waypoints.map((w) => [w.lat, w.lng])),
    [waypoints],
  );
  const lastCalcKeyRef = useRef("");

  useEffect(() => {
    if (hasRoutes && waypointsKey !== lastCalcKeyRef.current) {
      setRouteStale(true);
      // Clear old analysis — it's stale now and may show phantom anomalies
      setAnalysis(null);
    }
  }, [waypointsKey, hasRoutes]);

  // Load a saved trip: restore waypoints, route type, preferences, and optionally the saved route
  const loadTrip = useCallback(
    (
      tripWaypoints: Waypoint[],
      tripRouteType: RouteType,
      tripPreferences: RoutePreferences,
      savedRoute: RouteResult | null,
    ) => {
      setWaypoints(tripWaypoints);
      setRouteTypeState(tripRouteType);
      setPreferences(tripPreferences);
      setError(null);

      if (savedRoute && savedRoute.shape && savedRoute.shape.length > 0) {
        // Ensure the route has required fields with defaults
        const fullRoute: RouteResult = {
          distance_m: savedRoute.distance_m || 0,
          time_s: savedRoute.time_s || 0,
          shape: savedRoute.shape,
          legs: savedRoute.legs || [],
          maneuvers: savedRoute.maneuvers || [],
          moto_score: savedRoute.moto_score ?? null,
          valhalla_params: savedRoute.valhalla_params || {},
        };
        setRoutes([fullRoute]);
        setSelectedRouteIndex(0);
        // Mark as freshly loaded (not stale)
        lastCalcKeyRef.current = JSON.stringify(tripWaypoints.map((w) => [w.lat, w.lng]));
        setRouteStale(false);
      } else {
        setRoutes([]);
        setSelectedRouteIndex(0);
      }
    },
    [],
  );

  const selectedRoute = routes[selectedRouteIndex] || null;

  // ---------- Route Analysis ----------
  const [analysis, setAnalysis] = useState<RouteAnalysisResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  const runAnalysis = useCallback(async () => {
    if (!selectedRoute || waypoints.length < 2) {
      setAnalysis(null);
      return;
    }
    setAnalysisLoading(true);
    try {
      const result = await analyzeRoute(selectedRoute, waypoints);
      setAnalysis(result);
    } catch {
      setAnalysis(null);
    } finally {
      setAnalysisLoading(false);
    }
  }, [selectedRoute, waypoints]);

  // Auto-trigger analysis when route changes
  const analysisKeyRef = useRef("");
  useEffect(() => {
    if (!selectedRoute) {
      setAnalysis(null);
      return;
    }
    const key = `${selectedRouteIndex}-${selectedRoute.distance_m}`;
    if (key === analysisKeyRef.current) return;
    analysisKeyRef.current = key;

    const timer = setTimeout(() => runAnalysis(), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRouteIndex, selectedRoute?.distance_m]);

  // Apply a fix from an anomaly — atomic waypoint mutation + auto-recalculate
  const applyFix = useCallback(
    (anomaly: RouteAnomaly) => {
      const fix = anomaly.fix;

      if (fix.action === "remove_waypoint" && fix.waypoint_index != null) {
        setWaypoints((prev) => prev.filter((_, i) => i !== fix.waypoint_index));
      } else if (fix.action === "add_waypoint" && fix.suggested_coord) {
        const wp: Waypoint = {
          lat: fix.suggested_coord[1],
          lng: fix.suggested_coord[0],
          label: "Bypass",
        };
        setWaypoints((prev) => {
          const idx = findInsertIndex(wp, prev);
          const next = [...prev];
          next.splice(idx, 0, wp);
          return next;
        });
      } else if (fix.action === "move_waypoint" && fix.waypoint_index != null && fix.suggested_coord) {
        // Atomic: replace waypoint at index with new coords
        setWaypoints((prev) => {
          const next = [...prev];
          if (fix.waypoint_index! < next.length) {
            next[fix.waypoint_index!] = {
              ...next[fix.waypoint_index!],
              lat: fix.suggested_coord![1],
              lng: fix.suggested_coord![0],
            };
          }
          return next;
        });
      } else {
        return; // no_action or unsupported
      }

      // Clear stale analysis and mark route for recalculation
      setAnalysis(null);
      setRouteStale(true);
    },
    [],
  );

  return {
    waypoints,
    routes,
    selectedRoute,
    selectedRouteIndex,
    routeType,
    preferences,
    loading,
    error,
    analysis,
    analysisLoading,
    addWaypoint,
    insertWaypoint,
    removeWaypoint,
    moveWaypoint,
    updateWaypointLabel,
    setWaypointOvernight,
    setWaypointType,
    reorderWaypoints,
    clearWaypoints,
    setSelectedRouteIndex,
    setRouteType,
    setCustomPreferences,
    calculateRoute,
    calculateMultiModeRoute,
    routeStale,
    loadTrip,
    runAnalysis,
    applyFix,
  };
}
