"use client";

import { useMemo } from "react";
import type { RouteResult, RouteManeuver } from "@/lib/types";
import type { DayOverlayWithStats } from "@/lib/types";
import { useUnits } from "@/contexts/UnitContext";
import { formatTime } from "@/lib/formatters";
import { estimateFuel, formatFuelEstimate, type VehicleFuelData } from "@/lib/fuelCalc";

interface RouteStatsProps {
  route: RouteResult;
  selectedDay?: number | null;
  dayStats?: DayOverlayWithStats[];
  defaultVehicle?: VehicleFuelData | null;
}

// Valhalla maneuver type → icon
function maneuverIcon(type: number): string {
  switch (type) {
    case 1: case 2: case 3: return "🏁";    // Start
    case 4: case 5: case 6: return "📍";    // Destination
    case 8: return "⬆️";                     // Continue
    case 9: return "↗️";                     // Slight right
    case 10: return "➡️";                    // Right
    case 11: return "↘️";                    // Sharp right
    case 12: case 13: return "↩️";           // U-turn
    case 14: return "↙️";                    // Sharp left
    case 15: return "⬅️";                    // Left
    case 16: return "↖️";                    // Slight left
    case 17: case 18: case 19: return "🔀";  // Ramp
    case 20: case 21: return "↪️";           // Exit
    case 22: case 23: case 24: return "⬆️";  // Stay
    case 25: case 37: case 38: return "🔀";  // Merge
    case 26: return "🔄";                    // Roundabout enter
    case 27: return "🔄";                    // Roundabout exit
    case 28: case 29: return "⛴️";           // Ferry
    default: return "▪️";
  }
}

