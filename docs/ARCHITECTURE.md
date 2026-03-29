# Architecture

## System Overview

Moto-GPS is a motorcycle navigation platform that uses context-aware routing. Rather than simple "avoid motorways" rules, it scores every road segment on 5 dimensions and uses a Route-Score-Rerank strategy to find genuinely good motorcycle routes. It includes invite-only user management, adventure groups, collaborative trip sharing, an AI trip planner, and a POI overlay system.

```
┌──────────────────────────────────────────────────────────────────┐
│                          User (Browser)                          │
│           Next.js 16 + MapLibre GL + React 19                    │
│           Port 3001                                              │
│           ThemeContext (light/dark) · UnitContext (mi/km)         │
│                                                                  │
│  /login  /register  /admin  /profile  /groups  / (map+planner)  │
└────────────────────────────────┬─────────────────────────────────┘
                             │ REST API (JWT auth)
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
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │  AI Trip │  │  POI     │  │  Fuel    │  │  Google        │  │
│  │  Planner │  │  Service │  │  Calc    │  │  Places        │  │
│  │ (Gemini) │  │ (PostGIS)│  │          │  │  (optional)    │  │
│  └─────┬────┘  └────┬─────┘  └──────────┘  └────────────────┘  │
│        │             │                                           │
│  ┌─────┴─────────────┴────────────────────────────────────────┐  │
│  │  Auth (JWT) · Admin · Groups · Vehicles · Sharing          │  │
│  └────────────────────────┬───────────────────────────────────┘  │
│                           │                                      │
└───────────┬───────────────┼───────────────┬──────────────────────┘
            │               │               │
    ┌───────▼──┐   ┌────────▼────────────┐  │  ┌────────────────┐
    │ Valhalla │   │     PostGIS          │  │  │     Martin     │
    │ (routes) │   │  (road scores,       │  │  │ (vector tiles) │
    │ :8010    │   │   users, groups,     │  │  │ :3002          │
    └──────────┘   │   trips, sharing,    │  │  └────────┬───────┘
                   │   POIs: 83k+ OSM +   │  │           │
                   │   1.4k biker cafes)  │  │   MVT tiles│
                   │  :5434               │  │  ┌────────▼───────┐
                   └──────────────────────┘  │  │  MapLibre GL    │
                                             │  │ (score overlay  │
                   ┌─────────────────────────┘  │  + POI markers) │
                   │                            └────────────────┘
           ┌───────▼────────┐
           │  Gemini API    │
           │  (AI planner   │
           │   with tool    │
           │   calling)     │
           └────────────────┘
```

## User Management & Authentication

### Invite-Only Registration

Registration is closed by default. Admins generate invite codes, then share registration links (`/register?code=ABC`) manually (no email sending). Each code can be used once and optionally expires.

```
Admin generates code  →  Shares link  →  User registers  →  Code marked used
                                              │
                                          JWT issued (24h)
```

### Authentication Flow

- **JWT-based**: `Authorization: Bearer <token>` on every authenticated request
- Tokens contain `sub` (user ID), `is_admin`, `exp`, `iat`
- Signed with HS256 using `JWT_SECRET` from environment
- 24-hour expiry (`JWT_EXPIRE_MINUTES=1440`)
- Token issued on both register and login

### Authorization Layers

| Dependency | What it protects | Behaviour |
|-----------|-----------------|-----------|
| `get_current_user` | Most endpoints | Validates JWT, checks user exists and is not blocked. Returns user dict. |
| `get_current_admin` | `/api/admin/*` | Extends `get_current_user`, additionally requires `is_admin = true`. |
| `get_optional_user` | Migration-period endpoints | Returns user if valid token present, `None` if no token. Backwards compatibility. |
| `_check_group_role` | Group operations | Verifies user is a member with a required role (owner/editor/viewer). |

### Admin Capabilities

