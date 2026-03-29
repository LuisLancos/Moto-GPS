"use client";

import { useWalkthrough } from "@/contexts/WalkthroughContext";

export function HelpButton() {
  const { startTour } = useWalkthrough();
  return (
    <button
      data-tour="help"
      onClick={startTour}
      className="w-6 h-6 rounded-full border border-border text-muted hover:text-primary hover:border-border-focus transition-colors text-xs font-medium flex items-center justify-center"
      title="Guided tour &amp; help"
    >
      ?
    </button>
  );
}
