# Moto-GPS — Smart Motorcycle Route Planner

**Plan motorcycle routes that actually make sense.**

Every existing GPS app treats route planning as a binary choice: "avoid motorways" or "prefer curvy roads." The result? Scenic mode sends you down a farm track when you just need to cross a town. Fast mode ignores a gorgeous mountain pass 2 miles off the motorway.

Moto-GPS fixes this. It scores every road in the UK on 5 dimensions — curvature, surface quality, scenic interest, elevation, and urban density — then uses AI-powered planning to build routes that are scenic in the countryside and practical through towns. The way a motorcyclist actually rides.

---

## What Makes Moto-GPS Different

### 1. Context-Aware Routing (Not Binary Rules)

Other apps apply one rule to the entire route. Moto-GPS scores **5.15 million UK road segments** individually and picks the best combination:

- **Scenic countryside?** → B-roads, mountain passes, coastal stretches
- **Crossing a city?** → Dual carriageways and ring roads (fast, not frustrating)
- **Quick transit day?** → Motorways to get there, then twisties when you arrive

You can even set **different route modes per day** — Day 1 on the motorway to reach the mountains, Day 2 on scenic B-roads enjoying them.

### 2. AI Trip Planner — Describe It, Ride It

Tell the AI what you want in plain English:

> *"Plan a 3-day trip from Southend to Scotland. Scenic with twisties, bit of coastal and mountains. Max 200 miles per day."*

The AI (powered by Google Gemini) builds the entire trip: waypoints, day splits, overnight hotels, fuel stops, and points of interest — castles, biker cafes, viewpoints. One click to apply it all to the map.

No other motorcycle GPS app has this.

### 3. 83,000+ Points of Interest on the Map

Not just fuel stations. Moto-GPS has **83,000+ UK POIs** from OpenStreetMap plus **1,461 curated biker-specific spots** — cafes, meetup points, and hangouts from ukbikercafes.co.uk.

Toggle categories on/off: Fuel, Hotels, Restaurants, Pubs, Castles, Viewpoints, Museums, Cafes, Campsites, Attractions, Biker Spots.

Click any POI for details and add it as a waypoint with one tap.

### 4. Smart Multi-Day Trip Planning

Plan a full trip, then split it into daily segments. Each day is a **lens into the master route** — not a separate route that gets out of sync.

- **Auto-split** by your preferred daily mileage (configurable per route type in settings)
- **Auto-suggest overnight stays** — finds the nearest hotel/B&B to each day's endpoint
- **Auto-suggest fuel stops** — calculates from your motorcycle's actual tank range and consumption
- **Per-day stats** — select a day to see its distance, time, score, key roads, and turn-by-turn directions
- **Per-day route type** — motorway one day, scenic the next

### 5. Fuel Cost Intelligence

Register your motorcycle with its fuel type, consumption (MPG), and tank size. Moto-GPS then:

- Calculates **fuel cost per day and per trip**
- Shows how many **fuel stops you'll need** based on your tank range
- Suggests actual fuel stations from the POI database along your route

### 6. Adventure Groups — Plan Together, Ride Together

Create an Adventure Group, invite your riding mates, share routes and trips. Group members can:

- **Editors**: Collaboratively edit routes and trips
- **Viewers**: View and export routes, but can't modify
- **Clone**: Copy any shared trip to your own collection

Every member sees shared trips in their Saved Trips panel with the group name as a badge.

### 7. Route Analysis That Actually Helps

After planning a route, the analyzer checks for 8 types of problems:

