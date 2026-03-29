"use client";

import { useState } from "react";
import type { DayOverlay, DayOverlayWithStats, RouteType, DaySuggestion } from "@/lib/types";
import { ROUTE_TYPE_META } from "@/lib/types";
import { useUnits } from "@/contexts/UnitContext";
import { formatTime } from "@/lib/formatters";
import { estimateFuel, type VehicleFuelData } from "@/lib/fuelCalc";

interface DayPlannerPanelProps {
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
  onExportDayGpx?: (day: number) => void;
  onImportDayGpx?: (day: number, file: File) => void;
  onExportAllDaysGpx?: () => void;
  waypointCount: number;
  hasRoute: boolean;
  // Per-day route type (sync/unsync)
  tripRouteType?: RouteType;
  onDayRouteTypeChange?: (day: number, type: RouteType | undefined) => void;
  defaultVehicle?: VehicleFuelData | null;
  daySuggestions?: DaySuggestion[];
  onAddSuggestedWaypoint?: (poi: import("@/lib/types").POIResult) => void;
}

export function DayPlannerPanel({
  dayStats,
  selectedDay,
  dailyTargetM,
  isMultiDay,
  splitting,
  onAutoSplit,
  onClearDays,
  onSelectDay,
  onSetDailyTarget,
  onSetIsMultiDay,
  onUpdateDayMeta,
  onExportDayGpx,
  onImportDayGpx,
  onExportAllDaysGpx,
  waypointCount,
  hasRoute,
  tripRouteType = "balanced",
  onDayRouteTypeChange,
  defaultVehicle,
  daySuggestions,
  onAddSuggestedWaypoint,
}: DayPlannerPanelProps) {
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const { formatDist } = useUnits();

  // Don't show unless route exists with 3+ waypoints
  if (!hasRoute || waypointCount < 3) return null;

  // Show activation button when not in multi-day mode
  if (!isMultiDay) {
    return (
      <div className="border border-dashed border-border rounded-md p-3">
        <button
          onClick={() => {
            onSetIsMultiDay(true);
            onAutoSplit();
          }}
          className="w-full text-sm text-secondary hover:text-primary transition-colors py-1"
        >
          🗓️ Split into Multi-Day Trip
        </button>
      </div>
    );
  }

  const totalDistance = dayStats.reduce((s, d) => s + d.distance_m, 0);
  const totalTime = dayStats.reduce((s, d) => s + d.time_s, 0);

  return (
    <div className="flex flex-col gap-3 border border-border rounded-md p-3 bg-surface/50">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted uppercase tracking-wider">
          🗓️ Multi-Day Trip ({dayStats.length} {dayStats.length === 1 ? "day" : "days"})
        </span>
        <button
          onClick={() => { onClearDays(); onSetIsMultiDay(false); }}
          className="text-[10px] text-muted hover:text-secondary transition-colors"
        >
          Close
        </button>
      </div>

      {/* Daily target slider */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted">Daily target</span>
          <span className="text-[11px] text-secondary font-mono">
            {formatDist(dailyTargetM)}
          </span>
        </div>
        <input
          type="range"
          min={100000}
          max={800000}
          step={25000}
          value={dailyTargetM}
          onChange={(e) => onSetDailyTarget(Number(e.target.value))}
          className="w-full h-1 bg-surface-hover rounded-lg appearance-none cursor-pointer accent-blue-500"
        />
        <div className="flex justify-between text-[10px] text-zinc-600">
          <span>100km</span>
          <span>800km</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={onAutoSplit}
          disabled={splitting}
          className="flex-1 text-[11px] rounded bg-surface-alt hover:bg-surface-hover text-secondary py-1.5 transition-colors disabled:opacity-50"
        >
          {splitting ? "Splitting..." : "Auto-Split"}
        </button>
        <button
          onClick={onClearDays}
          className="text-[11px] rounded bg-surface-alt hover:bg-surface-hover text-muted px-3 py-1.5 transition-colors"
        >
          Clear
        </button>
      </div>

      {/* Day cards */}
      {dayStats.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {dayStats.map((day) => {
            const isSelected = selectedDay === day.day;
            const isEditing = editingDay === day.day;

            return (
              <div
                key={day.day}
                onClick={() => onSelectDay(isSelected ? null : day.day)}
                className={`
                  rounded-md px-3 py-2.5 cursor-pointer transition-all border
                  ${isSelected
                    ? "bg-blue-950/60 border-blue-600"
                    : "bg-surface-alt/80 border-border/50 hover:border-surface-hover"
                  }
                `}
              >
                {/* Day header */}
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-secondary truncate">
                    {day.name || `Day ${day.day}`}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {/* Edit button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isEditing) {
                          onUpdateDayMeta(day.day, { name: editName || undefined, description: editDesc || undefined });
                          setEditingDay(null);
                        } else {
                          setEditingDay(day.day);
                          setEditName(day.name || "");
                          setEditDesc(day.description || "");
                        }
                      }}
                      className="text-[10px] text-muted hover:text-secondary transition-colors"
                    >
                      {isEditing ? "✓" : "✏️"}
                    </button>
                    {/* Export GPX */}
                    {onExportDayGpx && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onExportDayGpx(day.day); }}
                        className="text-[10px] text-muted hover:text-blue-400 transition-colors"
                        title={`Export Day ${day.day} GPX`}
                      >
                        📤
                      </button>
                    )}
                    {/* Import GPX into this day */}
                    {onImportDayGpx && (
                      <label
                        className="text-[10px] text-muted hover:text-green-400 transition-colors cursor-pointer"
                        title={`Import GPX into Day ${day.day}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        📥
                        <input
                          type="file"
                          accept=".gpx,application/gpx+xml"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              onImportDayGpx(day.day, file);
                              e.target.value = "";
                            }
                          }}
                        />
                      </label>
                    )}
                  </div>
                </div>

                {/* Edit fields */}
                {isEditing && (
                  <div
                    className="flex flex-col gap-1.5 mb-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Day name"
                      className="w-full text-[11px] bg-surface border border-border rounded px-2 py-1 text-primary placeholder:text-muted"
                    />
                    <input
                      type="text"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Description (optional)"
                      className="w-full text-[11px] bg-surface border border-border rounded px-2 py-1 text-primary placeholder:text-muted"
                    />
                  </div>
                )}

                {/* Route mode: sync/unsync */}
                {onDayRouteTypeChange && (
                  <div
                    className="flex items-center gap-1 my-1 flex-wrap"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!day.route_type ? (
                      /* Synced state */
                      <>
                        <span className="text-[10px] text-muted">
                          🔗 {ROUTE_TYPE_META[tripRouteType]?.icon} {ROUTE_TYPE_META[tripRouteType]?.label}
                        </span>
                        <button
                          onClick={() => onDayRouteTypeChange(day.day, tripRouteType)}
                          className="text-[10px] text-zinc-600 hover:text-amber-400 transition-colors ml-auto"
                        >
                          Unsync
                        </button>
                      </>
                    ) : (
                      /* Un-synced state: show route type pills */
                      <>
                        <span className="text-[10px] text-amber-500/80 mr-0.5">🔓</span>
                        {(["scenic", "balanced", "fast"] as RouteType[]).map((type) => (
                          <button
                            key={type}
                            onClick={() => onDayRouteTypeChange(day.day, type)}
                            className={`text-[10px] px-1.5 py-0.5 rounded-full transition-colors ${
                              day.route_type === type
                                ? "bg-blue-600/30 text-blue-300 border border-blue-500/50"
                                : "bg-surface-alt text-muted hover:text-secondary border border-transparent"
                            }`}
                          >
                            {ROUTE_TYPE_META[type]?.icon} {ROUTE_TYPE_META[type]?.label}
                          </button>
                        ))}
                        <button
                          onClick={() => onDayRouteTypeChange(day.day, undefined)}
                          className="text-[10px] text-zinc-600 hover:text-green-400 transition-colors ml-auto"
                          title="Re-sync with trip default"
                        >
                          🔗 Sync
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* Stats row */}
                <div className="flex items-center gap-3 text-[11px] text-muted">
                  <span>{formatDist(day.distance_m)}</span>
                  <span>{formatTime(day.time_s)}</span>
                  <span className="text-zinc-600">{day.waypoint_count} wp</span>
                  {defaultVehicle && (() => {
                    const est = estimateFuel(day.distance_m, defaultVehicle);
                    if (!est) return null;
                    return <span className="text-amber-500/80">⛽{est.fuelStops > 0 ? est.fuelStops : ""} {est.currencySymbol}{est.fuelCost.toFixed(0)}</span>;
                  })()}
                </div>

                {/* Day suggestions: hotel + fuel stops */}
                {(() => {
                  const sug = daySuggestions?.find((s) => s.day === day.day);
                  if (!sug) return null;
                  return (
                    <div className="flex flex-col gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
                      {sug.hotel && (
                        <div className="flex items-center gap-1 text-[10px]">
                          <span className="text-blue-400 truncate flex-1" title={sug.hotel.address || ""}>
                            🏨 {sug.hotel.name}
                            {sug.hotel.distance_km != null && (
                              <span className="text-zinc-600"> ({sug.hotel.distance_km.toFixed(1)}km)</span>
                            )}
                          </span>
                          {onAddSuggestedWaypoint && (
                            <button
                              onClick={() => onAddSuggestedWaypoint(sug.hotel!)}
                              className="shrink-0 text-[9px] text-blue-500 hover:text-blue-300 border border-blue-800/50 rounded px-1 py-0.5 transition-colors"
                              title="Add hotel as waypoint"
                            >
                              + Route
                            </button>
                          )}
                        </div>
                      )}
                      {sug.fuel_stops.map((f, fi) => (
                        <div key={fi} className="flex items-center gap-1 text-[10px]">
                          <span className="text-amber-500/80 truncate flex-1">
                            ⛽ {f.name}
                          </span>
                          {onAddSuggestedWaypoint && (
                            <button
                              onClick={() => onAddSuggestedWaypoint(f)}
                              className="shrink-0 text-[9px] text-amber-500 hover:text-amber-300 border border-amber-800/50 rounded px-1 py-0.5 transition-colors"
                              title="Add fuel stop as waypoint"
                            >
                              + Route
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Description */}
                {day.description && !isEditing && (
                  <p className="text-[10px] text-muted mt-1 truncate">{day.description}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Trip totals */}
      {dayStats.length > 1 && (
        <div className="flex items-center justify-between text-[11px] text-muted border-t border-border/50 pt-2">
          <span>Total: {formatDist(totalDistance)} • {formatTime(totalTime)}</span>
        </div>
      )}

      {/* View toggle + export all */}
      <div className="flex gap-2">
        <button
          onClick={() => onSelectDay(null)}
          className={`flex-1 text-[11px] rounded py-1.5 transition-colors ${
            selectedDay === null
              ? "bg-blue-600 text-white"
              : "bg-surface-alt text-muted hover:bg-surface-hover"
          }`}
        >
          🗺️ Full Trip
        </button>
        {onExportAllDaysGpx && dayStats.length > 0 && (
          <button
            onClick={onExportAllDaysGpx}
            className="text-[11px] rounded bg-surface-alt hover:bg-surface-hover text-muted px-3 py-1.5 transition-colors"
            title="Export all days as ZIP"
          >
            📤 All Days
          </button>
        )}
      </div>
    </div>
  );
}
