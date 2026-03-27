"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthContext } from "@/components/auth/AuthProvider";
import {
  listUsers,
  deleteUser,
  blockUser,
  setUserAdmin,
  listInviteCodes,
  generateInviteCode,
  deleteInviteCode,
  type AdminUser,
  type InviteCode,
} from "@/lib/adminApi";
import { formatDate } from "@/lib/formatters";
import { TopNav } from "@/components/nav/TopNav";
import Link from "next/link";

export default function AdminPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuthContext();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingCodes, setLoadingCodes] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  // Auth gate — admin only
  useEffect(() => {
    if (!authLoading && (!user || !user.is_admin)) {
      router.push("/");
    }
  }, [authLoading, user, router]);

  // Auto-clear feedback
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [feedback]);

  const refreshUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      setUsers(await listUsers());
    } catch (err) {
      setFeedback({ type: "error", msg: err instanceof Error ? err.message : "Failed to load users" });
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  const refreshCodes = useCallback(async () => {
    setLoadingCodes(true);
    try {
      setCodes(await listInviteCodes());
    } catch (err) {
      setFeedback({ type: "error", msg: err instanceof Error ? err.message : "Failed to load invite codes" });
    } finally {
      setLoadingCodes(false);
    }
  }, []);

  useEffect(() => {
    if (user?.is_admin) {
      refreshUsers();
      refreshCodes();
    }
  }, [user, refreshUsers, refreshCodes]);

  const handleDelete = async (id: string) => {
    try {
      await deleteUser(id);
      setConfirmDelete(null);
      setFeedback({ type: "success", msg: "User deleted" });
      refreshUsers();
    } catch (err) {
      setFeedback({ type: "error", msg: err instanceof Error ? err.message : "Delete failed" });
    }
  };

  const handleBlock = async (id: string, blocked: boolean) => {
    try {
      await blockUser(id, blocked);
      setFeedback({ type: "success", msg: blocked ? "User blocked" : "User unblocked" });
      refreshUsers();
    } catch (err) {
      setFeedback({ type: "error", msg: err instanceof Error ? err.message : "Failed to update user" });
    }
  };

  const handleToggleAdmin = async (id: string, isAdmin: boolean) => {
    try {
      await setUserAdmin(id, isAdmin);
      setFeedback({ type: "success", msg: isAdmin ? "User promoted to admin" : "Admin demoted" });
      refreshUsers();
    } catch (err) {
      setFeedback({ type: "error", msg: err instanceof Error ? err.message : "Failed to update user" });
    }
  };

  const handleGenerateCode = async () => {
    try {
      const result = await generateInviteCode();
      setFeedback({ type: "success", msg: `Code generated: ${result.code}` });
      refreshCodes();
    } catch (err) {
      setFeedback({ type: "error", msg: err instanceof Error ? err.message : "Failed to generate code" });
    }
  };

  const handleDeleteCode = async (id: string) => {
    try {
      await deleteInviteCode(id);
      setFeedback({ type: "success", msg: "Invite code deleted" });
      refreshCodes();
    } catch (err) {
      setFeedback({ type: "error", msg: err instanceof Error ? err.message : "Delete failed" });
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setFeedback({ type: "success", msg: "Code copied to clipboard" });
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const copyInviteLink = (code: string) => {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    const link = `${baseUrl}/register?code=${encodeURIComponent(code)}`;
    navigator.clipboard.writeText(link);
    setCopiedCode(code);
    setFeedback({ type: "success", msg: "Registration link copied!" });
    setTimeout(() => setCopiedCode(null), 2000);
  };

  if (authLoading || !user?.is_admin) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <div className="text-zinc-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <TopNav />

      <div className="max-w-5xl mx-auto p-6 flex flex-col gap-8">
        {/* Feedback banner */}
        {feedback && (
          <div
            className={`px-4 py-2.5 rounded-md text-sm font-medium ${
              feedback.type === "success"
                ? "bg-green-900/40 text-green-300 border border-green-800/50"
                : "bg-red-900/40 text-red-300 border border-red-800/50"
            }`}
          >
            {feedback.msg}
          </div>
        )}

        {/* ===== Invite Codes ===== */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-zinc-200">
              Invite Codes
            </h2>
            <button
              onClick={handleGenerateCode}
              className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-3 py-1.5 rounded-md transition-colors"
            >
              + Generate Code
            </button>
          </div>

          {loadingCodes ? (
            <p className="text-xs text-zinc-500">Loading...</p>
          ) : codes.length === 0 ? (
            <p className="text-xs text-zinc-500">No invite codes yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500 text-left">
                    <th className="py-2 pr-4">Code</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Created By</th>
                    <th className="py-2 pr-4">Used By</th>
                    <th className="py-2 pr-4">Created</th>
                    <th className="py-2 pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-zinc-800/50 hover:bg-zinc-900/50"
                    >
                      <td className="py-2 pr-4">
                        <span className="font-mono text-zinc-200 bg-zinc-800 px-2 py-0.5 rounded">
                          {c.code}
                        </span>
                      </td>
                      <td className="py-2 pr-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                            c.status === "available"
                              ? "bg-green-900/50 text-green-400"
                              : c.status === "used"
                                ? "bg-zinc-800 text-zinc-500"
                                : "bg-red-900/50 text-red-400"
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-zinc-400">
                        {c.created_by_name}
                      </td>
                      <td className="py-2 pr-4 text-zinc-400">
                        {c.used_by_name || "—"}
                      </td>
                      <td className="py-2 pr-4 text-zinc-500">
                        {c.created_at ? formatDate(c.created_at) : "—"}
                      </td>
                      <td className="py-2 pr-4">
                        {c.status === "available" ? (
                          <div className="flex gap-2">
                            <button
                              onClick={() => copyCode(c.code)}
                              className="text-zinc-400 hover:text-zinc-200 transition-colors"
                              title="Copy code"
                            >
                              {copiedCode === c.code ? "✓" : "📋"}
                            </button>
                            <button
                              onClick={() => copyInviteLink(c.code)}
                              className="text-blue-400/70 hover:text-blue-300 transition-colors"
                              title="Copy registration link"
                            >
                              🔗
                            </button>
                            <button
                              onClick={() => handleDeleteCode(c.id)}
                              className="text-red-400/50 hover:text-red-400 transition-colors"
                              title="Delete code"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ===== Users ===== */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-zinc-200">
              Users ({users.length})
            </h2>
            <button
              onClick={refreshUsers}
              className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Refresh
            </button>
          </div>

          {loadingUsers ? (
            <p className="text-xs text-zinc-500">Loading...</p>
          ) : users.length === 0 ? (
            <p className="text-xs text-zinc-500">No users yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500 text-left">
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Email</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Role</th>
                    <th className="py-2 pr-4">Created</th>
                    <th className="py-2 pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      className="border-b border-zinc-800/50 hover:bg-zinc-900/50"
                    >
                      <td className="py-2 pr-4 text-zinc-200">{u.name}</td>
                      <td className="py-2 pr-4 text-zinc-400">{u.email}</td>
                      <td className="py-2 pr-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                            u.is_blocked
                              ? "bg-red-900/50 text-red-400"
                              : "bg-green-900/50 text-green-400"
                          }`}
                        >
                          {u.is_blocked ? "Blocked" : "Active"}
                        </span>
                      </td>
                      <td className="py-2 pr-4">
                        {u.is_admin && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-900/50 text-amber-400">
                            Admin
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-zinc-500">
                        {u.created_at ? formatDate(u.created_at) : "—"}
                      </td>
                      <td className="py-2 pr-4">
                        {u.id !== user.id && (
                          <div className="flex gap-2">
                            <button
                              onClick={() =>
                                handleBlock(u.id, !u.is_blocked)
                              }
                              className="text-zinc-400 hover:text-zinc-200 transition-colors"
                              title={
                                u.is_blocked ? "Unblock" : "Block"
                              }
                            >
                              {u.is_blocked ? "Unblock" : "Block"}
                            </button>
                            <button
                              onClick={() =>
                                handleToggleAdmin(u.id, !u.is_admin)
                              }
                              className="text-zinc-400 hover:text-zinc-200 transition-colors"
                              title={
                                u.is_admin ? "Demote" : "Promote"
                              }
                            >
                              {u.is_admin ? "Demote" : "Promote"}
                            </button>
                            {confirmDelete === u.id ? (
                              <span className="flex gap-1">
                                <button
                                  onClick={() => handleDelete(u.id)}
                                  className="text-red-400 hover:text-red-300"
                                >
                                  Confirm
                                </button>
                                <button
                                  onClick={() => setConfirmDelete(null)}
                                  className="text-zinc-500"
                                >
                                  Cancel
                                </button>
                              </span>
                            ) : (
                              <button
                                onClick={() => setConfirmDelete(u.id)}
                                className="text-red-400/60 hover:text-red-400 transition-colors"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
