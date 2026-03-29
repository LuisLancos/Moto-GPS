"use client";

import dynamic from "next/dynamic";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuthContext } from "@/components/auth/AuthProvider";
import { useRoute } from "@/hooks/useRoute";
import type { VehicleFuelData } from "@/lib/fuelCalc";
import { authFetch } from "@/lib/authApi";
import { useTripPlanner } from "@/hooks/useTripPlanner";
import { useAIPlanner } from "@/hooks/useAIPlanner";
import { RoutePanel } from "@/components/route/RoutePanel";
import { SaveTripDialog } from "@/components/route/SaveTripDialog";
import { TopNav } from "@/components/nav/TopNav";
import {
  listTrips, saveTrip, updateTrip, deleteTrip, getTrip, importGpx, importTripZip,
  listMultiDayTrips, saveMultiDayTrip, updateMultiDayTrip, deleteMultiDayTrip, getMultiDayTrip,
  snapToRoad, exportDayGpxUrl, importDayIntoTrip,
  listMyGroups,
  fetchRoutePOIs,
  reverseGeocode,
} from "@/lib/api";
import { POIOverlayControls, DEFAULT_POI_CATEGORIES, DEFAULT_SELECTED, type POICategoryDef } from "@/components/map/POIOverlayControls";
import type { UserGroup } from "@/lib/api";
import { findInsertIndex } from "@/lib/geo";
import { storableRouteType } from "@/lib/formatters";
import type { TripSummary, RouteType, Waypoint, POIResult } from "@/lib/types";

const Map = dynamic(() => import("@/components/map/Map").then((m) => m.Map), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-surface text-muted">
      Loading map...
    </div>
  ),
});

