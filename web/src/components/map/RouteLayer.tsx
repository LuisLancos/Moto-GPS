"use client";

import { Layer, Source } from "react-map-gl/maplibre";
import type { RouteResult } from "@/lib/types";

interface RouteLayerProps {
  route: RouteResult;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}

// Route colors: selected = bright blue, alternatives = grey
const SELECTED_COLOR = "#2563eb";
const ALT_COLORS = ["#6b7280", "#9ca3af", "#d1d5db"];

export function RouteLayer({
  route,
  index,
  isSelected,
  onClick,
}: RouteLayerProps) {
  const geojson: GeoJSON.Feature = {
    type: "Feature",
    properties: {
      index,
      distance: route.distance_m,
      time: route.time_s,
    },
    geometry: {
      type: "LineString",
      coordinates: route.shape,
    },
  };

  const color = isSelected
    ? SELECTED_COLOR
    : ALT_COLORS[index % ALT_COLORS.length];

  return (
    <Source id={`route-source-${index}`} type="geojson" data={geojson}>
      {/* Outline / casing */}
      <Layer
        id={`route-casing-${index}`}
        type="line"
        paint={{
          "line-color": "#000",
          "line-width": isSelected ? 8 : 5,
          "line-opacity": isSelected ? 0.3 : 0.15,
        }}
        layout={{
          "line-join": "round",
          "line-cap": "round",
          "line-sort-key": isSelected ? 1 : 0,
        }}
      />
      {/* Main route line */}
      <Layer
        id={`route-${index}`}
        type="line"
        paint={{
          "line-color": color,
          "line-width": isSelected ? 5 : 3,
          "line-opacity": isSelected ? 1 : 0.6,
        }}
        layout={{
          "line-join": "round",
          "line-cap": "round",
          "line-sort-key": isSelected ? 1 : 0,
        }}
      />
    </Source>
  );
}
