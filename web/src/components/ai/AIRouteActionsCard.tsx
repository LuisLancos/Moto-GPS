"use client";

import type { RouteAction } from "@/lib/types";

interface AIRouteActionsCardProps {
  actions: RouteAction[];
  onApply: () => void;
  onDismiss: () => void;
}

const ACTION_ICON: Record<RouteAction["type"], string> = {
  remove_waypoint: "\u2702\uFE0F",
  add_waypoint: "\uD83D\uDCCD",
  move_waypoint: "\u2197\uFE0F",
  recalculate: "\uD83D\uDD04",
};

const ACTION_LABEL: Record<RouteAction["type"], string> = {
  remove_waypoint: "Remove",
  add_waypoint: "Add",
  move_waypoint: "Move",
  recalculate: "Recalculate",
};

function formatAction(action: RouteAction): string {
  switch (action.type) {
    case "remove_waypoint":
      return action.index != null
        ? `Remove waypoint ${action.index + 1} \u2014 ${action.reason}`
        : `Remove waypoint \u2014 ${action.reason}`;
    case "add_waypoint":
      return action.label
        ? `Add: ${action.label} \u2014 ${action.reason}`
        : `Add waypoint \u2014 ${action.reason}`;
    case "move_waypoint":
      return action.index != null
        ? `Move waypoint ${action.index + 1} \u2014 ${action.reason}`
        : `Move waypoint \u2014 ${action.reason}`;
    case "recalculate":
      return `Recalculate route \u2014 ${action.reason}`;
    default:
      return action.reason;
  }
}

export function AIRouteActionsCard({ actions, onApply, onDismiss }: AIRouteActionsCardProps) {
  if (actions.length === 0) return null;

  return (
    <div className="border border-amber-700/50 bg-amber-950/20 rounded-lg p-3 flex flex-col gap-2">
      <h4 className="text-[10px] font-medium text-amber-300 uppercase tracking-wider">
        {"\uD83D\uDD27"} Route Changes ({actions.length} {actions.length === 1 ? "action" : "actions"})
      </h4>

      <div className="flex flex-col gap-1">
        {actions.map((action, i) => (
          <div key={i} className="flex items-start gap-2 text-xs text-secondary">
            <span className="shrink-0 mt-0.5">{ACTION_ICON[action.type]}</span>
            <span className="leading-relaxed">{formatAction(action)}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onApply}
          className="bg-amber-700 hover:bg-amber-600 text-white text-xs font-medium px-3 py-1.5 rounded-md transition-colors"
        >
          Apply All
        </button>
        <button
          onClick={onDismiss}
          className="text-xs text-muted hover:text-secondary transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
