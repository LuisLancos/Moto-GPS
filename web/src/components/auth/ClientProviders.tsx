"use client";

import { AuthProvider } from "./AuthProvider";

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