- Generate and delete invite codes
- List all users
- Block/unblock users (blocked users get 403 on any authenticated request)
- Promote/demote users to/from admin
- Delete users (cascades to vehicles, group memberships, etc.)
- First admin is created via CLI: `python -m app.cli.seed_admin`

### Seed Admin

On first setup, there are no users and therefore no way to generate invite codes. The `seed_admin` CLI tool creates the first admin user directly in the database:

```bash
cd backend
python -m app.cli.seed_admin
# Reads ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD from .env
```

The seed command also assigns any orphan routes/trips (created before auth was added) to the admin user.

## Adventure Groups

Groups enable collaborative trip planning. A group has a name, description, optional target date and duration.

### Group Roles

| Role | Can do |
|------|--------|
| **Owner** | Full control: edit group, invite/remove members, change roles, share/unshare items, delete group |
| **Editor** | Share items into the group, edit shared routes |
| **Viewer** | View shared items, export GPX, clone items to own trips |

The group creator is automatically the owner. New members are invited as editor or viewer.

### Invitation Flow

```
Owner searches for user (GET /api/users/search?q=...)
  → Sends invitation (POST /api/groups/{id}/invite)
    → Target user sees pending invitation (GET /api/invitations)
      → Accepts or declines
        → On accept: added as group member with invited role
```

Invitations are per-user, per-group (unique constraint). Re-inviting resets a declined invitation to pending.

## Trip & Route Sharing

### How Sharing Works

Owners and editors can share any trip or route with their group. Shared items appear in every member's Saved Trips list alongside their own trips, using a UNION query.

```sql
-- Conceptual: trips listing query
SELECT ... FROM saved_routes WHERE user_id = :current_user  -- owned
UNION ALL
SELECT ... FROM saved_routes sr
  JOIN group_shared_items gsi ON gsi.item_id = sr.id
  JOIN group_members gm ON gm.group_id = gsi.group_id
  WHERE gm.user_id = :current_user                        -- shared via group
```

### Ownership Indicators

Each trip in the list carries an `ownership` field:

| Value | UI Badge | Meaning |
|-------|----------|---------|
| `"owned"` | (none) | User's own trip |
| `"shared_editor"` | Blue "shared - edit" | Shared via group, can edit |
| `"shared_viewer"` | Grey "shared - view" | Shared via group, read-only |

Shared trips also show `owner_name` ("by {name}") and owned trips show `shared_with_groups` listing which groups they're shared with.

### Permission Matrix

| Action | Owner | Editor (shared) | Viewer (shared) |
|--------|-------|-----------------|-----------------|
| View route | Yes | Yes | Yes |
| Edit route | Yes | Yes | No |
| Export GPX | Yes | Yes | Yes |
| Delete trip | Yes | No | No |
| Unshare | Yes | Sharer only | No |
| Clone to own | -- | Yes | Yes |

### Clone

Any group member can clone a shared item, which creates an independent copy in their own trip list (with " (copy)" appended to the name). The clone has no further connection to the original.

## Core Strategy: Route-Score-Rerank

Valhalla's HTTP API doesn't support custom per-edge costs. So instead of modifying the routing graph, we:

1. **Generate candidates** -- Fire 3-4 Valhalla requests in parallel, each with different motorcycle costing parameters (`use_highways`, `use_hills`, `use_trails`). Each returns a single best route for those parameters. This is much faster than using `alternates` (which requires multiple graph explorations per call).

2. **Score against PostGIS** -- For each candidate route, sample points along the track and query nearby road segments from our pre-scored database. Compute a length-weighted average across all 5 scoring dimensions.

3. **Rerank** -- Sort candidates by motorcycle quality score, return the top 3.

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
- Backtracking -- waypoint sends route in the opposite direction
- Close proximity -- two waypoints essentially at the same location
- Detour ratio -- a leg is unreasonably longer than the straight-line distance
- U-turns -- route doubles back on itself

**PostGIS detectors** (parallel queries, ~500ms):
- Road quality drop -- a section scores much lower than the route average
- Missed high-scoring road -- a scenic road within 2km wasn't used