- Backtracking (smart enough to know loop routes aren't backtracking)
- Close waypoints that can be merged
- Excessive detours
- U-turns
- Road quality drops
- Missed scenic roads nearby

Each problem shows on the map with one-click fixes.

### 8. Works With Your Existing GPS

Export routes as **compact GPX files** (30-80 navigation points, not 17,000-point track dumps) that work with Garmin, Calimoto, Kurviger, and any GPX 1.1 device. Import routes from any of those apps too.

---

## Feature Comparison

| Feature | Moto-GPS | Calimoto | Kurviger | Google Maps |
|---------|:--------:|:--------:|:--------:|:-----------:|
| Motorcycle-specific routing | 5-dimension scoring | Basic | Good | No |
| Context-aware (scenic + practical) | Yes | No | No | No |
| AI trip planning (natural language) | Yes | No | No | No |
| Per-day route modes | Yes | No | No | No |
| 83k+ POIs on map | Yes | Limited | Limited | Yes |
| Biker-specific POIs (1,461) | Yes | No | No | No |
| Multi-day trip planning | Yes | No | Basic | No |
| Fuel cost estimation | Yes | No | No | No |
| Auto-suggest hotels + fuel stops | Yes | No | No | No |
| Group collaboration | Yes | No | No | No |
| Route analysis + fix suggestions | Yes | No | No | No |
| GPX import/export | Yes | Yes | Yes | No |
| Light + dark theme | Yes | Yes | Yes | Yes |
| Self-hosted (own data) | Yes | No | No | No |

---

## How It Works

```
You describe your trip (or click waypoints on the map)
        |
        v
   AI Trip Planner (Gemini)
   suggests waypoints, days, POIs
        |
        v
   Route-Score-Rerank Engine
   |-- Valhalla generates candidate routes (parallel fan-out)
   |-- PostGIS scores each against 5.15M road segments
   '-- Best routes ranked by motorcycle suitability score
        |
        v
   Route displayed on MapLibre GL map
   with POI overlay, day overlays, and analysis
```

The **Route-Score-Rerank** strategy:

1. **Generate candidates** — Fire 3-4 parallel requests to Valhalla with different motorcycle costing parameters (scenic, balanced, fast)
2. **Score against road data** — Match each route against 5.15M pre-scored UK road segments in PostGIS (curvature, surface quality, scenicness, urban density, elevation)
3. **Rank and return** — Deduplicate near-identical results and return the top 3 routes sorted by motorcycle quality score
4. **Analyse for anomalies** — Detect backtracking, U-turns, missed scenic roads, and suggest one-click fixes

---

## Architecture

```
                    +-------------------+
                    |   Next.js Web     | :3001
                    |   (MapLibre GL)   |
                    +---------+---------+
                              |
                    +---------v---------+
                    |  FastAPI Backend   | :8000
                    |  (route planner)   |
                    +---+----------+----+
                        |          |
           +------------v--+  +---v---------------+
           |   Valhalla     |  |  PostGIS           |
           | (routing)      |  | (road scores, POIs)|
           | :8010          |  | :5434              |
           +----------------+  +---------+----------+
                                         |
                                +--------v----------+
                                |  Martin            |
                                | (vector tiles)     |
                                | :3002              |
                                +--------------------+
```

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Frontend | Next.js 16, React 19, Tailwind CSS | Responsive web app with server-side rendering |
| Map display | MapLibre GL JS | Open-source vector map rendering |
| Backend API | FastAPI, Python 3.13, SQLAlchemy async | Route planning, scoring, analysis, auth |
| Database | PostgreSQL 16 + PostGIS 3.4 | 5.15M road segments, 83K POIs, users, trips |
| Routing engine | Valhalla | Motorcycle-profile route generation |
| AI planner | Google Gemini (with OpenAI fallback) | Conversational trip planning with function calling |
| Tile server | Martin (Rust) | Real-time PostGIS-to-vector tiles for road score overlay |
| Basemap | MapTiler (free tier) | Map styling and tile hosting (light/dark themes) |
| Map data | OpenStreetMap | Road network, POI data |

### Performance

Route planning for a 170-mile route (e.g., Midlands to Southend-on-Sea):

| Phase | Time |
|-------|------|
| Valhalla routing (4 parallel calls) | ~1.5-3s |
| PostGIS scoring (parallel) | ~0.3-0.5s |
| Route analysis (8 detectors) | ~0.3-0.5s |
| **Total** | **~2-4s** |

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Docker Desktop** | 24+ | Runs PostGIS, Valhalla, Martin |
| **Python** | 3.11+ | Backend + data pipeline |
| **Node.js** | 20+ | Next.js frontend |
| **Git** | 2.30+ | Clone the repo |
| **Disk space** | ~15 GB | Valhalla tiles (~8GB) + PostGIS data (~5GB) + OSM PBF (~1.5GB) |

**API keys needed** (all free tier):

| Key | Required | Where to get it |
|-----|----------|----------------|
| MapTiler | **Yes** | [maptiler.com/cloud](https://www.maptiler.com/cloud/) — free, 100k tiles/month |
| Gemini | Recommended | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — free, enables AI planner |
| Google Places | Optional | [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) — POI photo enrichment |

---

## Installation

### Quick Start (one command)

```bash
git clone <repo-url> && cd Moto-GPS
cp .env.example .env
# Edit .env — set at minimum: NEXT_PUBLIC_MAPTILER_KEY, JWT_SECRET, ADMIN_PASSWORD
# Recommended: set GEMINI_API_KEY for AI trip planner

./start.sh
```

The `start.sh` script handles everything: Docker services, Python venv, npm install, admin seeding, and health checks. It will tell you if anything is missing.

**Management commands:**
```bash
./start.sh          # Start all services
./start.sh --stop   # Stop everything (Docker + backend + frontend)
./start.sh --status # Check health of all services
```

### Step-by-Step Setup

If you prefer to set things up manually, or if `start.sh` fails:

**1. Clone and configure**
```bash
git clone <repo-url> && cd Moto-GPS
cp .env.example .env
```

Edit `.env` with your API keys:
```env
NEXT_PUBLIC_MAPTILER_KEY=your_key_here     # Required — map won't load without it
JWT_SECRET=your-random-secret-here          # Required — run: openssl rand -hex 32
ADMIN_PASSWORD=your-admin-password          # Required — first admin login
GEMINI_API_KEY=your-gemini-key              # Recommended — enables AI planner
```

**2. Start Docker services**
```bash
docker compose up -d
```

This starts 3 containers:
- **PostGIS** (port 5434) — road scores, users, trips, POIs
- **Valhalla** (port 8010) — motorcycle routing engine (first start takes 2-5 min to build tiles)
- **Martin** (port 3002) — vector tile server for road score overlay

**3. Import road data** (first time only, ~25 min)
```bash
cd pipeline
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python run_pipeline.py --step download,import,score
```

This downloads the UK road network from Geofabrik, imports 5.15M segments into PostGIS, and scores each on 5 dimensions.

**4. Import POIs** (optional but recommended)
```bash
# Still in pipeline/ with venv active
python import_pois.py          # 83k UK POIs from OpenStreetMap (~5 min)
python scrape_bikercafes.py    # 1,461 biker cafes (~2 min)
```

**5. Start the backend**
```bash
cd ../backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m app.cli.seed_admin          # Creates the first admin user
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**6. Start the frontend**
```bash
cd ../web
npm install
npm run dev -- --port 3001
```

**7. Open the app**

Go to [http://localhost:3001](http://localhost:3001) and log in with:
- Email: `admin@motogps.local` (or whatever you set in `.env`)
- Password: your `ADMIN_PASSWORD` from `.env`

Then go to **Admin** to generate invite codes for other users.

### Verify everything works

```bash
./start.sh --status
```

Or manually:
```bash
curl http://localhost:8000/health         # Backend
curl http://localhost:8010/status         # Valhalla
curl http://localhost:3002/catalog        # Martin
```

---

## Deployment (Cloud / VPS)

Moto-GPS is designed to run on any Linux server with Docker.

### Option 1: Single VPS (Recommended for small teams)

**Minimum specs:** 4 vCPU, 8GB RAM, 30GB SSD (e.g., Hetzner CX31 ~$15/mo, DigitalOcean $48/mo)

```bash
# On your VPS:
git clone <repo-url> && cd Moto-GPS
cp .env.example .env
```

Edit `.env` for production:
```env
# Security — CHANGE THESE
JWT_SECRET=<generate with: openssl rand -hex 32>
ADMIN_PASSWORD=<strong-password>

# API Keys
NEXT_PUBLIC_MAPTILER_KEY=your_key
GEMINI_API_KEY=your_key

# Database
POSTGRES_PASSWORD=<strong-db-password>
```

Build and start:
```bash
# Start Docker services
docker compose up -d

# Run data pipeline (first time only)
cd pipeline && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python run_pipeline.py --step download,import,score
python import_pois.py
python scrape_bikercafes.py
cd ..

# Start the app
./start.sh
```

**Add a reverse proxy** (nginx or Caddy) for HTTPS:

```nginx
# /etc/nginx/sites-available/motogps
server {
    server_name motogps.yourdomain.com;
    listen 443 ssl http2;

    ssl_certificate /etc/letsencrypt/live/motogps.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/motogps.yourdomain.com/privkey.pem;

    # Frontend
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Option 2: Separate Services

For larger deployments, run each service on its own infrastructure:

| Service | Hosting | Notes |
|---------|---------|-------|
| Frontend (Next.js) | Vercel, Netlify, Cloudflare Pages | Zero-config deploy |
| Backend (FastAPI) | Railway, Render, Fly.io, any VPS | Needs Python 3.11+ |
| PostGIS | Neon, Supabase, managed Postgres | Needs PostGIS extension |
| Valhalla | Dedicated VPS | Memory-hungry (~4GB for UK tiles) |
| Martin | Same as PostGIS or separate | Lightweight |

Update `.env` URLs to point to the correct service endpoints.

---

## Security

- **Invite-only** — no self-registration; admins generate invite codes
- **JWT authentication** — all endpoints require Bearer token (24h expiry)
- **Trip ownership** — users can only modify/delete their own trips
- **Role-based sharing** — editors can edit, viewers can only view/export
- **Self-hosted** — your data stays on your infrastructure
- **No tracking** — no analytics, no telemetry, no third-party scripts

---

## Documentation

| Document | Contents |
|----------|----------|
| [docs/API.md](docs/API.md) | Full REST API reference (auth, routes, trips, groups, POIs, AI) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, database schema, data flow |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local setup, Docker services, environment variables |
| [docs/PIPELINE.md](docs/PIPELINE.md) | Road scoring data pipeline |

---

## Project Status

### Done

- [x] Core routing with Valhalla motorcycle profile (Scenic / Balanced / Fast)
- [x] 5-dimension road scoring pipeline (curvature, surface, scenic, urban density, elevation)
- [x] Route-Score-Rerank with parallel fan-out (3 alternatives)
- [x] Route analysis with 8 anomaly detectors + one-click fixes
- [x] Multi-day trip planning with day overlays, auto-split, per-day view
- [x] GPX import/export (single route, multi-day ZIP, per-day)
- [x] Smart waypoint insertion (closest segment) + snap-to-road drag
- [x] Right-click context menu on map
- [x] Saved trips with in-place save/update
- [x] Address/postcode search (Nominatim)
- [x] Drag-and-drop waypoint reordering
- [x] Responsive PWA (installable on mobile)
- [x] User accounts (invite-only registration, JWT auth, profiles)
- [x] Admin dashboard (user management, invite codes, block/unblock)
- [x] Vehicle management (fuel type, consumption, tank size, fuel cost per trip)
- [x] Saved places (Home, Work, custom locations)
- [x] Adventure groups with role-based sharing (owner/editor/viewer)
- [x] Group invitations and member management
- [x] AI trip planner (Gemini with OpenAI fallback, function calling)
- [x] POI service (83k+ OSM locations + 1,461 biker cafes)
- [x] Road score overlay (colour-coded vector tiles via Martin)
- [x] Light and dark theme
- [x] Miles/km unit toggle

### Roadmap

- [ ] Elevation profile visualisation
- [ ] React Native mobile app
- [ ] Europe-wide road data (currently UK only)
- [ ] Preference learning from ride history
- [ ] Real-time weather overlay along route
- [ ] Live group tracking during rides
- [ ] Offline map tiles for areas with no signal

---

## Licence

MIT License. See [LICENSE](LICENSE) for details.

This project uses several open-source components with compatible licences:

| Component | Licence | Notes |
|-----------|---------|-------|
| [Valhalla](https://github.com/valhalla/valhalla) | MIT | Routing engine |
| [Martin](https://github.com/maplibre/martin) | Apache-2.0 OR MIT | Vector tile server |
| [PostGIS](https://postgis.net/) | GPLv2+ | Used as Docker runtime dependency (not distributed) |
| [PostgreSQL](https://www.postgresql.org/) | PostgreSQL License (BSD-like) | Database |
| [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) | BSD-3-Clause | Map rendering |
| [OpenStreetMap data](https://www.openstreetmap.org/copyright) | ODbL | Road data — attribution required |
| SRTM elevation data | Public domain | NASA/USGS |

When using OpenStreetMap data, include: **"Data © OpenStreetMap contributors, ODbL"**
