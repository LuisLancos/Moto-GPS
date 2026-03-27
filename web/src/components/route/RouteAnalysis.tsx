"use client";

import type { RouteAnalysisResponse, RouteAnomaly } from "@/lib/types";

const SEVERITY_STYLES: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  issue: { bg: "bg-red-950/50", border: "border-red-700", text: "text-red-300", icon: "🔴" },
  warning: { bg: "bg-amber-950/50", border: "border-amber-700", text: "text-amber-300", icon: "🟡" },
  suggestion: { bg: "bg-blue-950/50", border: "border-blue-700", text: "text-blue-300", icon: "🔵" },
};

const HEALTH_BADGE: Record<string, { label: string; color: string }> = {
  good: { label: "Route looks good", color: "text-green-400" },
  fair: { label: "Some issues found", color: "text-amber-400" },
  poor: { label: "Issues detected", color: "text-red-400" },
};

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
      <div className="flex items-center gap-2 text-xs text-zinc-500 py-2">
        <span className="animate-pulse">Analysing route...</span>
      </div>
    );
  }

  const health = HEALTH_BADGE[analysis.overall_health] || HEALTH_BADGE.good;

  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
          Route Analysis
        </span>
        <span className={`text-xs font-medium ${health.color}`}>
          {health.label}
        </span>
      </div>

      {/* No anomalies */}
      {analysis.anomalies.length === 0 && (
        <p className="text-xs text-zinc-500 py-1">
          No issues detected — this route looks great for riding.
        </p>
      )}

      {/* Anomaly cards */}
      {analysis.anomalies.map((anomaly, i) => {
        const style = SEVERITY_STYLES[anomaly.severity] || SEVERITY_STYLES.suggestion;
        return (
          <div
            key={`${anomaly.type}-${i}`}
            className={`
              flex flex-col gap-1.5 rounded-md px-3 py-2.5 border transition-all
              ${style.bg} ${style.border}
              hover:brightness-110 cursor-default
            `}
            onMouseEnter={() => onHighlightAnomaly(i)}
            onMouseLeave={() => onHighlightAnomaly(null)}
          >
            {/* Title row */}
            <div className="flex items-center gap-2">
              <span className="text-sm">{style.icon}</span>
              <span className={`text-sm font-medium ${style.text}`}>
                {anomaly.title}
              </span>
            </div>

            {/* Description */}
            <p className="text-xs text-zinc-400 leading-relaxed">
              {anomaly.description}
            </p>

            {/* Metric */}
            {anomaly.metric_value !== null && anomaly.metric_threshold !== null && (
              <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono">
                <span>
                  Measured: {anomaly.metric_value.toFixed(1)}
                </span>
                <span>|</span>
                <span>
                  Threshold: {anomaly.metric_threshold.toFixed(1)}
                </span>
              </div>
            )}

            {/* Action buttons row */}
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
              {/* Navigate to issue */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigateToAnomaly(anomaly);
                }}
                className="text-xs font-medium px-2 py-1 rounded transition-colors border border-zinc-600 text-zinc-300 hover:bg-zinc-700"
              >
                📍 Show
              </button>

              {/* Fix options — show all fixes from anomaly.fixes if present, else fall back to single fix */}
              {(anomaly.fixes && anomaly.fixes.length > 0 ? anomaly.fixes : anomaly.fix.action !== "no_action" ? [anomaly.fix] : []).map((fix, fixIdx) => {
                if (fix.action === "no_action") return null;
                const labels: Record<string, string> = {
                  remove_waypoint: "Remove waypoint",
                  add_waypoint: "Add waypoint",
                  move_waypoint: "Move waypoint",
                  reorder_waypoints: "Reorder",
                };
                return (
                  <button
                    key={fixIdx}
                    onClick={(e) => {
                      e.stopPropagation();
                      // Apply this specific fix
                      onApplyFix({ ...anomaly, fix });
                    }}
                    className={`text-xs font-medium px-2 py-1 rounded transition-colors border ${style.border} ${style.text} hover:bg-white/5`}
                    title={fix.description}
                  >
                    {labels[fix.action] || fix.action}
                  </button>
                );
              })}
            </div>

            {/* No-action hint (when only fix is no_action) */}
            {(!anomaly.fixes || anomaly.fixes.length === 0) && anomaly.fix.action === "no_action" && (
              <p className="text-[10px] text-zinc-600 italic">
                {anomaly.fix.description}
              </p>
            )}
          </div>
        );
      })}

      {/* Analysis time */}
      {analysis.analysis_time_ms > 0 && (
        <p className="text-[10px] text-zinc-600 text-right">
          Analysed in {analysis.analysis_time_ms}ms
        </p>
      )}
    </div>
  );
}
