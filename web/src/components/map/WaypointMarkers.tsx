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
}

export function WaypointMarkers({
  waypoints,
  overnightStopIndices,
  selectedWaypointIndex,
  onSelectWaypoint,
  onDeleteWaypoint,
  onMoveWaypoint,
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
        const isOvernightStop = overnightStopIndices?.has(index) ?? false;
        const isSelected = selectedWaypointIndex === index;
        const isDragging = draggingIndex === index;

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
                ${isStart ? "w-8 h-8 bg-green-600 border-white" : ""}
                ${isEnd ? "w-8 h-8 bg-red-600 border-white" : ""}
                ${isOvernightStop && !isStart && !isEnd ? "w-8 h-8 bg-amber-500 border-amber-300" : ""}
                ${!isStart && !isEnd && !isOvernightStop ? "w-6 h-6 bg-blue-600 border-white" : ""}
              `}
              title={
                isOvernightStop
                  ? `🌙 Overnight stop: ${wp.label || `Waypoint ${index + 1}`} — drag to move, click to select`
                  : `${wp.label || `Waypoint ${index + 1}`} — drag to move, click to select`
              }
            >
              <span className="pointer-events-none">
                {isStart ? "A" : isEnd ? "B" : isOvernightStop ? "🌙" : index}
              </span>
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
            <span className="text-sm font-medium text-zinc-800 truncate">
              {waypoints[selectedWaypointIndex].label || `Waypoint ${selectedWaypointIndex + 1}`}
            </span>
            <div className="flex items-center gap-1 text-[11px] text-zinc-500">
              <span>{waypoints[selectedWaypointIndex].lat.toFixed(4)}</span>
              <span>,</span>
              <span>{waypoints[selectedWaypointIndex].lng.toFixed(4)}</span>
            </div>
            <div className="flex gap-2 pt-1 border-t border-zinc-200">
              <button
                onClick={() => {
                  onDeleteWaypoint(selectedWaypointIndex);
                  onSelectWaypoint(null);
                }}
                className="flex-1 text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
              >
                Delete
              </button>
              <button
                onClick={() => onSelectWaypoint(null)}
                className="flex-1 text-xs px-2 py-1 rounded bg-zinc-100 text-zinc-600 hover:bg-zinc-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </Popup>
      )}
    </>
  );
}