export default function Home() {
  const router = useRouter();
  const { user, loading: authLoading, logout, pendingInvitations } = useAuthContext();

  const route = useRoute();
  const selectedRoute = route.routes[route.selectedRouteIndex] || null;

  // ---------- Default vehicle for fuel estimates (must be before useTripPlanner) ----------
  const [defaultVehicle, setDefaultVehicle] = useState<VehicleFuelData | null>(null);

  const tripPlanner = useTripPlanner(route.waypoints, selectedRoute, defaultVehicle, route.insertWaypoint);

  // Set daily target from user preferences based on route type
  useEffect(() => {
    const prefs = user?.preferences;
    if (!prefs) return;
    const milesToMeters = 1609.344;
    let targetMiles: number;
    switch (route.routeType) {
      case "scenic": targetMiles = prefs.daily_miles_scenic || 150; break;
      case "fast": targetMiles = prefs.daily_miles_fast || 250; break;
      default: targetMiles = prefs.daily_miles_balanced || 200; break;
    }
    tripPlanner.setDailyTargetM(Math.round(targetMiles * milesToMeters));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.routeType, user?.preferences]);

  const aiPlanner = useAIPlanner();
  const [aiAppliedIdx, setAiAppliedIdx] = useState<number | null>(null);
  const [mapPOIs, setMapPOIs] = useState<POIResult[]>([]);

  // ---------- Route POI overlay ----------
  const [poiCategoryDefs, setPoiCategoryDefs] = useState<POICategoryDef[]>([]);
  const [poiCategories, setPoiCategories] = useState<Set<string>>(() => {
    // Will be overridden by user preferences when they load
    return DEFAULT_SELECTED;
  });
  const [routePOIs, setRoutePOIs] = useState<POIResult[]>([]);
  const [poiLoading, setPoiLoading] = useState(false);
  const poiFetchRef = useRef<string | null>(null);

  // Load dynamic POI categories from API
  useEffect(() => {
    authFetch("/api/poi-categories").then(async (res) => {
      if (res.ok) {
        const cats = await res.json();
        if (cats.length > 0) setPoiCategoryDefs(cats);
      }
    }).catch(() => {});
  }, []);

  // Load user's preferred default POI categories
  useEffect(() => {
    const prefs = user?.preferences;
    if (prefs?.default_poi_categories?.length) {
      setPoiCategories(new Set(prefs.default_poi_categories));
    }
  }, [user?.preferences]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const res = await authFetch("/api/vehicles");
        if (res.ok) {
          const vehicles = await res.json();
          const def = vehicles.find((v: { is_default: boolean }) => v.is_default) || vehicles[0] || null;
          if (def && def.consumption) {
            setDefaultVehicle({
              fuel_type: def.fuel_type || "petrol",
              consumption: def.consumption,
              consumption_unit: def.consumption_unit || "mpg",
              tank_capacity: def.tank_capacity,
              fuel_cost_per_unit: def.fuel_cost_per_unit,
              fuel_cost_currency: def.fuel_cost_currency || "GBP",
            });
          }
        }
      } catch {
        // silent — fuel estimates are optional
      }
    })();
  }, [user]);

  // Fetch POIs when first category toggled on (or route changes with categories active)
  const poiCatCount = poiCategories.size;
  const selectedRouteForPOI = route.routes[route.selectedRouteIndex] ?? null;
  const selectedRouteDistForPOI = selectedRouteForPOI?.distance_m ?? 0;

  // Simple: fetch all active categories whenever toggles or route change
  // PostGIS is fast (~70ms) so no need for incremental caching
  const poiCatsKey = Array.from(poiCategories).sort().join(",");

  useEffect(() => {
    if (!selectedRouteForPOI?.shape?.length || poiCategories.size === 0) {
      setRoutePOIs([]);
      return;
    }

    const cats = Array.from(poiCategories);
    setPoiLoading(true);

    fetchRoutePOIs(selectedRouteForPOI.shape, cats)
      .then((pois) => {
        console.log(`[POI] Fetched ${pois.length} POIs for [${cats.join(",")}]`);
        setRoutePOIs(pois);
      })
      .catch((err) => {
        console.error("[POI] Fetch failed:", err);
        setRoutePOIs([]);
      })
      .finally(() => setPoiLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poiCatsKey, selectedRouteDistForPOI]);

  const handleTogglePOICategory = useCallback((cat: string) => {
    setPoiCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  // Combine AI POIs + route overlay POIs
  // Merge: AI POIs + route overlay POIs + day suggestion POIs (hotels + fuel)
  const suggestionPOIs = useMemo(() => {
    const pois: import("@/lib/types").POIResult[] = [];
    for (const s of tripPlanner.daySuggestions) {
      if (s.hotel) pois.push(s.hotel);
      for (const f of s.fuel_stops) pois.push(f);
    }
    return pois;
  }, [tripPlanner.daySuggestions]);

  const allMapPOIs = [...mapPOIs, ...routePOIs, ...suggestionPOIs];

  // ---------- Saved Trips state ----------
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadedTripId, setLoadedTripId] = useState<string | null>(null);
  const [loadedTripName, setLoadedTripName] = useState<string | null>(null);
  const [loadedTripIsMultiday, setLoadedTripIsMultiday] = useState(false);
  const [myGroups, setMyGroups] = useState<UserGroup[]>([]);

  // Auth gate
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [authLoading, user, router]);

  const refreshTrips = useCallback(async () => {
    setTripsLoading(true);
    try {
      // Load trips and groups in parallel
      const [singleDay, multiDay, groups] = await Promise.all([
        listTrips().catch(() => []),
        listMultiDayTrips().catch(() => []),
        listMyGroups().catch(() => []),
      ]);
      setMyGroups(groups);

      // Tag multi-day trips
      const mdTrips: TripSummary[] = multiDay.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        route_type: t.route_type,
        total_distance_m: t.total_distance_m,
        total_time_s: t.total_time_s,
        total_moto_score: t.total_moto_score,
        waypoint_count: 0,
        created_at: t.created_at,
        updated_at: t.created_at,
        is_multiday: true,
        day_count: t.day_count,
        shared_with_groups: t.shared_with_groups,
      }));

      // Merge and sort by date (newest first)
      const all = [...singleDay, ...mdTrips].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setTrips(all);
    } catch {
      // silent
    } finally {
      setTripsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshTrips();
  }, [refreshTrips]);

  // ---------- Trip actions ----------

  // Quick-save: update loaded trip in place (no dialog)
  async function handleQuickSave() {
    const sr = route.routes[route.selectedRouteIndex];
    if (!sr || !loadedTripId || !loadedTripName) return;

    setSaving(true);
    try {
      const isMultiday = tripPlanner.isMultiDay && tripPlanner.dayOverlays.length > 0;

      if (isMultiday || loadedTripIsMultiday) {
        if (loadedTripIsMultiday) {
          // Already a multi-day trip — update in place
          await updateMultiDayTrip(loadedTripId, {
            name: loadedTripName,
            route_type: storableRouteType(route.routeType),
            preferences: route.preferences,
            waypoints: route.waypoints,
            route_data: sr,
            day_overlays: tripPlanner.dayOverlays,
            daily_target_m: tripPlanner.dailyTargetM,
            total_distance_m: sr.distance_m,
            total_time_s: sr.time_s,
            total_moto_score: sr.moto_score ?? undefined,
          });
        } else {
          // Transitioning from single-day → multi-day: create new, delete old
          const result = await saveMultiDayTrip({
            name: loadedTripName,
            route_type: storableRouteType(route.routeType),
            preferences: route.preferences,
            waypoints: route.waypoints,
            route_data: sr,
            day_overlays: tripPlanner.dayOverlays,
            daily_target_m: tripPlanner.dailyTargetM,
            total_distance_m: sr.distance_m,
            total_time_s: sr.time_s,
            total_moto_score: sr.moto_score ?? undefined,
          });
          // Delete old single-day version
          await deleteTrip(loadedTripId).catch(() => {});
          // Update references to the new multi-day trip
          setLoadedTripId(result.id);
          setLoadedTripIsMultiday(true);
        }
      } else {
        await updateTrip(loadedTripId, {
          name: loadedTripName,
          route_type: storableRouteType(route.routeType),
          waypoints: route.waypoints,
          preferences: route.preferences,
          route_data: sr,
          total_distance_m: sr.distance_m,
          total_time_s: sr.time_s,
          total_moto_score: sr.moto_score ?? undefined,
        });
      }
      await refreshTrips();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // Save as new trip (with dialog for name/description)
  async function handleSaveTrip(name: string, description: string) {
    const sr = route.routes[route.selectedRouteIndex];
    if (!sr) return;

    setSaving(true);
    try {
      let newId: string;
      if (tripPlanner.isMultiDay && tripPlanner.dayOverlays.length > 0) {
        const result = await saveMultiDayTrip({
          name,
          description: description || undefined,
          route_type: storableRouteType(route.routeType),
          preferences: route.preferences,
          waypoints: route.waypoints,
          route_data: sr,
          day_overlays: tripPlanner.dayOverlays,
          daily_target_m: tripPlanner.dailyTargetM,
          total_distance_m: sr.distance_m,
          total_time_s: sr.time_s,
          total_moto_score: sr.moto_score ?? undefined,
        });
        newId = result.id;
        setLoadedTripIsMultiday(true);
      } else {
        const result = await saveTrip({
          name,
          description: description || undefined,
          route_type: storableRouteType(route.routeType),
          waypoints: route.waypoints,
          preferences: route.preferences,
          route_data: sr,
          total_distance_m: sr.distance_m,
          total_time_s: sr.time_s,
          total_moto_score: sr.moto_score ?? undefined,
        });
        newId = result.id;
        setLoadedTripIsMultiday(false);
      }
      // Track the new trip as "loaded" so future saves update in place
      setLoadedTripId(newId);
      setLoadedTripName(name);
      setShowSaveDialog(false);
      await refreshTrips();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleLoadTrip(summary: TripSummary) {
    try {
      if (summary.is_multiday) {
        const detail = await getMultiDayTrip(summary.id);
        route.loadTrip(
          detail.waypoints,
          (detail.route_type || "balanced") as RouteType,
          detail.preferences,
          detail.route_data,
        );
        tripPlanner.loadDayOverlays(
          detail.day_overlays,
          detail.daily_target_m ?? undefined,
        );
        if (!detail.route_data || !detail.route_data.shape || detail.route_data.shape.length === 0) {
          setTimeout(() => route.calculateRoute(), 100);
        }
      } else {
        const detail = await getTrip(summary.id);
        route.loadTrip(
          detail.waypoints,
          (detail.route_type || "balanced") as RouteType,
          detail.preferences,
          detail.route_data,
        );
        tripPlanner.clearDays();
        if (!detail.route_data || !detail.route_data.shape || detail.route_data.shape.length === 0) {
          setTimeout(() => route.calculateRoute(), 100);
        }
      }
      // Track loaded trip for in-place save
      setLoadedTripId(summary.id);
      setLoadedTripName(summary.name);
      setLoadedTripIsMultiday(summary.is_multiday ?? false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to load trip");
    }
  }

  async function handleDeleteTrip(id: string) {
    try {
      // Try both — one will succeed, the other will 404 silently
      const trip = trips.find((t) => t.id === id);
      if (trip?.is_multiday) {
        await deleteMultiDayTrip(id);
      } else {
        await deleteTrip(id);
      }
      await refreshTrips();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  }

  // ---------- GPX Import ----------
  async function handleImportGpx(file: File) {
    try {
      const result = await importGpx(file);
      // Load imported waypoints into the route planner
      route.loadTrip(
        result.waypoints,
        "balanced",
        route.preferences,
        result.track_shape.length > 0
          ? { distance_m: 0, time_s: 0, shape: result.track_shape, legs: [], maneuvers: [], moto_score: null, valhalla_params: {} }
          : null,
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "GPX import failed");
    }
  }

  // ---------- Import multi-day trip (ZIP) ----------
  async function handleImportTripZip(file: File) {
    try {
      const result = await importTripZip(file);
      // Load waypoints — no route data, user will need to calculate
      route.loadTrip(result.waypoints, "balanced", route.preferences, null);
      // Load day overlays
      tripPlanner.loadDayOverlays(result.day_overlays);
      setLoadedTripId(null);
      setLoadedTripName(result.name);
      setLoadedTripIsMultiday(true);
      // Auto-calculate if 2+ waypoints
      if (result.waypoints.length >= 2) {
        setTimeout(() => route.calculateRoute(), 100);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Trip import failed");
    }
  }

  // ---------- Per-day export ----------
  function handleExportDayGpx(day: number) {
    if (!loadedTripId) {
      alert("Save the trip first to export individual days");
      return;
    }
    window.open(exportDayGpxUrl(loadedTripId, day), "_blank");
  }

  // ---------- Per-day import ----------
  async function handleImportDayGpx(day: number, file: File) {
    if (!loadedTripId) {
      alert("Save the trip first to import into a specific day");
      return;
    }
    try {
      const result = await importDayIntoTrip(loadedTripId, day, file);
      // Reload the trip with updated waypoints + overlays
      route.loadTrip(result.waypoints, route.routeType, route.preferences, null);
      tripPlanner.loadDayOverlays(result.day_overlays);
      // Recalculate since route data was cleared
      if (result.waypoints.length >= 2) {
        setTimeout(() => route.calculateRoute(), 100);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Day import failed");
    }
  }

  // ---------- GPX Export (current route) ----------
  function handleExportGpx() {
    const selectedRoute = route.routes[route.selectedRouteIndex];
    if (!selectedRoute) return;

    // Pass full route data (shape + maneuvers) so the GPX export can
    // extract only navigation-relevant points (turns, junctions, roundabouts)
    // instead of dumping thousands of track points.
    const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const params = new URLSearchParams({
      name: "MotoGPS Route",
      waypoints: JSON.stringify(route.waypoints),
      route_data: JSON.stringify({
        shape: selectedRoute.shape,
        maneuvers: selectedRoute.maneuvers,
      }),
    });
    window.open(`${API_URL}/api/gpx/export?${params}`, "_blank");
  }

  // ---------- Waypoint selection + drag state ----------
  const [selectedWaypointIndex, setSelectedWaypointIndex] = useState<number | null>(null);

  const handleMoveWaypoint = useCallback(
    async (index: number, newLat: number, newLng: number) => {
      // Snap to nearest road
      const snapped = await snapToRoad(newLat, newLng);
      route.moveWaypoint(index, snapped.lat, snapped.lng);
      setSelectedWaypointIndex(null);
    },
    [route.moveWaypoint],
  );

  const handleDeleteWaypointFromMap = useCallback(
    (index: number) => {
      route.removeWaypoint(index);
      setSelectedWaypointIndex(null);
    },
    [route.removeWaypoint],
  );

  // ---------- Anomaly highlight + navigation state ----------
  const [highlightedAnomalyIndex, setHighlightedAnomalyIndex] = useState<number | null>(null);
  const [navigatedAnomaly, setNavigatedAnomaly] = useState<import("@/lib/types").RouteAnomaly | null>(null);

  function handleNavigateToAnomaly(anomaly: import("@/lib/types").RouteAnomaly) {
    setNavigatedAnomaly(anomaly);
    setHighlightedAnomalyIndex(
      route.analysis?.anomalies.indexOf(anomaly) ?? null
    );
  }

  // Clear anomaly highlight when analysis changes (route recalculated) or analysis is cleared
  useEffect(() => {
    setNavigatedAnomaly(null);
    setHighlightedAnomalyIndex(null);
  }, [route.analysis]);

  // ---------- Smart map click: insert at closest segment when route exists ----------
  const handleSmartMapClick = useCallback(
    (wp: Waypoint) => {
      // Add waypoint immediately with coordinates as label
      const tempLabel = wp.label || `${wp.lat.toFixed(4)}, ${wp.lng.toFixed(4)}`;
      const wpWithLabel = { ...wp, label: tempLabel };

      if (route.routes.length > 0 && route.waypoints.length >= 2) {
        const insertAt = findInsertIndex(wpWithLabel, route.waypoints);
        route.insertWaypoint(wpWithLabel, insertAt);
      } else {
        route.addWaypoint(wpWithLabel);
      }

      // Reverse geocode in background to get a human-readable label
      if (!wp.label) {
        reverseGeocode(wp.lat, wp.lng).then((label) => {
          if (label && label !== tempLabel) {
            route.updateWaypointLabel(wp.lat, wp.lng, label);
          }
        });
      }
    },
    [route.routes.length, route.waypoints, route.insertWaypoint, route.addWaypoint, route.updateWaypointLabel],
  );

  // ---------- Route insert (click directly on route line) ----------
  const handleRouteInsert = useCallback(
    (wp: Waypoint) => {
      const insertAt = findInsertIndex(wp, route.waypoints);
      route.insertWaypoint(wp, insertAt);
    },
    [route.waypoints, route.insertWaypoint]
  );

  // AI planner: apply suggestions to route (must be before early returns — Rules of Hooks)
  const handleApplyAISuggestions = useCallback(async () => {
    const s = aiPlanner.applySuggestions();
    if (!s) return;

    // Mark applied in chat
    const lastAssistantIdx = aiPlanner.messages.findLastIndex((m) => m.role === "assistant");
    setAiAppliedIdx(lastAssistantIdx >= 0 ? lastAssistantIdx : null);

    // Helper to apply day splits
    const applyDaySplits = () => {
      if (s.day_splits.length > 0) {
        tripPlanner.setIsMultiDay(true);
        tripPlanner.loadDayOverlays(s.day_splits.map((d) => ({
          day: d.day,
          name: d.name,
          description: d.description,
          start_waypoint_idx: d.start_waypoint_idx,
          end_waypoint_idx: d.end_waypoint_idx,
        })));
      }
    };

    // Mode 1: AI suggested new waypoints → replace route, then apply days
    if (s.waypoints.length > 0) {
      route.clearWaypoints();
      for (const wp of s.waypoints) {
        route.addWaypoint({ lat: wp.lat, lng: wp.lng, label: wp.label });
      }
      // Wait for route to finish calculating before applying day splits
      setTimeout(async () => {
        await route.calculateRoute();
        // Now the route exists — safe to apply day overlays
        applyDaySplits();
      }, 200);
    } else {
      // Mode 2: No new waypoints — AI is adjusting an existing route
      // Apply day splits directly (route already exists)
      applyDaySplits();
    }

    // Add any POIs to the map immediately (both modes)
    if (s.pois.length > 0) {
      setMapPOIs((prev) => {
        const existing = new Set(prev.map((p) => `${p.name}|${p.category}`));
        const newPois = s.pois.filter((p) => !existing.has(`${p.name}|${p.category}`));
        return [...prev, ...newPois];
      });
    }
  }, [aiPlanner, route, tripPlanner]);

  // Route calculation — uses multi-mode when days have different route types,
  // otherwise calculates as a single full route.
  const handleCalculateRoute = useCallback(() => {
    if (tripPlanner.hasPerDayRouteTypes && tripPlanner.dayOverlays.length > 0) {
      // Per-day route types exist — use multi-mode endpoint
      route.calculateMultiModeRoute(tripPlanner.dayOverlays);
    } else {
      route.calculateRoute();
    }
  }, [route, tripPlanner.hasPerDayRouteTypes, tripPlanner.dayOverlays]);

  // Auth gate — early returns AFTER all hooks
  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-page">
        <div className="text-muted text-sm">Loading...</div>
      </div>
    );
  }
  if (!user) return null;

  const panelProps = {
    waypoints: route.waypoints,
    routes: route.routes,
    selectedRouteIndex: route.selectedRouteIndex,
    routeType: (() => {
      // When an un-synced day is selected, show its route type in the selector
      const sel = tripPlanner.selectedDay;
      if (sel != null && tripPlanner.isMultiDay) {
        const day = tripPlanner.dayOverlays.find((d) => d.day === sel);
        if (day?.route_type) return day.route_type as RouteType;
      }
      return route.routeType;
    })(),
    preferences: route.preferences,
    loading: route.loading,
    error: route.error,
    routeStale: route.routeStale,
    trips,
    tripsLoading,
    myGroups,
    onRemoveWaypoint: route.removeWaypoint,
    onAddWaypoint: handleSmartMapClick,
    onReorderWaypoints: route.reorderWaypoints,
    onClear: () => { route.clearWaypoints(); setLoadedTripId(null); setLoadedTripName(null); setLoadedTripIsMultiday(false); },
    onCalculate: handleCalculateRoute,
    onRouteSelect: route.setSelectedRouteIndex,
    onRouteTypeChange: (type: RouteType) => {
      const sel = tripPlanner.selectedDay;
      if (sel != null && tripPlanner.isMultiDay) {
        // A day is selected — check if it's un-synced
        const day = tripPlanner.dayOverlays.find((d) => d.day === sel);
        if (day?.route_type != null) {
          // Un-synced day: change only this day's type
          tripPlanner.setDayRouteType(sel, type);
          return;
        }
      }
      // No day selected, or day is synced: change trip-level default
      route.setRouteType(type);
    },
    onCustomPreferencesChange: route.setCustomPreferences,
    onSaveTrip: loadedTripId ? handleQuickSave : () => setShowSaveDialog(true),
    onSaveAsNewTrip: () => setShowSaveDialog(true),
    loadedTripName,
    onLoadTrip: handleLoadTrip,
    onDeleteTrip: handleDeleteTrip,
    onRefreshTrips: refreshTrips,
    onImportGpx: handleImportGpx,
    onImportTripZip: handleImportTripZip,
    onExportGpx: handleExportGpx,
    analysis: route.analysis,
    analysisLoading: route.analysisLoading,
    onApplyFix: (anomaly: import("@/lib/types").RouteAnomaly) => {
      route.applyFix(anomaly);
      setNavigatedAnomaly(null);
      setHighlightedAnomalyIndex(null);
    },
    onHighlightAnomaly: setHighlightedAnomalyIndex,
    onNavigateToAnomaly: handleNavigateToAnomaly,
    defaultVehicle,
    aiPlanner: {
      messages: aiPlanner.messages,
      suggestions: aiPlanner.suggestions,
      isOpen: aiPlanner.isOpen,
      isLoading: aiPlanner.isLoading,
      error: aiPlanner.error,
      appliedMessageIdx: aiAppliedIdx,
      onToggle: aiPlanner.toggle,
      onSendMessage: (text: string) => aiPlanner.sendMessage(text, route.routeType, route.waypoints.length >= 2 ? route.waypoints : undefined),
      onApplySuggestions: handleApplyAISuggestions,
      onDismissSuggestions: aiPlanner.dismissSuggestions,
      onEnrichPOIs: () => aiPlanner.loadPOIs(),
      onClearChat: () => { aiPlanner.clearChat(); setAiAppliedIdx(null); },
    },
    dayPlannerProps: {
      dayOverlays: tripPlanner.dayOverlays,
      dayStats: tripPlanner.dayStats,
      selectedDay: tripPlanner.selectedDay,
      dailyTargetM: tripPlanner.dailyTargetM,
      isMultiDay: tripPlanner.isMultiDay,
      splitting: tripPlanner.splitting,
      onAutoSplit: tripPlanner.autoSplit,
      onClearDays: tripPlanner.clearDays,
      onSelectDay: tripPlanner.setSelectedDay,
      onSetDailyTarget: tripPlanner.setDailyTargetM,
      onSetIsMultiDay: tripPlanner.setIsMultiDay,
      onUpdateDayMeta: tripPlanner.updateDayMeta,
      onExportDayGpx: handleExportDayGpx,
      onImportDayGpx: handleImportDayGpx,
      waypointCount: route.waypoints.length,
      hasRoute: route.routes.length > 0,
      tripRouteType: route.routeType,
      onDayRouteTypeChange: tripPlanner.setDayRouteType,
      daySuggestions: tripPlanner.daySuggestions,
      onAddSuggestedWaypoint: (poi: import("@/lib/types").POIResult) => {
        handleSmartMapClick({ lat: poi.lat, lng: poi.lng, label: poi.name });
      },
    },
  };

  return (
    <div className="flex flex-col h-screen bg-page">
      <TopNav />
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="hidden md:flex md:w-80 lg:w-96 flex-col border-r border-border bg-surface">
          <RoutePanel {...panelProps} />
        </aside>

        {/* Map */}
        <main className="flex-1 relative">
        <Map
          waypoints={route.waypoints}
          routes={route.routes}
          selectedRouteIndex={route.selectedRouteIndex}
          onMapClick={handleSmartMapClick}
          onRouteInsert={handleRouteInsert}
          onRouteSelect={route.setSelectedRouteIndex}
          selectedWaypointIndex={selectedWaypointIndex}
          onSelectWaypoint={setSelectedWaypointIndex}
          onDeleteWaypoint={handleDeleteWaypointFromMap}
          onMoveWaypoint={handleMoveWaypoint}
          onRecalculate={route.calculateRoute}
          hasRoutes={route.routes.length > 0}
          navigatedAnomaly={navigatedAnomaly ?? undefined}
          overnightStopIndices={tripPlanner.overnightStopIndices}
          dayStats={tripPlanner.dayStats}
          selectedDay={tripPlanner.selectedDay}
          pois={allMapPOIs}
          onAddPOIAsWaypoint={(poi) => {
            handleSmartMapClick({ lat: poi.lat, lng: poi.lng, label: poi.name });
          }}
          onClearPOIs={() => { setMapPOIs([]); setRoutePOIs([]); setPoiCategories(new Set()); }}
          poiOverlaySlot={
            <POIOverlayControls
              categories={poiCategoryDefs.length > 0 ? poiCategoryDefs : DEFAULT_POI_CATEGORIES}
              activeCategories={poiCategories}
              onToggle={handleTogglePOICategory}
              loading={poiLoading}
              poiCount={allMapPOIs.length}
              disabled={!route.routes.length}
            />
          }
        />

        {/* Mobile bottom sheet */}
        <div className="md:hidden absolute bottom-0 left-0 right-0 bg-overlay backdrop-blur border-t border-border max-h-[40vh] overflow-y-auto rounded-t-xl">
          <div className="w-10 h-1 bg-surface-hover rounded-full mx-auto mt-2 mb-1" />
          <RoutePanel {...panelProps} />
        </div>
      </main>
      </div>

      {/* Save Trip dialog */}
      <SaveTripDialog
        open={showSaveDialog}
        saving={saving}
        onSave={handleSaveTrip}
        onClose={() => setShowSaveDialog(false)}
      />
    </div>
  );
}