Each anomaly includes **multiple fix options** (e.g., "Move waypoint" + "Remove waypoint" + "Ignore"). The user can:
- Click **"Show"** to zoom the map to the anomaly location with a coloured highlight line
- Click any fix option to apply it
- Fixes update the waypoints and trigger a manual recalculate

**Loop route detection**: The backtracking detector now identifies loop routes (where start and end are within a threshold distance) and suppresses false backtracking alerts on return legs. Anomaly highlights are automatically cleared on route recalculation. Severity levels use color-coded indicators (red for issues, amber for warnings, blue for suggestions).

## Multi-Day Trip Planning

Multi-day trips are planned as **one continuous route** with **day overlays** -- lenses that define where each day starts and ends.

```
TRIP = ONE continuous route planned as a whole
       A ──── B ──── C ──── D ──── E ──── F
                     *             *
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

**Per-day route types:** Each day can override the trip's default route type (scenic/balanced/fast). Day cards show an "Unsync" button to set a per-day type and "Sync" to return to the trip default. When any day has a custom type, `handleCalculateRoute` auto-detects this and uses the `POST /api/route/multi-mode` endpoint, which plans each day's segment independently with its own costing parameters and stitches the results together.

**Auto-suggest on day split:** When days are split, the system automatically searches for the nearest hotel/B&B near overnight stop waypoints and suggests fuel stops based on the vehicle's tank range. Suggestions appear in day cards with a "+ Route" button to add them as waypoints.

**Per-day route stats:** When a day is selected, `RouteStats` shows that day's distance, time, and moto score. Key roads and turn-by-turn directions are filtered to the selected day. A "Showing Day X" indicator is shown with a hint to select Full Trip for aggregate stats.

**Database:** Multi-day trips are stored in the `trips` table (separate from `saved_routes`). Day overlays are stored as a JSONB array of `{day, name, description, start_waypoint_idx, end_waypoint_idx}`.

## Map Interaction

### Smart Waypoint Insertion

When a route exists, clicking ANYWHERE on the map inserts the new waypoint at the closest segment position (using `findInsertIndex` from `geo.ts`), not appended to the end. Only when no route exists does a click append.

### Snap-to-Road

When a waypoint is dragged, it snaps to the nearest motorcycle-routable road using Valhalla's `/locate` API. The snap request returns the correlated lat/lng on the nearest road edge.

### Right-Click Context Menu

Right-clicking on the map shows:
- "Add waypoint here" -- smart insert at closest segment
- "Insert into route here" -- explicit route insertion
- "Recalculate route"
- "Delete waypoint N" -- if right-clicked near a waypoint

### Reverse Geocoding

When a user clicks the map to add a waypoint, the coordinate is reverse-geocoded via Nominatim to produce a human-readable label (e.g., "A5, Weedon Bec"). Waypoints show expandable details with coordinates and a copy button.

### UK Postcode Search

The search bar recognizes UK postcodes (regex match) and queries the postcodes.io API (free, no key required). Results are combined with Nominatim geocoding and local POI name search for a unified search experience.

### Manual Recalculate

Route does NOT auto-recalculate on every change. Instead:
- Edit multiple waypoints (move, add, delete, reorder)
- The "Plan Route" button turns amber: "Recalculate"
- Click once to recalculate with all changes applied
- Map zoom/position is preserved during edits

## AI Trip Planner

The AI trip planner uses Google Gemini with function calling to provide conversational trip planning.

```
User types message in chat panel
        │
        ▼
POST /api/ai/chat
        │
        ▼
trip_ai_orchestrator.py
        │
        ├── Build system prompt (motorcycle-specific knowledge,
        │   UK geography, riding preferences)
        │
        ├── Send to Gemini API with tool definitions
        │
        ├── Handle function calls:
        │   ├── suggest_trip_plan → generates waypoints + day splits
        │   └── search_nearby_pois → batch POI search along route
        │
        └── Return structured response:
            ├── reply (natural language)
            ├── suggested_waypoints
            ├── suggested_day_splits
            └── poi_suggestions (shown as map markers)
