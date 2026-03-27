"use client";

import { Marker } from "react-map-gl/maplibre";
import type { Waypoint } from "@/lib/types";

interface WaypointMarkersProps {
  waypoints: Waypoint[];
}

export function WaypointMarkers({ waypoints }: WaypointMarkersProps) {
  return (
    <>
      {waypoints.map((wp, index) => {
        const isStart = index === 0;
        const isEnd = index === waypoints.length - 1 && waypoints.length > 1;

        return (
          <Marker
            key={`wp-${index}`}
            longitude={wp.lng}
            latitude={wp.lat}
            anchor="center"
          >
            <div
              className={`
                flex items-center justify-center rounded-full border-2 border-white shadow-lg
                text-white text-xs font-bold
                ${isStart ? "w-8 h-8 bg-green-600" : ""}
                ${isEnd ? "w-8 h-8 bg-red-600" : ""}
                ${!isStart && !isEnd ? "w-6 h-6 bg-blue-600" : ""}
              `}
            >
              {isStart ? "A" : isEnd ? "B" : index}
            </div>
          </Marker>
        );
      })}
    </>
  );
}
