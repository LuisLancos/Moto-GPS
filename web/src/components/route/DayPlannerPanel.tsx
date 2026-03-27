"use client";

import { useState } from "react";
import type { DayOverlay, DayOverlayWithStats } from "@/lib/types";

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
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  const km = meters / 1000;
  if (km >= 100) return `${Math.round(km)}km`;
  return `${km.toFixed(1)}km`;
}

function formatMiles(meters: number): string {
  const miles = meters / 1609.344;
  if (miles >= 100) return `${Math.round(miles)}mi`;
  return `${miles.toFixed(1)}mi`;
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
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
}: DayPlannerPanelProps) {
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  // Don't show unless route exists with 3+ waypoints
  if (!hasRoute || waypointCount < 3) return null;

  // Show activation button when not in multi-day mode
  if (!isMultiDay) {
    return (
      <div className="border border-dashed border-zinc-700 rounded-md p-3">
        <button
          onClick={() => {
            onSetIsMultiDay(true);
            onAutoSplit();
          }}
          className="w-full text-sm text-zinc-300 hover:text-white transition-colors py-1"
        >
          🗓️ Split into Multi-Day Trip
        </button>
      </div>
    );
  }

  const totalDistance = dayStats.reduce((s, d) => s + d.distance_m, 0);
  const totalTime = dayStats.reduce((s, d) => s + d.time_s, 0);

  return (
    <div className="flex flex-col gap-3 border border-zinc-700 rounded-md p-3 bg-zinc-900/50">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
          🗓️ Multi-Day Trip ({dayStats.length} {dayStats.length === 1 ? "day" : "days"})
        </span>
        <button
          onClick={() => { onClearDays(); onSetIsMultiDay(false); }}
          className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Close
        </button>
      </div>

      {/* Daily target slider */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-zinc-500">Daily target</span>
          <span className="text-[11px] text-zinc-300 font-mono">
            {formatDistance(dailyTargetM)} / {formatMiles(dailyTargetM)}
          </span>
        </div>
        <input
          type="range"
          min={100000}
          max={800000}
          step={25000}
          value={dailyTargetM}
          onChange={(e) => onSetDailyTarget(Number(e.target.value))}
          className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
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
          className="flex-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-1.5 transition-colors disabled:opacity-50"
        >
          {splitting ? "Splitting..." : "Auto-Split"}
        </button>
        <button
          onClick={onClearDays}
          className="text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 px-3 py-1.5 transition-colors"
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
                    : "bg-zinc-800/80 border-zinc-700/50 hover:border-zinc-600"
                  }
                `}
              >
                {/* Day header */}
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-zinc-200 truncate">
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
                      className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      {isEditing ? "✓" : "✏️"}
                    </button>
                    {/* Export GPX */}
                    {onExportDayGpx && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onExportDayGpx(day.day); }}
                        className="text-[10px] text-zinc-500 hover:text-blue-400 transition-colors"
                        title={`Export Day ${day.day} GPX`}
                      >
                        📤
                      </button>
                    )}
                    {/* Import GPX into this day */}
                    {onImportDayGpx && (
                      <label
                        className="text-[10px] text-zinc-500 hover:text-green-400 transition-colors cursor-pointer"
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
                      className="w-full text-[11px] bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-zinc-200 placeholder:text-zinc-600"
                    />
                    <input
                      type="text"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Description (optional)"
                      className="w-full text-[11px] bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-zinc-200 placeholder:text-zinc-600"
                    />
                  </div>
                )}

                {/* Stats row */}
                <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                  <span>{formatDistance(day.distance_m)}</span>
                  <span>{formatMiles(day.distance_m)}</span>
                  <span>{formatTime(day.time_s)}</span>
                  <span className="text-zinc-600">{day.waypoint_count} wp</span>
                </div>

                {/* Description */}
                {day.description && !isEditing && (
                  <p className="text-[10px] text-zinc-500 mt-1 truncate">{day.description}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Trip totals */}
      {dayStats.length > 1 && (
        <div className="flex items-center justify-between text-[11px] text-zinc-500 border-t border-zinc-700/50 pt-2">
          <span>Total: {formatDistance(totalDistance)} • {formatTime(totalTime)}</span>
        </div>
      )}

      {/* View toggle + export all */}
      <div className="flex gap-2">
        <button
          onClick={() => onSelectDay(null)}
          className={`flex-1 text-[11px] rounded py-1.5 transition-colors ${
            selectedDay === null
              ? "bg-blue-600 text-white"
              : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
          }`}
        >
          🗺️ Full Trip
        </button>
        {onExportAllDaysGpx && dayStats.length > 0 && (
          <button
            onClick={onExportAllDaysGpx}
            className="text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 px-3 py-1.5 transition-colors"
            title="Export all days as ZIP"
          >
            📤 All Days
          </button>
        )}
      </div>
    </div>
  );
}