```

**Backend components:**
- `ai_client.py` -- Gemini API wrapper with function calling support
- `trip_ai_orchestrator.py` -- Orchestrates conversation, tool execution, and response assembly
- `ai_planner.py` (API router) -- `POST /api/ai/chat` endpoint
- `ai_planner.py` (models) -- Pydantic models for AI request/response

**Frontend components:**
- `useAIPlanner.ts` hook -- manages conversation state, sends messages, handles responses
- `web/src/components/ai/` -- AI chat panel UI components
- `aiApi.ts` -- API client for AI endpoints

## POI Overlay System

The POI system provides 83,000+ UK points of interest from OpenStreetMap plus 1,461 biker-specific cafes/spots.

### Data Pipeline

```
OSM PBF (Great Britain)
    │
    ▼
pipeline/import_pois.py ─── Extract POI nodes by amenity/tourism/historic tags
    │                        → pois table (83k+ rows, PostGIS POINT geometry)
    │
pipeline/scrape_bikercafes.py ─── Scrape ukbikercafes.co.uk
                                   → pois table (1,461 biker spots, category="biker_spot")
```

### Query Architecture

- **Route corridor search** (`GET /api/pois/route`): Uses `ST_DWithin` to find POIs within a configurable radius of the route geometry. Categories are filterable.
- **Name search** (`GET /api/poi-search`): Full-text search on POI names, combined with Nominatim geocoding and UK postcode lookup.
- **Google Places enrichment**: On POI click, optionally fetches photos and ratings from Google Places API (requires `GOOGLE_PLACES_API_KEY`).

### Frontend Integration

- `POIOverlayControls.tsx` -- Compact toolbar on the map with category toggles
- POI markers rendered on the map with click popups showing details + "Add as waypoint" action
- Categories: fuel, hotel, restaurant, pub, castle, viewpoint, museum, cafe, campsite, attraction, biker_spot

### Database: pois table

| Column | Type | Purpose |
|--------|------|---------|
| `id` | BIGSERIAL | Primary key |
| `name` | TEXT | POI name |
| `category` | TEXT | Category (fuel, hotel, biker_spot, etc.) |
| `geometry` | POINT(4326) | Location |
| `tags` | JSONB | OSM tags or scraped metadata |
| `source` | TEXT | `"osm"` or `"bikercafe"` |

**Indexes**: GIST on geometry, B-tree on category.

## Theme System

The application supports light and dark themes via CSS variables and React context.

```
ThemeContext (React context)
    │
    ├── Reads initial theme from localStorage ("theme" key)
    ├── Falls back to system preference (prefers-color-scheme)
    ├── Provides theme + toggleTheme to all components
    │
    ▼
globals.css (CSS custom properties)
    │
    ├── [data-theme="light"]: --page, --surface, --text-primary, --text-muted, --border, etc.
    ├── [data-theme="dark"]:  dark variants of all tokens
    │
    ▼
Tailwind classes use semantic tokens:
    bg-page, bg-surface, text-primary, text-muted, border-border

MapTiler tiles:
    light → streets-v2
    dark  → streets-v2-dark
```

The theme toggle (sun/moon icon) is in the TopNav bar. All components use semantic color tokens, so theme switching is instantaneous with no flash.

## Fuel Cost Estimation

Fuel cost calculation uses vehicle data and user-configured fuel prices.

```
Vehicle (fuel_type, consumption_value, consumption_unit, tank_size_litres)
    +
User Settings (fuel_price_per_litre, electricity_price_per_kwh)
    +
Route Data (distance per day, total distance)
    │
    ▼
fuelCalc.ts
    │
    ├── Convert consumption to litres per km
    ├── Calculate fuel needed per day and full trip
    ├── Calculate fuel cost from price settings
    ├── Calculate fuel stops needed from tank range
    │
    ▼
