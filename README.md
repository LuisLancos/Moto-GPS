# Moto-GPS

Smart motorcycle navigation that actually understands how riders want to ride.

Current satnav apps use binary rules ("avoid motorways", "prefer curvy roads") that produce poor routes: dual carriageways that feel like motorways, pointless backroads through towns, and near-offroad tracks. Moto-GPS solves this with **context-aware routing** — scenic roads in countryside, practical/direct through towns, learning from rider preferences over time.

## How It Works

Moto-GPS uses a **Route-Score-Rerank** strategy:

1. **Generate candidates** — Fire 3-4 parallel requests to Valhalla (open-source routing engine) with different motorcycle costing parameters
2. **Score against road data** — Match each route against 5.15M pre-scored UK road segments in PostGIS (curvature, surface quality, scenicness, urban density, elevation)
3. **Rank and return** — Return the top 3 routes sorted by motorcycle quality score
4. **Analyse for anomalies** — Detect backtracking, U-turns, missed scenic roads, and suggest one-click fixes

## Features

- **Route planning** with scenic/balanced/fast presets and custom preference sliders
- **Intelligent scoring** of every UK road segment on 5 dimensions (curvature, surface, scenic, urban density, elevation)
- **Route analysis** that detects 8 types of anomalies and suggests fixes
- **GPX import/export** compatible with Garmin, Calimoto, Kurviger, Google Earth
- **Saved trips** with route metadata, scores, and route type
- **Address/postcode search** via Nominatim (OSM geocoding)
- **Drag-and-drop waypoint reordering** with auto-recalculate
- **Click-on-route insertion** of intermediate waypoints
- **Road score overlay** — colour-coded map layer showing road quality (red to green)
- **Responsive PWA** — works on desktop and mobile, installable via "Add to Home Screen"

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Python 3.13+
- Node.js 22+

### 1. Clone and configure

```bash
git clone <repo-url> && cd Moto-GPS
cp .env.example .env
# Edit .env — add your MapTiler key (free tier: https://cloud.maptiler.com)
```

### 2. Start infrastructure

```bash
docker compose up -d
# First run: Valhalla downloads UK data (~2GB) and builds tiles (~30-60 min)
# Subsequent starts: instant (tiles cached in data/valhalla/)
```

### 3. Run the data pipeline (first time only)

```bash
cd pipeline
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python run_pipeline.py --step download,import,score
# Downloads UK OSM data, imports to PostGIS, scores all road segments
# Takes ~20-30 min for full UK dataset
```

### 4. Start the backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 5. Start the web app

```bash
cd web
npm install
npm run dev
# Open http://localhost:3001
```

### 6. Plan a route

1. Click the map to add waypoints (or search an address/postcode in the panel)
2. Select a route type: Scenic, Balanced, or Fast
3. Click "Plan Route"
4. Compare the 3 route alternatives — check scores, distances, turn-by-turn
5. Review the Route Analysis panel for anomalies and suggested improvements

## Architecture

```
                    ┌─────────────────┐
                    │   Next.js Web   │ :3001
                    │   (MapLibre)    │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  FastAPI Backend │ :8000
                    │  (route planner) │
                    └───┬────────┬────┘
                        │        │
           ┌────────────▼─┐  ┌──▼──────────────┐
           │   Valhalla    │  │  PostGIS         │
           │ (routing)     │  │ (road scores)    │
           │ :8010         │  │ :5434            │
           └───────────────┘  └────────┬─────────┘
                                       │
                              ┌────────▼─────────┐
                              │  Martin           │
                              │ (vector tiles)    │
                              │ :3002             │
                              └──────────────────┘
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system design.

## Documentation

| Document | Description |
|----------|-------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data flow, component interactions |
| [docs/API.md](docs/API.md) | All REST API endpoints with request/response examples |
| [docs/PIPELINE.md](docs/PIPELINE.md) | Road scoring pipeline — how roads are classified and scored |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local development setup, environment variables, debugging |

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Routing engine | Valhalla | Motorcycle-profile route generation |
| Map data | OpenStreetMap | Road network, tags, metadata |
| Spatial database | PostGIS (PostgreSQL 16) | Road segment storage and spatial queries |
| Road scoring | Custom Python pipeline | 5-dimension road quality scoring |
| Backend API | FastAPI (Python 3.13) | Route planning, scoring, analysis |
| Frontend | Next.js 16 + React 19 | Responsive web app |
| Map display | MapLibre GL JS | Vector map rendering |
| Tile server | Martin (Rust) | Real-time PostGIS-to-vector tiles |
| Basemap | MapTiler (free tier) | Map styling and tile hosting |

## Performance

Route planning for a 170-mile route (e.g., Midlands to Southend-on-Sea):

| Phase | Time |
|-------|------|
| Valhalla routing (4 parallel calls) | ~1.5-3s |
| PostGIS scoring (parallel) | ~0.3-0.5s |
| Route analysis (8 detectors) | ~0.3-0.5s |
| **Total** | **~2-4s** |

## Project Status

- [x] Core routing with Valhalla motorcycle profile
- [x] 5-dimension road scoring pipeline (curvature, surface, scenic, urban, elevation)
- [x] Route-Score-Rerank with parallel fan-out
- [x] Route analysis with 8 anomaly detectors
- [x] GPX import/export
- [x] Saved trips with metadata
- [x] Address/postcode search
- [x] Drag-and-drop waypoint management
- [x] Responsive PWA
- [ ] User accounts and ride history
- [ ] Preference learning from ride data
- [ ] Elevation profile visualization
- [ ] React Native mobile app
- [ ] Europe-wide road data

## Licence

Private — all rights reserved.
