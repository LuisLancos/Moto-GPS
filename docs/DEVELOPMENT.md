# Development Guide

Complete instructions for running Moto-GPS locally.

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Docker + Docker Compose | v2+ | `docker compose version` |
| Python | 3.13+ | `python3 --version` |
| Node.js | 22+ | `node --version` |
| npm | 10+ | `npm --version` |

## Port Map

All services and their ports at a glance:

| Service | Type | Internal Port | External Port | URL |
|---------|------|--------------|---------------|-----|
| **PostgreSQL + PostGIS** | Docker | 5432 | **5434** | `postgresql://motogps:motogps_dev@localhost:5434/motogps` |
| **Valhalla** (routing) | Docker | 8002 | **8010** | `http://localhost:8010/status` |
| **Martin** (vector tiles) | Docker | 3000 | **3002** | `http://localhost:3002/catalog` |
| **FastAPI Backend** | Native | — | **8000** | `http://localhost:8000/health` |
| **Next.js Web App** | Native | — | **3001** | `http://localhost:3001` |

> Docker services use remapped ports (5434, 8010, 3002) to avoid conflicts with local installations. Native services use standard ports (8000, 3001).

## Step-by-Step Setup

### 1. Clone and Configure

```bash
git clone <repo-url>
cd Moto-GPS
cp .env.example .env
```

Edit `.env` and set your MapTiler API key, JWT secret, and admin credentials:

```env
POSTGRES_USER=motogps
POSTGRES_PASSWORD=motogps_dev
POSTGRES_DB=motogps
POSTGRES_HOST=localhost
POSTGRES_PORT=5434

VALHALLA_URL=http://localhost:8010
MARTIN_URL=http://localhost:3002

# Get a free key at https://cloud.maptiler.com (100k requests/month)
NEXT_PUBLIC_MAPTILER_KEY=your_key_here

BACKEND_URL=http://localhost:8000

# JWT Authentication (CHANGE IN PRODUCTION!)
JWT_SECRET=change-me-in-production

# Admin seed credentials (used by: python -m app.cli.seed_admin)
ADMIN_EMAIL=admin@motogps.local
ADMIN_NAME=Admin
ADMIN_PASSWORD=change-me-in-production

# AI Trip Planner (optional — enables the AI chat panel)
GEMINI_API_KEY=your_gemini_api_key_here

# Google Places enrichment for POIs (optional — enables photo/rating lookups)
GOOGLE_PLACES_API_KEY=your_google_places_api_key_here
```

### 2. Start Docker Services

```bash
docker compose up -d
```

This starts 3 containers:

| Container | What happens on first start | Subsequent starts |
|-----------|-----------------------------|-------------------|
| `moto-gps-postgres-1` | Creates database, runs `init.sql` schema | Instant (data persisted in `data/postgres/`) |
| `moto-gps-valhalla-1` | Downloads UK OSM data (~2GB), builds routing tiles (~30-60 min) | Instant (tiles cached in `data/valhalla/`) |
| `moto-gps-martin-1` | Connects to PostGIS, serves vector tiles | Instant |

**Check service health:**

```bash
# All services
docker compose ps

# Individual checks
docker compose logs valhalla --tail 5   # Watch tile building progress
curl http://localhost:8010/status        # Valhalla ready? (fails until tiles built)
curl http://localhost:3002/catalog       # Martin tile catalog
docker compose exec postgres pg_isready -U motogps  # PostgreSQL ready?
```

**First run: Valhalla takes 30-60 minutes** to download and build tiles. You can start the pipeline and backend while it builds — they don't depend on Valhalla. Route planning will fail until Valhalla is ready, but road scoring and the web app will work.

### 3. Run the Data Pipeline (first time only)

```bash
cd pipeline
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Run everything:
python run_pipeline.py --step download,import,score

# Or run individual steps:
python run_pipeline.py --step download    # ~5 min (download UK PBF + SRTM)
python run_pipeline.py --step import      # ~10 min (extract 5.15M road segments)
python run_pipeline.py --step score       # ~10 min (curvature + surface + urban + composite)
```

