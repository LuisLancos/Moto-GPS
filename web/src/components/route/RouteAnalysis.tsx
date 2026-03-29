"use client";

import type { RouteAnalysisResponse, RouteAnomaly, AnomalyFix } from "@/lib/types";

const SEVERITY_STYLES: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  issue: { bg: "bg-red-950/40", border: "border-red-800/60", text: "text-red-300", icon: "⚠️" },
  warning: { bg: "bg-amber-950/40", border: "border-amber-800/60", text: "text-amber-300", icon: "⚡" },
  suggestion: { bg: "bg-blue-950/40", border: "border-blue-800/60", text: "text-blue-300", icon: "💡" },
};

const HEALTH_BADGE: Record<string, { label: string; color: string }> = {
  good: { label: "Route looks good ✓", color: "text-green-700 dark:text-green-400" },
  fair: { label: "Could be improved", color: "text-amber-700 dark:text-amber-400" },
  poor: { label: "Needs attention", color: "text-red-400" },
};

/** Rider-friendly description per anomaly type */
function riderDescription(anomaly: RouteAnomaly): string {
  const wp = anomaly.affected_waypoint_index;
  switch (anomaly.type) {
    case "backtracking":
      return wp != null
        ? `The route doubles back near waypoint ${wp + 1}. This adds unnecessary distance — consider moving or removing it.`
        : "Part of the route goes backwards. Check nearby waypoints.";
    case "close_proximity":
      return wp != null
        ? `Waypoints ${wp} and ${wp + 1} are very close together (${anomaly.metric_value ? `${(anomaly.metric_value / 1000).toFixed(1)}km` : "nearby"}). One of them may be unnecessary.`
        : "Two waypoints are very close together. Consider removing one.";
    case "detour_ratio":
      return wp != null
        ? `The route between waypoints ${wp} and ${wp + 1} takes a long detour (${anomaly.metric_value?.toFixed(1)}× the direct distance). Adding a waypoint between them can guide the router.`
        : "A section of the route takes an unusually long detour.";
    case "u_turn":
      return `The route makes a U-turn${anomaly.metric_value ? ` (${anomaly.metric_value.toFixed(1)}km)` : ""}. This usually means the router is struggling with a waypoint placement.`;
    case "road_quality_drop":
      return `A section of the route passes through poor-quality roads${anomaly.metric_value ? ` (score: ${(anomaly.metric_value * 100).toFixed(0)}%)` : ""}. Adding a waypoint can help bypass this area.`;
    case "missed_high_scoring_road":
      return `There's a great scenic road nearby${anomaly.metric_value ? ` (score: ${(anomaly.metric_value * 100).toFixed(0)}%)` : ""} that the route misses. Consider adding a waypoint to ride through it.`;
    default:
      return anomaly.description;
  }
}

/** Rider-friendly fix button label with icon */
function fixLabel(fix: AnomalyFix): { icon: string; label: string } {
  switch (fix.action) {
    case "remove_waypoint":
      return { icon: "✕", label: `Remove waypoint ${fix.waypoint_index != null ? fix.waypoint_index + 1 : ""}` };
    case "add_waypoint":
      return { icon: "+", label: "Add bypass waypoint" };
    case "move_waypoint":
      return { icon: "↗", label: `Move waypoint ${fix.waypoint_index != null ? fix.waypoint_index + 1 : ""}` };
    case "reorder_waypoints":
      return { icon: "⇅", label: "Reorder waypoints" };
    default:
      return { icon: "ℹ", label: fix.description };
  }
}

interface RouteAnalysisProps {
  analysis: RouteAnalysisResponse;
  loading: boolean;
  onApplyFix: (anomaly: RouteAnomaly) => void;
  onHighlightAnomaly: (index: number | null) => void;
  onNavigateToAnomaly: (anomaly: RouteAnomaly) => void;
}

export function RouteAnalysis({
  analysis,
  loading,
  onApplyFix,
  onHighlightAnomaly,
  onNavigateToAnomaly,
}: RouteAnalysisProps) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted py-2">
        <span className="animate-pulse">Analysing route...</span>
      </div>
    );
  }

  const health = HEALTH_BADGE[analysis.overall_health] || HEALTH_BADGE.good;

  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted uppercase tracking-wider">
          Route Analysis
        </span>
        <span className={`text-xs font-medium ${health.color}`}>
          {health.label}
        </span>
      </div>

      {/* No anomalies */}
      {analysis.anomalies.length === 0 && (
        <p className="text-xs text-muted py-1">
          No issues detected — this route looks great for riding. 🏍️
        </p>
      )}

      {/* Anomaly cards */}
      {analysis.anomalies.map((anomaly, i) => {
        const style = SEVERITY_STYLES[anomaly.severity] || SEVERITY_STYLES.suggestion;
        const fixes = anomaly.fixes?.length
          ? anomaly.fixes.filter((f) => f.action !== "no_action")
          : anomaly.fix.action !== "no_action"
          ? [anomaly.fix]
          : [];

        return (
          <div
            key={`${anomaly.type}-${i}`}
            className={`
              flex flex-col gap-2 rounded-lg px-3 py-2.5 border transition-all
              ${style.bg} ${style.border}
              hover:brightness-110
            `}
            onMouseEnter={() => onHighlightAnomaly(i)}
            onMouseLeave={() => onHighlightAnomaly(null)}
          >
            {/* Title + Show button */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-sm shrink-0">{style.icon}</span>
                <span className={`text-xs font-semibold ${style.text} truncate`}>
                  {anomaly.title}
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigateToAnomaly(anomaly);
                }}
                className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded border border-border text-secondary hover:bg-surface-hover hover:text-primary transition-colors"
              >
                📍 Show on map
              </button>
            </div>

            {/* Rider-friendly description */}
            <p className="text-[11px] text-muted leading-relaxed">
              {riderDescription(anomaly)}
            </p>

            {/* Fix buttons */}
            {fixes.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-muted mr-0.5">Fix:</span>
                {fixes.map((fix, fixIdx) => {
                  const fl = fixLabel(fix);
                  return (
                    <button
                      key={fixIdx}
                      onClick={(e) => {
                        e.stopPropagation();
                        onApplyFix({ ...anomaly, fix });
                      }}
                      className={`text-[10px] font-medium px-2 py-0.5 rounded-md transition-colors border ${style.border} ${style.text} hover:bg-white/10`}
                      title={fix.description}
                    >
                      {fl.icon} {fl.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* No-action hint */}
            {fixes.length === 0 && (
              <p className="text-[10px] text-muted italic">
                {anomaly.fix.action === "no_action" ? anomaly.fix.description : "No automatic fix available — review the waypoints manually."}
              </p>
            )}
          </div>
        );
      })}

      {/* Analysis time (subtle) */}
      {analysis.analysis_time_ms > 0 && (
        <p className="text-[9px] text-muted text-right">
          Analysed in {(analysis.analysis_time_ms / 1000).toFixed(1)}s
        </p>
      )}
    </div>
  );
}
