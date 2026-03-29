"use client";

import { AuthProvider, useAuthContext } from "./AuthProvider";
import { UnitProvider, type UnitSystem } from "@/contexts/UnitContext";
import { ThemeProvider } from "@/contexts/ThemeContext";

function UnitProviderWithAuth({ children }: { children: React.ReactNode }) {
  const auth = useAuthContext();
  const units: UnitSystem = (auth.user?.preferences?.units as UnitSystem) || "miles";
  return <UnitProvider initial={units}>{children}</UnitProvider>;
}

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <UnitProviderWithAuth>{children}</UnitProviderWithAuth>
      </AuthProvider>
    </ThemeProvider>
  );
}
