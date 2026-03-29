"use client";

import { useState, useRef, useEffect } from "react";
import { useWalkthrough } from "@/contexts/WalkthroughContext";

interface HintBeaconProps {
  id: string;
  hint: string;
  className?: string;
}

export function HintBeacon({ id, hint, className = "" }: HintBeaconProps) {
  const { completedTour, isTouring, isHintDismissed, dismissHint } =
    useWalkthrough();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!completedTour || isTouring || isHintDismissed(id)) return null;

  return (
    <div ref={ref} className={`relative inline-flex ${className}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-3.5 h-3.5 rounded-full bg-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.25)] hover:bg-blue-400 transition-colors"
        style={{ animation: "beacon-pulse 2s ease-in-out infinite" }}
        aria-label="Feature hint"
      />

      {open && (
        <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 w-52 bg-surface border border-border rounded-lg shadow-lg p-3 animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-secondary leading-relaxed">{hint}</p>
            <button
              onClick={() => dismissHint(id)}
              className="text-muted hover:text-primary text-xs flex-shrink-0"
              aria-label="Dismiss hint"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
