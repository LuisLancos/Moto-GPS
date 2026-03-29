"use client";

import { useState, useRef, useEffect } from "react";

export interface POICategoryDef {
  id: string;
  label: string;
  icon: string;
}

export const DEFAULT_POI_CATEGORIES: POICategoryDef[] = [
  { id: "biker_spot", icon: "🏍️", label: "Biker Spots" },
  { id: "fuel", icon: "⛽", label: "Fuel" },
  { id: "hotel", icon: "🏨", label: "Hotels" },
  { id: "restaurant", icon: "🍽️", label: "Food" },
  { id: "cafe", icon: "☕", label: "Cafes" },
  { id: "pub", icon: "🍺", label: "Pubs" },
  { id: "campsite", icon: "⛺", label: "Camps" },
  { id: "viewpoint", icon: "👁️", label: "Views" },
  { id: "castle", icon: "🏰", label: "Castles" },
  { id: "museum", icon: "🏛️", label: "Museums" },
  { id: "attraction", icon: "📍", label: "Sights" },
];

/** Categories selected by default when a route is first loaded */
export const DEFAULT_SELECTED = new Set(["fuel", "biker_spot"]);

interface POIOverlayControlsProps {
  categories: POICategoryDef[];
  activeCategories: Set<string>;
  onToggle: (categoryId: string) => void;
  loading: boolean;
  poiCount: number;
  disabled: boolean;
}

export function POIOverlayControls({
  categories,
  activeCategories,
  onToggle,
  loading,
  poiCount,
  disabled,
}: POIOverlayControlsProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const cats = categories.length > 0 ? categories : DEFAULT_POI_CATEGORIES;
  const activeCount = activeCategories.size;

  // Close dropdown on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {/* Compact trigger button */}
      <button
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className={`
          flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium shadow-lg transition-colors
          ${activeCount > 0
            ? "bg-amber-600 text-white"
            : "bg-surface-alt text-muted hover:text-primary"
          }
          disabled:opacity-40 disabled:cursor-not-allowed
        `}
      >
        📍 POIs
        {activeCount > 0 && (
          <span className="bg-white/20 rounded-full px-1.5 text-[10px]">{poiCount > 0 ? poiCount : activeCount}</span>
        )}
        {loading && <span className="animate-spin text-[10px]">⏳</span>}
      </button>

      {/* Dropdown checklist */}
      {open && !disabled && (
        <div className="absolute top-full left-0 mt-1 bg-overlay backdrop-blur border border-border/80 rounded-lg shadow-xl z-50 min-w-[180px] py-1">
          {cats.map(({ id, icon, label }) => {
            const active = activeCategories.has(id);
            return (
              <button
                key={id}
                onClick={(e) => { e.stopPropagation(); onToggle(id); }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-surface-alt/80 transition-colors"
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${
                  active ? "bg-amber-600 border-amber-500 text-white" : "border-border"
                }`}>
                  {active && "✓"}
                </span>
                <span className="text-sm">{icon}</span>
                <span className={`text-xs ${active ? "text-primary" : "text-muted"}`}>{label}</span>
              </button>
            );
          })}
          {/* Status line */}
          <div className="border-t border-border mt-1 pt-1 px-3 pb-1">
            {loading && <span className="text-[9px] text-amber-400 animate-pulse">Loading...</span>}
            {!loading && poiCount > 0 && <span className="text-[9px] text-muted">{poiCount} POIs along route</span>}
            {!loading && poiCount === 0 && activeCount > 0 && <span className="text-[9px] text-muted">No POIs found</span>}
          </div>
        </div>
      )}
    </div>
  );
}
