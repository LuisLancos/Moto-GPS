"use client";

import { useState, useEffect, useCallback } from "react";
import type { AuthUser } from "@/lib/authApi";
import {
  login as apiLogin,
  register as apiRegister,
  getMe,
  clearToken,
  getToken,
  getPendingInvitationsCount,
} from "@/lib/authApi";

export interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  pendingInvitations: number;
  login: (email: string, password: string) => Promise<void>;
  register: (
    code: string,
    name: string,
    email: string,
    password: string,
  ) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingInvitations, setPendingInvitations] = useState(0);

  // On mount: validate stored token
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    getMe()
      .then((u) => {
        setUser(u);
        // Fetch invitation count in background
        getPendingInvitationsCount().then(setPendingInvitations).catch(() => {});
      })
      .catch(() => {
        clearToken();
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const resp = await apiLogin(email, password);
    setUser(resp.user);
    // Fetch invitation count
    getPendingInvitationsCount().then(setPendingInvitations).catch(() => {});
  }, []);

  const register = useCallback(
    async (
      code: string,
      name: string,
      email: string,
      password: string,
    ) => {
      const resp = await apiRegister(code, name, email, password);
      setUser(resp.user);
    },
    [],
  );

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setPendingInvitations(0);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const u = await getMe();
      setUser(u);
      const count = await getPendingInvitationsCount();
      setPendingInvitations(count);
    } catch {
      clearToken();
      setUser(null);
    }
  }, []);

  return {
    user,
    loading,
    pendingInvitations,
    login,
    register,
    logout,
    refreshUser,
  };
}
