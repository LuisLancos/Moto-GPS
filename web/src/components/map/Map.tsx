"use client";

import { useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Map as MapGL,
  NavigationControl,
  GeolocateControl,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import { RouteLayer } from "./RouteLayer";
import { WaypointMarkers } from "./WaypointMarkers";
import { ScoreOverlay } from "./ScoreOverlay";
import type { Waypoint, RouteResult } from "@/lib/types";

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY || "";
const MAP_STYLE = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${MAPTILER_KEY}`
  : {
      version: 8 as const,
      sources: {
        osm: {
          type: "raster" as const,
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution: "&copy; OpenStreetMap contributors",
        },
      },
      layers: [
        {
          id: "osm",
          type: "raster" as const,
          source: "osm",
          minzoom: 0,
          maxzoom: 19,
        },
      ],
    };

// UK center
const INITIAL_VIEW = {
  longitude: -1.5,
  latitude: 53.0,
  zoom: 6,
};

interface MapProps {
  waypoints: Waypoint[];
  routes: RouteResult[];
  selectedRouteIndex: number;
  onMapClick: (wp: Waypoint) => void;
  onRouteInsert: (wp: Waypoint) => void;
  onRouteSelect: (index: number) => void;
}

export function Map({
  waypoints,
  routes,
  selectedRouteIndex,
  onMapClick,
  onRouteInsert,
  onRouteSelect,
}: MapProps) {
  const mapRef = useRef<MapRef>(null);
  const [showOverlay, setShowOverlay] = useState(true);

  const handleClick = useCallback(
    (e: MapLayerMouseEvent) => {
      // Check if click is on a route layer
      const routeLayers = routes
        .map((_, i) => `route-${i}`)
        .filter((id) => {
          try {
            return e.target.getLayer(id);
          } catch {
            return false;
          }
        });

      const features = e.target.queryRenderedFeatures(e.point, {
        layers: routeLayers,
      });

      const clickedWp: Waypoint = {
        lat: e.lngLat.lat,
        lng: e.lngLat.lng,
      };

      if (features.length > 0) {
        // Click was ON a route line → insert between nearest waypoint pair
        onRouteInsert(clickedWp);
        return;
      }

      // Click on empty map → append waypoint
      onMapClick(clickedWp);
    },
    [onMapClick, onRouteInsert, routes]
  );

  return (
    <MapGL
      ref={mapRef}
      mapLib={maplibregl}
      initialViewState={INITIAL_VIEW}
      style={{ width: "100%", height: "100%" }}
      mapStyle={MAP_STYLE}
      onClick={handleClick}
      cursor="crosshair"
    >
      <NavigationControl position="top-right" />
      <GeolocateControl position="top-right" />

      <ScoreOverlay visible={showOverlay} />

      {routes.map((route, index) => (
        <RouteLayer
          key={index}
          route={route}
          index={index}
          isSelected={index === selectedRouteIndex}
          onClick={() => onRouteSelect(index)}
        />
      ))}

      <WaypointMarkers waypoints={waypoints} />

      {/* Overlay toggle button */}
      <div className="absolute top-3 left-3 z-10">
        <button
          onClick={() => setShowOverlay(!showOverlay)}
          className={`
            px-3 py-1.5 rounded-md text-xs font-medium shadow-lg transition-colors
            ${showOverlay
              ? "bg-blue-600 text-white"
              : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            }
          `}
        >
          {showOverlay ? "Road Scores ON" : "Road Scores OFF"}
        </button>
      </div>
    </MapGL>
  );
}