Verify the import worked:

```bash
PGPASSWORD=motogps_dev psql -h localhost -p 5434 -U motogps -d motogps \
  -c "SELECT count(*) FROM road_segments;"
# Expected: ~5,150,000 rows
```

### 3b. Import POIs (optional, enables POI overlay)

The POI pipeline imports points of interest from OpenStreetMap and biker cafe data. This is separate from the road scoring pipeline and can be run at any time.

```bash
cd pipeline
source .venv/bin/activate

# Import 83,000+ UK POIs from OSM (fuel, hotels, restaurants, pubs, castles, etc.)
python import_pois.py

# Import 1,461 biker-specific cafes/spots from ukbikercafes.co.uk
python scrape_bikercafes.py
```

Verify POIs were imported:

```bash
PGPASSWORD=motogps_dev psql -h localhost -p 5434 -U motogps -d motogps \
  -c "SELECT source, count(*) FROM pois GROUP BY source;"
# Expected: osm ~83,000, bikercafe ~1,461
```

### 4. Start the Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Development (auto-reload on code changes):
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Or production:
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

Verify:

```bash
curl http://localhost:8000/health
# {"status":"ok","service":"moto-gps-api"}
```

### 4b. Seed the Admin User (first time only)

The platform uses invite-only registration, so you need an admin user to generate the first invite codes.

```bash
cd backend
source .venv/bin/activate

# Uses ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD from .env
python -m app.cli.seed_admin

# Or override with CLI args:
python -m app.cli.seed_admin --email admin@motogps.local --name Admin --password your-password
```

This creates the first admin user. If you had any saved routes/trips from before auth was added, they'll be assigned to this admin user.

After seeding, you can:
1. Log in at http://localhost:3001/login with the admin credentials
2. Go to http://localhost:3001/admin to generate invite codes
3. Share registration links (`/register?code=ABC`) with other users

### 5. Start the Web App

```bash
cd web
npm install
npm run dev
# Open http://localhost:3001
```

The dev server has hot-reload — changes to `.tsx`/`.ts` files reflect instantly.

### 6. Verify Everything Works

1. Open **http://localhost:3001** -- you should see the login page
2. Log in with the admin credentials from step 4b
3. Go to **/admin** and generate an invite code
4. Open **/register?code=YOUR_CODE** in an incognito window to test registration
5. Back in the main window, click two points on the map to add waypoints
6. Click **"Plan Route"** -- routes should appear in 2-4 seconds
7. Check the **Route Analysis** panel below route stats for anomaly detection
8. Try the road score overlay toggle on the map (if Martin is healthy)
9. Save a trip, then try sharing it via the Groups page
10. Toggle the **theme** using the sun/moon icon in the top nav bar
11. Toggle **POI categories** on the map toolbar (fuel, hotels, etc.) -- requires POI import from step 3b
12. Open the **AI Trip Planner** panel (requires `GEMINI_API_KEY`) and try describing a trip
13. Check **Profile > Settings** for unit system (miles/km) and fuel price configuration
14. Try searching for a **UK postcode** (e.g., "SW1A 1AA") in the search bar

## Docker Service Details

### PostgreSQL + PostGIS

```yaml
# docker-compose.yml
postgres:
  image: postgis/postgis:16-3.4
  ports: ["5434:5432"]          # External 5434, internal 5432
  environment:
    POSTGRES_USER: ${POSTGRES_USER}
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    POSTGRES_DB: ${POSTGRES_DB}
  volumes:
    - ./data/postgres:/var/lib/postgresql/data           # Persistent data
    - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql  # Schema
```

**Connect directly:**
```bash
PGPASSWORD=motogps_dev psql -h localhost -p 5434 -U motogps -d motogps
```

