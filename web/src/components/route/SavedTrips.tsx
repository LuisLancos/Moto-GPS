"use client";

import { useState } from "react";
import type { TripSummary } from "@/lib/types";
import { ROUTE_TYPE_META } from "@/lib/types";
import { exportTripGpxUrl } from "@/lib/api";

function formatDistance(m: number | null): string {
  if (!m) return "—";
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function formatTime(s: number | null): string {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

interface SavedTripsProps {
  trips: TripSummary[];
  loading: boolean;
  onSelect: (trip: TripSummary) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
}

export function SavedTrips({ trips, loading, onSelect, onDelete, onRefresh }: SavedTripsProps) {
  const [expanded, setExpanded] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 uppercase tracking-wider hover:text-zinc-300 transition-colors"
        >
          <span className="text-[10px]">{expanded ? "▾" : "▸"}</span>
          Saved Trips ({trips.length})
        </button>
        <button
          onClick={onRefresh}
          className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
          title="Refresh"
        >
          ↻
        </button>
      </div>

      {expanded && loading && (
        <p className="text-xs text-zinc-500 py-2">Loading trips...</p>
      )}

      {expanded && !loading && trips.length === 0 && (
        <p className="text-xs text-zinc-500 py-2">No saved trips yet. Plan a route and save it!</p>
      )}

      {expanded && !loading && trips.length > 0 && (
        <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
          {trips.map((trip) => {
            const meta = ROUTE_TYPE_META[trip.route_type as keyof typeof ROUTE_TYPE_META];
            const isConfirming = confirmDeleteId === trip.id;

            return (
              <div
                key={trip.id}
                className="group flex flex-col gap-1 rounded-lg bg-zinc-800 border border-zinc-700 hover:border-zinc-500 px-3 py-2.5 transition-colors cursor-pointer"
                onClick={() => !isConfirming && onSelect(trip)}
              >
                {/* Top row: name + route type badge */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-200 truncate pr-2">
                    {trip.name}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {meta && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-400">
                        {meta.icon} {meta.label}
                      </span>
                    )}
                  </div>
                </div>

                {/* Description */}
                {trip.description && (
                  <p className="text-[11px] text-zinc-500 line-clamp-1">{trip.description}</p>
                )}

                {/* Stats row */}
                <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                  <span>{formatDistance(trip.total_distance_m)}</span>
                  <span>{formatTime(trip.total_time_s)}</span>
                  {trip.total_moto_score !== null && trip.total_moto_score !== undefined && (
                    <span className={
                      trip.total_moto_score >= 0.5 ? "text-green-500" :
                      trip.total_moto_score >= 0.3 ? "text-yellow-500" : "text-zinc-500"
                    }>
                      Score: {(trip.total_moto_score * 100).toFixed(0)}
                    </span>
                  )}
                  <span className="ml-auto">{formatDate(trip.created_at)}</span>
                </div>

                {/* Delete confirmation */}
                {isConfirming ? (
                  <div
                    className="flex items-center gap-2 pt-1 border-t border-zinc-700/50"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-[11px] text-red-400">Delete this trip?</span>
                    <button
                      onClick={() => { onDelete(trip.id); setConfirmDeleteId(null); }}
                      className="text-[11px] px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white transition-colors"
                    >
                      Yes, delete
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-[11px] text-zinc-400 hover:text-zinc-200"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="hidden group-hover:flex items-center gap-3 pt-1 border-t border-zinc-700/50">
                    <a
                      href={exportTripGpxUrl(trip.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="text-[10px] text-zinc-500 hover:text-blue-400 transition-colors"
                      title="Export as GPX"
                    >
                      📤 GPX
                    </a>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(trip.id); }}
                      className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
