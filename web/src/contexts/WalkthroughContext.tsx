"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { TOUR_STEPS } from "@/components/walkthrough/tourSteps";

const STORAGE_KEY = "motogps-walkthrough";

interface PersistedState {
  completedTour: boolean;
  dismissedHints: string[];
}

interface WalkthroughContextValue {
  completedTour: boolean;
  dismissedHints: string[];
  isTouring: boolean;
  currentStep: number;
  totalSteps: number;
  startTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
  skipTour: () => void;
  finishTour: () => void;
  dismissHint: (id: string) => void;
  isHintDismissed: (id: string) => boolean;
}

const WalkthroughContext = createContext<WalkthroughContextValue>({
  completedTour: false,
  dismissedHints: [],
  isTouring: false,
  currentStep: 0,
  totalSteps: TOUR_STEPS.length,
  startTour: () => {},
  nextStep: () => {},
  prevStep: () => {},
  skipTour: () => {},
  finishTour: () => {},
  dismissHint: () => {},
  isHintDismissed: () => false,
});

function readStorage(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { completedTour: false, dismissedHints: [] };
}

function writeStorage(state: PersistedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export function WalkthroughProvider({ children }: { children: ReactNode }) {
  const [completedTour, setCompletedTour] = useState(true); // default true to avoid flash
  const [dismissedHints, setDismissedHints] = useState<string[]>([]);
  const [isTouring, setIsTouring] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [mounted, setMounted] = useState(false);

  // Read persisted state on mount
  useEffect(() => {
    const saved = readStorage();
    setCompletedTour(saved.completedTour);
    setDismissedHints(saved.dismissedHints);
    setMounted(true);
  }, []);

  // Auto-trigger tour for first-time users
  useEffect(() => {
    if (!mounted) return;
    if (completedTour) return;

    const timer = setTimeout(() => {
      setIsTouring(true);
      setCurrentStep(0);
    }, 1200);

    return () => clearTimeout(timer);
  }, [mounted, completedTour]);

  // Persist changes
  useEffect(() => {
    if (!mounted) return;
    writeStorage({ completedTour, dismissedHints });
  }, [completedTour, dismissedHints, mounted]);

  const startTour = useCallback(() => {
    setCurrentStep(0);
    setIsTouring(true);
  }, []);

  const finishTour = useCallback(() => {
    setIsTouring(false);
    setCompletedTour(true);
  }, []);

  const skipTour = useCallback(() => {
    setIsTouring(false);
    setCompletedTour(true);
  }, []);

  const nextStep = useCallback(() => {
    setCurrentStep((prev) => {
      if (prev >= TOUR_STEPS.length - 1) {
        setIsTouring(false);
        setCompletedTour(true);
        return prev;
      }
      return prev + 1;
    });
  }, []);

  const prevStep = useCallback(() => {
    setCurrentStep((prev) => Math.max(0, prev - 1));
  }, []);

  const dismissHint = useCallback((id: string) => {
    setDismissedHints((prev) =>
      prev.includes(id) ? prev : [...prev, id]
    );
  }, []);

  const isHintDismissed = useCallback(
    (id: string) => dismissedHints.includes(id),
    [dismissedHints]
  );

  return (
    <WalkthroughContext.Provider
      value={{
        completedTour,
        dismissedHints,
        isTouring,
        currentStep,
        totalSteps: TOUR_STEPS.length,
        startTour,
        nextStep,
        prevStep,
        skipTour,
        finishTour,
        dismissHint,
        isHintDismissed,
      }}
    >
      {children}
    </WalkthroughContext.Provider>
  );
}

export function useWalkthrough() {
  return useContext(WalkthroughContext);
}
