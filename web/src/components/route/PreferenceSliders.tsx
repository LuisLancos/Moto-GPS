"use client";

import type { RoutePreferences } from "@/lib/types";

interface PreferenceSlidersProps {
  preferences: RoutePreferences;
  onChange: (prefs: RoutePreferences) => void;
}

function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.05,
  suffix = "",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="text-secondary font-mono">
          {(value * 100).toFixed(0)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none bg-surface-hover accent-blue-500 cursor-pointer"
      />
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-xs text-muted">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`
          relative w-9 h-5 rounded-full transition-colors
          ${checked ? "bg-blue-600" : "bg-surface-hover"}
        `}
      >
        <span
          className={`
            absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform
            ${checked ? "translate-x-4" : "translate-x-0"}
          `}
        />
      </button>
    </label>
  );
}

export function PreferenceSliders({
  preferences,
  onChange,
}: PreferenceSlidersProps) {
  const update = (key: keyof RoutePreferences, value: number | boolean) => {
    onChange({ ...preferences, [key]: value });
  };

  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs font-medium text-muted uppercase tracking-wider">
        Route Preferences
      </span>

      <Slider
        label="Scenic roads"
        value={preferences.scenic_weight}
        onChange={(v) => update("scenic_weight", v)}
      />

      <Slider
        label="Curvy roads"
        value={preferences.curvature_weight}
        onChange={(v) => update("curvature_weight", v)}
      />

      <Slider
        label="Surface quality"
        value={preferences.surface_weight}
        onChange={(v) => update("surface_weight", v)}
      />

      <Slider
        label="Hills & elevation"
        value={preferences.elevation_weight}
        onChange={(v) => update("elevation_weight", v)}
      />

      <Slider
        label="Avoid urban"
        value={preferences.urban_avoidance_weight}
        onChange={(v) => update("urban_avoidance_weight", v)}
      />

      <Slider
        label="Max detour"
        value={preferences.max_detour_factor}
        onChange={(v) => update("max_detour_factor", v)}
        min={1}
        max={3}
        step={0.1}
        suffix="x"
      />

      <div className="border-t border-border pt-2 flex flex-col gap-2">
        <Toggle
          label="Avoid motorways"
          checked={preferences.avoid_motorways}
          onChange={(v) => update("avoid_motorways", v)}
        />
        <Toggle
          label="Avoid dual carriageways"
          checked={preferences.avoid_dual_carriageways}
          onChange={(v) => update("avoid_dual_carriageways", v)}
        />
      </div>
    </div>
  );
}
