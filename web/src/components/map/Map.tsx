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
  Marker,
  Popup,
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
import { useTheme } from "@/contexts/ThemeContext";

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY || "";

const OSM_FALLBACK_STYLE = {
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

function getMapStyle(theme: "light" | "dark") {
  if (!MAPTILER_KEY) return OSM_FALLBACK_STYLE;
  const variant = theme === "dark" ? "streets-v2-dark" : "streets-v2";
  return `https://api.maptiler.com/maps/${variant}/style.json?key=${MAPTILER_KEY}`;
}

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
  onToggleOvernightStop?: (index: number) => void;
  onSetWaypointType?: (index: number, type: import("@/lib/types").WaypointType) => void;
  dayStats?: DayOverlayWithStats[];
  selectedDay?: number | null;
  // AI POIs
  pois?: import("@/lib/types").POIResult[];
  onAddPOIAsWaypoint?: (poi: import("@/lib/types").POIResult) => void;
  onClearPOIs?: () => void;
  // Route POI overlay controls
  poiOverlaySlot?: React.ReactNode;
  // Fly to a specific coordinate (triggered from waypoint list click)
  flyToCoord?: { lat: number; lng: number; zoom?: number } | null;
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
  onToggleOvernightStop,
  onSetWaypointType,
  dayStats,
  selectedDay,
  pois,
  onAddPOIAsWaypoint,
  onClearPOIs,
  poiOverlaySlot,
  flyToCoord,
}: MapProps) {
  const { theme } = useTheme();
  const mapStyle = useMemo(() => getMapStyle(theme), [theme]);
  const mapRef = useRef<MapRef>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [openPOIIndex, setOpenPOIIndex] = useState<number | null>(null);
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

  // Fly to specific coordinate (from waypoint list click)
  useEffect(() => {
    if (!mapRef.current || !flyToCoord) return;
    mapRef.current.flyTo({
      center: [flyToCoord.lng, flyToCoord.lat],
      zoom: flyToCoord.zoom ?? 13,
      duration: 600,
    });
  }, [flyToCoord]);

  // Anomaly highlight GeoJSON — uses actual route shape (not a straight line)
  const anomalyHighlightGeoJson = useMemo(() => {
    if (!navigatedAnomaly?.segment) return null;
    const seg = navigatedAnomaly.segment;

    // Use actual route shape points between indices for an accurate on-road highlight
    let coordinates: [number, number][];
    if (
      selectedRoute?.shape &&
      seg.start_shape_index >= 0 &&
      seg.end_shape_index > seg.start_shape_index &&
      seg.end_shape_index < selectedRoute.shape.length
    ) {
      // shape is [[lat,lng],...] but GeoJSON needs [lng,lat]
      coordinates = selectedRoute.shape
        .slice(seg.start_shape_index, seg.end_shape_index + 1)
        .map((p) => [p[1], p[0]] as [number, number]);
    } else {
      // Fallback: straight line between segment endpoints
      coordinates = [seg.start_coord, seg.end_coord];
    }

    if (coordinates.length < 2) return null;

    return {
      type: "FeatureCollection" as const,
      features: [{
        type: "Feature" as const,
        properties: { severity: navigatedAnomaly.severity },
        geometry: {
          type: "LineString" as const,
          coordinates,
        },
      }],
    };
  }, [navigatedAnomaly, selectedRoute]);

  const handleClick = useCallback(
    (e: MapLayerMouseEvent) => {
      // Close any open POI popup
      setOpenPOIIndex(null);
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
      mapStyle={mapStyle}
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
        onToggleOvernightStop={onToggleOvernightStop}
        onSetWaypointType={onSetWaypointType}
      />

      {/* Overlay toggle */}
      <div className="absolute top-3 left-3 z-10 flex gap-2">
        <button
          onClick={() => setShowOverlay(!showOverlay)}
          className={`
            px-3 py-1.5 rounded-md text-xs font-medium shadow-lg transition-colors
            ${showOverlay
              ? "bg-blue-600 text-white"
              : "bg-surface-alt text-muted hover:text-secondary"
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
      {/* POI overlay controls */}
      {poiOverlaySlot && (
        <div className="absolute top-12 left-3 z-10">
          {poiOverlaySlot}
        </div>
      )}
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
      {/* Anomaly location marker — pointer-events-none so it doesn't block waypoint clicks */}
      {navigatedAnomaly?.segment && (
        <Marker
          longitude={
            (navigatedAnomaly.segment.start_coord[0] + navigatedAnomaly.segment.end_coord[0]) / 2
          }
          latitude={
            (navigatedAnomaly.segment.start_coord[1] + navigatedAnomaly.segment.end_coord[1]) / 2
          }
          anchor="center"
        >
          <div
            className={`flex items-center justify-center w-8 h-8 rounded-full border-2 text-sm font-bold shadow-lg pointer-events-none ${
              navigatedAnomaly.severity === "issue"
                ? "bg-red-600/90 border-red-400 text-white"
                : navigatedAnomaly.severity === "warning"
                ? "bg-amber-600/90 border-amber-400 text-white"
                : "bg-blue-600/90 border-blue-400 text-white"
            }`}
          >
            {navigatedAnomaly.severity === "issue" ? "⚠" : navigatedAnomaly.severity === "warning" ? "!" : "💡"}
          </div>
        </Marker>
      )}

      {/* AI POI markers */}
      {pois && pois.length > 0 && (
        <>
          {pois.map((poi, i) => (
            <POIMarker
              key={`poi-${i}-${poi.name}`}
              poi={poi}
              isOpen={openPOIIndex === i}
              onOpen={() => setOpenPOIIndex(i)}
              onClose={() => setOpenPOIIndex(null)}
              onAddAsWaypoint={onAddPOIAsWaypoint}
            />
          ))}
          {/* Clear POIs button */}
          {onClearPOIs && (
            <div className="absolute top-14 right-3 z-10">
              <button
                onClick={onClearPOIs}
                className="bg-overlay border border-border text-secondary text-[10px] px-2 py-1 rounded-md hover:bg-surface-alt transition-colors"
              >
                Clear {pois.length} POIs
              </button>
            </div>
          )}
        </>
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

// ---------- POI Marker sub-component ----------

const POI_ICONS: Record<string, string> = {
  fuel: "⛽", restaurant: "🍽️", pub: "🍺", castle: "🏰",
  viewpoint: "👁️", museum: "🏛️", biker_cafe: "☕",
  biker_spot: "🏍️", scenic_road: "🛣️", accommodation: "🏨",
  hotel: "🏨", campsite: "⛺", attraction: "📍", cafe: "☕",
};

function POIMarker({
  poi,
  isOpen,
  onOpen,
  onClose,
  onAddAsWaypoint,
}: {
  poi: import("@/lib/types").POIResult;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onAddAsWaypoint?: (poi: import("@/lib/types").POIResult) => void;
}) {
  const [detail, setDetail] = useState<{
    google?: { rating?: number; user_ratings_total?: number; photo_url?: string; google_maps_url?: string };
    wikipedia?: { title?: string; extract?: string; thumbnail?: string; url?: string };
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const icon = POI_ICONS[poi.category] || "📍";

  const fetchDetail = async () => {
    if (detail || detailLoading) return;
    setDetailLoading(true);
    try {
      const { authFetch } = await import("@/lib/authApi");
      const res = await authFetch("/api/route/poi-detail", {
        method: "POST",
        body: JSON.stringify({ name: poi.name, lat: poi.lat, lng: poi.lng, wikidata: poi.wikidata }),
      });
      if (res.ok) setDetail(await res.json());
    } catch { /* silent */ }
    finally { setDetailLoading(false); }
  };

  return (
    <>
      <Marker
        longitude={poi.lng}
        latitude={poi.lat}
        anchor="bottom"
        onClick={(e) => {
          e.originalEvent.stopPropagation();
          if (isOpen) onClose(); else onOpen();
        }}
      >
        <div
          className="flex items-center justify-center w-7 h-7 rounded-full bg-surface/90 border-2 border-amber-500 cursor-pointer hover:scale-110 transition-transform text-sm"
          title={`${poi.name} (${poi.category})`}
        >
          {icon}
        </div>
      </Marker>
      {isOpen && (
        <Popup
          longitude={poi.lng}
          latitude={poi.lat}
          anchor="bottom"
          offset={30}
          closeOnClick={true}
          onClose={onClose}
          className="poi-popup"
          maxWidth="280px"
        >
          <div className="flex flex-col gap-1.5 min-w-[200px] max-w-[260px]">
            {/* Photo from Google/Wikipedia */}
            {detail?.google?.photo_url && (
              <img src={detail.google.photo_url} alt={poi.name} className="w-full h-24 object-cover rounded" />
            )}
            {!detail?.google?.photo_url && detail?.wikipedia?.thumbnail && (
              <img src={detail.wikipedia.thumbnail} alt={poi.name} className="w-full h-24 object-cover rounded" />
            )}

            {/* Name + category */}
            <div className="text-xs font-semibold text-primary">
              {icon} {poi.name}
            </div>

            {/* Brand / cuisine */}
            {(poi.brand || poi.cuisine) && (
              <div className="text-[10px] text-muted">
                {poi.brand}{poi.brand && poi.cuisine ? " · " : ""}{poi.cuisine}
              </div>
            )}

            {/* Google rating */}
            {detail?.google?.rating && (
              <div className="text-[10px] text-amber-600 font-medium">
                ⭐ {detail.google.rating}/5 ({detail.google.user_ratings_total} reviews)
              </div>
            )}

            {/* Address */}
            {poi.address && (
              <div className="text-[10px] text-muted">📍 {poi.address}</div>
            )}

            {/* Opening hours */}
            {poi.opening_hours && (
              <div className="text-[10px] text-muted">🕐 {poi.opening_hours}</div>
            )}

            {/* Phone */}
            {poi.phone && (
              <div className="text-[10px] text-muted">📞 {poi.phone}</div>
            )}

            {/* Website */}
            {poi.website && (
              <a href={poi.website} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-600 hover:underline truncate">
                🌐 {poi.website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
              </a>
            )}

            {/* Wikipedia extract */}
            {detail?.wikipedia?.extract && (
              <p className="text-[10px] text-muted leading-relaxed line-clamp-3">
                {detail.wikipedia.extract}
              </p>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-1.5 mt-0.5">
              {onAddAsWaypoint && (
                <button
                  onClick={() => { onAddAsWaypoint(poi); onClose(); }}
                  className="text-[10px] bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded transition-colors"
                >
                  + Waypoint
                </button>
              )}
              {!detail && !detailLoading && (
                <button
                  onClick={fetchDetail}
                  className="text-[10px] bg-surface-alt hover:bg-surface-hover text-secondary px-2 py-1 rounded transition-colors"
                >
                  📷 More info
                </button>
              )}
              {detailLoading && (
                <span className="text-[10px] text-muted animate-pulse">Loading...</span>
              )}
              {detail?.google?.google_maps_url && (
                <a
                  href={detail.google.google_maps_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] bg-surface-alt hover:bg-surface-hover text-secondary px-2 py-1 rounded transition-colors"
                >
                  🗺️ Google Maps
                </a>
              )}
              {detail?.wikipedia?.url && (
                <a
                  href={detail.wikipedia.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] bg-surface-alt hover:bg-surface-hover text-secondary px-2 py-1 rounded transition-colors"
                >
                  📖 Wiki
                </a>
              )}
            </div>
          </div>
        </Popup>
      )}
    </>
  );
}
