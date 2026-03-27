"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthContext } from "@/components/auth/AuthProvider";
import { updateProfile, changePassword } from "@/lib/authApi";
import { authFetch } from "@/lib/authApi";
import { TopNav } from "@/components/nav/TopNav";
import Link from "next/link";

interface Vehicle {
  id: string;
  type: string;
  brand: string;
  model: string;
  year: number | null;
  picture_base64: string | null;
  is_default: boolean;
  created_at: string;
}

const VEHICLE_TYPES = ["Motorcycle", "Car", "Scooter", "Trike", "Quad", "Other"];

export default function ProfilePage() {
  const router = useRouter();
  const { user, loading: authLoading, refreshUser } = useAuthContext();

  // Profile form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  // Password form
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);

  // Vehicles
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<string | null>(null);

  // Vehicle form
  const [vType, setVType] = useState("Motorcycle");
  const [vBrand, setVBrand] = useState("");
  const [vModel, setVModel] = useState("");
  const [vYear, setVYear] = useState("");
  const [vPicture, setVPicture] = useState<string | null>(null);
  const [vDefault, setVDefault] = useState(false);
  const [vSaving, setVSaving] = useState(false);

  // Auth gate
  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [authLoading, user, router]);

  // Init profile form
  useEffect(() => {
    if (user) {
      setName(user.name);
      setEmail(user.email);
    }
  }, [user]);

  // Load vehicles
  const loadVehicles = useCallback(async () => {
    setVehiclesLoading(true);
    try {
      const res = await authFetch("/api/vehicles");
      if (res.ok) setVehicles(await res.json());
    } catch {
      /* ignore */
    } finally {
      setVehiclesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) loadVehicles();
  }, [user, loadVehicles]);

  // Profile save
  const handleProfileSave = async () => {
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      await updateProfile({ name, email });
      await refreshUser();
      setProfileMsg("Profile updated");
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : "Update failed");
    } finally {
      setProfileSaving(false);
    }
  };

  // Password change
  const handlePasswordChange = async () => {
    setPwMsg(null);
    if (newPw !== confirmPw) {
      setPwMsg("Passwords don't match");
      return;
    }
    if (newPw.length < 8) {
      setPwMsg("New password must be at least 8 characters");
      return;
    }
    setPwSaving(true);
    try {
      await changePassword(currentPw, newPw);
      setPwMsg("Password changed");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      setPwMsg(err instanceof Error ? err.message : "Failed");
    } finally {
      setPwSaving(false);
    }
  };

  // Vehicle add/edit
  const resetVehicleForm = () => {
    setVType("Motorcycle");
    setVBrand("");
    setVModel("");
    setVYear("");
    setVPicture(null);
    setVDefault(false);
    setShowAddForm(false);
    setEditingVehicle(null);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_500_000) {
      alert("Image too large (max 1.5MB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Strip data URI prefix, keep just base64
      const base64 = dataUrl.split(",")[1] || dataUrl;
      setVPicture(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleVehicleSave = async () => {
    if (!vBrand.trim() || !vModel.trim()) return;
    setVSaving(true);
    try {
      const body = {
        type: vType,
        brand: vBrand.trim(),
        model: vModel.trim(),
        year: vYear ? parseInt(vYear) : null,
        picture_base64: vPicture,
        is_default: vDefault,
      };

      if (editingVehicle) {
        await authFetch(`/api/vehicles/${editingVehicle}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await authFetch("/api/vehicles", {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      resetVehicleForm();
      loadVehicles();
    } catch {
      /* ignore */
    } finally {
      setVSaving(false);
    }
  };

  const handleDeleteVehicle = async (id: string) => {
    await authFetch(`/api/vehicles/${id}`, { method: "DELETE" });
    loadVehicles();
  };

  const startEditVehicle = (v: Vehicle) => {
    setEditingVehicle(v.id);
    setVType(v.type);
    setVBrand(v.brand);
    setVModel(v.model);
    setVYear(v.year?.toString() || "");
    setVPicture(v.picture_base64);
    setVDefault(v.is_default);
    setShowAddForm(true);
  };

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <div className="text-zinc-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <TopNav />

      <div className="max-w-2xl mx-auto p-6 flex flex-col gap-8">
        {/* ===== Profile ===== */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
          <h2 className="text-base font-semibold text-zinc-200 mb-4">Profile</h2>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-zinc-400">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-zinc-400">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-blue-600"
              />
            </div>
            {profileMsg && (
              <p className={`text-xs ${profileMsg.includes("updated") ? "text-green-400" : "text-red-400"}`}>
                {profileMsg}
              </p>
            )}
            <button
              onClick={handleProfileSave}
              disabled={profileSaving}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white text-sm font-medium py-2 rounded-md transition-colors w-fit px-4"
            >
              {profileSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </section>

        {/* ===== Change Password ===== */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
          <h2 className="text-base font-semibold text-zinc-200 mb-4">Change Password</h2>
          <div className="flex flex-col gap-3">
            <input
              type="password"
              placeholder="Current password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600"
            />
            <input
              type="password"
              placeholder="New password (min 8 chars)"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600"
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600"
            />
            {pwMsg && (
              <p className={`text-xs ${pwMsg.includes("changed") ? "text-green-400" : "text-red-400"}`}>
                {pwMsg}
              </p>
            )}
            <button
              onClick={handlePasswordChange}
              disabled={pwSaving || !currentPw || !newPw}
              className="bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-200 text-sm font-medium py-2 rounded-md transition-colors w-fit px-4"
            >
              {pwSaving ? "Changing..." : "Change Password"}
            </button>
          </div>
        </section>

        {/* ===== Vehicles ===== */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-zinc-200">
              My Vehicles ({vehicles.length})
            </h2>
            {!showAddForm && (
              <button
                onClick={() => { resetVehicleForm(); setShowAddForm(true); }}
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-3 py-1.5 rounded-md transition-colors"
              >
                + Add Vehicle
              </button>
            )}
          </div>

          {/* Vehicle form (add/edit) */}
          {showAddForm && (
            <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4 mb-4 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-zinc-400">Type</label>
                  <select
                    value={vType}
                    onChange={(e) => setVType(e.target.value)}
                    className="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-blue-600"
                  >
                    {VEHICLE_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-zinc-400">Year</label>
                  <input
                    type="number"
                    value={vYear}
                    onChange={(e) => setVYear(e.target.value)}
                    placeholder="2024"
                    className="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-zinc-400">Brand</label>
                  <input
                    value={vBrand}
                    onChange={(e) => setVBrand(e.target.value)}
                    placeholder="Honda, BMW, Ducati..."
                    className="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-zinc-400">Model</label>
                  <input
                    value={vModel}
                    onChange={(e) => setVModel(e.target.value)}
                    placeholder="CB500X, R1250GS..."
                    className="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              {/* Picture upload */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-zinc-400">Picture (optional, max 1.5MB)</label>
                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="text-xs text-zinc-400 file:mr-2 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-zinc-700 file:text-zinc-300 hover:file:bg-zinc-600"
                  />
                  {vPicture && (
                    <img
                      src={`data:image/jpeg;base64,${vPicture}`}
                      alt="Preview"
                      className="w-16 h-16 rounded-md object-cover border border-zinc-700"
                    />
                  )}
                </div>
              </div>

              {/* Default checkbox */}
              <label className="flex items-center gap-2 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={vDefault}
                  onChange={(e) => setVDefault(e.target.checked)}
                  className="rounded"
                />
                Set as default vehicle
              </label>

              <div className="flex gap-2">
                <button
                  onClick={handleVehicleSave}
                  disabled={vSaving || !vBrand.trim() || !vModel.trim()}
                  className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white text-xs font-medium px-4 py-2 rounded-md transition-colors"
                >
                  {vSaving ? "Saving..." : editingVehicle ? "Update" : "Add Vehicle"}
                </button>
                <button
                  onClick={resetVehicleForm}
                  className="text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Vehicle list */}
          {vehiclesLoading ? (
            <p className="text-xs text-zinc-500">Loading...</p>
          ) : vehicles.length === 0 ? (
            <p className="text-xs text-zinc-500">No vehicles added yet</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {vehicles.map((v) => (
                <div
                  key={v.id}
                  className="bg-zinc-800 border border-zinc-700 rounded-lg p-3 flex gap-3"
                >
                  {/* Image */}
                  <div className="w-20 h-20 flex-shrink-0 rounded-md bg-zinc-900 overflow-hidden flex items-center justify-center">
                    {v.picture_base64 ? (
                      <img
                        src={`data:image/jpeg;base64,${v.picture_base64}`}
                        alt={`${v.brand} ${v.model}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-2xl">
                        {v.type === "Motorcycle" ? "🏍️" : v.type === "Car" ? "🚗" : "🛵"}
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 flex flex-col justify-between min-w-0">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-200 truncate">
                          {v.brand} {v.model}
                        </span>
                        {v.is_default && (
                          <span className="text-[10px] bg-amber-900/50 text-amber-400 px-1.5 py-0.5 rounded">
                            Default
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-zinc-500">
                        {v.type}{v.year ? ` • ${v.year}` : ""}
                      </span>
                    </div>
                    <div className="flex gap-2 mt-1">
                      <button
                        onClick={() => startEditVehicle(v)}
                        className="text-[10px] text-zinc-400 hover:text-zinc-200"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteVehicle(v.id)}
                        className="text-[10px] text-red-400/60 hover:text-red-400"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
