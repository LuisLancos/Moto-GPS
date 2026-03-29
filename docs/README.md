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

Toggle categories on/off: ⛽ Fuel · 🏨 Hotels · 🍽️ Restaurants · 🍺 Pubs · 🏰 Castles · 👁️ Viewpoints · 🏛️ Museums · ☕ Cafes · ⛺ Campsites · 📍 Attractions · 🏍️ Biker Spots

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

## Feature Summary

| Feature | Moto-GPS | Calimoto | Kurviger | Google Maps |
|---------|:--------:|:--------:|:--------:|:-----------:|
| Motorcycle-specific routing | ✅ 5-dimension scoring | ✅ Basic | ✅ Good | ❌ |
| Context-aware (scenic + practical) | ✅ | ❌ | ❌ | ❌ |
| AI trip planning (natural language) | ✅ | ❌ | ❌ | ❌ |
| Per-day route modes | ✅ | ❌ | ❌ | ❌ |
| 83k+ POIs on map | ✅ | Limited | Limited | ✅ |
| Biker-specific POIs (1,461) | ✅ | ❌ | ❌ | ❌ |
| Multi-day trip planning | ✅ | ❌ | Basic | ❌ |
| Fuel cost estimation | ✅ | ❌ | ❌ | ❌ |
| Auto-suggest hotels + fuel stops | ✅ | ❌ | ❌ | ❌ |
| Group collaboration | ✅ | ❌ | ❌ | ❌ |
| Route analysis + fix suggestions | ✅ | ❌ | ❌ | ❌ |
| GPX import/export | ✅ | ✅ | ✅ | ❌ |
| Light + dark theme | ✅ | ✅ | ✅ | ✅ |
| Self-hosted (own data) | ✅ | ❌ | ❌ | ❌ |

---

## How It Works

```
You describe your trip (or click waypoints on the map)
        │
        ▼
   AI Trip Planner (Gemini)
   suggests waypoints, days, POIs
        │
        ▼
   Route-Score-Rerank Engine
   ├─ Valhalla generates candidate routes (parallel fan-out)
   ├─ PostGIS scores each against 5.15M road segments
   └─ Best routes ranked by motorcycle suitability score
        │
        ▼
   Route displayed on MapLibre GL map
   with POI overlay, day overlays, and analysis
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, MapLibre GL JS, Tailwind CSS |
| Backend | FastAPI, Python 3.13, SQLAlchemy async |
| Database | PostgreSQL 16 + PostGIS 3.4 (5.15M road segments, 83K POIs) |
| Routing | Valhalla (motorcycle costing, multi-mode per-day) |
| AI | Google Gemini with function calling |
| Tiles | Martin vector tile server (road score overlay) |
| Maps | MapTiler (light/dark basemap themes) |

---

## Quick Start

```bash
# 1. Clone and configure
git clone <repo-url> && cd Moto-GPS
cp .env.example .env
# Edit .env: set NEXT_PUBLIC_MAPTILER_KEY, JWT_SECRET, ADMIN_PASSWORD
# For AI planner: set GEMINI_API_KEY

# 2. Start infrastructure (PostGIS, Valhalla, Martin)
docker compose up -d

# 3. Import road data (first time, ~25 min)
cd pipeline && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python run_pipeline.py --step download,import,score

# 3b. Import POIs (optional but recommended)
python import_pois.py          # 83k UK POIs from OpenStreetMap
python scrape_bikercafes.py    # 1,461 biker cafes

# 4. Start backend
cd ../backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m app.cli.seed_admin   # Create admin user
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 5. Start frontend
cd ../web && npm install && npm run dev
# Open http://localhost:3001
```

---

## Documentation

| Document | Contents |
|----------|----------|
| [API.md](API.md) | Full REST API reference (auth, routes, trips, groups, POIs, AI) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, database schema, data flow |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Local setup, Docker services, environment variables |
| [PIPELINE.md](PIPELINE.md) | Road scoring data pipeline |

---

## Security

- **Invite-only** — no self-registration; admins generate invite codes
- **JWT authentication** — all endpoints require Bearer token (24h expiry)
- **Trip ownership** — users can only modify/delete their own trips
- **Role-based sharing** — editors can edit, viewers can only view/export
- **Self-hosted** — your data stays on your infrastructure

---

## Roadmap

- [ ] Elevation profile visualisation
- [ ] React Native mobile app (PWA in the meantime)
- [ ] Europe-wide road data (currently UK only)
- [ ] Preference learning from ride history
- [ ] Real-time weather overlay
- [ ] Live group tracking during rides
