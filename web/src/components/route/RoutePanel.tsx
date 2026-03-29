"use client";

import type { Waypoint, RouteResult, RouteType, RoutePreferences, TripSummary, RouteAnalysisResponse, RouteAnomaly } from "@/lib/types";
import type { VehicleFuelData } from "@/lib/fuelCalc";
import { formatDistance, formatTime } from "@/lib/formatters";
import { RouteTypeSelector } from "./RouteTypeSelector";
import { RouteStats } from "./RouteStats";
import { RouteAnalysis } from "./RouteAnalysis";
import { SavedTrips } from "./SavedTrips";
import { WaypointList } from "./WaypointList";
import { DayPlannerPanel } from "./DayPlannerPanel";
import type { DayOverlay, DayOverlayWithStats, AIChatMessage, AISuggestions } from "@/lib/types";
import type { UserGroup } from "@/lib/api";
import { AIPlannerChat } from "../ai/AIPlannerChat";
import { HintBeacon } from "../walkthrough/HintBeacon";

interface RoutePanelProps {
  waypoints: Waypoint[];
  routes: RouteResult[];
  selectedRouteIndex: number;
  routeType: RouteType;
  preferences: RoutePreferences;
  loading: boolean;
  error: string | null;
  routeStale: boolean;
  // Saved trips
  trips: TripSummary[];
  tripsLoading: boolean;
  myGroups?: UserGroup[];
  onRemoveWaypoint: (index: number) => void;
  onAddWaypoint: (wp: Waypoint) => void;
  onReorderWaypoints: (from: number, to: number) => void;
  onNavigateToWaypoint?: (index: number) => void;
  onClear: () => void;
  onCalculate: () => void;
  onRouteSelect: (index: number) => void;
  onRouteTypeChange: (type: RouteType) => void;
  onCustomPreferencesChange: (prefs: RoutePreferences) => void;
  // Trip actions
  onSaveTrip: () => void;
  onSaveAsNewTrip: () => void;
  loadedTripName: string | null;
  onLoadTrip: (trip: TripSummary) => void;
  onDeleteTrip: (id: string) => void;
  onRefreshTrips: () => void;
  onImportGpx: (file: File) => void;
  onImportTripZip: (file: File) => void;
  onExportGpx: () => void;
  // Analysis
  analysis: RouteAnalysisResponse | null;
  analysisLoading: boolean;
  onApplyFix: (anomaly: RouteAnomaly) => void;
  onHighlightAnomaly: (index: number | null) => void;
  onNavigateToAnomaly: (anomaly: RouteAnomaly) => void;
  // AI trip planner
  aiPlanner?: {
    messages: AIChatMessage[];
    suggestions: AISuggestions | null;
    routeActions: import("@/lib/types").RouteAction[];
    isOpen: boolean;
    isLoading: boolean;
    error: string | null;
    appliedMessageIdx: number | null;
    onToggle: () => void;
    onSendMessage: (text: string) => void;
    onApplySuggestions: () => void;
    onDismissSuggestions: () => void;
    onApplyRouteActions: () => void;
    onDismissRouteActions: () => void;
    onEnrichPOIs: () => void;
    onClearChat: () => void;
  };
  // Fuel estimation
  defaultVehicle?: VehicleFuelData | null;
  // Multi-day trip planner
  dayPlannerProps?: {
    dayOverlays: DayOverlay[];
    dayStats: DayOverlayWithStats[];
    selectedDay: number | null;
    dailyTargetM: number;
    isMultiDay: boolean;
    splitting: boolean;
    onAutoSplit: () => void;
    onClearDays: () => void;
    onSelectDay: (day: number | null) => void;
    onSetDailyTarget: (target: number) => void;
    onSetIsMultiDay: (active: boolean) => void;
    onUpdateDayMeta: (day: number, meta: { name?: string; description?: string }) => void;
    daySuggestions?: import("@/lib/types").DaySuggestion[];
    onAddSuggestedWaypoint?: (poi: import("@/lib/types").POIResult) => void;
  };
}

// formatDistance and formatTime imported from @/lib/formatters