Display in day cards:
    - Fuel cost per day
    - Full trip fuel cost
    - Number of fuel stops needed
```

## Unit System

The `UnitContext` provides a miles/km toggle persisted in user settings.

- Default: miles (UK-focused platform)
- Toggle location: Profile > Settings
- All distance displays use a `formatDistance()` helper that reads from context
- Day target slider shows both km and miles simultaneously
- Backend stores all distances in meters; conversion is frontend-only

## Save / Update Flow

- **No trip loaded (new route):** Save+ opens Save dialog -> creates new trip
- **Trip loaded (editing):** Save quick-saves in place -> updates the same trip
- **Trip loaded, want a copy:** Save+ opens Save dialog -> creates new trip
- Header shows "Editing: Trip Name" when a loaded trip is active
- **Shared trip (editor):** Save updates the original (owner's trip)
- **Shared trip (viewer):** Save is disabled; use Clone to create own copy

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

### users

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `email` | TEXT | Unique, stored lowercase |
| `name` | TEXT | Display name |
| `password_hash` | TEXT | bcrypt hash |
| `is_admin` | BOOLEAN | Admin privileges |
| `is_blocked` | BOOLEAN | Blocked from all access |
| `created_at`, `updated_at` | TIMESTAMPTZ | Timestamps |

### invite_codes

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `code` | TEXT | Unique 8-char code (token_urlsafe) |
| `created_by` | UUID FK | Admin who generated it |
| `used_by` | UUID FK | User who consumed it (null if unused) |
| `used_at` | TIMESTAMPTZ | When it was used |
| `expires_at` | TIMESTAMPTZ | Optional expiry |

### vehicles

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `user_id` | UUID FK | Owner |
| `type` | TEXT | Default "Motorcycle" |
| `brand`, `model` | TEXT | Manufacturer and model name |
| `year` | INTEGER | Model year |
| `picture_base64` | TEXT | Base64-encoded photo (max ~2MB) |
| `is_default` | BOOLEAN | Default vehicle for the user |
| `fuel_type` | TEXT | petrol, diesel, or electric |
| `consumption_value` | REAL | Fuel consumption value |
| `consumption_unit` | TEXT | mpg or l_per_100km |
| `tank_size_litres` | REAL | Tank capacity in litres |

### adventure_groups

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `name`, `description` | TEXT | Group metadata |
| `target_date` | DATE | Planned ride date |
| `duration_days` | INTEGER | Planned duration |
| `created_by` | UUID FK | Group creator |

### group_members

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `group_id` | UUID FK | Adventure group (CASCADE delete) |
| `user_id` | UUID FK | Member (CASCADE delete) |
| `role` | TEXT | `owner`, `editor`, or `viewer` |
| `joined_at` | TIMESTAMPTZ | When they joined |

Unique constraint on `(group_id, user_id)`.

### group_invitations

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `group_id` | UUID FK | Target group |
| `invited_by` | UUID FK | Who sent the invitation |
| `invited_user_id` | UUID FK | Who is being invited |
| `role` | TEXT | Role they'll get on accept |
| `status` | TEXT | `pending`, `accepted`, `declined` |
| `responded_at` | TIMESTAMPTZ | When they responded |

Unique constraint on `(group_id, invited_user_id)`. Re-inviting resets status to pending.

### group_shared_items

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `group_id` | UUID FK | Which group it's shared with |
| `item_type` | TEXT | `trip` or `route` |
| `item_id` | UUID | FK to `trips.id` or `saved_routes.id` |
| `shared_by` | UUID FK | Who shared it |
| `shared_at` | TIMESTAMPTZ | When it was shared |

### saved_routes

Single-day saved routes with full route data.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `user_id` | UUID FK | Owner (null for legacy pre-auth routes) |
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
| `user_id` | UUID FK | Owner (null for legacy pre-auth trips) |
| `name`, `description` | TEXT | Trip metadata |
| `route_type` | TEXT | scenic / balanced / fast |
| `preferences` | JSONB | Scoring weights |
| `waypoints` | JSONB | ALL waypoints for the full trip |
| `route_data` | JSONB | Full RouteResult (entire trip) |
| `day_overlays` | JSONB | Array of `{day, name, description, start_waypoint_idx, end_waypoint_idx}` |
| `daily_target_m` | REAL | Target daily distance used for auto-split |
| `total_distance_m`, `total_time_s`, `total_moto_score` | REAL | Summary stats |

### user_preferences

Default scoring weights (legacy single-user table, pre-auth).

## Frontend Architecture

Multi-page app with authentication, admin panel, user profile, groups, and the main map planner:

```
layout.tsx (root layout — auth provider, theme provider, nav bar)
│
├── /login → LoginPage
├── /register → RegisterPage (auto-fills invite code from URL ?code=)
├── /admin → AdminPage (invite codes + user management, admin only)
├── /profile → ProfilePage (edit profile, vehicles, change password, settings)
├── /groups → GroupsPage (adventure groups, invitations, shared items)
│
└── / → page.tsx (main map + route planner)
    ├── NavBar.tsx (user menu, invitation badge, admin link, theme toggle)
    │
    ├── Map.tsx (MapLibre GL)
    │   ├── WaypointMarkers.tsx (draggable, selectable, snap-to-road, popup,
    │   │                         reverse-geocoded labels, expandable details)
    │   ├── RouteLayer.tsx (polyline renderer, multi-route)
    │   ├── DayRouteLayer.tsx (per-day coloured route segments)
    │   ├── ScoreOverlay.tsx (colour-coded road quality from Martin tiles)
    │   ├── POIOverlayControls.tsx (category toggle toolbar, POI markers + popups)
    │   └── MapContextMenu.tsx (right-click: add/insert/delete/recalculate)
    │
    ├── AI Chat Panel (✨ AI Trip Planner)
    │   └── components/ai/ (chat input, message list, suggestion cards)
    │
    ├── RoutePanel.tsx (side panel / bottom sheet)
    │   ├── SavedTrips.tsx (load/delete, multi-day badges, per-trip GPX export,
    │   │                    group sharing, ownership badges, clone button)
    │   ├── WaypointList.tsx (search + drag-and-drop list, UK postcode support)
    │   ├── RouteTypeSelector.tsx (scenic/balanced/fast + custom settings)
    │   ├── RouteStats.tsx (distance, time, score, turn-by-turn, per-day filtering)
    │   ├── RouteAnalysis.tsx (anomaly cards + Show + multiple fix buttons,
    │   │                       severity coloring, loop-aware detection)
    │   └── DayPlannerPanel.tsx (multi-day: auto-split, day cards, per-day route types,
    │                             unsync/sync, fuel cost, overnight/fuel suggestions)
    │
    └── SaveTripDialog.tsx (save route modal)
