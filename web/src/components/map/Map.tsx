"use client";

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Map as MapGL,
  NavigationControl,
  GeolocateControl,
  Source,
  Layer,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import { RouteLayer } from "./RouteLayer";
import { DayRouteLayer } from "./DayRouteLayer";
import { WaypointMarkers } from "./WaypointMarkers";
import { ScoreOverlay } from "./ScoreOverlay";
import { MapContextMenu, type ContextMenuAction } from "./MapContextMenu";
import type { Waypoint, RouteResult, DayOverlayWithStats, RouteAnomaly } from "@/lib/types";
import { SEVERITY_COLORS } from "@/lib/formatters";

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
  // Waypoint interaction
  selectedWaypointIndex: number | null;
  onSelectWaypoint: (index: number | null) => void;
  onDeleteWaypoint: (index: number) => void;
  onMoveWaypoint: (index: number, lat: number, lng: number) => void;
  // Actions
  onRecalculate?: () => void;
  hasRoutes?: boolean;
  // Anomaly navigation
  navigatedAnomaly?: RouteAnomaly | null;
  // Multi-day support
  overnightStopIndices?: Set<number>;
  dayStats?: DayOverlayWithStats[];
  selectedDay?: number | null;
}

export function Map({
  waypoints,
  routes,
  selectedRouteIndex,
  onMapClick,
  onRouteInsert,
  onRouteSelect,
  selectedWaypointIndex,
  onSelectWaypoint,
  onDeleteWaypoint,
  onMoveWaypoint,
  onRecalculate,
  hasRoutes,
  navigatedAnomaly,
  overnightStopIndices,
  dayStats,
  selectedDay,
}: MapProps) {
  const mapRef = useRef<MapRef>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    lngLat: { lat: number; lng: number };
    waypointIndex: number | null; // if right-clicked on a waypoint
  } | null>(null);

  const selectedRoute = routes[selectedRouteIndex] || null;
  const isMultiDay = (dayStats?.length ?? 0) > 1;

  // Fit to route bounds when routes change (e.g., after loading a saved trip)
  const routeShapeLen = selectedRoute?.shape?.length ?? 0;
  useEffect(() => {
    if (!mapRef.current || !selectedRoute?.shape || selectedRoute.shape.length < 2) return;
    // Only fit when there's no day selection active
    if (selectedDay !== null && selectedDay !== undefined) return;

    const shape = selectedRoute.shape;
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    // Sample every Nth point for speed (no need to check all 10k+ points)
    const step = Math.max(1, Math.floor(shape.length / 100));
    for (let i = 0; i < shape.length; i += step) {
      const [lng, lat] = shape[i];
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }

    mapRef.current.fitBounds(
      [[minLng, minLat], [maxLng, maxLat]],
      { padding: 60, duration: 800 },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeShapeLen]); // Only trigger when route shape fundamentally changes (new route loaded)

  // Zoom to selected day's bounds
  useEffect(() => {
    if (!mapRef.current || !selectedRoute?.shape || !dayStats?.length) return;
    if (selectedDay === null || selectedDay === undefined) return;

    const day = dayStats.find((d) => d.day === selectedDay);
    if (!day) return;

    const dayShape = selectedRoute.shape.slice(day.shape_start_idx, day.shape_end_idx + 1);
    if (dayShape.length < 2) return;

    // Compute bounding box
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const [lng, lat] of dayShape) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }

    mapRef.current.fitBounds(
      [[minLng, minLat], [maxLng, maxLat]],
      { padding: 60, duration: 800 },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay, dayStats, routeShapeLen]);

  // Zoom to navigated anomaly
  useEffect(() => {
    if (!mapRef.current || !navigatedAnomaly) return;
    const seg = navigatedAnomaly.segment;
    if (!seg?.start_coord || !seg?.end_coord) return;

    const [lng1, lat1] = seg.start_coord;
    const [lng2, lat2] = seg.end_coord;

    const minLng = Math.min(lng1, lng2);
    const maxLng = Math.max(lng1, lng2);
    const minLat = Math.min(lat1, lat2);
    const maxLat = Math.max(lat1, lat2);

    mapRef.current.fitBounds(
      [[minLng - 0.01, minLat - 0.01], [maxLng + 0.01, maxLat + 0.01]],
      { padding: 80, duration: 800, maxZoom: 14 },
    );
  }, [navigatedAnomaly]);

  // Anomaly highlight GeoJSON — memoized to avoid new object reference each render
  const anomalyHighlightGeoJson = useMemo(() => {
    if (!navigatedAnomaly?.segment) return null;
    return {
      type: "FeatureCollection" as const,
      features: [{
        type: "Feature" as const,
        properties: { severity: navigatedAnomaly.severity },
        geometry: {
          type: "LineString" as const,
          coordinates: [navigatedAnomaly.segment.start_coord, navigatedAnomaly.segment.end_coord],
        },
      }],
    };
  }, [navigatedAnomaly]);

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
        onRouteInsert(clickedWp);
        return;
      }

      onMapClick(clickedWp);
    },
    [onMapClick, onRouteInsert, routes]
  );

  // Right-click handler
  const handleContextMenu = useCallback(
    (e: MapLayerMouseEvent) => {
      e.preventDefault();

      // Check if right-clicked near a waypoint (within ~20px)
      let nearestWpIdx: number | null = null;
      if (mapRef.current) {
        const point = e.point;
        let minDist = 25; // pixel threshold
        waypoints.forEach((wp, idx) => {
          const projected = mapRef.current!.project([wp.lng, wp.lat]);
          const dx = projected.x - point.x;
          const dy = projected.y - point.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < minDist) {
            minDist = dist;
            nearestWpIdx = idx;
          }
        });
      }

      setContextMenu({
        x: e.point.x,
        y: e.point.y,
        lngLat: { lat: e.lngLat.lat, lng: e.lngLat.lng },
        waypointIndex: nearestWpIdx,
      });
    },
    [waypoints],
  );

  const contextMenuActions: ContextMenuAction[] = contextMenu
    ? [
        // Waypoint-specific actions
        ...(contextMenu.waypointIndex !== null
          ? [
              {
                label: `Delete waypoint ${contextMenu.waypointIndex + 1}`,
                icon: "🗑️",
                danger: true,
                onClick: () => onDeleteWaypoint(contextMenu.waypointIndex!),
              },
              { label: "", icon: "", onClick: () => {}, divider: true },
            ]
          : []),
        // Generic map actions
        {
          label: "Add waypoint here",
          icon: "📍",
          onClick: () => onMapClick({ lat: contextMenu.lngLat.lat, lng: contextMenu.lngLat.lng }),
        },
        ...(hasRoutes
          ? [
              {
                label: "Insert into route here",
                icon: "➕",
                onClick: () => onRouteInsert({ lat: contextMenu.lngLat.lat, lng: contextMenu.lngLat.lng }),
              },
            ]
          : []),
        { label: "", icon: "", onClick: () => {}, divider: true },
        {
          label: "Recalculate route",
          icon: "🔄",
          onClick: () => onRecalculate?.(),
          disabled: !hasRoutes && waypoints.length < 2,
        },
      ]
    : [];

  return (
    <MapGL
      ref={mapRef}
      mapLib={maplibregl}
      initialViewState={INITIAL_VIEW}
      style={{ width: "100%", height: "100%" }}
      mapStyle={MAP_STYLE}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      cursor="crosshair"
    >
      <NavigationControl position="top-right" />
      <GeolocateControl position="top-right" />

      <ScoreOverlay visible={showOverlay} />

      {/* Route layers — either day-colored or standard */}
      {isMultiDay && selectedRoute ? (
        // Multi-day: render per-day colored segments
        <>
          {dayStats!.map((day) => (
            <DayRouteLayer
              key={`day-${day.day}`}
              route={selectedRoute}
              day={day}
              isSelectedDay={selectedDay === null || selectedDay === day.day}
              isFaded={selectedDay !== null && selectedDay !== day.day}
            />
          ))}
        </>
      ) : (
        // Standard: render all route alternatives
        routes.map((route, index) => (
          <RouteLayer
            key={index}
            route={route}
            index={index}
            isSelected={index === selectedRouteIndex}
            onClick={() => onRouteSelect(index)}
          />
        ))
      )}

      <WaypointMarkers
        waypoints={waypoints}
        overnightStopIndices={overnightStopIndices}
        selectedWaypointIndex={selectedWaypointIndex}
        onSelectWaypoint={onSelectWaypoint}
        onDeleteWaypoint={onDeleteWaypoint}
        onMoveWaypoint={onMoveWaypoint}
      />

      {/* Overlay toggle */}
      <div className="absolute top-3 left-3 z-10 flex gap-2">
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
          {showOverlay ? "Scores ON" : "Scores OFF"}
        </button>
        {isMultiDay && selectedDay !== null && (
          <span className="px-3 py-1.5 rounded-md text-xs font-medium bg-amber-600/80 text-white shadow-lg">
            Day {selectedDay} view
          </span>
        )}
      </div>
      {/* Anomaly highlight on map */}
      {anomalyHighlightGeoJson && (
        <Source id="anomaly-highlight" type="geojson" data={anomalyHighlightGeoJson}>
          <Layer
            id="anomaly-highlight-line"
            type="line"
            paint={{
              "line-color": SEVERITY_COLORS[navigatedAnomaly?.severity ?? "suggestion"],
              "line-width": 6,
              "line-dasharray": [2, 1],
              "line-opacity": 0.9,
            }}
          />
          {/* Glow effect */}
          <Layer
            id="anomaly-highlight-glow"
            type="line"
            paint={{
              "line-color": SEVERITY_COLORS[navigatedAnomaly?.severity ?? "suggestion"],
              "line-width": 14,
              "line-opacity": 0.25,
              "line-blur": 8,
            }}
          />
        </Source>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <MapContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          actions={contextMenuActions}
          onClose={() => setContextMenu(null)}
        />
      )}
    </MapGL>
  );
}
