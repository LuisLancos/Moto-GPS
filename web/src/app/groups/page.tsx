"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthContext } from "@/components/auth/AuthProvider";
import { authFetch } from "@/lib/authApi";
import { formatDate, formatDistance } from "@/lib/formatters";
import { TopNav } from "@/components/nav/TopNav";

// ---------- Types ----------

interface Group {
  id: string;
  name: string;
  description: string | null;
  target_date: string | null;
  duration_days: number | null;
  member_count: number;
  shared_item_count: number;
  my_role: "owner" | "editor" | "viewer";
  created_at: string;
}

interface GroupDetail extends Group {
  members: { user_id: string; name: string; email: string; role: string; joined_at: string }[];
  shared_items: {
    id: string; item_type: string; item_id: string;
    shared_by_name: string; item_name: string; item_distance_m: number | null; shared_at: string;
  }[];
  pending_invitations?: { id: string; invited_user_name: string; role: string; created_at: string }[];
}

interface Invitation {
  id: string; group_id: string; group_name: string;
  invited_by_name: string; role: string; created_at: string;
}

interface SearchUser {
  id: string; name: string; email: string;
}

export default function GroupsPage() {
  const router = useRouter();
  const { user, loading: authLoading, refreshUser } = useAuthContext();

  const [groups, setGroups] = useState<Group[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  // Create group form
  const [showCreate, setShowCreate] = useState(false);
  const [gName, setGName] = useState("");
  const [gDesc, setGDesc] = useState("");
  const [gDate, setGDate] = useState("");
  const [gDuration, setGDuration] = useState("");
  const [creating, setCreating] = useState(false);

  // Invite form
  const [showInvite, setShowInvite] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [inviteRole, setInviteRole] = useState("editor");
  const [inviting, setInviting] = useState(false);

  // Auth gate
  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [authLoading, user, router]);

  // Auto-clear feedback
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [feedback]);

  // Load groups and invitations
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [g, inv] = await Promise.all([
        authFetch("/api/groups").then((r) => (r.ok ? r.json() : [])),
        authFetch("/api/invitations").then((r) => (r.ok ? r.json() : [])),
      ]);
      setGroups(g);
      setInvitations(inv);
    } catch {
      setFeedback({ type: "error", msg: "Failed to load groups" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) loadData();
  }, [user, loadData]);

  // Load group detail
  const loadGroupDetail = async (id: string) => {
    try {
      const res = await authFetch(`/api/groups/${id}`);
      if (res.ok) {
        setSelectedGroup(await res.json());
      } else {
        setFeedback({ type: "error", msg: "Failed to load group details" });
      }
    } catch {
      setFeedback({ type: "error", msg: "Failed to load group details" });
    }
  };

  // Create group
  const handleCreate = async () => {
    if (!gName.trim()) return;
    setCreating(true);
    try {
      const res = await authFetch("/api/groups", {
        method: "POST",
        body: JSON.stringify({
          name: gName.trim(),
          description: gDesc.trim() || null,
          target_date: gDate || null,
          duration_days: gDuration ? parseInt(gDuration) : null,
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        setGName("");
        setGDesc("");
        setGDate("");
        setGDuration("");
        setFeedback({ type: "success", msg: "Group created!" });
        loadData();
      } else {
        const err = await res.json().catch(() => ({ detail: "Failed to create group" }));
        setFeedback({ type: "error", msg: err.detail || "Failed to create group" });
      }
    } catch {
      setFeedback({ type: "error", msg: "Failed to create group" });
    } finally {
      setCreating(false);
    }
  };

  // Accept/decline invitation
  const handleInvitation = async (id: string, action: "accept" | "decline") => {
    try {
      const res = await authFetch(`/api/invitations/${id}/${action}`, { method: "POST" });
      if (res.ok) {
        setFeedback({ type: "success", msg: action === "accept" ? "Invitation accepted!" : "Invitation declined" });
      } else {
        const err = await res.json().catch(() => ({ detail: "Failed" }));
        setFeedback({ type: "error", msg: err.detail || "Failed" });
      }
    } catch {
      setFeedback({ type: "error", msg: "Failed to respond to invitation" });
    }
    loadData();
    refreshUser();
  };

  // User search for invite
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await authFetch(`/api/users/search?q=${encodeURIComponent(searchQuery)}`);
        if (res.ok) setSearchResults(await res.json());
      } catch {
        // ignore search errors
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleInviteUser = async (userId: string) => {
    if (!selectedGroup) return;
    setInviting(true);
    try {
      const res = await authFetch(`/api/groups/${selectedGroup.id}/invite`, {
        method: "POST",
        body: JSON.stringify({ user_id: userId, role: inviteRole }),
      });
      if (res.ok) {
        setFeedback({ type: "success", msg: "Invitation sent!" });
        setSearchQuery("");
        setSearchResults([]);
        loadGroupDetail(selectedGroup.id);
      } else {
        const err = await res.json().catch(() => ({ detail: "Invite failed" }));
        setFeedback({ type: "error", msg: err.detail || "Invite failed" });
      }
    } catch {
      setFeedback({ type: "error", msg: "Failed to send invitation" });
    } finally {
      setInviting(false);
    }
  };

  // Change member role
  const handleChangeRole = async (memberId: string, newRole: string) => {
    if (!selectedGroup) return;
    try {
      const res = await authFetch(`/api/groups/${selectedGroup.id}/members/${memberId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        setFeedback({ type: "success", msg: "Role updated" });
        loadGroupDetail(selectedGroup.id);
      } else {
        const err = await res.json().catch(() => ({ detail: "Failed" }));
        setFeedback({ type: "error", msg: err.detail || "Failed to change role" });
      }
    } catch {
      setFeedback({ type: "error", msg: "Failed to change role" });
    }
  };

  // Remove member
  const handleRemoveMember = async (memberId: string) => {
    if (!selectedGroup) return;
    try {
      const res = await authFetch(`/api/groups/${selectedGroup.id}/members/${memberId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setFeedback({ type: "success", msg: "Member removed" });
        loadGroupDetail(selectedGroup.id);
      } else {
        const err = await res.json().catch(() => ({ detail: "Failed" }));
        setFeedback({ type: "error", msg: err.detail || "Failed to remove member" });
      }
    } catch {
      setFeedback({ type: "error", msg: "Failed to remove member" });
    }
  };

  // Delete group
  const handleDeleteGroup = async (id: string) => {
    try {
      const res = await authFetch(`/api/groups/${id}`, { method: "DELETE" });
      if (res.ok) {
        setFeedback({ type: "success", msg: "Group deleted" });
        setSelectedGroup(null);
        loadData();
      } else {
        const err = await res.json().catch(() => ({ detail: "Failed" }));
        setFeedback({ type: "error", msg: err.detail || "Failed to delete group" });
      }
    } catch {
      setFeedback({ type: "error", msg: "Failed to delete group" });
    }
  };

  // Clone shared item
  const handleClone = async (sharedItemId: string) => {
    if (!selectedGroup) return;
    try {
      const res = await authFetch(`/api/groups/${selectedGroup.id}/shared/${sharedItemId}/clone`, {
        method: "POST",
      });
      if (res.ok) {
        setFeedback({ type: "success", msg: "Item cloned to your trips!" });
        loadData();
      } else {
        const err = await res.json().catch(() => ({ detail: "Clone failed" }));
        setFeedback({ type: "error", msg: err.detail || "Clone failed" });
      }
    } catch {
      setFeedback({ type: "error", msg: "Failed to clone item" });
    }
  };

  // Unshare
  const handleUnshare = async (sharedItemId: string) => {
    if (!selectedGroup) return;
    try {
      const res = await authFetch(`/api/groups/${selectedGroup.id}/shared/${sharedItemId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setFeedback({ type: "success", msg: "Item unshared" });
        loadGroupDetail(selectedGroup.id);
      } else {
        const err = await res.json().catch(() => ({ detail: "Unshare failed" }));
        setFeedback({ type: "error", msg: err.detail || "Failed to unshare" });
      }
    } catch {
      setFeedback({ type: "error", msg: "Failed to unshare item" });
    }
  };

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center h-screen bg-page">
        <div className="text-muted text-sm">Loading...</div>
      </div>
    );
  }

  const roleColor = (role: string) => {
    switch (role) {
      case "owner": return "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400";
      case "editor": return "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-400";
      default: return "bg-surface-alt text-muted";
    }
  };

  return (
    <div className="min-h-screen bg-page text-primary">
      <TopNav />

      <div className="max-w-4xl mx-auto p-6 flex flex-col gap-6">
        {/* Feedback banner */}
        {feedback && (
          <div
            className={`px-4 py-2.5 rounded-md text-sm font-medium ${
              feedback.type === "success"
                ? "bg-green-100 text-green-800 border border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800/50"
                : "bg-red-100 text-red-800 border border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800/50"
            }`}
          >
            {feedback.msg}
          </div>
        )}

        {/* Pending invitations */}
        {invitations.length > 0 && (
          <section className="bg-amber-900/20 border border-amber-800/50 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-amber-300 mb-3">
              Pending Invitations ({invitations.length})
            </h2>
            <div className="flex flex-col gap-2">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between bg-surface rounded-md px-3 py-2"
                >
                  <div>
                    <span className="text-sm text-secondary">{inv.group_name}</span>
                    <span className="text-xs text-muted ml-2">
                      by {inv.invited_by_name} as {inv.role}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleInvitation(inv.id, "accept")}
                      className="bg-green-700 hover:bg-green-600 text-white text-xs px-3 py-1 rounded-md"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => handleInvitation(inv.id, "decline")}
                      className="bg-surface-hover hover:bg-surface-alt text-secondary text-xs px-3 py-1 rounded-md"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">Adventure Groups</h1>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-3 py-1.5 rounded-md transition-colors"
          >
            + Create Group
          </button>
        </div>

        {/* Create form */}
        {showCreate && (
          <div className="bg-surface border border-border rounded-lg p-4 flex flex-col gap-3">
            <input
              value={gName}
              onChange={(e) => setGName(e.target.value)}
              placeholder="Group name"
              className="bg-surface-alt border border-border rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-border-focus"
            />
            <textarea
              value={gDesc}
              onChange={(e) => setGDesc(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              className="bg-surface-alt border border-border rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-border-focus resize-none"
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted">Target Date</label>
                <input
                  type="date"
                  value={gDate}
                  onChange={(e) => setGDate(e.target.value)}
                  className="bg-surface-alt border border-border rounded-md px-3 py-2 text-sm text-primary focus:outline-none focus:border-border-focus"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted">Duration (days)</label>
                <input
                  type="number"
                  value={gDuration}
                  onChange={(e) => setGDuration(e.target.value)}
                  placeholder="e.g. 3"
                  className="bg-surface-alt border border-border rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-border-focus"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={creating || !gName.trim()}
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-surface-hover text-white text-xs font-medium px-4 py-2 rounded-md"
              >
                {creating ? "Creating..." : "Create Group"}
              </button>
              <button onClick={() => setShowCreate(false)} className="text-xs text-muted hover:text-secondary">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Groups list */}
        {loading ? (
          <p className="text-xs text-muted">Loading groups...</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted">No groups yet. Create one or wait for an invitation.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => loadGroupDetail(g.id)}
                className={`text-left bg-surface border rounded-lg p-4 transition-colors hover:border-surface-hover ${
                  selectedGroup?.id === g.id ? "border-blue-600" : "border-border"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-secondary">{g.name}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${roleColor(g.my_role)}`}>
                    {g.my_role}
                  </span>
                </div>
                {g.description && (
                  <p className="text-xs text-muted truncate">{g.description}</p>
                )}
                <div className="flex gap-3 mt-2 text-[11px] text-muted">
                  <span>👥 {g.member_count}</span>
                  {g.shared_item_count > 0 && (
                    <span className="text-indigo-400/80">{g.shared_item_count} shared</span>
                  )}
                  {g.target_date && <span>📅 {g.target_date}</span>}
                  {g.duration_days && <span>{g.duration_days} days</span>}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Group detail */}
        {selectedGroup && (
          <section className="bg-surface border border-border rounded-lg p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-secondary">{selectedGroup.name}</h2>
              <div className="flex gap-2">
                {selectedGroup.my_role === "owner" && (
                  <button
                    onClick={() => handleDeleteGroup(selectedGroup.id)}
                    className="text-xs text-red-400/60 hover:text-red-400"
                  >
                    Delete Group
                  </button>
                )}
                <button
                  onClick={() => { setSelectedGroup(null); setShowInvite(false); }}
                  className="text-xs text-muted hover:text-secondary"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Members */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-medium text-muted uppercase tracking-wider">
                  Members ({selectedGroup.members.length})
                </h3>
                {selectedGroup.my_role === "owner" && (
                  <button
                    onClick={() => setShowInvite(!showInvite)}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    {showInvite ? "Close" : "+ Invite"}
                  </button>
                )}
              </div>

              {/* Invite form */}
              {showInvite && selectedGroup.my_role === "owner" && (
                <div className="bg-surface-alt border border-border rounded-md p-3 mb-3 flex flex-col gap-2">
                  <p className="text-[11px] text-muted">
                    Search for registered users by name or email to invite them.
                  </p>
                  <div className="flex gap-2">
                    <input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search by name or email..."
                      className="flex-1 bg-surface border border-border rounded-md px-3 py-1.5 text-xs text-primary placeholder:text-muted focus:outline-none focus:border-border-focus"
                    />
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                      className="bg-surface border border-border rounded-md px-2 py-1.5 text-xs text-primary"
                    >
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </div>
                  {searchQuery.length >= 2 && searchResults.length === 0 && (
                    <p className="text-[11px] text-muted italic">
                      No users found. They need to register first (Admin &rarr; Generate Invite Code).
                    </p>
                  )}
                  {searchResults.length > 0 && (
                    <div className="flex flex-col gap-1">
                      {searchResults.map((u) => {
                        const alreadyMember = selectedGroup.members.some((m) => m.user_id === u.id);
                        return (
                          <button
                            key={u.id}
                            onClick={() => !alreadyMember && handleInviteUser(u.id)}
                            disabled={inviting || alreadyMember}
                            className={`flex items-center justify-between rounded px-3 py-1.5 text-xs ${
                              alreadyMember
                                ? "bg-surface/50 text-muted cursor-not-allowed"
                                : "bg-surface hover:bg-surface-alt text-secondary"
                            }`}
                          >
                            <span>
                              <span className={alreadyMember ? "text-muted" : "text-secondary"}>{u.name}</span>
                              <span className="text-muted ml-2">{u.email}</span>
                            </span>
                            <span className={alreadyMember ? "text-muted" : "text-blue-400"}>
                              {alreadyMember ? "Already member" : "Invite →"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-1">
                {selectedGroup.members.map((m) => (
                  <div
                    key={m.user_id}
                    className="flex items-center justify-between px-3 py-1.5 rounded bg-surface-alt/50"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-secondary">{m.name}</span>
                      <span className="text-[10px] text-muted">{m.email}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${roleColor(m.role)}`}>
                        {m.role}
                      </span>
                      {selectedGroup.my_role === "owner" && m.role !== "owner" && (
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleChangeRole(m.user_id, m.role === "editor" ? "viewer" : "editor")}
                            className="text-[10px] text-muted hover:text-secondary"
                            title={`Change to ${m.role === "editor" ? "viewer" : "editor"}`}
                          >
                            {m.role === "editor" ? "→viewer" : "→editor"}
                          </button>
                          <button
                            onClick={() => handleRemoveMember(m.user_id)}
                            className="text-[10px] text-red-400/50 hover:text-red-400"
                            title="Remove member"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Shared items */}
            <div>
              <h3 className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
                Shared Trips & Routes ({selectedGroup.shared_items.length})
              </h3>
              {selectedGroup.shared_items.length === 0 ? (
                <p className="text-xs text-muted">
                  Nothing shared yet. Share trips from the route planner.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {selectedGroup.shared_items.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between px-3 py-2 rounded bg-surface-alt/50"
                    >
                      <div>
                        <span className="text-xs text-secondary">{s.item_name}</span>
                        <span className="text-[10px] text-muted ml-2">
                          {s.item_type} • {s.item_distance_m ? formatDistance(s.item_distance_m) : "—"}
                          • by {s.shared_by_name}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleClone(s.id)}
                          className="text-[10px] text-blue-400 hover:text-blue-300"
                        >
                          Clone
                        </button>
                        {(selectedGroup.my_role === "owner" || s.shared_by_name === user.name) && (
                          <button
                            onClick={() => handleUnshare(s.id)}
                            className="text-[10px] text-red-400/60 hover:text-red-400"
                          >
                            Unshare
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