**Useful queries:**
```sql
-- Road segment count
SELECT count(*) FROM road_segments;

-- Score distribution
SELECT
  CASE
    WHEN composite_moto_score >= 0.7 THEN 'excellent'
    WHEN composite_moto_score >= 0.5 THEN 'good'
    WHEN composite_moto_score >= 0.3 THEN 'decent'
    ELSE 'poor'
  END AS quality,
  count(*)
FROM road_segments
GROUP BY 1 ORDER BY 1;

-- Top 10 roads
SELECT name, ref, road_class, composite_moto_score
FROM road_segments
WHERE name IS NOT NULL
ORDER BY composite_moto_score DESC
LIMIT 10;

-- Users
SELECT id, name, email, is_admin, is_blocked, created_at FROM users ORDER BY created_at DESC;

-- Invite codes with status
SELECT ic.code, ic.expires_at, ic.used_at, creator.name AS created_by, consumer.name AS used_by
FROM invite_codes ic
JOIN users creator ON creator.id = ic.created_by
LEFT JOIN users consumer ON consumer.id = ic.used_by
ORDER BY ic.created_at DESC;

-- Saved routes (single-day) with owner
SELECT sr.id, sr.name, sr.route_type, sr.total_distance_m, u.name AS owner, sr.created_at
FROM saved_routes sr LEFT JOIN users u ON u.id = sr.user_id
ORDER BY sr.created_at DESC;

-- Multi-day trips with owner
SELECT t.id, t.name, t.route_type, t.total_distance_m,
       jsonb_array_length(t.day_overlays) AS days,
       u.name AS owner, t.created_at
FROM trips t LEFT JOIN users u ON u.id = t.user_id
ORDER BY t.created_at DESC;

-- Groups with member count
SELECT g.name, g.target_date,
       (SELECT count(*) FROM group_members gm WHERE gm.group_id = g.id) AS members,
       (SELECT count(*) FROM group_shared_items gsi WHERE gsi.group_id = g.id) AS shared_items
FROM adventure_groups g ORDER BY g.created_at DESC;

-- Pending invitations
SELECT gi.status, g.name AS group_name, u.name AS invited_user
FROM group_invitations gi
JOIN adventure_groups g ON g.id = gi.group_id
JOIN users u ON u.id = gi.invited_user_id
WHERE gi.status = 'pending';

-- POI counts by category and source
SELECT category, source, count(*)
FROM pois
GROUP BY category, source
ORDER BY category, source;

-- Sample POIs near a coordinate (e.g., London)
SELECT name, category, ST_AsText(geometry)
FROM pois
WHERE ST_DWithin(geometry, ST_SetSRID(ST_MakePoint(-0.1, 51.5), 4326), 0.05)
LIMIT 10;
```

### Valhalla (Routing Engine)

```yaml
valhalla:
  image: ghcr.io/nilsnolde/docker-valhalla/valhalla:latest
  ports: ["8010:8002"]          # External 8010, internal 8002
  environment:
    - tile_urls=https://download.geofabrik.de/europe/great-britain-latest.osm.pbf
    - force_rebuild=False       # Set True to rebuild tiles from scratch
    - build_elevation=True
    - server_threads=8          # Parallel routing threads
    - serve_tiles=True
  volumes:
    - ./data/valhalla:/custom_files   # Tiles + config cached here (~9GB)
```

**Key runtime config** (`data/valhalla/valhalla.json`):
```json
{
  "mjolnir": {
    "concurrency": 8,
    "max_concurrent_reader_users": 8,   // Critical: was 1, serialised all I/O
    "use_lru_mem_cache": true,           // Cache tiles in RAM
    "max_cache_size": 1000000000         // 1GB tile cache
  }
}
```

**Test routing directly:**
```bash
curl -X POST http://localhost:8010/route \
  -H "Content-Type: application/json" \
  -d '{
    "locations": [{"lat":51.5,"lon":-0.1}, {"lat":51.6,"lon":-0.2}],
    "costing": "motorcycle",
    "costing_options": {"motorcycle": {"use_highways": 0.5, "use_hills": 0.5}},
    "units": "kilometers"
  }'
```

### Martin (Vector Tile Server)

```yaml
martin:
  image: ghcr.io/maplibre/martin:latest
  ports: ["3002:3000"]          # External 3002, internal 3000
  volumes:
    - ./docker/martin/config.yaml:/config.yaml
  depends_on:
    postgres: { condition: service_healthy }
```

