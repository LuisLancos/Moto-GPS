"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import type {
  Waypoint,
  RouteResult,
  DayOverlay,
  DayOverlayWithStats,
} from "@/lib/types";
import { autoSplitTrip } from "@/lib/api";

/**
 * Day planner hook — manages day overlays over a master route.
 *
 * Does NOT own the route data. Consumes useRoute's waypoints + selectedRoute.
 * Days are lightweight index-based lenses: { start_waypoint_idx, end_waypoint_idx }.
 */
export function useTripPlanner(
  waypoints: Waypoint[],
  selectedRoute: RouteResult | null,
) {
  const [dayOverlays, setDayOverlays] = useState<DayOverlay[]>([]);
  const [dailyTargetM, setDailyTargetM] = useState(400_000); // 400km
  const [selectedDay, setSelectedDay] = useState<number | null>(null); // null = full trip
  const [isMultiDay, setIsMultiDay] = useState(false);
  const [splitting, setSplitting] = useState(false);

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
      setSelectedDay(null); // show full trip view
    } catch (err) {
      console.error("Auto-split failed:", err);
    } finally {
      setSplitting(false);
    }
  }, [waypoints, selectedRoute, dailyTargetM]);

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

  // ---------- Adjust overlay indices when waypoints change ----------
  useEffect(() => {
    if (!dayOverlays.length) return;

    // Validate: ensure last overlay's end matches waypoint count
    const lastOverlay = dayOverlays[dayOverlays.length - 1];
    if (lastOverlay && lastOverlay.end_waypoint_idx !== waypoints.length - 1) {
      // Waypoints changed — adjust last overlay
      setDayOverlays((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          end_waypoint_idx: waypoints.length - 1,
        };
        return updated;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypoints.length]); // exclude dayOverlays — effect sets it, would cause double-fire

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

  return {
    // State
    dayOverlays,
    dayStats,
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
