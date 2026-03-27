"use client";

import type { RouteType, RoutePreferences } from "@/lib/types";
import { ROUTE_TYPE_META, ROUTE_TYPE_PRESETS } from "@/lib/types";
import { PreferenceSliders } from "./PreferenceSliders";

const PRESET_TYPES: Exclude<RouteType, "custom">[] = [
  "scenic",
  "balanced",
  "fast",
];

const WEIGHT_LABELS: { key: keyof RoutePreferences; label: string; icon: string }[] = [
  { key: "scenic_weight", label: "Scenic", icon: "🌄" },
  { key: "curvature_weight", label: "Curvy roads", icon: "🛤️" },
  { key: "surface_weight", label: "Surface quality", icon: "🛣️" },
  { key: "elevation_weight", label: "Hills & elevation", icon: "⛰️" },
  { key: "urban_avoidance_weight", label: "Avoid urban", icon: "🏘️" },
];

interface RouteTypeSelectorProps {
  routeType: RouteType;
  preferences: RoutePreferences;
  onRouteTypeChange: (type: RouteType) => void;
  onCustomPreferencesChange: (prefs: RoutePreferences) => void;
}

export function RouteTypeSelector({
  routeType,
  preferences,
  onRouteTypeChange,
  onCustomPreferencesChange,
}: RouteTypeSelectorProps) {
  const isPreset = routeType !== "custom";
  const preset = isPreset
    ? ROUTE_TYPE_PRESETS[routeType as Exclude<RouteType, "custom">]
    : null;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
        Route Type
      </span>

      {/* Type buttons */}
      <div className="grid grid-cols-4 gap-1.5">
        {[...PRESET_TYPES, "custom" as RouteType].map((type) => {
          const meta = ROUTE_TYPE_META[type];
          const selected = type === routeType;
          return (
            <button
              key={type}
              onClick={() => onRouteTypeChange(type)}
              className={`
                flex flex-col items-center gap-0.5 rounded-lg px-1.5 py-2 text-center transition-all border
                ${
                  selected
                    ? "bg-blue-950/60 border-blue-500 text-blue-300"
                    : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300"
                }
              `}
            >
              <span className="text-base">{meta.icon}</span>
              <span className="text-[11px] font-semibold">{meta.label}</span>
            </button>
          );
        })}
      </div>

      {/* Preset details — shown automatically when a preset is selected */}
      {isPreset && preset && (
        <div className="bg-zinc-800/50 rounded-lg px-3 py-2.5 flex flex-col gap-2 border border-zinc-700/50">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-zinc-400 font-semibold">
              {ROUTE_TYPE_META[routeType].icon} {ROUTE_TYPE_META[routeType].label} settings
            </span>
            <span className="text-[10px] text-zinc-600">
              Select Custom to edit
            </span>
          </div>

          {/* Weight bars */}
          <div className="flex flex-col gap-1.5">
            {WEIGHT_LABELS.map(({ key, label, icon }) => {
              const val = preset[key] as number;
              const pct = Math.round(val * 100);
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-xs w-4 text-center">{icon}</span>
                  <span className="text-[11px] text-zinc-400 w-24 shrink-0">
                    {label}
                  </span>
                  <div className="flex-1 h-1.5 bg-zinc-700/50 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500/70 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-zinc-300 font-mono w-8 text-right">
                    {pct}%
                  </span>
                </div>
              );
            })}
          </div>

          {/* Flags */}
          <div className="flex flex-wrap gap-2 pt-1 border-t border-zinc-700/40">
            <FlagBadge
              active={preset.avoid_motorways}
              activeLabel="No motorways"
              inactiveLabel="Motorways OK"
            />
            <FlagBadge
              active={preset.avoid_dual_carriageways}
              activeLabel="No dual c/ways"
              inactiveLabel="Dual c/ways OK"
            />
            <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/40 text-zinc-400">
              Max detour: {preset.max_detour_factor}x
            </span>
          </div>
        </div>
      )}

      {/* Custom: full preference sliders */}
      {routeType === "custom" && (
        <PreferenceSliders
          preferences={preferences}
          onChange={onCustomPreferencesChange}
        />
      )}
    </div>
  );
}

function FlagBadge({
  active,
  activeLabel,
  inactiveLabel,
}: {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${
        active
          ? "bg-green-900/30 text-green-400 border border-green-800/40"
          : "bg-zinc-700/40 text-zinc-500"
      }`}
    >
      <span>{active ? "✓" : "✗"}</span>
      {active ? activeLabel : inactiveLabel}
    </span>
  );
}
