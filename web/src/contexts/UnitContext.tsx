"use client";

import { createContext, useContext, useCallback, useState, useEffect, type ReactNode } from "react";

export type UnitSystem = "miles" | "km";

interface UnitContextValue {
  units: UnitSystem;
  setUnits: (u: UnitSystem) => void;
  /** Format meters to the user's preferred unit */
  formatDist: (meters: number | null | undefined) => string;
  /** Format meters for maneuver-level distances (shorter format) */
  formatShortDist: (km: number) => string;
  /** Unit label: "km" or "mi" */
  unitLabel: string;
  /** Speed label: "km/h" or "mph" */
  speedLabel: string;
}

const UnitContext = createContext<UnitContextValue>({
  units: "miles",
  setUnits: () => {},
  formatDist: () => "—",
  formatShortDist: () => "",
  unitLabel: "mi",
  speedLabel: "mph",
});

export function useUnits() {
  return useContext(UnitContext);
}

const MI_PER_M = 1 / 1609.344;
const KM_PER_M = 1 / 1000;

export function UnitProvider({
  initial = "miles",
  children,
}: {
  initial?: UnitSystem;
  children: ReactNode;
}) {
  const [units, setUnits] = useState<UnitSystem>(initial);

  // Sync from initial prop (when user prefs load async)
  useEffect(() => {
    setUnits(initial);
  }, [initial]);

  const formatDist = useCallback(
    (meters: number | null | undefined): string => {
      if (!meters) return "—";
      if (units === "miles") {
        const mi = meters * MI_PER_M;
        if (mi >= 100) return `${Math.round(mi)} mi`;
        if (mi >= 10) return `${Math.round(mi)} mi`;
        return `${mi.toFixed(1)} mi`;
      } else {
        const km = meters * KM_PER_M;
        if (km >= 100) return `${Math.round(km)} km`;
        if (km >= 10) return `${Math.round(km)} km`;
        return `${km.toFixed(1)} km`;
      }
    },
    [units],
  );

  const formatShortDist = useCallback(
    (km: number): string => {
      if (km < 0.1) return "";
      if (units === "miles") {
        const mi = km * 0.621371;
        if (mi < 0.1) return "";
        if (mi < 1) return `${(mi * 5280).toFixed(0)} ft`;
        return mi >= 10 ? `${Math.round(mi)} mi` : `${mi.toFixed(1)} mi`;
      } else {
        if (km < 1) return `${(km * 1000).toFixed(0)}m`;
        return km >= 10 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`;
      }
    },
    [units],
  );

  return (
    <UnitContext.Provider
      value={{
        units,
        setUnits,
        formatDist,
        formatShortDist,
        unitLabel: units === "miles" ? "mi" : "km",
        speedLabel: units === "miles" ? "mph" : "km/h",
      }}
    >
      {children}
    </UnitContext.Provider>
  );
}
