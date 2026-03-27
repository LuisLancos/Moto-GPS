/**
 * Admin API functions — user management and invite code generation.
 */

import { authFetch } from "./authApi";

// ---------- Types ----------

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  is_admin: boolean;
  is_blocked: boolean;
  created_at: string | null;
}

export interface InviteCode {
  id: string;
  code: string;
  created_by_name: string;
  used_by_name: string | null;
  used_at: string | null;
  expires_at: string | null;
  created_at: string | null;
  status: "available" | "used" | "expired";
}

// ---------- User management ----------

export async function listUsers(): Promise<AdminUser[]> {
  const res = await authFetch("/api/admin/users");
  if (!res.ok) throw new Error("Failed to load users");
  return res.json();
}

export async function deleteUser(id: string): Promise<void> {
  const res = await authFetch(`/api/admin/users/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Delete failed" }));
    throw new Error(err.detail || "Delete failed");
  }
}

export async function blockUser(
  id: string,
  blocked: boolean,
): Promise<void> {
  const res = await authFetch(`/api/admin/users/${id}/block`, {
    method: "PATCH",
    body: JSON.stringify({ blocked }),
  });
  if (!res.ok) throw new Error("Failed to update user");
}

export async function setUserAdmin(
  id: string,
  isAdmin: boolean,
): Promise<void> {
  const res = await authFetch(`/api/admin/users/${id}/admin`, {
    method: "PATCH",
    body: JSON.stringify({ is_admin: isAdmin }),
  });
  if (!res.ok) throw new Error("Failed to update user");
}

// ---------- Invite codes ----------

export async function listInviteCodes(): Promise<InviteCode[]> {
  const res = await authFetch("/api/admin/invite-codes");
  if (!res.ok) throw new Error("Failed to load invite codes");
  return res.json();
}

export async function generateInviteCode(
  expiresInDays?: number,
): Promise<{ code: string; id: string }> {
  const body = expiresInDays
    ? JSON.stringify({ expires_in_days: expiresInDays })
    : "{}";
  const res = await authFetch("/api/admin/invite-codes", {
    method: "POST",
    body,
  });
  if (!res.ok) throw new Error("Failed to generate code");
  return res.json();
}

export async function deleteInviteCode(id: string): Promise<void> {
  const res = await authFetch(`/api/admin/invite-codes/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Delete failed" }));
    throw new Error(err.detail || "Delete failed");
  }
}
