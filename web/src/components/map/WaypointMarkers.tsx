"use client";

import { useState, useCallback } from "react";
import { Marker, Popup } from "react-map-gl/maplibre";
import type { Waypoint } from "@/lib/types";

interface WaypointMarkersProps {
  waypoints: Waypoint[];
  overnightStopIndices?: Set<number>;
  selectedWaypointIndex: number | null;
  onSelectWaypoint: (index: number | null) => void;
  onDeleteWaypoint: (index: number) => void;
  onMoveWaypoint: (index: number, newLat: number, newLng: number) => void;
  onToggleOvernightStop?: (index: number) => void;
  onSetWaypointType?: (index: number, type: import("@/lib/types").WaypointType) => void;
}

export function WaypointMarkers({
  waypoints,
  overnightStopIndices,
  selectedWaypointIndex,
  onSelectWaypoint,
  onDeleteWaypoint,
  onMoveWaypoint,
  onToggleOvernightStop,
  onSetWaypointType,
}: WaypointMarkersProps) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  const handleDragStart = useCallback((_e: unknown, index: number) => {
    setDraggingIndex(index);
  }, []);

  const handleDragEnd = useCallback(
    (e: { lngLat: { lat: number; lng: number } }, index: number) => {
      setDraggingIndex(null);
      onMoveWaypoint(index, e.lngLat.lat, e.lngLat.lng);
    },
    [onMoveWaypoint],
  );

  const handleMarkerClick = useCallback(
    (e: React.MouseEvent, index: number) => {
      e.stopPropagation();
      // Toggle selection
      onSelectWaypoint(selectedWaypointIndex === index ? null : index);
    },
    [selectedWaypointIndex, onSelectWaypoint],
  );

  return (
    <>
      {waypoints.map((wp, index) => {
        const isStart = index === 0;
        const isEnd = index === waypoints.length - 1 && waypoints.length > 1;
        const wpType = wp.type || "waypoint";
        const isOvernight = wpType === "overnight" || wpType === "hotel" || wp.is_overnight || (overnightStopIndices?.has(index) ?? false);
        const isTypedPOI = ["fuel", "restaurant", "attraction", "biker_cafe"].includes(wpType);
        const isSelected = selectedWaypointIndex === index;
        const isDragging = draggingIndex === index;

        // Icon and color based on type
        const { icon, markerClass } = (() => {
          if (isStart) return { icon: "A", markerClass: "w-8 h-8 bg-green-600 border-white" };
          if (isEnd) return { icon: "B", markerClass: "w-8 h-8 bg-red-600 border-white" };
          if (isOvernight) return { icon: "🌙", markerClass: "w-8 h-8 bg-amber-500 border-amber-300" };
          switch (wpType) {
            case "fuel": return { icon: "⛽", markerClass: "w-7 h-7 bg-orange-600 border-orange-300" };
            case "restaurant": return { icon: "🍽️", markerClass: "w-7 h-7 bg-rose-600 border-rose-300" };
            case "biker_cafe": return { icon: "☕", markerClass: "w-7 h-7 bg-yellow-700 border-yellow-400" };
            case "attraction": return { icon: "📍", markerClass: "w-7 h-7 bg-purple-600 border-purple-300" };
            default: return { icon: String(index), markerClass: "w-6 h-6 bg-blue-600 border-white" };
          }
        })();

        const typeLabel = isOvernight ? "Overnight" : isTypedPOI ? wpType : "Waypoint";

        return (
          <Marker
            key={`wp-${index}`}
            longitude={wp.lng}
            latitude={wp.lat}
            anchor="center"
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragEnd={(e) => handleDragEnd(e, index)}
          >
            <div
              onClick={(e) => handleMarkerClick(e, index)}
              style={{ pointerEvents: "auto" }}
              className={`
                flex items-center justify-center rounded-full border-2 shadow-lg
                text-white text-xs font-bold cursor-grab active:cursor-grabbing
                transition-all duration-150 select-none
                ${isDragging ? "scale-125 opacity-80" : ""}
                ${isSelected ? "ring-2 ring-yellow-400 ring-offset-1 ring-offset-transparent scale-110" : ""}
                ${markerClass}
              `}
              title={`${typeLabel}: ${wp.label || `Waypoint ${index + 1}`} — drag to move, click to select`}
            >
              <span className="pointer-events-none">{icon}</span>
            </div>
          </Marker>
        );
      })}

      {/* Popup for selected waypoint — shows label + delete button */}
      {selectedWaypointIndex !== null && waypoints[selectedWaypointIndex] && (
        <Popup
          longitude={waypoints[selectedWaypointIndex].lng}
          latitude={waypoints[selectedWaypointIndex].lat}
          anchor="bottom"
          offset={[0, -16]}
          closeOnClick={false}
          onClose={() => onSelectWaypoint(null)}
          className="waypoint-popup"
        >
          <div className="flex flex-col gap-1.5 min-w-[140px]">
            <span className="text-sm font-medium text-primary truncate">
              {waypoints[selectedWaypointIndex].label || `Waypoint ${selectedWaypointIndex + 1}`}
            </span>
            <div className="flex items-center gap-1 text-[11px] text-muted">
              <span>{waypoints[selectedWaypointIndex].lat.toFixed(4)}</span>
              <span>,</span>
              <span>{waypoints[selectedWaypointIndex].lng.toFixed(4)}</span>
            </div>
            <div className="flex flex-col gap-1.5 pt-1 border-t border-border">
              {/* Waypoint type selector — only for intermediate waypoints */}
              {onSetWaypointType && selectedWaypointIndex > 0 && selectedWaypointIndex < waypoints.length - 1 && (
                <div className="flex flex-wrap gap-1">
                  {([
                    { type: "waypoint" as const, icon: "📍", label: "Normal" },
                    { type: "overnight" as const, icon: "🌙", label: "Overnight" },
                    { type: "fuel" as const, icon: "⛽", label: "Fuel" },
                    { type: "restaurant" as const, icon: "🍽️", label: "Food" },
                    { type: "attraction" as const, icon: "🏰", label: "Visit" },
                    { type: "biker_cafe" as const, icon: "☕", label: "Cafe" },
                  ]).map(({ type, icon, label }) => {
                    const currentType = waypoints[selectedWaypointIndex].type || "waypoint";
                    const isActive = currentType === type || (type === "overnight" && waypoints[selectedWaypointIndex].is_overnight);
                    return (
                      <button
                        key={type}
                        onClick={() => {
                          onSetWaypointType(selectedWaypointIndex, type);
                          onSelectWaypoint(null);
                        }}
                        className={`text-[10px] px-1.5 py-1 rounded transition-colors ${
                          isActive
                            ? "bg-blue-600 text-white"
                            : "bg-surface-alt text-muted hover:bg-surface-hover hover:text-secondary"
                        }`}
                        title={label}
                      >
                        {icon}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    onDeleteWaypoint(selectedWaypointIndex);
                    onSelectWaypoint(null);
                  }}
                  className="flex-1 text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60 transition-colors"
                >
                  Delete
                </button>
                <button
                  onClick={() => onSelectWaypoint(null)}
                  className="flex-1 text-xs px-2 py-1 rounded bg-surface-alt text-muted hover:bg-surface-hover transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </Popup>
      )}
    </>
  );
}
