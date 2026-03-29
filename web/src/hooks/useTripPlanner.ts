"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type {
  Waypoint,
  RouteType,
  RouteResult,
  DayOverlay,
  DayOverlayWithStats,
  DaySuggestion,
} from "@/lib/types";
import type { VehicleFuelData } from "@/lib/fuelCalc";
import { autoSplitTrip, fetchDaySuggestions } from "@/lib/api";

/**
 * Day planner hook — manages day overlays over a master route.
 *
 * Does NOT own the route data. Consumes useRoute's waypoints + selectedRoute.
 * Days are lightweight index-based lenses: { start_waypoint_idx, end_waypoint_idx }.
 */
export function useTripPlanner(
  waypoints: Waypoint[],
  selectedRoute: RouteResult | null,
  defaultVehicle?: VehicleFuelData | null,
  addWaypoint?: (wp: Waypoint, atIndex: number) => void,
) {
  const [dayOverlays, setDayOverlays] = useState<DayOverlay[]>([]);
  const [dailyTargetM, setDailyTargetM] = useState(400_000);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [isMultiDay, setIsMultiDay] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [daySuggestions, setDaySuggestions] = useState<DaySuggestion[]>([]);

  // ---------- Compute per-day stats from overlays + route legs ----------
  const dayStats: DayOverlayWithStats[] = useMemo(() => {
    if (!dayOverlays.length || !selectedRoute?.legs?.length) return [];

    return dayOverlays.map((overlay) => {
      const legSlice = (selectedRoute.legs || []).slice(
        overlay.start_waypoint_idx,
        overlay.end_waypoint_idx,
      );
      const distance_m = legSlice.reduce(
        (sum, l) => sum + (l.distance_m || 0),
        0,
      );
      const time_s = legSlice.reduce((sum, l) => sum + (l.time_s || 0), 0);
      const shape_start_idx =
        legSlice[0]?.shape_start_idx ?? 0;
      const shape_end_idx =
        legSlice[legSlice.length - 1]?.shape_end_idx ??
        (selectedRoute.shape?.length ?? 1) - 1;

      return {
        ...overlay,
        distance_m,
        time_s,
        moto_score: null,
        waypoint_count: overlay.end_waypoint_idx - overlay.start_waypoint_idx + 1,
        shape_start_idx,
        shape_end_idx,
      };
    });
  }, [dayOverlays, selectedRoute]);

  // ---------- Auto-split via backend ----------
  const autoSplit = useCallback(async () => {
    if (!selectedRoute?.legs?.length || waypoints.length < 3) return;
    setSplitting(true);
    try {
      const legs = selectedRoute.legs.map((l) => ({
        distance_m: l.distance_m || 0,
        time_s: l.time_s || 0,
        shape_start_idx: l.shape_start_idx ?? 0,
        shape_end_idx: l.shape_end_idx ?? 0,
      }));
      const result = await autoSplitTrip(waypoints, legs, dailyTargetM);
      setDayOverlays(result.day_overlays);
      setIsMultiDay(true);
      setSelectedDay(null);

      // Auto-insert overnight hotel waypoints at each day boundary
      if (addWaypoint && selectedRoute.shape?.length) {
        try {
          const vehicle = defaultVehicle
            ? { consumption: defaultVehicle.consumption, consumption_unit: defaultVehicle.consumption_unit, tank_capacity: defaultVehicle.tank_capacity }
            : null;
          const sugData = await fetchDaySuggestions(
            waypoints,
            result.day_overlays,
            selectedRoute.shape,
            legs,
            vehicle,
          );
          const suggestions = sugData.suggestions || [];
          setDaySuggestions(suggestions);

          // Insert hotel waypoints at each overnight stop (in reverse order to preserve indices)
          const hotelsToInsert: { wp: Waypoint; afterIdx: number }[] = [];
          for (const sug of suggestions) {
            if (sug.hotel && sug.day < result.day_overlays.length) {
              const dayOv = result.day_overlays.find((d) => d.day === sug.day);
              if (dayOv) {
                hotelsToInsert.push({
                  wp: { lat: sug.hotel.lat, lng: sug.hotel.lng, label: `🏨 ${sug.hotel.name}` },
                  afterIdx: dayOv.end_waypoint_idx + 1,
                });
              }
            }
          }

          // Insert in reverse order so indices don't shift
          hotelsToInsert.sort((a, b) => b.afterIdx - a.afterIdx);
          for (const h of hotelsToInsert) {
            addWaypoint(h.wp, h.afterIdx);
          }
        } catch {
          // Suggestions are optional — don't fail the split
        }
      }
    } catch (err) {
      console.error("Auto-split failed:", err);
    } finally {
      setSplitting(false);
    }
  }, [waypoints, selectedRoute, dailyTargetM, addWaypoint, defaultVehicle]);

  // ---------- Toggle a waypoint as overnight stop ----------
  const toggleOvernightStop = useCallback(
    (waypointIdx: number) => {
      if (waypointIdx <= 0 || waypointIdx >= waypoints.length - 1) return;

      setDayOverlays((prev) => {
        // Check if this waypoint is already a day boundary
        const isBoundary = prev.some(
          (d) => d.end_waypoint_idx === waypointIdx,
        );

        if (isBoundary) {
          // Remove the boundary — merge the two days
          const newOverlays: DayOverlay[] = [];
          let dayNum = 1;
          for (let i = 0; i < prev.length; i++) {
            if (prev[i].end_waypoint_idx === waypointIdx && i + 1 < prev.length) {
              // Merge this day with the next
              newOverlays.push({
                day: dayNum,
                start_waypoint_idx: prev[i].start_waypoint_idx,
                end_waypoint_idx: prev[i + 1].end_waypoint_idx,
                name: undefined,
                description: undefined,
              });
              i++; // skip next
              dayNum++;
            } else {
              newOverlays.push({ ...prev[i], day: dayNum });
              dayNum++;
            }
          }
          return _relabel(newOverlays, waypoints);
        } else {
          // Add a boundary — split the day that contains this waypoint
          const newOverlays: DayOverlay[] = [];
          let dayNum = 1;
          for (const d of prev) {
            if (
              waypointIdx > d.start_waypoint_idx &&
              waypointIdx < d.end_waypoint_idx
            ) {
              // Split this day at waypointIdx
              newOverlays.push({
                day: dayNum,
                start_waypoint_idx: d.start_waypoint_idx,
                end_waypoint_idx: waypointIdx,
              });
              dayNum++;
              newOverlays.push({
                day: dayNum,
                start_waypoint_idx: waypointIdx,
                end_waypoint_idx: d.end_waypoint_idx,
              });
              dayNum++;
            } else {
              newOverlays.push({ ...d, day: dayNum });
              dayNum++;
            }
          }
          return _relabel(newOverlays, waypoints);
        }
      });
    },
    [waypoints],
  );

  // ---------- Update day name/description ----------
  const updateDayMeta = useCallback(
    (dayNum: number, meta: { name?: string; description?: string }) => {
      setDayOverlays((prev) =>
        prev.map((d) =>
          d.day === dayNum ? { ...d, ...meta } : d,
        ),
      );
    },
    [],
  );

  // ---------- Clear all day splits ----------
  const clearDays = useCallback(() => {
    setDayOverlays([]);
    setIsMultiDay(false);
    setSelectedDay(null);
  }, []);

  // ---------- Get day's waypoints (sliced from master) ----------
  const getDayWaypoints = useCallback(
    (dayNum: number): Waypoint[] => {
      const day = dayOverlays.find((d) => d.day === dayNum);
      if (!day) return waypoints;
      return waypoints.slice(day.start_waypoint_idx, day.end_waypoint_idx + 1);
    },
    [dayOverlays, waypoints],
  );

  // ---------- Get overnight stop indices ----------
  const overnightStopIndices: Set<number> = useMemo(() => {
    const indices = new Set<number>();
    for (const d of dayOverlays) {
      if (d.end_waypoint_idx < waypoints.length - 1) {
        indices.add(d.end_waypoint_idx);
      }
    }
    return indices;
  }, [dayOverlays, waypoints.length]);

  // ---------- Adjust overlay indices when waypoints are added/removed ----------
  const prevWpCountRef = useRef(waypoints.length);

  useEffect(() => {
    if (!dayOverlays.length) return;

    const newCount = waypoints.length;
    const prevCount = prevWpCountRef.current;
    prevWpCountRef.current = newCount;

    if (prevCount === newCount || newCount < 2) return;

    // Simple strategy: keep the LAST overlay expanding/contracting.
    // All other overlays keep their current size. This avoids complex
    // "where was the insertion" logic and always produces valid overlays.
    setDayOverlays((prev) => {
      if (!prev.length) return prev;
      const updated = [...prev];
      // Just update the last overlay's end to match new waypoint count
      updated[updated.length - 1] = {
        ...updated[updated.length - 1],
        end_waypoint_idx: newCount - 1,
      };

      // Validate: ensure every overlay has at least 2 waypoints (start != end)
      for (let i = 0; i < updated.length; i++) {
        if (updated[i].end_waypoint_idx <= updated[i].start_waypoint_idx) {
          // This overlay is invalid — merge it into the previous one
          if (i > 0) {
            updated[i - 1] = {
              ...updated[i - 1],
              end_waypoint_idx: updated[i].end_waypoint_idx,
            };
            updated.splice(i, 1);
            // Re-number days
            for (let j = 0; j < updated.length; j++) {
              updated[j] = { ...updated[j], day: j + 1 };
            }
            i--; // Recheck at same position
          }
        }
      }

      // Ensure contiguity
      for (let i = 1; i < updated.length; i++) {
        updated[i] = { ...updated[i], start_waypoint_idx: updated[i - 1].end_waypoint_idx };
      }

      return updated;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypoints.length]);

  // ---------- Per-day route type (sync/unsync) ----------
  const setDayRouteType = useCallback(
    (dayNum: number, type: RouteType | undefined) => {
      setDayOverlays((prev) =>
        prev.map((d) =>
          d.day === dayNum ? { ...d, route_type: type } : d,
        ),
      );
    },
    [],
  );

  const hasPerDayRouteTypes = useMemo(
    () => dayOverlays.some((d) => d.route_type != null),
    [dayOverlays],
  );

  // ---------- Load overlays from saved trip ----------
  const loadDayOverlays = useCallback(
    (overlays: DayOverlay[], targetM?: number) => {
      setDayOverlays(overlays);
      if (targetM) setDailyTargetM(targetM);
      setIsMultiDay(overlays.length > 0);
      setSelectedDay(null);
    },
    [],
  );

  // ---------- Auto-fetch overnight + fuel suggestions when days change ----------
  const dayOverlayKey = dayOverlays.map((d) => `${d.day}:${d.start_waypoint_idx}-${d.end_waypoint_idx}`).join("|");

  useEffect(() => {
    if (!dayOverlays.length || !selectedRoute?.shape?.length || !selectedRoute?.legs?.length) {
      setDaySuggestions([]);
      return;
    }

    const vehicle = defaultVehicle
      ? { consumption: defaultVehicle.consumption, consumption_unit: defaultVehicle.consumption_unit, tank_capacity: defaultVehicle.tank_capacity }
      : null;

    fetchDaySuggestions(
      waypoints,
      dayOverlays,
      selectedRoute.shape,
      selectedRoute.legs.map((l) => ({ distance_m: l.distance_m, time_s: l.time_s })),
      vehicle,
    )
      .then((data) => setDaySuggestions(data.suggestions || []))
      .catch(() => setDaySuggestions([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayOverlayKey, selectedRoute?.distance_m]);

  return {
    // State
    dayOverlays,
    dayStats,
    daySuggestions,
    selectedDay,
    dailyTargetM,
    isMultiDay,
    splitting,
    overnightStopIndices,

    // Actions
    autoSplit,
    toggleOvernightStop,
    updateDayMeta,
    clearDays,
    setSelectedDay,
    setDailyTargetM,
    setIsMultiDay,
    getDayWaypoints,
    loadDayOverlays,
    setDayRouteType,
    hasPerDayRouteTypes,
  };
}

// ---------- Helpers ----------

function _relabel(overlays: DayOverlay[], waypoints: Waypoint[]): DayOverlay[] {
  return overlays.map((d) => ({
    ...d,
    name:
      d.name ||
      _autoLabel(d.day, waypoints, d.start_waypoint_idx, d.end_waypoint_idx),
  }));
}

function _autoLabel(
  day: number,
  waypoints: Waypoint[],
  startIdx: number,
  endIdx: number,
): string {
  const start = waypoints[startIdx]?.label;
  const end = waypoints[endIdx]?.label;
  if (start && end) return `Day ${day}: ${start} → ${end}`;
  if (start) return `Day ${day}: From ${start}`;
  if (end) return `Day ${day}: To ${end}`;
  return `Day ${day}`;
}
