"use client";

import { useState, useRef, useCallback } from "react";
import type { Waypoint } from "@/lib/types";
import type { GeocodingResult } from "@/lib/api";
import { geocodeSearch } from "@/lib/api";

interface WaypointListProps {
  waypoints: Waypoint[];
  onRemove: (index: number) => void;
  onAdd: (wp: Waypoint) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

export function WaypointList({ waypoints, onRemove, onAdd, onReorder }: WaypointListProps) {
  // ---------- Search state ----------
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------- Drag state ----------
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  // ---------- Search ----------
  const handleSearchChange = useCallback((value: string) => {
    setQuery(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    if (value.trim().length < 2) {
      setResults([]);
      setShowResults(false);
      return;
    }

    // Debounce 400ms
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await geocodeSearch(value.trim());
        setResults(res);
        setShowResults(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
  }, []);

  function handleSelectResult(result: GeocodingResult) {
    // Extract a short label from the display_name
    const parts = result.display_name.split(",");
    const label = parts.slice(0, 2).join(",").trim();

    onAdd({ lat: result.lat, lng: result.lng, label });
    setQuery("");
    setResults([]);
    setShowResults(false);
  }

  // ---------- Drag & Drop ----------
  function handleDragStart(e: React.DragEvent, index: number) {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    // Required for Firefox
    e.dataTransfer.setData("text/plain", String(index));
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOverIndex(index);
  }

  function handleDrop(e: React.DragEvent, toIndex: number) {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== toIndex) {
      onReorder(dragIndex, toIndex);
    }
    setDragIndex(null);
    setOverIndex(null);
  }

  function handleDragEnd() {
    setDragIndex(null);
    setOverIndex(null);
  }

  function getMarkerStyle(i: number): string {
    if (i === 0) return "bg-green-600";
    if (i === waypoints.length - 1 && waypoints.length > 1) return "bg-red-600";
    return "bg-blue-600";
  }

  function getMarkerLabel(i: number): string {
    if (i === 0) return "A";
    if (i === waypoints.length - 1 && waypoints.length > 1) return "B";
    return String(i);
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted uppercase tracking-wider">
        Waypoints
      </span>

      {/* Search box */}
      <div className="relative">
        <div className="flex items-center gap-1.5 rounded-md bg-surface-alt border border-border focus-within:border-border-focus transition-colors">
          <span className="pl-2.5 text-muted text-sm">🔍</span>
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearchChange(e.target.value)}
            onFocus={() => results.length > 0 && setShowResults(true)}
            placeholder="Search address or postcode..."
            className="flex-1 bg-transparent px-2 py-2 text-sm text-primary placeholder:text-muted focus:outline-none"
          />
          {searching && (
            <span className="pr-2.5 text-[10px] text-muted animate-pulse">
              Searching...
            </span>
          )}
        </div>

        {/* Search results dropdown */}
        {showResults && results.length > 0 && (
          <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-surface-alt border border-border rounded-lg shadow-xl max-h-48 overflow-y-auto">
            {results.map((r, i) => (
              <button
                key={i}
                onClick={() => handleSelectResult(r)}
                className="w-full text-left px-3 py-2 text-sm text-secondary hover:bg-surface-hover transition-colors border-b border-border/50 last:border-0"
              >
                <span className="line-clamp-1">{r.display_name}</span>
              </button>
            ))}
          </div>
        )}

        {showResults && !searching && results.length === 0 && query.trim().length >= 2 && (
          <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-surface-alt border border-border rounded-lg shadow-xl px-3 py-2">
            <span className="text-xs text-muted">No results found</span>
          </div>
        )}
      </div>

      {/* Click outside to close results */}
      {showResults && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowResults(false)}
        />
      )}

      {/* Waypoint list with drag-and-drop */}
      {waypoints.length > 0 && (
        <div className="flex flex-col gap-1">
          {waypoints.map((wp, i) => {
            const isDragging = dragIndex === i;
            const isOver = overIndex === i && dragIndex !== i;

            return (
              <div key={`wp-${i}-${wp.lat}-${wp.lng}`} className="flex flex-col">
                <div
                  draggable
                  onDragStart={(e) => handleDragStart(e, i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDrop={(e) => handleDrop(e, i)}
                  onDragEnd={handleDragEnd}
                  className={`
                    flex items-center justify-between rounded-md bg-surface-alt px-2 py-2 transition-all cursor-grab active:cursor-grabbing
                    ${isDragging ? "opacity-40 scale-95" : ""}
                    ${isOver ? "border-t-2 border-blue-500" : "border-t-2 border-transparent"}
                  `}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {/* Drag handle */}
                    <span className="text-zinc-600 text-xs cursor-grab select-none shrink-0">⠿</span>

                    {/* Marker */}
                    <span
                      className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white shrink-0 ${getMarkerStyle(i)}`}
                    >
                      {getMarkerLabel(i)}
                    </span>

                    {/* Label — click to expand details */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setExpandedIndex(expandedIndex === i ? null : i); }}
                      className="text-sm text-secondary truncate text-left hover:text-primary transition-colors min-w-0"
                      title={wp.label ? `${wp.label}\n${wp.lat.toFixed(6)}, ${wp.lng.toFixed(6)}` : `${wp.lat.toFixed(6)}, ${wp.lng.toFixed(6)}`}
                    >
                      {wp.label || `${wp.lat.toFixed(4)}, ${wp.lng.toFixed(4)}`}
                    </button>
                  </div>

                  {/* Remove button */}
                  <button
                    onClick={() => onRemove(i)}
                    className="text-muted hover:text-red-400 transition-colors text-sm shrink-0 ml-1"
                  >
                    ×
                  </button>
                </div>

                {/* Expanded detail panel */}
                {expandedIndex === i && (
                  <div className="ml-9 mr-2 mb-1 mt-0.5 px-2 py-1.5 bg-surface/80 rounded border border-border/50 text-[11px] flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted">Coords:</span>
                      <span className="text-muted font-mono">{wp.lat.toFixed(6)}, {wp.lng.toFixed(6)}</span>
                      <button
                        onClick={() => navigator.clipboard.writeText(`${wp.lat.toFixed(6)}, ${wp.lng.toFixed(6)}`)}
                        className="text-muted hover:text-blue-400 transition-colors"
                        title="Copy coordinates"
                      >
                        📋
                      </button>
                    </div>
                    {wp.label && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted">Label:</span>
                        <span className="text-muted truncate">{wp.label}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {waypoints.length === 0 && (
        <p className="text-xs text-muted py-1">
          Click the map or search above to add waypoints.
        </p>
      )}
    </div>
  );
}
