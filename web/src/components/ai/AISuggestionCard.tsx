"use client";

import type { AISuggestions } from "@/lib/types";

interface AISuggestionCardProps {
  suggestions: AISuggestions;
  onApply: () => void;
  onDismiss: () => void;
  onEnrichPOIs?: () => void;
  applied?: boolean;
}

const CATEGORY_ICON: Record<string, string> = {
  fuel: "⛽",
  restaurant: "🍽️",
  pub: "🍺",
  castle: "🏰",
  viewpoint: "👁️",
  museum: "🏛️",
  biker_cafe: "☕",
  scenic_road: "🛣️",
  accommodation: "🏨",
  hotel: "🏨",
  campsite: "⛺",
  attraction: "📍",
};

export function AISuggestionCard({
  suggestions,
  onApply,
  onDismiss,
  onEnrichPOIs,
  applied = false,
}: AISuggestionCardProps) {
  const hasWaypoints = suggestions.waypoints.length > 0;
  const hasDaySplits = suggestions.day_splits.length > 0;
  const hasPOIs = suggestions.pois.length > 0;

  if (!hasWaypoints && !hasPOIs) return null;

  return (
    <div className="border border-purple-800/50 bg-purple-950/30 rounded-lg p-3 flex flex-col gap-2">
      {/* Waypoints */}
      {hasWaypoints && (
        <div>
          <h4 className="text-[10px] font-medium text-purple-300 uppercase tracking-wider mb-1">
            Suggested Route ({suggestions.waypoints.length} waypoints)
          </h4>
          <div className="flex flex-col gap-0.5">
            {suggestions.waypoints.map((wp, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-secondary">
                <span className="w-4 h-4 flex items-center justify-center rounded-full bg-purple-700 text-[9px] text-purple-200 shrink-0">
                  {i + 1}
                </span>
                <span className="truncate">{wp.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Day splits */}
      {hasDaySplits && (
        <div>
          <h4 className="text-[10px] font-medium text-amber-300 uppercase tracking-wider mb-1">
            Day Plan ({suggestions.day_splits.length} days)
          </h4>
          <div className="flex flex-col gap-0.5">
            {suggestions.day_splits.map((ds) => (
              <div key={ds.day} className="text-xs text-muted">
                <span className="text-amber-700 dark:text-amber-400">Day {ds.day}:</span>{" "}
                <span className="text-secondary">{ds.name}</span>
                {ds.description && (
                  <span className="text-muted ml-1">— {ds.description}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* POIs */}
      {hasPOIs && (
        <div>
          <h4 className="text-[10px] font-medium text-green-300 uppercase tracking-wider mb-1">
            Points of Interest ({suggestions.pois.length})
          </h4>
          <div className="flex flex-col gap-0.5">
            {suggestions.pois.slice(0, 8).map((poi, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs text-secondary">
                <span>{CATEGORY_ICON[poi.category] || "📍"}</span>
                <span className="truncate">{poi.name}</span>
                {poi.is_biker_friendly && (
                  <span className="text-[9px] text-amber-700 dark:text-amber-400" title="Biker-friendly">★</span>
                )}
              </div>
            ))}
            {suggestions.pois.length > 8 && (
              <span className="text-[10px] text-muted">
                +{suggestions.pois.length - 8} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      {applied ? (
        <div className="text-xs text-green-700 dark:text-green-400 font-medium pt-1">✓ Applied to route</div>
      ) : (
        <div className="flex items-center gap-2 pt-1">
          {hasWaypoints && (
            <button
              onClick={onApply}
              className="bg-purple-700 hover:bg-purple-600 text-white text-xs font-medium px-3 py-1.5 rounded-md transition-colors"
            >
              Apply to Route
            </button>
          )}
          {!hasWaypoints && hasPOIs && (
            <button
              onClick={onApply}
              className="bg-amber-700 hover:bg-amber-600 text-white text-xs font-medium px-3 py-1.5 rounded-md transition-colors"
            >
              Show on Map
            </button>
          )}
          {onEnrichPOIs && hasWaypoints && (
            <button
              onClick={onEnrichPOIs}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              + Find POIs
            </button>
          )}
          <button
            onClick={onDismiss}
            className="text-xs text-muted hover:text-secondary transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
