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

Edit `.env` and set your MapTiler API key:

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

### 5. Start the Web App

```bash
cd web
npm install
npm run dev
# Open http://localhost:3001
```

The dev server has hot-reload — changes to `.tsx`/`.ts` files reflect instantly.

### 6. Verify Everything Works

1. Open **http://localhost:3001** — you should see a map of the UK
2. Click two points on the map to add waypoints
3. Click **"Plan Route"** — routes should appear in 2-4 seconds
4. Check the **Route Analysis** panel below route stats for anomaly detection
5. Try the road score overlay toggle on the map (if Martin is healthy)

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

-- Saved trips
SELECT id, name, route_type, total_distance_m, created_at FROM saved_routes ORDER BY created_at DESC;
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
| `NEXT_PUBLIC_MAPTILER_KEY` | — | Web | MapTiler API key for basemap tiles |
| `BACKEND_URL` | `http://localhost:8000` | Web | Backend API URL |

## Project File Structure

```
Moto-GPS/
  .env                        ← Your local config (gitignored)
  .env.example                ← Template
  docker-compose.yml          ← 3 Docker services
  start.sh                    ← Quick start script

  docker/
    postgres/init.sql          ← Database schema (PostGIS + tables + indexes)
    valhalla/valhalla.json     ← Valhalla source config (concurrency, limits)
    martin/config.yaml         ← Martin tile server config

  data/                        ← Docker volumes (gitignored, ~17GB total)
    postgres/                  ← PostgreSQL data files (~8GB)
    valhalla/                  ← Routing tiles + runtime config (~9GB)
    elevation/                 ← SRTM elevation tiles

  backend/
    requirements.txt
    app/
      main.py                  ← FastAPI app entry point
      config.py                ← Pydantic settings (reads .env)
      api/
        routes.py              ← POST /api/route + /api/route/analyze
        trips.py               ← Saved trips CRUD
        gpx.py                 ← GPX import/export
      services/
        valhalla_client.py     ← HTTP client to Valhalla (persistent connection)
        road_scorer.py         ← PostGIS spatial scoring
        route_analyzer.py      ← Anomaly detection (8 detectors)
        scenic_attractors.py   ← Find nearby scenic roads
        route_cache.py         ← In-memory TTL cache
      models/
        route.py               ← All Pydantic models (route, analysis, anomalies)
      db/
        database.py            ← SQLAlchemy async engine + session pool

  pipeline/
    run_pipeline.py            ← Pipeline orchestrator
    download.py                ← Download OSM + SRTM data
    osm_to_postgis.py          ← Import roads to PostGIS
    curvature.py               ← Curvature scoring
    surface_scorer.py          ← Surface quality scoring
    urban_density.py           ← Urban vs rural scoring
    road_classifier.py         ← Road classification
    composite_scorer.py        ← Final weighted score

  web/
    package.json
    next.config.ts
    src/
      app/
        layout.tsx             ← Root layout
        page.tsx               ← Main page (map + panel)
      components/
        map/                   ← Map, markers, route layers, score overlay
        route/                 ← Panel, stats, analysis, trips, preferences
      lib/
        api.ts                 ← API client functions
        types.ts               ← TypeScript types (mirrors backend models)
        geo.ts                 ← Geospatial utilities
      hooks/
        useRoute.ts            ← Route state management + auto-recalculate
```
