"use client";

import { useEffect, useRef } from "react";

export interface ContextMenuAction {
  label: string;
  icon?: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
}

interface MapContextMenuProps {
  x: number;
  y: number;
  actions: ContextMenuAction[];
  onClose: () => void;
}

export function MapContextMenu({ x, y, actions, onClose }: MapContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  const style: React.CSSProperties = {
    position: "fixed",
    left: x,
    top: y,
    zIndex: 9999,
  };

  return (
    <div ref={ref} style={style} className="min-w-[180px] rounded-lg bg-zinc-800 border border-zinc-700 shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100">
      {actions.map((action, i) => {
        if (action.divider) {
          return <div key={i} className="border-t border-zinc-700 my-1" />;
        }
        return (
          <button
            key={i}
            onClick={() => {
              if (!action.disabled) {
                action.onClick();
                onClose();
              }
            }}
            disabled={action.disabled}
            className={`
              w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors
              ${action.disabled ? "text-zinc-600 cursor-not-allowed" : ""}
              ${action.danger && !action.disabled ? "text-red-400 hover:bg-red-950/40" : ""}
              ${!action.danger && !action.disabled ? "text-zinc-200 hover:bg-zinc-700" : ""}
            `}
          >
            {action.icon && <span className="text-xs w-4 text-center">{action.icon}</span>}
            <span>{action.label}</span>
          </button>
        );
      })}
    </div>
  );
}
