"use client";

import { useState } from "react";
import { Layer, Source } from "react-map-gl/maplibre";

const MARTIN_URL = process.env.NEXT_PUBLIC_MARTIN_URL || "http://localhost:3002";

interface ScoreOverlayProps {
  visible: boolean;
}

export function ScoreOverlay({ visible }: ScoreOverlayProps) {
  if (!visible) return null;

  return (
    <Source
      id="road-scores"
      type="vector"
      tiles={[`${MARTIN_URL}/road_scores/{z}/{x}/{y}`]}
      minzoom={10}
      maxzoom={16}
    >
      {/* Road quality color overlay */}
      <Layer
        id="road-scores-line"
        type="line"
        source-layer="road_scores"
        paint={{
          "line-color": [
            "interpolate",
            ["linear"],
            ["get", "composite_moto_score"],
            0.0, "#ef4444",    // red = bad for motorcycling
            0.2, "#f97316",    // orange
            0.35, "#eab308",   // yellow
            0.5, "#22c55e",    // green
            0.7, "#10b981",    // emerald
            0.9, "#06b6d4",    // cyan = best roads
          ],
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10, 1.5,
            13, 3,
            16, 5,
          ],
          "line-opacity": 0.75,
        }}
        filter={[
          "all",
          ["!=", ["get", "highway"], "service"],
          ["!=", ["get", "highway"], "residential"],
        ]}
        layout={{
          "line-join": "round",
          "line-cap": "round",
        }}
      />
    </Source>
  );
}