Martin serves the `road_segments` table as vector tiles for the map overlay. Config is at `docker/martin/config.yaml`.

**Check tile catalog:**
```bash
curl http://localhost:3002/catalog
```

## Docker Management

```bash
# Start all services
docker compose up -d

# Stop all services (data preserved)
docker compose down

# Stop and delete all data (fresh start)
docker compose down -v && rm -rf data/

# View logs
docker compose logs -f              # All services
docker compose logs valhalla -f     # Just Valhalla
docker compose logs postgres -f     # Just PostgreSQL

# Restart a single service
docker compose restart valhalla

# Check resource usage
docker stats
```

## Database Migrations

If you already have a running Moto-GPS database from before user management was added, run the migration to add the new tables:

```bash
PGPASSWORD=motogps_dev psql -h localhost -p 5434 -U motogps -d motogps \
  -f backend/app/db/migrations/001_users_and_groups.sql
```

This adds: `users`, `invite_codes`, `vehicles`, `adventure_groups`, `group_members`, `group_invitations`, `group_shared_items` tables, and adds `user_id` columns to `saved_routes` and `trips`.

The `pois` table is created automatically by the POI import pipeline (`import_pois.py`). It includes a PostGIS POINT geometry column with a GIST index and a B-tree index on category. Vehicle fuel fields (`fuel_type`, `consumption_value`, `consumption_unit`, `tank_size_litres`) are added by schema evolution in the init.sql.

For fresh installs, `docker/postgres/init.sql` already includes all tables.

After the migration, run `python -m app.cli.seed_admin` to create the first admin user and assign orphan routes/trips.

## Common Issues

### Valhalla shows "unhealthy"

Valhalla takes 30-60 minutes on first start to build tiles. Check progress:
```bash
docker compose logs valhalla --tail 20
```
Look for messages like "Building tiles...", "Finished with X graph edges". Once you see "Listening for requests", it's ready.

### Port already in use

```bash
# Find what's using a port
lsof -i :8000

# Kill it
lsof -i :8000 -t | xargs kill
```

### PostGIS connection refused

Check PostgreSQL is running and healthy:
```bash
docker compose ps postgres
docker compose logs postgres --tail 10
```

The backend connects to `localhost:5434` (not the default 5432). Ensure `.env` has `POSTGRES_PORT=5434`.

### Route planning returns 502

Usually means Valhalla isn't ready. Check:
```bash
curl http://localhost:8010/status
```
If it fails, Valhalla is still building tiles. Wait for it to become healthy.

### Martin shows no tiles

Martin depends on PostGIS data. Run the pipeline first:
```bash
cd pipeline && python run_pipeline.py --step download,import,score
```

Then restart Martin:
```bash
docker compose restart martin
```

## Environment Variables Reference

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `POSTGRES_USER` | `motogps` | Docker, Backend, Pipeline | PostgreSQL username |
| `POSTGRES_PASSWORD` | `motogps_dev` | Docker, Backend, Pipeline | PostgreSQL password |
| `POSTGRES_DB` | `motogps` | Docker, Backend, Pipeline | Database name |
| `POSTGRES_HOST` | `localhost` | Backend, Pipeline | PostgreSQL host |
| `POSTGRES_PORT` | `5434` | Backend, Pipeline | PostgreSQL external port |
| `VALHALLA_URL` | `http://localhost:8010` | Backend | Valhalla routing API URL |
| `MARTIN_URL` | `http://localhost:3002` | Web | Martin vector tile URL |
| `NEXT_PUBLIC_MAPTILER_KEY` | -- | Web | MapTiler API key for basemap tiles |
| `BACKEND_URL` | `http://localhost:8000` | Web | Backend API URL |
| `JWT_SECRET` | `change-me-in-production` | Backend | Secret key for JWT signing (HS256). **Change in production!** |
| `JWT_ALGORITHM` | `HS256` | Backend | JWT signing algorithm |
| `JWT_EXPIRE_MINUTES` | `1440` | Backend | Token lifetime in minutes (default: 24 hours) |
| `ADMIN_EMAIL` | `admin@motogps.local` | seed_admin CLI | Email for the seed admin user |
| `ADMIN_NAME` | `Admin` | seed_admin CLI | Display name for the seed admin |
| `ADMIN_PASSWORD` | `change-me-in-production` | seed_admin CLI | Password for the seed admin. **Change in production!** |
| `GEMINI_API_KEY` | -- | Backend | Google Gemini API key for AI trip planner. Optional; AI panel hidden if not set. |
| `GOOGLE_PLACES_API_KEY` | -- | Backend | Google Places API key for POI photo/rating enrichment. Optional; POIs work without it. |

