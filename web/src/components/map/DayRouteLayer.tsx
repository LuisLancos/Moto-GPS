"use client";

import { Layer, Source } from "react-map-gl/maplibre";
import type { RouteResult, DayOverlayWithStats } from "@/lib/types";

// Alternating day colors for visual distinction
const DAY_COLORS = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#f97316", // orange
  "#a855f7", // purple
  "#ef4444", // red
  "#06b6d4", // cyan
  "#eab308", // yellow
  "#ec4899", // pink
];

interface DayRouteLayerProps {
  route: RouteResult;
  day: DayOverlayWithStats;
  isSelectedDay: boolean;
  isFaded: boolean;
}

export function DayRouteLayer({
  route,
  day,
  isSelectedDay,
  isFaded,
}: DayRouteLayerProps) {
  // Slice the route shape for this day
  const dayShape = route.shape.slice(day.shape_start_idx, day.shape_end_idx + 1);

  if (dayShape.length < 2) return null;

  const color = DAY_COLORS[(day.day - 1) % DAY_COLORS.length];
  const opacity = isFaded ? 0.25 : isSelectedDay ? 1 : 0.8;
  const width = isSelectedDay && !isFaded ? 5 : 3;

  const geojson: GeoJSON.Feature = {
    type: "Feature",
    properties: { day: day.day },
    geometry: {
      type: "LineString",
      coordinates: dayShape,
    },
  };

  const sourceId = `day-route-source-${day.day}`;

  return (
    <Source id={sourceId} type="geojson" data={geojson}>
      {/* Casing */}
      <Layer
        id={`day-route-casing-${day.day}`}
        type="line"
        paint={{
          "line-color": "#000",
          "line-width": width + 3,
          "line-opacity": opacity * 0.2,
        }}
        layout={{ "line-join": "round", "line-cap": "round" }}
      />
      {/* Main line */}
      <Layer
        id={`day-route-${day.day}`}
        type="line"
        paint={{
          "line-color": color,
          "line-width": width,
          "line-opacity": opacity,
        }}
        layout={{ "line-join": "round", "line-cap": "round" }}
      />
    </Source>
  );
}
