"use client";

import type { RouteResult, RouteManeuver } from "@/lib/types";

interface RouteStatsProps {
  route: RouteResult;
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  const km = meters / 1000;
  return km >= 10 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`;
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins} min`;
}

function formatManeuverDist(km: number): string {
  if (km < 0.1) return "";
  if (km < 1) return `${(km * 1000).toFixed(0)}m`;
  return km >= 10 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`;
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

export function RouteStats({ route }: RouteStatsProps) {
  const scorePercent =
    route.moto_score !== null ? Math.round(route.moto_score * 100) : null;

  const summary = routeSummary(route.maneuvers);

  return (
    <div className="rounded-md bg-zinc-800 p-3 flex flex-col gap-3">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-lg font-semibold text-zinc-100">
            {formatDistance(route.distance_m)}
          </div>
          <div className="text-[10px] text-zinc-500 uppercase">Distance</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-zinc-100">
            {formatTime(route.time_s)}
          </div>
          <div className="text-[10px] text-zinc-500 uppercase">Est. Time</div>
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
              <div className="text-[10px] text-zinc-500 uppercase">
                Moto Score
              </div>
            </>
          ) : (
            <>
              <div className="text-lg text-zinc-500">--</div>
              <div className="text-[10px] text-zinc-500 uppercase">Score</div>
            </>
          )}
        </div>
      </div>

      {/* Road summary badges */}
      {summary.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] text-zinc-500 font-medium uppercase">
            Key roads
          </span>
          <div className="flex flex-wrap gap-1.5">
            {summary.map(([name, km]) => (
              <span key={name} className="inline-flex items-center gap-1">
                {roadBadge(name)}
                <span className="text-[10px] text-zinc-500">
                  {km >= 10 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Turn-by-turn directions */}
      {route.maneuvers.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200 transition-colors">
            {route.maneuvers.length} directions
          </summary>
          <div className="mt-2 flex flex-col gap-0.5 max-h-64 overflow-y-auto">
            {route.maneuvers.map((m, i) => {
              const dist = formatManeuverDist(m.length);
              const hasRoadNames = m.street_names.length > 0;
              return (
                <div
                  key={i}
                  className="flex items-start gap-2 py-1.5 border-b border-zinc-700/40 last:border-0"
                >
                  <span className="text-sm w-5 shrink-0 text-center leading-5">
                    {maneuverIcon(m.type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-zinc-300 leading-tight">
                      {m.instruction}
                    </p>
                    {hasRoadNames && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {m.street_names.map((name) => roadBadge(name))}
                      </div>
                    )}
                  </div>
                  {dist && (
                    <span className="text-[10px] text-zinc-500 font-mono shrink-0 pt-0.5">
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