## Project File Structure

```
Moto-GPS/
  .env                        <- Your local config (gitignored)
  .env.example                <- Template (includes JWT + admin seed vars)
  docker-compose.yml          <- 3 Docker services
  start.sh                    <- Quick start script

  docker/
    postgres/init.sql          <- Database schema (PostGIS + all tables + indexes)
    valhalla/valhalla.json     <- Valhalla source config (concurrency, limits)
    martin/config.yaml         <- Martin tile server config

  data/                        <- Docker volumes (gitignored, ~17GB total)
    postgres/                  <- PostgreSQL data files (~8GB)
    valhalla/                  <- Routing tiles + runtime config (~9GB)
    elevation/                 <- SRTM elevation tiles

  backend/
    requirements.txt
    app/
      main.py                  <- FastAPI app entry point (registers all routers)
      config.py                <- Pydantic settings (reads .env, includes JWT + AI config)
      auth/
        __init__.py
        jwt.py                 <- JWT token creation + validation (HS256)
        passwords.py           <- bcrypt password hashing + verification
        dependencies.py        <- FastAPI deps: get_current_user, get_current_admin, get_optional_user
      cli/
        __init__.py
        seed_admin.py          <- CLI: create first admin user + assign orphan trips
      api/
        routes.py              <- POST /api/route + /api/route/analyze + /api/route/snap + /api/route/multi-mode
        trips.py               <- Saved routes CRUD (single-day, with ownership)
        trip_planner.py        <- Multi-day trips: CRUD, auto-split, per-day GPX, import
        gpx.py                 <- GPX import/export (single route + trip ZIP)
        auth.py                <- Register, login, profile, change password
        admin.py               <- User management, invite code generation/deletion
        vehicles.py            <- Vehicle CRUD (type, brand, model, year, picture, fuel data)
        groups.py              <- Adventure groups, members, invitations, sharing, user search
        ai_planner.py          <- POST /api/ai/chat (AI trip planner endpoint)
      services/
        valhalla_client.py     <- HTTP client to Valhalla (persistent connection)
        road_scorer.py         <- PostGIS spatial scoring
        route_analyzer.py      <- Anomaly detection (8 detectors, loop-aware, multiple fix options)
        scenic_attractors.py   <- Find nearby scenic roads
        route_cache.py         <- In-memory TTL cache
        ai_client.py           <- Gemini API wrapper with function calling
        trip_ai_orchestrator.py <- AI conversation orchestration + tool execution
        poi_service.py         <- POI queries (route corridor, name search)
        google_places.py       <- Google Places API client (optional enrichment)
        overpass_client.py     <- Overpass API client for OSM queries
      models/
        route.py               <- Pydantic models (route, analysis, trips, sharing/ownership)
        group.py               <- Pydantic models (GroupCreate, InviteUserRequest, ShareItemRequest, etc.)
        vehicle.py             <- Pydantic models (VehicleCreate, VehicleUpdate, VehicleResponse + fuel fields)
        ai_planner.py          <- Pydantic models (AIChatRequest, AIChatResponse, POISuggestion)
      db/
        database.py            <- SQLAlchemy async engine + session pool
        migrations/
          001_users_and_groups.sql  <- Migration: users, invite codes, vehicles, groups, sharing

  pipeline/
    run_pipeline.py            <- Pipeline orchestrator (road scoring)
    download.py                <- Download OSM + SRTM data
    osm_to_postgis.py          <- Import roads to PostGIS
    curvature.py               <- Curvature scoring
    surface_scorer.py          <- Surface quality scoring
    urban_density.py           <- Urban vs rural scoring
    road_classifier.py         <- Road classification
    composite_scorer.py        <- Final weighted score
    import_pois.py             <- Import 83k+ UK POIs from OSM PBF
    scrape_bikercafes.py       <- Scrape 1,461 biker cafes from ukbikercafes.co.uk
    poi_importer.py            <- POI import utilities

  web/
    package.json
    next.config.ts
    src/
      app/
        globals.css            <- CSS custom properties for light/dark theming
        layout.tsx             <- Root layout (auth provider, theme provider, nav bar)
        page.tsx               <- Main page (map + panel)
        login/page.tsx         <- Login page
        register/page.tsx      <- Registration page (auto-fills invite code from URL)
        admin/page.tsx         <- Admin panel: invite codes + user management
        profile/page.tsx       <- User profile: edit info, vehicles, change password, settings
        groups/page.tsx        <- Adventure groups: create, manage, invitations, sharing
      components/
        auth/                  <- Authentication components
          AuthProvider.tsx     <- Auth context provider (token, user state)
          ClientProviders.tsx  <- Wraps ThemeContext, UnitContext, AuthProvider
          ProtectedRoute.tsx   <- Route guard for authenticated pages
        nav/
          NavBar.tsx           <- Top nav: user menu, invitation badge, admin link, theme toggle
        ai/                    <- AI trip planner components
          (chat panel UI)      <- Chat input, message list, suggestion cards
        map/                   <- Map, markers, route layers, score overlay, context menu
          Map.tsx              <- MapLibre wrapper with route/day/anomaly layers + theme-aware tiles
          WaypointMarkers.tsx  <- Draggable, selectable markers with popup + reverse geocoding
          RouteLayer.tsx       <- Standard route polyline
          DayRouteLayer.tsx    <- Per-day coloured route segments
          ScoreOverlay.tsx     <- Road score colour overlay (Martin tiles)
          POIOverlayControls.tsx <- POI category toolbar + marker rendering
          MapContextMenu.tsx   <- Right-click context menu
        route/                 <- Panel, stats, analysis, trips, preferences
          RoutePanel.tsx       <- Main sidebar (orchestrates all sub-components)
          RouteAnalysis.tsx    <- Anomaly cards with Show + fixes, severity coloring
          DayPlannerPanel.tsx  <- Multi-day: auto-split, day cards, per-day route types,
                                  fuel cost, overnight/fuel suggestions
          SavedTrips.tsx       <- Trip list: ownership badges, group sharing, clone
          WaypointList.tsx     <- Search + drag-and-drop + UK postcode support
          RouteTypeSelector.tsx<- Scenic/balanced/fast presets
          RouteStats.tsx       <- Distance, time, score, turn-by-turn, per-day filtering
          SaveTripDialog.tsx   <- Name + description modal
      contexts/
        ThemeContext.tsx        <- Light/dark theme context with localStorage persistence
        UnitContext.tsx         <- Miles/km unit system context
      lib/
        api.ts                 <- API client (routes, multi-mode, trips, GPX, snap, POIs, settings)
        authApi.ts             <- Auth API client (register, login, profile, password)
        adminApi.ts            <- Admin API client (users, invite codes)
        aiApi.ts               <- AI planner API client (chat)
        types.ts               <- TypeScript types (mirrors backend models + auth/group/AI types)
        geo.ts                 <- Geospatial utilities (findInsertIndex)
        fuelCalc.ts            <- Fuel cost estimation + stops calculation
      hooks/
        useAuth.ts             <- Auth state (login, logout, token, user profile)
        useRoute.ts            <- Route state (waypoints, routes, stale indicator, analysis, multi-mode)
        useTripPlanner.ts      <- Multi-day state (day overlays, per-day route types, overnight stops)
        useAIPlanner.ts        <- AI planner state (conversation, message sending, response handling)
```
