"use client";

import { useState } from "react";

interface SaveTripDialogProps {
  open: boolean;
  saving: boolean;
  onSave: (name: string, description: string) => void;
  onClose: () => void;
}

export function SaveTripDialog({ open, saving, onSave, onClose }: SaveTripDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSave(name.trim(), description.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="bg-surface border border-border rounded-xl p-5 w-full max-w-sm flex flex-col gap-4 shadow-2xl"
      >
        <h2 className="text-base font-bold text-primary">Save Trip</h2>

        <div className="flex flex-col gap-1">
          <label htmlFor="trip-name" className="text-xs text-muted font-medium">
            Trip Name *
          </label>
          <input
            id="trip-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Midlands to Southend scenic"
            autoFocus
            className="rounded-md bg-surface-alt border border-border px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-border-focus"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="trip-desc" className="text-xs text-muted font-medium">
            Description
          </label>
          <textarea
            id="trip-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Notes about this trip..."
            rows={3}
            className="rounded-md bg-surface-alt border border-border px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-border-focus resize-none"
          />
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted hover:text-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || saving}
            className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-500 disabled:bg-surface-hover disabled:text-muted text-white transition-colors"
          >
            {saving ? "Saving..." : "Save Trip"}
          </button>
        </div>
      </form>
    </div>
  );
}
