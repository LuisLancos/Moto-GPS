"use client";

import { useState } from "react";
import type { TripSummary } from "@/lib/types";
import { ROUTE_TYPE_META } from "@/lib/types";
import type { UserGroup } from "@/lib/api";
import { exportTripGpxUrl, exportAllDaysGpxUrl, shareItemWithGroup, unshareItem } from "@/lib/api";
import { formatDistance, formatTime, formatDate } from "@/lib/formatters";

interface SavedTripsProps {
  trips: TripSummary[];
  loading: boolean;
  onSelect: (trip: TripSummary) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
  myGroups?: UserGroup[];
}

export function SavedTrips({ trips, loading, onSelect, onDelete, onRefresh, myGroups = [] }: SavedTripsProps) {
  const [expanded, setExpanded] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [sharingTripId, setSharingTripId] = useState<string | null>(null);

  const handleShare = async (tripId: string, groupId: string, isMultiday: boolean) => {
    try {
      await shareItemWithGroup(groupId, isMultiday ? "trip" : "route", tripId);
      onRefresh();
    } catch {
      /* ignore */
    }
    setSharingTripId(null);
  };

  const handleUnshare = async (groupId: string, sharedItemId: string) => {
    try {
      await unshareItem(groupId, sharedItemId);
      onRefresh();
    } catch {
      /* ignore */
    }
  };

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
            const isSharing = sharingTripId === trip.id;
            const sharedGroups = trip.shared_with_groups || [];
            const isShared = trip.ownership && trip.ownership !== "owned";
            const canEdit = !isShared || trip.ownership === "shared_editor";

            return (
              <div
                key={trip.id}
                className={`group flex flex-col gap-1 rounded-lg border px-3 py-2.5 transition-colors cursor-pointer ${
                  isShared
                    ? "bg-indigo-950/30 border-indigo-800/40 hover:border-indigo-600/60"
                    : "bg-zinc-800 border-zinc-700 hover:border-zinc-500"
                }`}
                onClick={() => !isConfirming && !isSharing && onSelect(trip)}
              >
                {/* Top row: name + badges */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-200 truncate pr-2">
                    {trip.name}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isShared && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        trip.ownership === "shared_editor"
                          ? "bg-blue-900/50 text-blue-300"
                          : "bg-zinc-700/50 text-zinc-400"
                      }`}>
                        {trip.ownership === "shared_editor" ? "shared • edit" : "shared • view"}
                      </span>
                    )}
                    {trip.is_multiday && trip.day_count && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-600/40 text-amber-300">
                        {trip.day_count} days
                      </span>
                    )}
                    {meta && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-400">
                        {meta.icon} {meta.label}
                      </span>
                    )}
                  </div>
                </div>

                {/* Owner info for shared trips */}
                {isShared && trip.owner_name && (
                  <p className="text-[10px] text-indigo-400/70">by {trip.owner_name}</p>
                )}

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

                {/* Shared group badges */}
                {sharedGroups.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {sharedGroups.map((g) => (
                      <span
                        key={g.id}
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/40 text-indigo-300 border border-indigo-800/40"
                      >
                        {g.name}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleUnshare(g.id, g.shared_item_id); }}
                          className="text-indigo-400/60 hover:text-red-400 ml-0.5"
                          title={`Unshare from ${g.name}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Share dropdown */}
                {isSharing && (
                  <div
                    className="flex flex-col gap-1 pt-1 border-t border-zinc-700/50"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-[10px] text-zinc-400">Share with group:</span>
                    {myGroups.filter((g) => g.my_role !== "viewer").length === 0 ? (
                      <span className="text-[10px] text-zinc-600">No groups available</span>
                    ) : (
                      myGroups
                        .filter((g) => g.my_role !== "viewer")
                        .filter((g) => !sharedGroups.some((sg) => sg.id === g.id))
                        .map((g) => (
                          <button
                            key={g.id}
                            onClick={() => handleShare(trip.id, g.id, !!trip.is_multiday)}
                            className="text-left text-[11px] px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-700 text-zinc-300 transition-colors"
                          >
                            {g.name}
                          </button>
                        ))
                    )}
                    {myGroups.filter((g) => g.my_role !== "viewer").filter((g) => !sharedGroups.some((sg) => sg.id === g.id)).length === 0 && sharedGroups.length > 0 && (
                      <span className="text-[10px] text-zinc-600">Already shared with all groups</span>
                    )}
                    <button
                      onClick={() => setSharingTripId(null)}
                      className="text-[10px] text-zinc-500 hover:text-zinc-300 mt-1"
                    >
                      Cancel
                    </button>
                  </div>
                )}

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
                ) : !isSharing && (
                  <div className="hidden group-hover:flex items-center gap-3 pt-1 border-t border-zinc-700/50">
                    {/* Export — available to all */}
                    {trip.is_multiday ? (
                      <a
                        href={exportAllDaysGpxUrl(trip.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[10px] text-zinc-500 hover:text-blue-400 transition-colors"
                        title="Export all days as ZIP"
                      >
                        Export ZIP
                      </a>
                    ) : (
                      <a
                        href={exportTripGpxUrl(trip.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[10px] text-zinc-500 hover:text-blue-400 transition-colors"
                        title="Export as GPX"
                      >
                        Export GPX
                      </a>
                    )}
                    {/* Share — only for owned trips or editors */}
                    {myGroups.length > 0 && canEdit && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setSharingTripId(trip.id); }}
                        className="text-[10px] text-zinc-500 hover:text-indigo-400 transition-colors"
                      >
                        Share
                      </button>
                    )}
                    {/* Delete — only for owned trips */}
                    {!isShared && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(trip.id); }}
                        className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors"
                      >
                        Delete
                      </button>
                    )}
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