// Road badge colors by type
function roadBadge(name: string) {
  const isMotorway = /^M\d/.test(name) || /^A\d+\(M\)/.test(name);
  const isAroad = /^A\d/.test(name) && !isMotorway;
  const isBroad = /^B\d/.test(name);
  const isEuropean = /^E\s?\d/.test(name);

  let bg = "bg-zinc-600";
  let text = "text-zinc-200";
  if (isMotorway) { bg = "bg-blue-600"; text = "text-white"; }
  else if (isAroad) { bg = "bg-green-700"; text = "text-white"; }
  else if (isBroad) { bg = "bg-amber-700"; text = "text-white"; }
  else if (isEuropean) { bg = "bg-emerald-800"; text = "text-white"; }

  return (
    <span
      key={name}
      className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold ${bg} ${text} leading-none`}
    >
      {name}
    </span>
  );
}

// Build a route summary: key roads with distances
function routeSummary(maneuvers: RouteManeuver[]) {
  const roadDistances: Record<string, number> = {};
  for (const m of maneuvers) {
    for (const name of m.street_names) {
      if (/^[MABE]\d/.test(name) || /^E\s?\d/.test(name)) {
        roadDistances[name] = (roadDistances[name] || 0) + m.length;
      }
    }
  }
  return Object.entries(roadDistances)
    .filter(([, km]) => km > 1)
    .sort((a, b) => b[1] - a[1]);
}

export function RouteStats({ route, selectedDay, dayStats, defaultVehicle }: RouteStatsProps) {
  const { formatDist, formatShortDist } = useUnits();
  // Compute day view: slice legs + maneuvers for the selected day
  const dayView = useMemo(() => {
    if (selectedDay == null || !dayStats?.length) return null;
    const day = dayStats.find((d) => d.day === selectedDay);
    if (!day) return null;

    // Day's legs: legs[start_waypoint_idx .. end_waypoint_idx - 1]
    const startLeg = day.start_waypoint_idx;
    const endLeg = Math.min(day.end_waypoint_idx, route.legs.length);
    const dayLegs = route.legs.slice(startLeg, endLeg);

    if (dayLegs.length === 0) return null;

    // Sum distance and time from legs
    let distance = 0;
    let time = 0;
    for (const leg of dayLegs) {
      distance += leg.distance_m;
      time += leg.time_s;
    }

    // Distance before this day starts (sum of preceding legs)
    let distBefore = 0;
    for (let i = 0; i < startLeg && i < route.legs.length; i++) {
      distBefore += route.legs[i].distance_m;
    }
    const distAfter = distBefore + distance;

    // Filter maneuvers by cumulative distance — more reliable than shape indices
    let cumDist = 0;
    const maneuvers: RouteManeuver[] = [];
    for (const m of route.maneuvers) {
      const mDistM = m.length * 1000; // km → m
      if (cumDist + mDistM > distBefore && cumDist < distAfter) {
        maneuvers.push(m);
      }
      cumDist += mDistM;
    }

    return { day, distance, time, motoScore: day.moto_score, maneuvers };
  }, [selectedDay, dayStats, route.legs, route.maneuvers]);

  const visibleManeuvers = dayView ? dayView.maneuvers : route.maneuvers;
  const distance = dayView ? dayView.distance : route.distance_m;
  const time = dayView ? dayView.time : route.time_s;
  const motoScore = dayView ? dayView.motoScore : route.moto_score;

  const scorePercent = motoScore !== null && motoScore !== undefined ? Math.round(motoScore * 100) : null;

  const summary = routeSummary(visibleManeuvers);

  return (
    <div className="rounded-md bg-surface-alt p-3 flex flex-col gap-3">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-lg font-semibold text-primary">
            {formatDist(distance)}
          </div>
          <div className="text-[10px] text-muted uppercase">Distance</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-primary">
            {formatTime(time)}
          </div>
          <div className="text-[10px] text-muted uppercase">Est. Time</div>
        </div>
        <div>
          {scorePercent !== null ? (
            <>
              <div
                className={`text-lg font-semibold ${
                  scorePercent >= 50
                    ? "text-green-400"
                    : scorePercent >= 30
                      ? "text-yellow-400"
                      : "text-red-400"
                }`}
              >
                {scorePercent}
              </div>
              <div className="text-[10px] text-muted uppercase">
                Moto Score
              </div>
            </>
          ) : (
            <>
              <div className="text-lg text-muted">--</div>
              <div className="text-[10px] text-muted uppercase">Score</div>
            </>
          )}
        </div>
      </div>

      {/* Fuel estimate */}
      {defaultVehicle && (() => {
        const est = estimateFuel(distance, defaultVehicle);
        if (!est) return null;
        return (
          <div className="flex items-center justify-center gap-2 text-xs text-muted border-t border-border/50 pt-2">
            <span>⛽</span>
            <span>{formatFuelEstimate(est)}</span>
          </div>
        );
      })()}

      {/* Road summary badges */}
      {summary.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] text-muted font-medium uppercase">
            Key roads
          </span>
          <div className="flex flex-wrap gap-1.5">
            {summary.map(([name, km]) => (
              <span key={name} className="inline-flex items-center gap-1">
                {roadBadge(name)}
                <span className="text-[10px] text-muted">
                  {formatShortDist(km)}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Day indicator */}
      {dayView && (
        <div className="text-[10px] text-blue-400 font-medium text-center -mt-1">
          Showing Day {dayView.day.day}{dayView.day.name ? `: ${dayView.day.name}` : ""} · Select &quot;Full Trip&quot; for complete route
        </div>
      )}

      {/* Turn-by-turn directions */}
      {visibleManeuvers.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted hover:text-secondary transition-colors">
            {visibleManeuvers.length} directions{dayView ? ` (Day ${dayView.day.day})` : ""}
          </summary>
          <div className="mt-2 flex flex-col gap-0.5 max-h-64 overflow-y-auto">
            {visibleManeuvers.map((m, i) => {
              const dist = formatShortDist(m.length);
              const hasRoadNames = m.street_names.length > 0;
              return (
                <div
                  key={i}
                  className="flex items-start gap-2 py-1.5 border-b border-border/40 last:border-0"
                >
                  <span className="text-sm w-5 shrink-0 text-center leading-5">
                    {maneuverIcon(m.type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-secondary leading-tight">
                      {m.instruction}
                    </p>
                    {hasRoadNames && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {m.street_names.map((name) => roadBadge(name))}
                      </div>
                    )}
                  </div>
                  {dist && (
                    <span className="text-[10px] text-muted font-mono shrink-0 pt-0.5">
                      {dist}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
