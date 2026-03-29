"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthContext } from "@/components/auth/AuthProvider";
import { updateProfile, changePassword, updatePreferences } from "@/lib/authApi";
import { useUnits, type UnitSystem } from "@/contexts/UnitContext";
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
  fuel_type: string;
  consumption: number | null;
  consumption_unit: string;
  tank_capacity: number | null;
  fuel_cost_per_unit: number | null;
  fuel_cost_currency: string;
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
  const [vFuelType, setVFuelType] = useState("petrol");
  const [vConsumption, setVConsumption] = useState("");
  const [vConsumptionUnit, setVConsumptionUnit] = useState("mpg");
  const [vTankCapacity, setVTankCapacity] = useState("");
  const [vFuelCostPerUnit, setVFuelCostPerUnit] = useState("");
  const [vFuelCostCurrency, setVFuelCostCurrency] = useState("GBP");
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
    setVFuelType("petrol");
    setVConsumption("");
    setVConsumptionUnit("mpg");
    setVTankCapacity("");
    setVFuelCostPerUnit("");
    setVFuelCostCurrency("GBP");
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
        fuel_type: vFuelType,
        consumption: vConsumption ? parseFloat(vConsumption) : null,
        consumption_unit: vConsumptionUnit,
        tank_capacity: vTankCapacity ? parseFloat(vTankCapacity) : null,
        fuel_cost_per_unit: vFuelCostPerUnit ? parseFloat(vFuelCostPerUnit) : null,
        fuel_cost_currency: vFuelCostCurrency,
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
    setVFuelType(v.fuel_type || "petrol");
    setVConsumption(v.consumption?.toString() || "");
    setVConsumptionUnit(v.consumption_unit || "mpg");
    setVTankCapacity(v.tank_capacity?.toString() || "");
    setVFuelCostPerUnit(v.fuel_cost_per_unit?.toString() || "");
    setVFuelCostCurrency(v.fuel_cost_currency || "GBP");
    setShowAddForm(true);
  };

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center h-screen bg-page">
        <div className="text-muted text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page text-primary">
      <TopNav />

      <div className="max-w-2xl mx-auto p-6 flex flex-col gap-8">
        {/* ===== Profile ===== */}
        <section className="bg-surface border border-border rounded-lg p-5">
          <h2 className="text-base font-semibold text-secondary mb-4">Profile</h2>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-surface-alt border border-border rounded-md px-3 py-2 text-sm text-primary focus:outline-none focus:border-border-focus"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-surface-alt border border-border rounded-md px-3 py-2 text-sm text-primary focus:outline-none focus:border-border-focus"
              />
            </div>
            {profileMsg && (
              <p className={`text-xs ${profileMsg.includes("updated") ? "text-green-700 dark:text-green-400" : "text-red-400"}`}>
                {profileMsg}
              </p>
            )}
            <button
              onClick={handleProfileSave}
              disabled={profileSaving}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-surface-hover text-white text-sm font-medium py-2 rounded-md transition-colors w-fit px-4"
            >
              {profileSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </section>

        {/* ===== Preferences ===== */}
        <PreferencesSection />

        {/* ===== Change Password ===== */}
        <section className="bg-surface border border-border rounded-lg p-5">
          <h2 className="text-base font-semibold text-secondary mb-4">Change Password</h2>
          <div className="flex flex-col gap-3">
            <input
              type="password"
              placeholder="Current password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              className="bg-surface-alt border border-border rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-border-focus"
            />
            <input
              type="password"
              placeholder="New password (min 8 chars)"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className="bg-surface-alt border border-border rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-border-focus"
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              className="bg-surface-alt border border-border rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-border-focus"
            />
            {pwMsg && (
              <p className={`text-xs ${pwMsg.includes("changed") ? "text-green-700 dark:text-green-400" : "text-red-400"}`}>
                {pwMsg}
              </p>
            )}
            <button
              onClick={handlePasswordChange}
              disabled={pwSaving || !currentPw || !newPw}
              className="bg-surface-hover hover:bg-surface-alt disabled:bg-surface-alt disabled:text-muted text-secondary text-sm font-medium py-2 rounded-md transition-colors w-fit px-4"
            >
              {pwSaving ? "Changing..." : "Change Password"}
            </button>
          </div>
        </section>

        {/* ===== Vehicles ===== */}
        <section className="bg-surface border border-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-secondary">
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
            <div className="bg-surface-alt border border-border rounded-lg p-4 mb-4 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted">Type</label>
                  <select
                    value={vType}
                    onChange={(e) => setVType(e.target.value)}
                    className="bg-surface border border-border rounded-md px-3 py-2 text-sm text-primary focus:outline-none focus:border-border-focus"
                  >
                    {VEHICLE_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted">Year</label>
                  <input
                    type="number"
                    value={vYear}
                    onChange={(e) => setVYear(e.target.value)}
                    placeholder="2024"
                    className="bg-surface border border-border rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-border-focus"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted">Brand</label>
                  <input
                    value={vBrand}
                    onChange={(e) => setVBrand(e.target.value)}
                    placeholder="Honda, BMW, Ducati..."
                    className="bg-surface border border-border rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-border-focus"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted">Model</label>
                  <input
                    value={vModel}
                    onChange={(e) => setVModel(e.target.value)}
                    placeholder="CB500X, R1250GS..."
                    className="bg-surface border border-border rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-border-focus"
                  />
                </div>
              </div>

              {/* Fuel fields */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted">Fuel Type</label>
                  <select
                    value={vFuelType}
                    onChange={(e) => setVFuelType(e.target.value)}
                    className="bg-surface border border-border rounded-md px-3 py-2 text-sm text-primary focus:outline-none focus:border-border-focus"
                  >
                    <option value="petrol">Petrol</option>
                    <option value="diesel">Diesel</option>
                    <option value="ev">EV</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted">Consumption</label>
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      value={vConsumption}
                      onChange={(e) => setVConsumption(e.target.value)}
                      placeholder={vFuelType === "ev" ? "kWh" : "e.g. 55"}
                      className="flex-1 bg-surface border border-border rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-border-focus"
                    />
                    <select
                      value={vConsumptionUnit}
                      onChange={(e) => setVConsumptionUnit(e.target.value)}
                      className="bg-surface border border-border rounded-md px-2 py-2 text-xs text-primary focus:outline-none focus:border-border-focus"
                    >
                      <option value="mpg">MPG</option>
                      <option value="l100km">L/100km</option>
                      <option value="kwhper100km">kWh/100km</option>
                    </select>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted">
                    Tank Capacity ({vFuelType === "ev" ? "kWh" : "litres"})
                  </label>
                  <input
                    type="number"
                    value={vTankCapacity}
                    onChange={(e) => setVTankCapacity(e.target.value)}
                    placeholder={vFuelType === "ev" ? "e.g. 75" : "e.g. 20"}
                    className="bg-surface border border-border rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-border-focus"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted">
                    Fuel Cost ({vFuelType === "ev" ? "per kWh" : "per litre"})
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      step="0.01"
                      value={vFuelCostPerUnit}
                      onChange={(e) => setVFuelCostPerUnit(e.target.value)}
                      placeholder="e.g. 1.45"
                      className="flex-1 bg-surface border border-border rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-border-focus"
                    />
                    <select
                      value={vFuelCostCurrency}
                      onChange={(e) => setVFuelCostCurrency(e.target.value)}
                      className="bg-surface border border-border rounded-md px-2 py-2 text-xs text-primary focus:outline-none focus:border-border-focus"
                    >
                      <option value="GBP">£ GBP</option>
                      <option value="EUR">€ EUR</option>
                      <option value="USD">$ USD</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Picture upload */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted">Picture (optional, max 1.5MB)</label>
                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="text-xs text-muted file:mr-2 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-surface-hover file:text-secondary hover:file:bg-surface-alt"
                  />
                  {vPicture && (
                    <img
                      src={`data:image/jpeg;base64,${vPicture}`}
                      alt="Preview"
                      className="w-16 h-16 rounded-md object-cover border border-border"
                    />
                  )}
                </div>
              </div>

              {/* Default checkbox */}
              <label className="flex items-center gap-2 text-xs text-muted">
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
                  className="bg-blue-600 hover:bg-blue-500 disabled:bg-surface-hover text-white text-xs font-medium px-4 py-2 rounded-md transition-colors"
                >
                  {vSaving ? "Saving..." : editingVehicle ? "Update" : "Add Vehicle"}
                </button>
                <button
                  onClick={resetVehicleForm}
                  className="text-xs text-muted hover:text-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Vehicle list */}
          {vehiclesLoading ? (
            <p className="text-xs text-muted">Loading...</p>
          ) : vehicles.length === 0 ? (
            <p className="text-xs text-muted">No vehicles added yet</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {vehicles.map((v) => (
                <div
                  key={v.id}
                  className="bg-surface-alt border border-border rounded-lg p-3 flex gap-3"
                >
                  {/* Image */}
                  <div className="w-20 h-20 flex-shrink-0 rounded-md bg-surface overflow-hidden flex items-center justify-center">
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
                        <span className="text-sm font-medium text-secondary truncate">
                          {v.brand} {v.model}
                        </span>
                        {v.is_default && (
                          <span className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400 px-1.5 py-0.5 rounded">
                            Default
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted">
                        {v.type}{v.year ? ` • ${v.year}` : ""}
                      </span>
                      {v.fuel_type && v.consumption && (
                        <span className="text-[10px] text-muted">
                          {v.fuel_type === "ev" ? "⚡" : "⛽"}{" "}
                          {v.fuel_type.charAt(0).toUpperCase() + v.fuel_type.slice(1)}
                          {" · "}
                          {v.consumption} {v.consumption_unit === "mpg" ? "MPG" : v.consumption_unit === "l100km" ? "L/100km" : "kWh/100km"}
                          {v.tank_capacity ? ` · ${v.tank_capacity}${v.fuel_type === "ev" ? "kWh" : "L"} tank` : ""}
                          {v.fuel_cost_per_unit ? ` · ${v.fuel_cost_currency === "GBP" ? "£" : v.fuel_cost_currency === "EUR" ? "€" : "$"}${v.fuel_cost_per_unit}/${v.fuel_type === "ev" ? "kWh" : "L"}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2 mt-1">
                      <button
                        onClick={() => startEditVehicle(v)}
                        className="text-[10px] text-muted hover:text-secondary"
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

        {/* ===== Saved Places (Favourites) ===== */}
        <SavedPlacesSection />
      </div>
    </div>
  );
}

// ---------- Saved Places Section ----------

const PLACE_ICONS = ["🏠", "🏢", "⭐", "📍", "🏍️", "🏖️", "⛰️", "🏰", "☕", "⛽"];

function SavedPlacesSection() {
  const [places, setPlaces] = useState<Array<{ id: string; name: string; lat: number; lng: number; icon: string; category: string; address?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", lat: "", lng: "", icon: "⭐", address: "" });
  const [saving, setSaving] = useState(false);

  const fetchPlaces = useCallback(async () => {
    try {
      const r = await authFetch("/api/places");
      if (r.ok) setPlaces(await r.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchPlaces(); }, [fetchPlaces]);

  const handleSave = async () => {
    if (!form.name.trim() || !form.lat || !form.lng) return;
    setSaving(true);
    try {
      if (editId) {
        await authFetch(`/api/places/${editId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: form.name, icon: form.icon, address: form.address || null, lat: parseFloat(form.lat), lng: parseFloat(form.lng) }),
        });
      } else {
        await authFetch("/api/places", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: form.name, lat: parseFloat(form.lat), lng: parseFloat(form.lng), icon: form.icon, address: form.address || null }),
        });
      }
      setShowAdd(false);
      setEditId(null);
      setForm({ name: "", lat: "", lng: "", icon: "⭐", address: "" });
      await fetchPlaces();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await authFetch(`/api/places/${id}`, { method: "DELETE" });
    await fetchPlaces();
  };

  const startEdit = (p: typeof places[0]) => {
    setEditId(p.id);
    setForm({ name: p.name, lat: String(p.lat), lng: String(p.lng), icon: p.icon, address: p.address || "" });
    setShowAdd(true);
  };

  return (
    <section className="bg-surface border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-secondary">
          ⭐ Saved Places ({places.length})
        </h2>
        {!showAdd && (
          <button
            onClick={() => { setShowAdd(true); setEditId(null); setForm({ name: "", lat: "", lng: "", icon: "⭐", address: "" }); }}
            className="text-xs text-blue-500 hover:text-blue-400 transition-colors"
          >
            + Add Place
          </button>
        )}
      </div>

      {/* Add/Edit form */}
      {showAdd && (
        <div className="bg-surface-alt border border-border rounded-lg p-3 mb-4 flex flex-col gap-2">
          <div className="flex gap-2">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[10px] text-muted">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Home, Work, Mersea Island"
                className="bg-surface border border-border rounded px-2 py-1.5 text-sm text-primary focus:outline-none focus:border-border-focus"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted">Icon</label>
              <div className="flex gap-0.5 flex-wrap">
                {PLACE_ICONS.map((ic) => (
                  <button
                    key={ic}
                    onClick={() => setForm((f) => ({ ...f, icon: ic }))}
                    className={`w-7 h-7 rounded text-sm flex items-center justify-center transition-colors ${
                      form.icon === ic ? "bg-blue-600 text-white" : "bg-surface hover:bg-surface-hover"
                    }`}
                  >
                    {ic}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[10px] text-muted">Latitude</label>
              <input
                value={form.lat}
                onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))}
                placeholder="51.5358"
                className="bg-surface border border-border rounded px-2 py-1.5 text-sm text-primary font-mono focus:outline-none focus:border-border-focus"
              />
            </div>
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[10px] text-muted">Longitude</label>
              <input
                value={form.lng}
                onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))}
                placeholder="0.6764"
                className="bg-surface border border-border rounded px-2 py-1.5 text-sm text-primary font-mono focus:outline-none focus:border-border-focus"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted">Address (optional)</label>
            <input
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              placeholder="8 Kenilworth Gardens, SS0 0BD"
              className="bg-surface border border-border rounded px-2 py-1.5 text-sm text-primary focus:outline-none focus:border-border-focus"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving || !form.name.trim() || !form.lat || !form.lng}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-blue-400 text-white text-xs px-3 py-1.5 rounded transition-colors"
            >
              {saving ? "Saving..." : editId ? "Update" : "Save Place"}
            </button>
            <button
              onClick={() => { setShowAdd(false); setEditId(null); }}
              className="text-xs text-muted hover:text-secondary transition-colors"
            >
              Cancel
            </button>
          </div>
          <p className="text-[10px] text-muted">
            💡 Tip: You can also save places from the waypoint list — click a waypoint, expand details, then &quot;⭐ Save as favourite&quot;.
          </p>
        </div>
      )}

      {/* Places list */}
      {loading ? (
        <p className="text-xs text-muted">Loading...</p>
      ) : places.length === 0 && !showAdd ? (
        <p className="text-xs text-muted">
          No saved places yet. Add your home, work, or frequent destinations for quick access when planning routes.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {places.map((p) => (
            <div key={p.id} className="flex items-center justify-between bg-surface-alt rounded-md px-3 py-2 group">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm">{p.icon}</span>
                <div className="min-w-0">
                  <span className="text-sm text-secondary font-medium truncate block">{p.name}</span>
                  {p.address && <span className="text-[10px] text-muted truncate block">{p.address}</span>}
                  <span className="text-[10px] text-muted font-mono">{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => startEdit(p)}
                  className="text-[10px] text-muted hover:text-blue-400 transition-colors px-1"
                >
                  ✏️
                </button>
                <button
                  onClick={() => handleDelete(p.id)}
                  className="text-[10px] text-muted hover:text-red-400 transition-colors px-1"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------- Preferences Section ----------

const POI_CATEGORY_OPTIONS = [
  { id: "biker_spot", label: "🏍️ Biker Spots" },
  { id: "fuel", label: "⛽ Fuel" },
  { id: "hotel", label: "🏨 Hotels" },
  { id: "restaurant", label: "🍽️ Restaurants" },
  { id: "cafe", label: "☕ Cafes" },
  { id: "pub", label: "🍺 Pubs" },
  { id: "campsite", label: "⛺ Campsites" },
  { id: "viewpoint", label: "👁️ Viewpoints" },
  { id: "castle", label: "🏰 Castles" },
  { id: "museum", label: "🏛️ Museums" },
  { id: "attraction", label: "📍 Attractions" },
];

function PreferencesSection() {
  const { units, setUnits } = useUnits();
  const { user, refreshUser } = useAuthContext();
  const [saving, setSaving] = useState(false);
  const prefs = user?.preferences || {};

  // Daily miles per route mode
  const [scenicMiles, setScenicMiles] = useState(String(prefs.daily_miles_scenic || 150));
  const [balancedMiles, setBalancedMiles] = useState(String(prefs.daily_miles_balanced || 200));
  const [fastMiles, setFastMiles] = useState(String(prefs.daily_miles_fast || 250));

  // Default POI categories
  const [selectedPOIs, setSelectedPOIs] = useState<Set<string>>(
    new Set(prefs.default_poi_categories || ["fuel", "biker_spot"])
  );

  // Sync from user prefs on load
  useEffect(() => {
    if (user?.preferences) {
      const p = user.preferences;
      if (p.daily_miles_scenic) setScenicMiles(String(p.daily_miles_scenic));
      if (p.daily_miles_balanced) setBalancedMiles(String(p.daily_miles_balanced));
      if (p.daily_miles_fast) setFastMiles(String(p.daily_miles_fast));
      if (p.default_poi_categories) setSelectedPOIs(new Set(p.default_poi_categories));
    }
  }, [user?.preferences]);

  const handleUnitChange = async (u: UnitSystem) => {
    setUnits(u);
    setSaving(true);
    try {
      await updatePreferences({ units: u });
      await refreshUser();
    } catch { setUnits(units); }
    finally { setSaving(false); }
  };

  const handleSaveDailyMiles = async () => {
    setSaving(true);
    try {
      await updatePreferences({
        daily_miles_scenic: parseInt(scenicMiles) || 150,
        daily_miles_balanced: parseInt(balancedMiles) || 200,
        daily_miles_fast: parseInt(fastMiles) || 250,
      });
      await refreshUser();
    } catch { /* silent */ }
    finally { setSaving(false); }
  };

  const handleTogglePOI = async (catId: string) => {
    const next = new Set(selectedPOIs);
    if (next.has(catId)) next.delete(catId);
    else next.add(catId);
    setSelectedPOIs(next);
    setSaving(true);
    try {
      await updatePreferences({ default_poi_categories: Array.from(next) });
      await refreshUser();
    } catch { /* silent */ }
    finally { setSaving(false); }
  };

  return (
    <section className="bg-surface border border-border rounded-lg p-5">
      <h2 className="text-base font-semibold text-secondary mb-4">Preferences</h2>
      <div className="flex flex-col gap-5">
        {/* Distance units */}
        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted font-medium">Distance units</label>
          <div className="flex gap-2">
            {(["miles", "km"] as UnitSystem[]).map((u) => (
              <button
                key={u}
                onClick={() => handleUnitChange(u)}
                disabled={saving}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  units === u
                    ? "bg-blue-600 text-white"
                    : "bg-surface-alt text-muted hover:bg-surface-hover hover:text-secondary"
                } disabled:opacity-50`}
              >
                {u === "miles" ? "Miles (mi)" : "Kilometres (km)"}
              </button>
            ))}
          </div>
        </div>

        {/* Daily miles per route mode */}
        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted font-medium">Max miles per day (for auto-split)</label>
          <p className="text-[10px] text-muted">Sets the daily distance target when splitting a multi-day trip.</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "🏔️ Scenic", value: scenicMiles, set: setScenicMiles },
              { label: "⚖️ Balanced", value: balancedMiles, set: setBalancedMiles },
              { label: "⚡ Fast", value: fastMiles, set: setFastMiles },
            ].map(({ label, value, set }) => (
              <div key={label} className="flex flex-col gap-1">
                <span className="text-[10px] text-muted">{label}</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    className="w-full bg-surface-alt border border-border rounded-md px-2 py-1.5 text-sm text-primary focus:outline-none focus:border-border-focus"
                  />
                  <span className="text-[10px] text-muted">mi</span>
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={handleSaveDailyMiles}
            disabled={saving}
            className="self-start text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save daily targets"}
          </button>
        </div>

        {/* Default POI categories */}
        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted font-medium">Default POI categories on map</label>
          <p className="text-[10px] text-muted">These categories are automatically shown when you plan a route.</p>
          <div className="flex flex-wrap gap-1.5">
            {POI_CATEGORY_OPTIONS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => handleTogglePOI(id)}
                disabled={saving}
                className={`text-xs px-2.5 py-1 rounded-md transition-colors border ${
                  selectedPOIs.has(id)
                    ? "bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-900/50 dark:border-amber-600/60 dark:text-amber-300"
                    : "bg-surface-alt border-border text-muted hover:text-secondary"
                } disabled:opacity-50`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
