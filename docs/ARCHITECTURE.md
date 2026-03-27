# Architecture

## System Overview

Moto-GPS is a motorcycle navigation platform that uses context-aware routing. Rather than simple "avoid motorways" rules, it scores every road segment on 5 dimensions and uses a Route-Score-Rerank strategy to find genuinely good motorcycle routes.

```
┌──────────────────────────────────────────────────────────────────┐
│                          User (Browser)                          │
│           Next.js 16 + MapLibre GL + React 19                    │
│           Port 3001                                              │
└────────────────────────────┬─────────────────────────────────────┘
                             │ REST API
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│                        FastAPI Backend                            │
│                        Port 8000                                 │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │  Route    │  │  Road    │  │  Route   │  │  Route         │  │
│  │  Planner  │  │  Scorer  │  │ Analyzer │  │  Cache         │  │
│  └─────┬────┘  └────┬─────┘  └────┬─────┘  └────────────────┘  │
│        │             │             │                              │
└────────┼─────────────┼─────────────┼────────────────────────────┘
         │             │             │
    ┌────▼────┐   ┌────▼─────────────▼──┐   ┌────────────────┐
    │ Valhalla │   │     PostGIS         │   │     Martin     │
    │ (routes) │   │  (road scores,      │   │ (vector tiles) │
    │ :8010    │   │   saved trips)      │   │ :3002          │
    └──────────┘   │  :5434              │   └────────┬───────┘
                   └─────────────────────┘            │
                                                      │ MVT tiles
                                              ┌───────▼───────┐
                                              │  MapLibre GL   │
                                              │ (score overlay)│
                                              └───────────────┘
```

## Core Strategy: Route-Score-Rerank

Valhalla's HTTP API doesn't support custom per-edge costs. So instead of modifying the routing graph, we:

1. **Generate candidates** — Fire 3-4 Valhalla requests in parallel, each with different motorcycle costing parameters (`use_highways`, `use_hills`, `use_trails`). Each returns a single best route for those parameters. This is much faster than using `alternates` (which requires multiple graph explorations per call).

2. **Score against PostGIS** — For each candidate route, sample points along the track and query nearby road segments from our pre-scored database. Compute a length-weighted average across all 5 scoring dimensions.

3. **Rerank** — Sort candidates by motorcycle quality score, return the top 3.

```
                 Valhalla (parallel)
                 ┌─── use_highways=0.5, use_hills=0.5 ──→ Route A
Waypoints ──────┼─── use_highways=0.0, use_hills=0.8 ──→ Route B
                 ├─── use_highways=0.3, use_hills=0.2 ──→ Route C
                 └─── use_highways=0.0, use_hills=0.6 ──→ Route D
                                                              │
                                           Deduplicate ◄──────┘
                                               │
                                    PostGIS scoring (parallel)
                                               │
                                    Sort by moto_score
                                               │
                                        Return top 3
```

## Road Scoring Pipeline

The pipeline runs offline (once after data download, or periodically for updates). It processes every road segment from OpenStreetMap and assigns quality scores.

```
OSM PBF (Great Britain, ~2GB)
    │
    ▼
osm_to_postgis.py ─── Extract highways → road_segments table (5.15M rows)
    │
    ├── curvature.py ──── Circumcircle-radius algorithm → curvature_score
    ├── surface_scorer.py ── OSM tag mapping → surface_score
    ├── elevation.py ───── SRTM sampling → elevation_score
    ├── urban_density.py ── Heuristic (highway + speed + lit) → urban_density_score
    │
    ▼
road_classifier.py ── Assign road_class (scenic_rural, urban_transit, etc.)
    │
    ▼
composite_scorer.py ── Weighted combination → composite_moto_score
```

Each road segment gets scores on 5 dimensions (0.0 to 1.0):

| Dimension | What it measures | Data source |
|-----------|-----------------|-------------|
| Curvature | Twistiness (hairpins, sweepers, straights) | Geometry analysis |
| Surface | Road surface quality (asphalt, gravel, track) | OSM `surface` + `smoothness` tags |
| Scenic | Elevation changes, interesting terrain | SRTM elevation data |
| Urban density | Rural vs built-up area | OSM highway type + speed + lighting |
| Elevation | Elevation gain/loss interest | SRTM elevation profile |

## Route Analysis

After a route is planned, the analysis system runs 8 detectors to find problems and suggest improvements.

**Geometry detectors** (pure math, <5ms):
- Backtracking — waypoint sends route in the opposite direction
- Close proximity — two waypoints essentially at the same location
- Detour ratio — a leg is unreasonably longer than the straight-line distance
- U-turns — route doubles back on itself

