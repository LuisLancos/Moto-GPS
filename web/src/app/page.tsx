"use client";

import dynamic from "next/dynamic";
import { useState, useEffect, useCallback } from "react";
import { useRoute } from "@/hooks/useRoute";
import { useTripPlanner } from "@/hooks/useTripPlanner";
import { RoutePanel } from "@/components/route/RoutePanel";
import { SaveTripDialog } from "@/components/route/SaveTripDialog";
import {
  listTrips, saveTrip, updateTrip, deleteTrip, getTrip, importGpx, importTripZip,
  listMultiDayTrips, saveMultiDayTrip, updateMultiDayTrip, deleteMultiDayTrip, getMultiDayTrip,
  snapToRoad, exportDayGpxUrl, importDayIntoTrip,
} from "@/lib/api";
import { findInsertIndex } from "@/lib/geo";
import { storableRouteType } from "@/lib/formatters";
import type { TripSummary, RouteType, Waypoint } from "@/lib/types";

const Map = dynamic(() => import("@/components/map/Map").then((m) => m.Map), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-zinc-900 text-zinc-500">
      Loading map...
    </div>
  ),
});

export default function Home() {
  const route = useRoute();
  const selectedRoute = route.routes[route.selectedRouteIndex] || null;
  const tripPlanner = useTripPlanner(route.waypoints, selectedRoute);

  // ---------- Saved Trips state ----------
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  // Track the currently loaded trip so we can update in place
  const [loadedTripId, setLoadedTripId] = useState<string | null>(null);
  const [loadedTripName, setLoadedTripName] = useState<string | null>(null);
  const [loadedTripIsMultiday, setLoadedTripIsMultiday] = useState(false);

  const refreshTrips = useCallback(async () => {
    setTripsLoading(true);
    try {
      // Load both single-day and multi-day trips, merge into one list
      const [singleDay, multiDay] = await Promise.all([
        listTrips().catch(() => []),
        listMultiDayTrips().catch(() => []),
      ]);

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
        await updateTrip(loadedTripId, {
          name: loadedTripName,
          route_type: storableRouteType(route.routeType),
          waypoints: route.waypoints,
          preferences: route.preferences,
          selected_route: sr,
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
          selected_route: sr,
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

  // ---------- Smart map click: insert at closest segment when route exists ----------
  const handleSmartMapClick = useCallback(
    (wp: Waypoint) => {
      if (route.routes.length > 0 && route.waypoints.length >= 2) {
        // Route exists — insert at the closest segment, not at the end
        const insertAt = findInsertIndex(wp, route.waypoints);
        route.insertWaypoint(wp, insertAt);
      } else {
        // No route yet — append as usual
        route.addWaypoint(wp);
      }
    },
    [route.routes.length, route.waypoints, route.insertWaypoint, route.addWaypoint],
  );

  // ---------- Route insert (click directly on route line) ----------
  const handleRouteInsert = useCallback(
    (wp: Waypoint) => {
      const insertAt = findInsertIndex(wp, route.waypoints);
      route.insertWaypoint(wp, insertAt);
    },
    [route.waypoints, route.insertWaypoint]
  );

  const panelProps = {
    waypoints: route.waypoints,
    routes: route.routes,
    selectedRouteIndex: route.selectedRouteIndex,
    routeType: route.routeType,
    preferences: route.preferences,
    loading: route.loading,
    error: route.error,
    routeStale: route.routeStale,
    trips,
    tripsLoading,
    onRemoveWaypoint: route.removeWaypoint,
    onAddWaypoint: handleSmartMapClick,
    onReorderWaypoints: route.reorderWaypoints,
    onClear: () => { route.clearWaypoints(); setLoadedTripId(null); setLoadedTripName(null); setLoadedTripIsMultiday(false); },
    onCalculate: route.calculateRoute,
    onRouteSelect: route.setSelectedRouteIndex,
    onRouteTypeChange: route.setRouteType,
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
    onApplyFix: route.applyFix,
    onHighlightAnomaly: setHighlightedAnomalyIndex,
    onNavigateToAnomaly: handleNavigateToAnomaly,
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
    },
  };

  return (
    <div className="flex h-screen bg-zinc-950">
      {/* Sidebar */}
      <aside className="hidden md:flex md:w-80 lg:w-96 flex-col border-r border-zinc-800 bg-zinc-900">
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
        />

        {/* Mobile bottom sheet */}
        <div className="md:hidden absolute bottom-0 left-0 right-0 bg-zinc-900/95 backdrop-blur border-t border-zinc-800 max-h-[40vh] overflow-y-auto rounded-t-xl">
          <div className="w-10 h-1 bg-zinc-600 rounded-full mx-auto mt-2 mb-1" />
          <RoutePanel {...panelProps} />
        </div>
      </main>

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
