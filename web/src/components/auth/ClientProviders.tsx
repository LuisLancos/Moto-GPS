"use client";

import { AuthProvider, useAuthContext } from "./AuthProvider";
import { UnitProvider, type UnitSystem } from "@/contexts/UnitContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { WalkthroughProvider } from "@/contexts/WalkthroughContext";

function UnitProviderWithAuth({ children }: { children: React.ReactNode }) {
  const auth = useAuthContext();
  const units: UnitSystem = (auth.user?.preferences?.units as UnitSystem) || "miles";
  return <UnitProvider initial={units}>{children}</UnitProvider>;
}

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <WalkthroughProvider>
          <UnitProviderWithAuth>{children}</UnitProviderWithAuth>
        </WalkthroughProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
