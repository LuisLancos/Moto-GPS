"use client";

import { useState, useCallback } from "react";
import type { AIChatMessage, AISuggestions, POIResult, RouteAction, RouteResult, Waypoint } from "@/lib/types";
import { sendAIMessage, enrichPOIs } from "@/lib/aiApi";

export interface UseAIPlannerReturn {
  // State
  messages: AIChatMessage[];
  suggestions: AISuggestions | null;
  pois: POIResult[];
  routeActions: RouteAction[];
  isOpen: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  toggle: () => void;
  sendMessage: (text: string, routeType?: string, currentWaypoints?: Waypoint[], currentRouteData?: RouteResult) => Promise<void>;
  applySuggestions: () => AISuggestions | null;
  dismissSuggestions: () => void;
  clearRouteActions: () => void;
  loadPOIs: (categories?: string[]) => Promise<void>;
  clearChat: () => void;
  clearPOIs: () => void;
}

export function useAIPlanner(): UseAIPlannerReturn {
  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [suggestions, setSuggestions] = useState<AISuggestions | null>(null);
  const [pois, setPois] = useState<POIResult[]>([]);
  const [routeActions, setRouteActions] = useState<RouteAction[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  const sendMessage = useCallback(async (text: string, routeType: string = "balanced", currentWaypoints?: Waypoint[], currentRouteData?: RouteResult) => {
    const userMsg: AIChatMessage = {
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };

    // Add user message immediately
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setIsLoading(true);
    setError(null);

    try {
      const response = await sendAIMessage(updatedMessages, routeType, currentWaypoints, currentRouteData);

      const assistantMsg: AIChatMessage = {
        role: "assistant",
        content: response.reply,
        suggestions: response.suggestions || undefined,
        timestamp: new Date().toISOString(),
      };

      setMessages([...updatedMessages, assistantMsg]);

      if (response.suggestions) {
        setSuggestions(response.suggestions);
      }

      if (response.route_actions && response.route_actions.length > 0) {
        setRouteActions(response.route_actions);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get AI response");
    } finally {
      setIsLoading(false);
    }
  }, [messages]);

  const applySuggestions = useCallback(() => {
    // Returns the current suggestions so the caller can apply them
    // to useRoute and useTripPlanner
    const current = suggestions;
    setSuggestions(null);
    return current;
  }, [suggestions]);

  const dismissSuggestions = useCallback(() => {
    setSuggestions(null);
  }, []);

  const clearRouteActions = useCallback(() => {
    setRouteActions([]);
  }, []);

  const loadPOIs = useCallback(async (categories: string[] = ["fuel", "restaurant", "attraction"]) => {
    if (!suggestions?.waypoints.length) return;
    setIsLoading(true);
    try {
      const results = await enrichPOIs(suggestions.waypoints, categories);
      setPois(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load POIs");
    } finally {
      setIsLoading(false);
    }
  }, [suggestions]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setSuggestions(null);
    setPois([]);
    setRouteActions([]);
    setError(null);
  }, []);

  const clearPOIs = useCallback(() => {
    setPois([]);
  }, []);

  return {
    messages,
    suggestions,
    pois,
    routeActions,
    isOpen,
    isLoading,
    error,
    toggle,
    sendMessage,
    applySuggestions,
    dismissSuggestions,
    clearRouteActions,
    loadPOIs,
    clearChat,
    clearPOIs,
  };
}
