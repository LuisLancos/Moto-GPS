# Moto-GPS

Moto-GPS is a motorcycle navigation platform that finds genuinely good motorcycle routes using context-aware road scoring. Rather than simple "avoid motorways" rules, it scores every road segment on 5 dimensions (curvature, surface quality, scenic interest, elevation, urban density) and uses a Route-Score-Rerank strategy against a pre-scored PostGIS database of 5.15 million UK road segments.

## Key Features

### Route Planning
- **Smart motorcycle routing** with parallel Valhalla fan-out and PostGIS-based reranking
- **3 route presets**: scenic, balanced, fast -- or custom weights for all 5 scoring dimensions
- **Per-day route types** -- each day in a multi-day trip can have its own route type (scenic/balanced/fast), with unsync/sync controls on day cards
- **Route analysis**: 8 anomaly detectors find problems (backtracking, U-turns, missed scenic roads) with one-click fix suggestions. Loop route detection avoids false backtracking alerts on return legs. Severity-based coloring and improved fix actions (move/remove waypoint).
- **Snap-to-road** waypoints via Valhalla's locate API
- **Smart waypoint insertion** at the closest route segment, not just appended
- **Reverse geocoding** -- map clicks auto-resolve to human-readable labels (e.g., "A5, Weedon Bec") via Nominatim, with expandable waypoint details and coordinate copy

### AI Trip Planner (Gemini-Powered)
- **Chat-based interface** in the left panel -- describe your trip in natural language and the AI suggests waypoints, day splits, and POIs
- Conversational trip planning powered by Google Gemini with motorcycle-specific knowledge
- **Function calling**: `suggest_trip_plan` and `search_nearby_pois` (batch) for structured suggestions
- POI suggestions shown on the map as markers with "Add as waypoint" popups
- Backend orchestration via `POST /api/ai/chat` with tool calling pipeline
- Requires `GEMINI_API_KEY` environment variable

### POI Overlay System (PostGIS-Based)
- **83,000+ UK POIs** imported from OpenStreetMap (fuel, hotels, restaurants, pubs, castles, viewpoints, museums, campsites, attractions)
- **1,461 biker-specific cafes/spots** scraped from ukbikercafes.co.uk
- Compact **POI toolbar** on map with category toggles (fuel, hotels, restaurants, pubs, castles, viewpoints, museums, cafes, campsites, attractions, biker spots)
- **Route corridor search**: finds POIs within a configurable distance of the current route
- **POI name search** with combined results from local database, Nominatim, and UK postcode lookup
- Click any POI marker for details popup with "Add as waypoint" action
- Optional **Google Places enrichment** on click for photos and ratings (`GOOGLE_PLACES_API_KEY`)
- Import pipeline: `pipeline/import_pois.py` (OSM PBF), `pipeline/scrape_bikercafes.py`

### Fuel Cost Estimation
- Vehicle fuel data: fuel type, consumption (MPG or L/100km), tank size
- **Per-day and full-trip fuel cost** displayed in day cards
- Fuel stops needed calculated from vehicle tank range
- Cost calculation based on user-configured price per litre/kWh
- Fuel price settings page

### Multi-Day Trip Planning
- Plan multi-day trips as one continuous route with **day overlays** (lenses into the master route)
- **Auto-split** by target daily distance
- **Per-day route stats** -- selecting a day shows that day's distance/time/score, key roads, and turn-by-turn directions
- **Auto-suggest on day split** -- automatically finds nearest hotel/B&B for overnight stops and suggests fuel stops based on tank range
- Per-day GPX export, full-trip ZIP export
- Import trips from GPX files or ZIP bundles

### GPX Import / Export
- Compact GPX 1.1 export (navigation points only, not full track dumps)
- Smart GPX import from Garmin, Calimoto, Kurviger, Google Earth, and any GPX 1.1 source
- Per-day and full-trip export for multi-day trips

### Light/Dark Theme
- System-aware theme with manual toggle in the top nav bar
- CSS variable-based theming with semantic tokens (`--page`, `--surface`, `--text-primary`, etc.)
- Theme persisted in localStorage via ThemeContext
- MapTiler tiles switch between `streets-v2` (light) and `streets-v2-dark` (dark)
- All components use semantic color tokens (`bg-page`, `bg-surface`, `text-primary`, `text-muted`, `border-border`)