```

**Contexts**:
- `ThemeContext` -- light/dark theme with localStorage persistence; provides `theme` + `toggleTheme`
- `UnitContext` -- miles/km unit system; provides `unit` + `toggleUnit`

**State management**:
- `useAuth` hook -- login state, token storage, user profile, logout
- `useRoute` hook -- waypoints, routes, analysis, preferences, stale indicator. Does NOT auto-recalculate; user triggers manually. Auto-detects per-day route types and uses multi-mode endpoint when needed.
- `useTripPlanner` hook -- day overlays, selected day, daily target, overnight stops. Reads from `useRoute`'s state (never duplicates it). Per-day route type overrides.
- `useAIPlanner` hook -- AI conversation state, message history, sends messages to `/api/ai/chat`, handles structured responses (waypoints, day splits, POIs)
- Loaded trip tracking -- `loadedTripId`, `loadedTripName`, `loadedTripIsMultiday` for in-place save vs save-as-new.

**API clients**:
- `api.ts` -- route planning (including multi-mode), trips, multi-day, GPX, snap-to-road, POIs, settings
- `authApi.ts` -- register, login, profile, password
- `adminApi.ts` -- user management, invite codes
- `aiApi.ts` -- AI trip planner chat

**Utilities**:
- `fuelCalc.ts` -- fuel cost estimation, stops calculation, unit conversion
- `geo.ts` -- geospatial utilities (findInsertIndex, distance calculations)

## Security Design Decisions

| Decision | Rationale |
|----------|-----------|
| Invite-only registration | Keeps the platform private; admin controls who joins |
| No email sending | Simplifies deployment; invite codes shared manually (copy link) |
| Group invitations for existing users only | Avoids external email invites and spam vectors |
| JWT in Authorization header (not cookies) | Simpler CORS, explicit auth, works with API clients |
| Trip ownership checks on update/delete | Users can only modify their own trips; shared access via group membership |
| Shared trips via UNION queries | Owned and shared trips merge into one list without duplicating data |
| Day overlays as lenses (not separate routes) | Editing a day modifies the master route; no sync issues |
| `get_optional_user` dependency | Backwards compatibility during migration from anonymous to authenticated |

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
2. Frontend: POST /api/route {waypoints, route_type} + Authorization header
3. Backend: Validate JWT, check user not blocked
4. Backend: Check cache → hit? return immediately
5. Backend: Build 3-4 Valhalla parameter sets based on route_type
6. Backend: asyncio.gather() → 3-4 parallel Valhalla /route calls
7. Backend: Deduplicate routes (2% distance / 5% time threshold)
8. Backend: asyncio.gather() → parallel PostGIS scoring per route
9. Backend: Sort by moto_score, return top 3
10. Backend: Cache result (5-min TTL)
11. Frontend: Display routes on map + stats panel
12. Frontend: Auto-trigger POST /api/route/analyze (300ms delay)
13. Backend: Run 4 geometry detectors + 2 PostGIS detectors in parallel
14. Frontend: Display anomaly cards with fix buttons
```