**PostGIS detectors** (parallel queries, ~500ms):
- Road quality drop — a section scores much lower than the route average
- Missed high-scoring road — a scenic road within 2km wasn't used

Each anomaly includes **multiple fix options** (e.g., "Move waypoint" + "Remove waypoint" + "Ignore"). The user can:
- Click **"📍 Show"** to zoom the map to the anomaly location with a coloured highlight line
- Click any fix option to apply it
- Fixes update the waypoints and trigger a manual recalculate

## Multi-Day Trip Planning

Multi-day trips are planned as **one continuous route** with **day overlays** — lenses that define where each day starts and ends.

```
TRIP = ONE continuous route planned as a whole
       A ──── B ──── C ──── D ──── E ──── F
                     🌙           🌙
                  (overnight)   (overnight)

Day overlays (lenses into the master route):
  Day 1:  A ──── B ──── C
  Day 2:                C ──── D
  Day 3:                       D ──── E ──── F
```

**Key principles:**
- The trip is ALWAYS stored as one set of waypoints + one route
- Days are defined by marking certain waypoints as "overnight stops"
- Days share boundary waypoints (C connects Day 1 end and Day 2 start)
- Editing in "Day 2 view" also modifies the full trip
- Each day has its own name, description, stats, and exportable GPX

**Auto-split algorithm:** Given a target daily distance (e.g., 400km), walks through legs accumulating distance and creates day boundaries at the nearest waypoint to each target. Prefers labelled waypoints as boundaries.

**Database:** Multi-day trips are stored in the `trips` table (separate from `saved_routes`). Day overlays are stored as a JSONB array of `{day, name, description, start_waypoint_idx, end_waypoint_idx}`.

## Map Interaction

### Smart Waypoint Insertion

When a route exists, clicking ANYWHERE on the map inserts the new waypoint at the closest segment position (using `findInsertIndex` from `geo.ts`), not appended to the end. Only when no route exists does a click append.

### Snap-to-Road

When a waypoint is dragged, it snaps to the nearest motorcycle-routable road using Valhalla's `/locate` API. The snap request returns the correlated lat/lng on the nearest road edge.

### Right-Click Context Menu

Right-clicking on the map shows:
- "📍 Add waypoint here" — smart insert at closest segment
- "➕ Insert into route here" — explicit route insertion
- "🔄 Recalculate route"
- "🗑️ Delete waypoint N" — if right-clicked near a waypoint

### Manual Recalculate

Route does NOT auto-recalculate on every change. Instead:
- Edit multiple waypoints (move, add, delete, reorder)
- The "Plan Route" button turns amber: "🔄 Recalculate"
- Click once to recalculate with all changes applied
- Map zoom/position is preserved during edits

## Save / Update Flow

- **No trip loaded (new route):** 💾+ opens Save dialog → creates new trip
- **Trip loaded (editing):** 💾 quick-saves in place → updates the same trip
- **Trip loaded, want a copy:** 💾+ opens Save dialog → creates new trip
- Header shows "Editing: Trip Name" when a loaded trip is active

## Database Schema

### road_segments (5.15M rows)

The core data table. Each row is a single OSM way segment.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | BIGSERIAL | Primary key |
| `osm_way_id` | BIGINT | OpenStreetMap way ID |
| `name`, `ref` | TEXT | Road name and reference (A303, B3212) |
| `highway` | TEXT | OSM highway classification |
| `surface`, `smoothness` | TEXT | Road surface tags |
| `maxspeed`, `lanes`, `width` | INT/REAL | Road characteristics |
| `geometry` | LINESTRING(4326) | Road centreline geometry |
| `curvature_score` | REAL | 0-1, calculated by pipeline |
| `scenic_score` | REAL | 0-1, calculated by pipeline |
| `surface_score` | REAL | 0-1, calculated by pipeline |
| `urban_density_score` | REAL | 0-1 (0=rural, 1=urban) |
| `elevation_score` | REAL | 0-1, calculated by pipeline |
| `composite_moto_score` | REAL | 0-1, weighted combination |
| `road_class` | TEXT | scenic_rural, urban_transit, dual_carriageway, etc. |

**Indexes**: GIST on geometry, B-tree on highway, road_class, composite_moto_score, region.

### saved_routes

