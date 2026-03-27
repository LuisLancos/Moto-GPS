"use client";

import dynamic from "next/dynamic";
import { useState, useEffect, useCallback } from "react";
import { useRoute } from "@/hooks/useRoute";
import { RoutePanel } from "@/components/route/RoutePanel";
import { SaveTripDialog } from "@/components/route/SaveTripDialog";
import { listTrips, saveTrip, deleteTrip, getTrip, importGpx } from "@/lib/api";
import { findInsertIndex } from "@/lib/geo";
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

  // ---------- Saved Trips state ----------
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saving, setSaving] = useState(false);

  const refreshTrips = useCallback(async () => {
    setTripsLoading(true);
    try {
      setTrips(await listTrips());
    } catch {
      // silent — trips panel will show empty
    } finally {
      setTripsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshTrips();
  }, [refreshTrips]);

  // ---------- Trip actions ----------

  async function handleSaveTrip(name: string, description: string) {
    const selectedRoute = route.routes[route.selectedRouteIndex];
    if (!selectedRoute) return;

    setSaving(true);
    try {
      await saveTrip({
        name,
        description: description || undefined,
        route_type: route.routeType === "custom" ? "balanced" : route.routeType,
        waypoints: route.waypoints,
        preferences: route.preferences,
        selected_route: selectedRoute,
        total_distance_m: selectedRoute.distance_m,
        total_time_s: selectedRoute.time_s,
        total_moto_score: selectedRoute.moto_score ?? undefined,
      });
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
      const detail = await getTrip(summary.id);
      // Restore waypoints
      route.loadTrip(
        detail.waypoints,
        (detail.route_type || "balanced") as RouteType,
        detail.preferences,
        detail.route_data,
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to load trip");
    }
  }

  async function handleDeleteTrip(id: string) {
    try {
      await deleteTrip(id);
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
          ? { distance_m: 0, time_s: 0, shape: result.track_shape, maneuvers: [], moto_score: null, valhalla_params: {} }
          : null,
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "GPX import failed");
    }
  }

  // ---------- GPX Export (current route) ----------
  function handleExportGpx() {
    const selectedRoute = route.routes[route.selectedRouteIndex];
    if (!selectedRoute) return;

    // Build URL with query params for the export endpoint
    const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const params = new URLSearchParams({
      name: "MotoGPS Route",
      waypoints: JSON.stringify(route.waypoints),
      route_shape: JSON.stringify(selectedRoute.shape),
    });
    // Trigger download
    window.open(`${API_URL}/api/gpx/export?${params}`, "_blank");
  }

  // ---------- Anomaly highlight state ----------
  const [highlightedAnomalyIndex, setHighlightedAnomalyIndex] = useState<number | null>(null);

  // ---------- Route insert (click on route line) ----------
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
    trips,
    tripsLoading,
    onRemoveWaypoint: route.removeWaypoint,
    onAddWaypoint: route.addWaypoint,
    onReorderWaypoints: route.reorderWaypoints,
    onClear: route.clearWaypoints,
    onCalculate: route.calculateRoute,
    onRouteSelect: route.setSelectedRouteIndex,
    onRouteTypeChange: route.setRouteType,
    onCustomPreferencesChange: route.setCustomPreferences,
    onSaveTrip: () => setShowSaveDialog(true),
    onLoadTrip: handleLoadTrip,
    onDeleteTrip: handleDeleteTrip,
    onRefreshTrips: refreshTrips,
    onImportGpx: handleImportGpx,
    onExportGpx: handleExportGpx,
    analysis: route.analysis,
    analysisLoading: route.analysisLoading,
    onApplyFix: route.applyFix,
    onHighlightAnomaly: setHighlightedAnomalyIndex,
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
          onMapClick={route.addWaypoint}
          onRouteInsert={handleRouteInsert}
          onRouteSelect={route.setSelectedRouteIndex}
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