## Data Flow: Trip Sharing

```
1. Owner clicks "Share" on a trip in Saved Trips panel
2. Frontend: POST /api/groups/{group_id}/share {item_type, item_id}
3. Backend: Verify user is owner or editor of the group
4. Backend: INSERT into group_shared_items
5. All group members now see the trip in their GET /api/trips response
6. Frontend: Shared trips display with "shared - edit" or "shared - view" badge
7. Editors can load and edit the shared trip (saves update the original)
8. Viewers can view, export GPX, or clone to their own trips
```

## Data Flow: AI Trip Planning

```
1. User opens AI Trip Planner panel and types a message
2. Frontend: POST /api/ai/chat {message, conversation_history, current_waypoints}
3. Backend: trip_ai_orchestrator builds system prompt with motorcycle knowledge
4. Backend: Sends conversation to Gemini API with tool definitions
5. Gemini may call suggest_trip_plan → orchestrator generates waypoints + day splits
6. Gemini may call search_nearby_pois → orchestrator queries PostGIS POI table
7. Backend: Assembles structured response (reply + waypoints + POIs)
8. Frontend: Displays AI reply in chat, shows POI markers on map
9. User can click "Add as waypoint" on any POI suggestion
10. User can accept suggested trip plan to populate route planner
```

## Data Flow: POI Route Corridor Search

```
1. User toggles POI categories on the map toolbar
2. Frontend: GET /api/pois/route?coordinates=...&categories=fuel,hotel&radius_m=5000
3. Backend: Builds route geometry from coordinate array
4. Backend: ST_DWithin query against pois table with category filter
5. Backend: Returns matching POIs with name, category, coordinates, tags
6. Frontend: Renders POI markers on map with category icons
7. User clicks marker → popup with details + optional Google Places enrichment
8. User clicks "Add as waypoint" → inserts POI location into waypoint list
```
