"use client";

import { useState, useRef, useEffect } from "react";
import type { AIChatMessage, AISuggestions, RouteAction } from "@/lib/types";
import { AISuggestionCard } from "./AISuggestionCard";
import { AIRouteActionsCard } from "./AIRouteActionsCard";

interface AIPlannerChatProps {
  messages: AIChatMessage[];
  suggestions: AISuggestions | null;
  routeActions: RouteAction[];
  isLoading: boolean;
  error: string | null;
  onSendMessage: (text: string) => void;
  onApplySuggestions: () => void;
  onDismissSuggestions: () => void;
  onApplyRouteActions: () => void;
  onDismissRouteActions: () => void;
  onEnrichPOIs: () => void;
  onClearChat: () => void;
  appliedMessageIdx: number | null;
}

const SUGGESTION_CHIPS = [
  { label: "🏍️ Plan a scenic ride", prompt: "Plan a scenic motorcycle ride in the UK, about 200 miles through countryside" },
  { label: "⛽ Add fuel stops", prompt: "Suggest fuel stops along my current route, every 200km" },
  { label: "🍽️ Suggest restaurants", prompt: "Suggest good lunch and dinner stops along my route, preferably biker-friendly" },
  { label: "🏰 Historic route", prompt: "Plan a motorcycle trip visiting castles and historic sites in England" },
  { label: "🏔️ Mountain passes", prompt: "Plan a multi-day trip through the best mountain passes and scenic roads" },
];

export function AIPlannerChat({
  messages,
  suggestions,
  routeActions,
  isLoading,
  error,
  onSendMessage,
  onApplySuggestions,
  onDismissSuggestions,
  onApplyRouteActions,
  onDismissRouteActions,
  onEnrichPOIs,
  onClearChat,
  appliedMessageIdx,
}: AIPlannerChatProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Focus input on open
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    onSendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col gap-2 border border-purple-800/40 bg-purple-950/20 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2.5">
        <span className="text-xs font-semibold text-purple-300">✨ AI Trip Planner</span>
        {messages.length > 0 && (
          <button
            onClick={onClearChat}
            className="text-[10px] text-muted hover:text-secondary transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex flex-col gap-2 px-3 overflow-y-auto max-h-80 min-h-[120px]"
      >
        {/* Empty state with suggestion chips */}
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col gap-2 py-2">
            <p className="text-xs text-muted">
              Describe the motorcycle trip you want to plan and I&apos;ll suggest waypoints, day splits, and points of interest.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTION_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  onClick={() => onSendMessage(chip.prompt)}
                  className="text-[10px] px-2 py-1 rounded-full bg-surface-alt border border-border text-secondary hover:border-purple-600 hover:text-purple-300 transition-colors"
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message list */}
        {messages.map((msg, i) => (
          <div key={i} className="flex flex-col gap-1">
            {/* Message bubble */}
            <div
              className={`text-xs px-3 py-2 rounded-lg max-w-[95%] ${
                msg.role === "user"
                  ? "bg-blue-900/40 text-blue-100 self-end ml-auto"
                  : "bg-surface-alt/80 text-secondary self-start"
              }`}
            >
              <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
            </div>

            {/* Suggestion card (attached to assistant messages) */}
            {msg.role === "assistant" && msg.suggestions && (
              <AISuggestionCard
                suggestions={msg.suggestions}
                onApply={onApplySuggestions}
                onDismiss={onDismissSuggestions}
                onEnrichPOIs={onEnrichPOIs}
                applied={appliedMessageIdx === i}
              />
            )}
          </div>
        ))}

        {/* Current suggestion (from latest response, not yet in messages) */}
        {suggestions && !messages.some((m) => m.suggestions === suggestions) && (
          <AISuggestionCard
            suggestions={suggestions}
            onApply={onApplySuggestions}
            onDismiss={onDismissSuggestions}
            onEnrichPOIs={onEnrichPOIs}
          />
        )}

        {/* Route actions card (from AI route analysis/repair) */}
        {routeActions.length > 0 && (
          <AIRouteActionsCard
            actions={routeActions}
            onApply={onApplyRouteActions}
            onDismiss={onDismissRouteActions}
          />
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted">
            <span className="animate-pulse">●</span>
            <span>Thinking...</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-xs text-red-400 bg-red-950/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="flex gap-2 px-3 pb-3">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe your trip..."
          disabled={isLoading}
          className="flex-1 bg-surface-alt border border-border rounded-md px-3 py-2 text-xs text-primary placeholder:text-muted focus:outline-none focus:border-purple-600 disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
          className="bg-purple-700 hover:bg-purple-600 disabled:bg-surface-hover text-white text-xs font-medium px-3 py-2 rounded-md transition-colors shrink-0"
        >
          Send
        </button>
      </div>
    </div>
  );
}