Single-day saved routes with full route data.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `name`, `description` | TEXT | User-provided metadata |
| `route_type` | TEXT | scenic / balanced / fast |
| `waypoints` | JSONB | Array of `{lat, lng, label}` |
| `preferences` | JSONB | Scoring weights at time of save |
| `route_data` | JSONB | Full RouteResult (shape, maneuvers, scores) |
| `total_distance_m`, `total_time_s`, `total_moto_score` | REAL | Summary stats |

### trips

Multi-day trips with day overlays. Stores the full route + day boundary metadata.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `name`, `description` | TEXT | Trip metadata |
| `route_type` | TEXT | scenic / balanced / fast |
| `preferences` | JSONB | Scoring weights |
| `waypoints` | JSONB | ALL waypoints for the full trip |
| `route_data` | JSONB | Full RouteResult (entire trip) |
| `day_overlays` | JSONB | Array of `{day, name, description, start_waypoint_idx, end_waypoint_idx}` |
| `daily_target_m` | REAL | Target daily distance used for auto-split |
| `total_distance_m`, `total_time_s`, `total_moto_score` | REAL | Summary stats |

### user_preferences

Default scoring weights (single-user, phase 1).

## Frontend Architecture

Single-page app with a map and side panel:

```
page.tsx (main orchestrator)
├── Map.tsx (MapLibre GL)
│   ├── WaypointMarkers.tsx (draggable, selectable, snap-to-road, popup)
│   ├── RouteLayer.tsx (polyline renderer, multi-route)
│   ├── DayRouteLayer.tsx (per-day coloured route segments)
│   ├── ScoreOverlay.tsx (colour-coded road quality from Martin tiles)
│   └── MapContextMenu.tsx (right-click: add/insert/delete/recalculate)
│
├── RoutePanel.tsx (side panel / bottom sheet)
│   ├── SavedTrips.tsx (load/delete, multi-day badges, per-trip GPX export)
│   ├── WaypointList.tsx (search + drag-and-drop list)
│   ├── RouteTypeSelector.tsx (scenic/balanced/fast + custom settings)
│   ├── RouteStats.tsx (distance, time, score, turn-by-turn)
│   ├── RouteAnalysis.tsx (anomaly cards + 📍 Show + multiple fix buttons)
│   └── DayPlannerPanel.tsx (multi-day: auto-split, day cards, per-day export/import)
│
└── SaveTripDialog.tsx (save route modal)
```

**State management**:
- `useRoute` hook — waypoints, routes, analysis, preferences, stale indicator. Does NOT auto-recalculate; user triggers manually.
- `useTripPlanner` hook — day overlays, selected day, daily target, overnight stops. Reads from `useRoute`'s state (never duplicates it).
- Loaded trip tracking — `loadedTripId`, `loadedTripName`, `loadedTripIsMultiday` for in-place save vs save-as-new.

## Performance Optimisations

| Optimisation | Impact | Details |
|-------------|--------|---------|
| Parallel Valhalla fan-out | 20-40x faster routing | 4 calls with `alternates=0` vs 2 calls with `alternates=2` |
| Valhalla LRU memory cache | ~2x faster repeat areas | `use_lru_mem_cache: true` in config |
| Valhalla concurrent readers | Unblocks parallelism | `max_concurrent_reader_users: 8` (was 1) |
| Persistent httpx client | ~200ms saved per request | Module-level singleton with connection pooling |
| Parallel PostGIS scoring | 3-5x faster scoring | Each route scored in its own DB session |
| Point-based GIST queries | ~5x faster than LineString | Individual point ST_DWithin vs corridor scan |
| SQLAlchemy connection pool | Eliminates connection overhead | pool_size=10, max_overflow=20 |
| In-memory route cache | Instant for repeat requests | 5-min TTL, hash of waypoints+preferences |

## Data Flow: Route Planning Request

```
1. User clicks "Plan Route"
2. Frontend: POST /api/route {waypoints, route_type}
3. Backend: Check cache → hit? return immediately
4. Backend: Build 3-4 Valhalla parameter sets based on route_type
5. Backend: asyncio.gather() → 3-4 parallel Valhalla /route calls
6. Backend: Deduplicate routes (2% distance / 5% time threshold)
7. Backend: asyncio.gather() → parallel PostGIS scoring per route
8. Backend: Sort by moto_score, return top 3
9. Backend: Cache result (5-min TTL)
10. Frontend: Display routes on map + stats panel
11. Frontend: Auto-trigger POST /api/route/analyze (300ms delay)
12. Backend: Run 4 geometry detectors + 2 PostGIS detectors in parallel
13. Frontend: Display anomaly cards with fix buttons
```
