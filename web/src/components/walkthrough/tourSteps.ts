export interface TourStep {
  id: string;
  targetSelector: string;
  title: string;
  description: string;
  placement: "top" | "bottom" | "left" | "right";
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "map",
    targetSelector: '[data-tour="map"]',
    title: "The Map",
    description:
      "Click anywhere on the map to add waypoints for your route. Right-click a waypoint for more options like delete or move.",
    placement: "left",
  },
  {
    id: "search",
    targetSelector: '[data-tour="search"]',
    title: "Search Places",
    description:
      "Search for addresses, postcodes, or towns. Your saved favourite places also appear here for quick access.",
    placement: "bottom",
  },
  {
    id: "waypoints",
    targetSelector: '[data-tour="waypoints"]',
    title: "Your Waypoints",
    description:
      "Drag to reorder your stops. Click a waypoint to zoom to it on the map.",
    placement: "bottom",
  },
  {
    id: "route-type",
    targetSelector: '[data-tour="route-type"]',
    title: "Route Type",
    description:
      "Choose Scenic for beautiful countryside roads, Balanced for a mix, Fast for motorways, or Custom to tune every preference.",
    placement: "bottom",
  },
  {
    id: "plan-route",
    targetSelector: '[data-tour="plan-route"]',
    title: "Plan Your Route",
    description:
      "Once you have 2 or more waypoints, hit this to calculate the best motorcycle route.",
    placement: "top",
  },
  {
    id: "ai-planner",
    targetSelector: '[data-tour="ai-planner"]',
    title: "AI Trip Planner",
    description:
      "Ask the AI to suggest scenic routes, fuel stops, restaurants, viewpoints, and multi-day splits.",
    placement: "bottom",
  },
  {
    id: "save-trip",
    targetSelector: '[data-tour="save-trip"]',
    title: "Save Your Trip",
    description:
      "Save your planned route so you can load it later, export GPX files, or share with your riding group.",
    placement: "top",
  },
  {
    id: "help",
    targetSelector: '[data-tour="help"]',
    title: "Need Help?",
    description:
      "Click here anytime to replay this tour and rediscover features.",
    placement: "bottom",
  },
];
