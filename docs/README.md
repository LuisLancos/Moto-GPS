# Moto-GPS

Moto-GPS is a motorcycle navigation platform that finds genuinely good motorcycle routes using context-aware road scoring. Rather than simple "avoid motorways" rules, it scores every road segment on 5 dimensions (curvature, surface quality, scenic interest, elevation, urban density) and uses a Route-Score-Rerank strategy against a pre-scored PostGIS database of 5.15 million UK road segments.

## Key Features

### Route Planning
- **Smart motorcycle routing** with parallel Valhalla fan-out and PostGIS-based reranking
- **3 route presets**: scenic, balanced, fast -- or custom weights for all 5 scoring dimensions
- **Route analysis**: 8 anomaly detectors find problems (backtracking, U-turns, missed scenic roads) with one-click fix suggestions
- **Snap-to-road** waypoints via Valhalla's locate API
- **Smart waypoint insertion** at the closest route segment, not just appended

### Multi-Day Trip Planning
- Plan multi-day trips as one continuous route with **day overlays** (lenses into the master route)
- **Auto-split** by target daily distance
- Per-day GPX export, full-trip ZIP export
- Import trips from GPX files or ZIP bundles

### GPX Import / Export
- Compact GPX 1.1 export (navigation points only, not full track dumps)
- Smart GPX import from Garmin, Calimoto, Kurviger, Google Earth, and any GPX 1.1 source
- Per-day and full-trip export for multi-day trips

### User Management
- **Invite-only registration** -- admins generate invite codes, share registration links manually
- JWT-based authentication with Bearer tokens (24-hour expiry)
- User profiles with name, email, password management
- **Vehicle garage** -- add motorcycles with type, brand, model, year, and photo
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
   |         |         |
   v         v         v
Valhalla   PostGIS   Martin
(routing)  (scores,  (vector
 :8010     users,     tiles)
           groups)    :3002
           :5434
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for full system design, database schema, and data flow.

## Quick Start

```bash
# 1. Clone and configure
git clone <repo-url> && cd Moto-GPS
cp .env.example .env
# Edit .env: set NEXT_PUBLIC_MAPTILER_KEY, JWT_SECRET, ADMIN_PASSWORD

# 2. Start Docker services (PostGIS, Valhalla, Martin)
docker compose up -d

# 3. Run data pipeline (first time only, ~25 min)
cd pipeline && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python run_pipeline.py --step download,import,score

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
| Tiles | Martin (vector tile server) |
| Auth | JWT (PyJWT), bcrypt password hashing |
| Maps | MapTiler (basemap tiles) |

## Security Model

- **Invite-only**: no self-registration; admins generate invite codes
- **JWT authentication**: all API endpoints (except health and login/register) require `Authorization: Bearer <token>`
- **Trip ownership**: users can only modify/delete their own trips
- **Group-based sharing**: shared trips accessible via group membership with role-based permissions
- **Admin isolation**: admin endpoints (`/api/admin/*`) protected by `get_current_admin` dependency
- **Blocked users**: cannot log in or access any authenticated endpoint