export function RoutePanel({
  waypoints,
  routes,
  selectedRouteIndex,
  routeType,
  preferences,
  loading,
  error,
  routeStale,
  trips,
  tripsLoading,
  myGroups,
  onRemoveWaypoint,
  onAddWaypoint,
  onReorderWaypoints,
  onNavigateToWaypoint,
  onClear,
  onCalculate,
  onRouteSelect,
  onRouteTypeChange,
  onCustomPreferencesChange,
  onSaveTrip,
  onSaveAsNewTrip,
  loadedTripName,
  onLoadTrip,
  onDeleteTrip,
  onRefreshTrips,
  onImportGpx,
  onImportTripZip,
  onExportGpx,
  analysis,
  analysisLoading,
  onApplyFix,
  onHighlightAnomaly,
  onNavigateToAnomaly,
  aiPlanner,
  defaultVehicle,
  dayPlannerProps,
}: RoutePanelProps) {
  const selectedRoute = routes[selectedRouteIndex] || null;
  const hasRoutes = routes.length > 0;

  return (
    <div className="flex flex-col gap-4 p-4 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <h1 className="text-lg font-bold text-primary">Moto-GPS</h1>
          {loadedTripName && (
            <span className="text-[11px] text-muted truncate max-w-[160px]">
              Editing: {loadedTripName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Import Route (.gpx) */}
          <label
            className="text-xs text-muted hover:text-secondary transition-colors cursor-pointer"
            title="Import a single route (.gpx)"
          >
            📥 Route
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
          {/* Import Trip (.zip) */}
          <label
            className="text-xs text-muted hover:text-secondary transition-colors cursor-pointer"
            title="Import a multi-day trip (.zip of GPX files)"
          >
            📥 Trip
            <input
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  onImportTripZip(file);
                  e.target.value = "";
                }
              }}
            />
          </label>
          {waypoints.length > 0 && (
            <button
              onClick={onClear}
              className="text-xs text-muted hover:text-secondary transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* AI Trip Planner */}
      {aiPlanner && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
          <button
            data-tour="ai-planner"
            onClick={aiPlanner.onToggle}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md transition-colors ${
              aiPlanner.isOpen
                ? "bg-purple-700 text-white"
                : "bg-surface-alt border border-border text-secondary hover:border-purple-600 hover:text-purple-300"
            }`}
          >
            ✨ AI Trip Planner
          </button>
          <HintBeacon id="ai-planner" hint="Ask the AI to plan routes, suggest fuel stops, scenic detours, and more." />
          </div>
          {aiPlanner.isOpen && (
            <AIPlannerChat
              messages={aiPlanner.messages}
              suggestions={aiPlanner.suggestions}
              routeActions={aiPlanner.routeActions}
              isLoading={aiPlanner.isLoading}
              error={aiPlanner.error}
              onSendMessage={aiPlanner.onSendMessage}
              onApplySuggestions={aiPlanner.onApplySuggestions}
              onDismissSuggestions={aiPlanner.onDismissSuggestions}
              onApplyRouteActions={aiPlanner.onApplyRouteActions}
              onDismissRouteActions={aiPlanner.onDismissRouteActions}
              onEnrichPOIs={aiPlanner.onEnrichPOIs}
              onClearChat={aiPlanner.onClearChat}
              appliedMessageIdx={aiPlanner.appliedMessageIdx}
            />
          )}
        </div>
      )}

      {/* Saved Trips */}
      <SavedTrips
        trips={trips}
        loading={tripsLoading}
        onSelect={onLoadTrip}
        onDelete={onDeleteTrip}
        onRefresh={onRefreshTrips}
        myGroups={myGroups}
      />

      {/* Waypoints — search, list, drag-and-drop */}
      <WaypointList
        waypoints={waypoints}
        onRemove={onRemoveWaypoint}
        onAdd={onAddWaypoint}
        onReorder={onReorderWaypoints}
        onNavigateToWaypoint={onNavigateToWaypoint}
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
            data-tour="plan-route"
            onClick={onCalculate}
            disabled={loading}
            className={`flex-1 rounded-md font-medium py-2.5 transition-colors text-sm text-white disabled:bg-surface-hover disabled:text-muted ${
              routeStale
                ? "bg-amber-600 hover:bg-amber-500"
                : "bg-blue-600 hover:bg-blue-500"
            }`}
          >
            {loading ? "Planning..." : routeStale ? "🔄 Recalculate" : "Plan Route"}
          </button>
          {hasRoutes && (
            <>
              <button
                data-tour="save-trip"
                onClick={onSaveTrip}
                className="rounded-md bg-surface-hover hover:bg-surface-alt text-secondary font-medium px-3 py-2.5 transition-colors text-sm"
                title={loadedTripName ? `Save "${loadedTripName}"` : "Save as new trip"}
              >
                💾{loadedTripName ? "" : "+"}
              </button>
              {loadedTripName && (
                <button
                  onClick={onSaveAsNewTrip}
                  className="rounded-md bg-surface-hover hover:bg-surface-alt text-secondary font-medium px-3 py-2.5 transition-colors text-[10px]"
                  title="Save as new trip"
                >
                  💾+
                </button>
              )}
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
          <span className="text-xs font-medium text-muted uppercase tracking-wider">
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
                    : "bg-surface-alt border-border hover:border-surface-hover"
                }
              `}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-secondary">
                  Route {i + 1}
                </span>
                {route.moto_score !== null && (
                  <span
                    className={`text-xs font-mono ${
                      route.moto_score >= 0.5
                        ? "text-green-700 dark:text-green-400"
                        : route.moto_score >= 0.3
                          ? "text-yellow-700 dark:text-yellow-400"
                          : "text-muted"
                    }`}
                  >
                    Score: {(route.moto_score * 100).toFixed(0)}
                  </span>
                )}
              </div>
              <div className="flex gap-3 text-xs text-muted">
                <span>{formatDistance(route.distance_m)}</span>
                <span>{formatTime(route.time_s)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Multi-Day Trip Planner */}
      {dayPlannerProps && (
        <DayPlannerPanel
          {...dayPlannerProps}
          waypointCount={waypoints.length}
          hasRoute={hasRoutes}
          defaultVehicle={defaultVehicle}
        />
      )}

      {/* Selected route stats — filtered by day when a day is selected */}
      {selectedRoute && (
        <RouteStats
          route={selectedRoute}
          selectedDay={dayPlannerProps?.selectedDay}
          dayStats={dayPlannerProps?.dayStats}
          defaultVehicle={defaultVehicle}
        />
      )}

      {/* Route analysis */}
      {(analysis || analysisLoading) && selectedRoute && (
        <RouteAnalysis
          analysis={analysis || { anomalies: [], overall_health: "good", analysis_time_ms: 0 }}
          loading={analysisLoading}
          onApplyFix={onApplyFix}
          onHighlightAnomaly={onHighlightAnomaly}
          onNavigateToAnomaly={onNavigateToAnomaly}
        />
      )}
    </div>
  );
}
