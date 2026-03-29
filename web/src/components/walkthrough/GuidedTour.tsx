"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useWalkthrough } from "@/contexts/WalkthroughContext";
import { TOUR_STEPS } from "./tourSteps";

interface TargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PADDING = 8;
const GAP = 12;

function getTooltipPosition(
  rect: TargetRect,
  placement: string,
  tooltipEl: HTMLDivElement | null
) {
  if (!tooltipEl) return { top: 0, left: 0 };

  const tw = tooltipEl.offsetWidth;
  const th = tooltipEl.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top = 0;
  let left = 0;

  switch (placement) {
    case "bottom":
      top = rect.y + rect.height + PADDING + GAP;
      left = rect.x + rect.width / 2 - tw / 2;
      if (top + th > vh - 16) top = rect.y - PADDING - GAP - th;
      break;
    case "top":
      top = rect.y - PADDING - GAP - th;
      left = rect.x + rect.width / 2 - tw / 2;
      if (top < 16) top = rect.y + rect.height + PADDING + GAP;
      break;
    case "left":
      top = rect.y + rect.height / 2 - th / 2;
      left = rect.x - PADDING - GAP - tw;
      if (left < 16) left = rect.x + rect.width + PADDING + GAP;
      break;
    case "right":
      top = rect.y + rect.height / 2 - th / 2;
      left = rect.x + rect.width + PADDING + GAP;
      if (left + tw > vw - 16) left = rect.x - PADDING - GAP - tw;
      break;
  }

  left = Math.max(16, Math.min(left, vw - tw - 16));
  top = Math.max(16, Math.min(top, vh - th - 16));

  return { top, left };
}

export function GuidedTour() {
  const {
    isTouring,
    currentStep,
    totalSteps,
    nextStep,
    prevStep,
    skipTour,
  } = useWalkthrough();

  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const [visible, setVisible] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const step = TOUR_STEPS[currentStep];

  const measure = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(step.targetSelector);
    if (!el) {
      nextStep();
      return;
    }

    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const r2 = el.getBoundingClientRect();
          setTargetRect({ x: r2.x, y: r2.y, width: r2.width, height: r2.height });
        });
      });
    } else {
      setTargetRect({ x: r.x, y: r.y, width: r.width, height: r.height });
    }
  }, [step, nextStep]);

  // Measure on step change
  useEffect(() => {
    if (!isTouring) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => {
      measure();
      setVisible(true);
    }, 100);
    return () => clearTimeout(t);
  }, [isTouring, currentStep, measure]);

  // Position tooltip after targetRect changes
  useEffect(() => {
    if (!targetRect || !tooltipRef.current || !step) return;
    const pos = getTooltipPosition(targetRect, step.placement, tooltipRef.current);
    setTooltipPos(pos);
  }, [targetRect, step]);

  // Observe resize & scroll
  useEffect(() => {
    if (!isTouring) return;
    const handleResize = () => measure();
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleResize, true);

    if (step) {
      const el = document.querySelector(step.targetSelector);
      if (el) {
        observerRef.current = new ResizeObserver(handleResize);
        observerRef.current.observe(el);
      }
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleResize, true);
      observerRef.current?.disconnect();
    };
  }, [isTouring, currentStep, step, measure]);

  // Escape key to skip
  useEffect(() => {
    if (!isTouring) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") skipTour();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isTouring, skipTour]);

  if (!isTouring || !step) return null;

  const isLast = currentStep === totalSteps - 1;
  const isFirst = currentStep === 0;

  const overlay = (
    <div
      className="fixed inset-0"
      style={{ zIndex: 9999, opacity: visible && targetRect ? 1 : 0, transition: "opacity 0.2s ease" }}
    >
      {/* SVG overlay with spotlight cutout */}
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.x - PADDING}
                y={targetRect.y - PADDING}
                width={targetRect.width + PADDING * 2}
                height={targetRect.height + PADDING * 2}
                rx="8"
                fill="black"
                style={{ transition: "all 0.3s ease" }}
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.6)"
          mask="url(#tour-mask)"
          style={{ pointerEvents: "all" }}
          onClick={skipTour}
        />
      </svg>

      {/* Spotlight ring */}
      {targetRect && (
        <div
          className="absolute rounded-lg border-2 border-blue-400/50 pointer-events-none"
          style={{
            left: targetRect.x - PADDING,
            top: targetRect.y - PADDING,
            width: targetRect.width + PADDING * 2,
            height: targetRect.height + PADDING * 2,
            transition: "all 0.3s ease",
            boxShadow: "0 0 0 4px rgba(59, 130, 246, 0.15)",
          }}
        />
      )}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="absolute bg-surface border border-border rounded-xl shadow-2xl p-4 w-72"
        style={{
          top: tooltipPos.top,
          left: tooltipPos.left,
          zIndex: 10000,
          transition: "top 0.3s ease, left 0.3s ease",
          opacity: visible && targetRect ? 1 : 0,
        }}
      >
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-sm font-bold text-primary">{step.title}</h3>
          <span className="text-[10px] text-muted ml-2 whitespace-nowrap">
            {currentStep + 1} / {totalSteps}
          </span>
        </div>

        <p className="text-xs text-secondary leading-relaxed mb-4">
          {step.description}
        </p>

        <div className="flex items-center justify-between">
          <button
            onClick={skipTour}
            className="text-[11px] text-muted hover:text-secondary transition-colors"
          >
            Skip tour
          </button>

          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                onClick={prevStep}
                className="text-[11px] text-secondary hover:text-primary transition-colors px-2 py-1"
              >
                Back
              </button>
            )}
            <button
              onClick={nextStep}
              className="text-[11px] font-medium bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-md transition-colors"
            >
              {isLast ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