### Unit System (Miles / Km)
- User-selectable unit system with miles as default
- Toggle in Profile > Settings via UnitContext
- All distances displayed in the user's preferred unit
- Day target slider shows both km and miles

### UK Postcode Search
- Search bar recognizes UK postcodes (e.g., "SS0 0BD")
- Uses postcodes.io API (free, no key needed)
- Results combined with Nominatim and local POI search

### User Management
- **Invite-only registration** -- admins generate invite codes, share registration links manually
- JWT-based authentication with Bearer tokens (24-hour expiry)
- User profiles with name, email, password management
- **Vehicle garage** -- add motorcycles with type, brand, model, year, photo, fuel type, consumption, and tank size
- **Admin panel** -- generate/delete invite codes, block/unblock users, promote/demote admins

### Adventure Groups
- Create groups with name, description, target date, and duration
- **Role-based access**: owner, editor, viewer
- Invite existing platform users by searching name/email
- Group invitation system with pending/accepted/declined status and notification badge

### Trip & Route Sharing
- Share trips and routes with adventure groups from the Saved Trips panel
- Group-shared trips appear in each member's trip list with ownership indicators
- **Editors** can edit shared routes; **viewers** can only view and export
- **Clone** shared items to create your own independent copy
- Only the trip owner can delete; group owner or original sharer can unshare

## Architecture

```
Browser (Next.js 16 + MapLibre GL)
        |
        | REST API (JWT auth)
        v
FastAPI Backend (Python 3.13)
   |         |         |         |
   v         v         v         v
Valhalla   PostGIS   Martin   Gemini API
(routing)  (scores,  (vector  (AI trip
 :8010     users,     tiles)   planner)
           POIs,      :3002
           groups)
           :5434
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for full system design, database schema, and data flow.

## Quick Start

```bash
# 1. Clone and configure
git clone <repo-url> && cd Moto-GPS
cp .env.example .env
# Edit .env: set NEXT_PUBLIC_MAPTILER_KEY, JWT_SECRET, ADMIN_PASSWORD
# Optional: set GEMINI_API_KEY (AI planner), GOOGLE_PLACES_API_KEY (POI enrichment)

# 2. Start Docker services (PostGIS, Valhalla, Martin)
docker compose up -d

# 3. Run data pipeline (first time only, ~25 min)
cd pipeline && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python run_pipeline.py --step download,import,score

# 3b. Import POIs (optional, enables POI overlay)
python import_pois.py          # Import 83k+ UK POIs from OSM
python scrape_bikercafes.py    # Import 1,461 biker cafes

# 4. Start backend
cd ../backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m app.cli.seed_admin          # Create first admin user
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 5. Start frontend
cd ../web && npm install && npm run dev
# Open http://localhost:3001
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed setup, Docker service configuration, and troubleshooting.

## Documentation

| Document | Contents |
|----------|----------|
| [README.md](README.md) | This file -- project overview and quick start |
| [API.md](API.md) | Full REST API reference with request/response examples |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, database schema, data flow, frontend structure |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Local setup, Docker services, pipeline, environment variables |
| [PIPELINE.md](PIPELINE.md) | Road scoring data pipeline details |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, MapLibre GL, TypeScript |
| Backend | FastAPI, Python 3.13, SQLAlchemy (async), Pydantic |
| Database | PostgreSQL 16 + PostGIS 3.4 |
| Routing | Valhalla (motorcycle costing) |
| AI | Google Gemini (trip planner with function calling) |
| Tiles | Martin (vector tile server) |
| Auth | JWT (PyJWT), bcrypt password hashing |
| Maps | MapTiler (basemap tiles, light/dark themes) |
| POI Data | OpenStreetMap (Overpass/PBF), ukbikercafes.co.uk, Google Places (optional) |
| Geocoding | Nominatim (reverse geocoding), postcodes.io (UK postcode lookup) |

## Security Model

- **Invite-only**: no self-registration; admins generate invite codes
- **JWT authentication**: all API endpoints (except health and login/register) require `Authorization: Bearer <token>`
- **Trip ownership**: users can only modify/delete their own trips
- **Group-based sharing**: shared trips accessible via group membership with role-based permissions
- **Admin isolation**: admin endpoints (`/api/admin/*`) protected by `get_current_admin` dependency
- **Blocked users**: cannot log in or access any authenticated endpoint
