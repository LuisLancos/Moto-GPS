/**
 * Auth-aware fetch wrapper and authentication API functions.
 *
 * All API calls that need auth should use authFetch() instead of raw fetch().
 * Token is stored in localStorage under "motogps_token".
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ---------- Token management ----------

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("motogps_token");
}

export function setToken(token: string): void {
  localStorage.setItem("motogps_token", token);
}

export function clearToken(): void {
  localStorage.removeItem("motogps_token");
}

// ---------- Auth-aware fetch ----------

export async function authFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // Don't set Content-Type for FormData (browser sets multipart boundary)
  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  return fetch(`${API_URL}${path}`, { ...options, headers });
}

// ---------- Auth API functions ----------

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  is_admin: boolean;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export async function login(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Login failed" }));
    throw new Error(err.detail || "Login failed");
  }
  const data: AuthResponse = await res.json();
  setToken(data.token);
  return data;
}

export async function register(
  code: string,
  name: string,
  email: string,
  password: string,
): Promise<AuthResponse> {
  const res = await fetch(`${API_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name, email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Registration failed" }));
    throw new Error(err.detail || "Registration failed");
  }
  const data: AuthResponse = await res.json();
  setToken(data.token);
  return data;
}

export async function getMe(): Promise<AuthUser> {
  const res = await authFetch("/api/auth/me");
  if (!res.ok) {
    clearToken();
    throw new Error("Not authenticated");
  }
  return res.json();
}

export async function updateProfile(data: {
  name?: string;
  email?: string;
}): Promise<void> {
  const res = await authFetch("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Update failed" }));
    throw new Error(err.detail || "Update failed");
  }
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const res = await authFetch("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Password change failed" }));
    throw new Error(err.detail || "Password change failed");
  }
}

// ---------- Pending invitations count ----------

export async function getPendingInvitationsCount(): Promise<number> {
  const res = await authFetch("/api/invitations");
  if (!res.ok) return 0;
  const data = await res.json();
  return Array.isArray(data) ? data.length : 0;
}
