"use client";

import type { Waypoint, RouteResult, RouteType, RoutePreferences, TripSummary, RouteAnalysisResponse, RouteAnomaly } from "@/lib/types";
import { RouteTypeSelector } from "./RouteTypeSelector";
import { RouteStats } from "./RouteStats";
import { RouteAnalysis } from "./RouteAnalysis";
import { SavedTrips } from "./SavedTrips";
import { WaypointList } from "./WaypointList";

interface RoutePanelProps {
  waypoints: Waypoint[];
  routes: RouteResult[];
  selectedRouteIndex: number;
  routeType: RouteType;
  preferences: RoutePreferences;
  loading: boolean;
  error: string | null;
  // Saved trips
  trips: TripSummary[];
  tripsLoading: boolean;
  onRemoveWaypoint: (index: number) => void;
  onAddWaypoint: (wp: Waypoint) => void;
  onReorderWaypoints: (from: number, to: number) => void;
  onClear: () => void;
  onCalculate: () => void;
  onRouteSelect: (index: number) => void;
  onRouteTypeChange: (type: RouteType) => void;
  onCustomPreferencesChange: (prefs: RoutePreferences) => void;
  // Trip actions
  onSaveTrip: () => void;
  onLoadTrip: (trip: TripSummary) => void;
  onDeleteTrip: (id: string) => void;
  onRefreshTrips: () => void;
  onImportGpx: (file: File) => void;
  onExportGpx: () => void;
  // Analysis
  analysis: RouteAnalysisResponse | null;
  analysisLoading: boolean;
  onApplyFix: (anomaly: RouteAnomaly) => void;
  onHighlightAnomaly: (index: number | null) => void;
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function RoutePanel({
  waypoints,
  routes,
  selectedRouteIndex,
  routeType,
  preferences,
  loading,
  error,
  trips,
  tripsLoading,
  onRemoveWaypoint,
  onAddWaypoint,
  onReorderWaypoints,
  onClear,
  onCalculate,
  onRouteSelect,
  onRouteTypeChange,
  onCustomPreferencesChange,
  onSaveTrip,
  onLoadTrip,
  onDeleteTrip,
  onRefreshTrips,
  onImportGpx,
  onExportGpx,
  analysis,
  analysisLoading,
  onApplyFix,
  onHighlightAnomaly,
}: RoutePanelProps) {
  const selectedRoute = routes[selectedRouteIndex] || null;
  const hasRoutes = routes.length > 0;

  return (
    <div className="flex flex-col gap-4 p-4 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-zinc-100">Moto-GPS</h1>
        <div className="flex items-center gap-2">
          {/* Import GPX */}
          <label
            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            title="Import GPX file"
          >
            📥 Import
            <input
              type="file"
              accept=".gpx,application/gpx+xml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  onImportGpx(file);
                  e.target.value = "";
                }
              }}
            />
          </label>
          {waypoints.length > 0 && (
            <button
              onClick={onClear}
              className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* Saved Trips */}
      <SavedTrips
        trips={trips}
        loading={tripsLoading}
        onSelect={onLoadTrip}
        onDelete={onDeleteTrip}
        onRefresh={onRefreshTrips}
      />

      {/* Waypoints — search, list, drag-and-drop */}
      <WaypointList
        waypoints={waypoints}
        onRemove={onRemoveWaypoint}
        onAdd={onAddWaypoint}
        onReorder={onReorderWaypoints}
      />

      {/* Route Type Selector */}
      <RouteTypeSelector
        routeType={routeType}
        preferences={preferences}
        onRouteTypeChange={onRouteTypeChange}
        onCustomPreferencesChange={onCustomPreferencesChange}
      />

      {/* Action buttons */}
      {waypoints.length >= 2 && (
        <div className="flex gap-2">
          <button
            onClick={onCalculate}
            disabled={loading}
            className="flex-1 rounded-md bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium py-2.5 transition-colors text-sm"
          >
            {loading ? "Planning..." : "Plan Route"}
          </button>
          {hasRoutes && (
            <>
              <button
                onClick={onSaveTrip}
                className="rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-200 font-medium px-3 py-2.5 transition-colors text-sm"
                title="Save this trip"
              >
                💾
              </button>
              <button
                onClick={onExportGpx}
                className="rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-200 font-medium px-3 py-2.5 transition-colors text-sm"
                title="Export as GPX"
              >
                📤
              </button>
            </>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-sm text-red-400 bg-red-950/50 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {/* Route results */}
      {routes.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
            Routes ({routes.length})
          </span>
          {routes.map((route, i) => (
            <button
              key={i}
              onClick={() => onRouteSelect(i)}
              className={`
                flex flex-col gap-1 rounded-md px-3 py-3 text-left transition-colors border
                ${
                  i === selectedRouteIndex
                    ? "bg-blue-950/50 border-blue-600"
                    : "bg-zinc-800 border-zinc-700 hover:border-zinc-500"
                }
              `}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-200">
                  Route {i + 1}
                </span>
                {route.moto_score !== null && (
                  <span
                    className={`text-xs font-mono ${
                      route.moto_score >= 0.5
                        ? "text-green-400"
                        : route.moto_score >= 0.3
                          ? "text-yellow-400"
                          : "text-zinc-400"
                    }`}
                  >
                    Score: {(route.moto_score * 100).toFixed(0)}
                  </span>
                )}
              </div>
              <div className="flex gap-3 text-xs text-zinc-400">
                <span>{formatDistance(route.distance_m)}</span>
                <span>{formatTime(route.time_s)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Selected route stats */}
      {selectedRoute && <RouteStats route={selectedRoute} />}

      {/* Route analysis */}
      {(analysis || analysisLoading) && selectedRoute && (
        <RouteAnalysis
          analysis={analysis || { anomalies: [], overall_health: "good", analysis_time_ms: 0 }}
          loading={analysisLoading}
          onApplyFix={onApplyFix}
          onHighlightAnomaly={onHighlightAnomaly}
        />
      )}
    </div>
  );
}
