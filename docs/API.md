# API Reference

Base URL: `http://localhost:8000`

All endpoints accept and return JSON unless otherwise noted.

---

## Health

### GET /health

Service health check.

**Response**
```json
{"status": "ok", "service": "moto-gps-api"}
```

---

## Route Planning

### POST /api/route

Plan a motorcycle route with parallel Valhalla fan-out, PostGIS scoring, and reranking.

**Request Body**
```json
{
  "waypoints": [
    {"lat": 52.4862, "lng": -1.8904, "label": "Birmingham"},
    {"lat": 51.5405, "lng": 0.7129, "label": "Southend-on-Sea"}
  ],
  "route_type": "balanced",
  "preferences": null
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `waypoints` | `Waypoint[]` | Yes | At least 2 waypoints. Each has `lat`, `lng`, optional `label` |
| `route_type` | `string` | No | `"scenic"`, `"balanced"` (default), or `"fast"` |
| `preferences` | `RoutePreferences` | No | Custom weights. If null, uses `route_type` preset |

**RoutePreferences object**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `scenic_weight` | float | 0.3 | Weight for scenic score (0-1) |
| `curvature_weight` | float | 0.3 | Weight for curvature/twistiness |
| `surface_weight` | float | 0.2 | Weight for road surface quality |
| `elevation_weight` | float | 0.1 | Weight for elevation interest |
| `urban_avoidance_weight` | float | 0.1 | Weight for avoiding urban areas |
| `max_detour_factor` | float | 1.5 | Max acceptable route/direct distance ratio |
| `avoid_motorways` | bool | false | Penalise motorways in routing |
| `avoid_dual_carriageways` | bool | true | Penalise dual carriageways |

**Route type presets**
| Type | Scenic | Curvature | Surface | Elevation | Urban Avoidance | Detour | Motorways | Dual CW |
|------|--------|-----------|---------|-----------|-----------------|--------|-----------|---------|
| scenic | 0.35 | 0.35 | 0.15 | 0.1 | 0.05 | 2.0 | avoid | avoid |
| balanced | 0.3 | 0.3 | 0.2 | 0.1 | 0.1 | 1.5 | allow | avoid |
| fast | 0.05 | 0.05 | 0.3 | 0.0 | 0.6 | 1.1 | allow | allow |

**Response** — `RouteResponse`
```json
{
  "routes": [
    {
      "distance_m": 285400,
      "time_s": 14200,
      "shape": [[-1.8904, 52.4862], [-1.85, 52.47], ...],
      "legs": [
        {"distance_m": 285400, "time_s": 14200, "shape": []}
      ],
      "maneuvers": [
        {
          "instruction": "Drive east on A45.",
          "type": 2,
          "street_names": ["A45"],
          "length": 3.2,
          "time": 180,
          "begin_shape_index": 0,
          "end_shape_index": 45
        }
      ],
      "moto_score": 0.42,
      "valhalla_params": {"use_highways": 0.0, "use_trails": 0.0, "use_hills": 0.5}
    }
  ],
  "waypoints": [
    {"lat": 52.4862, "lng": -1.8904, "label": "Birmingham"},
    {"lat": 51.5405, "lng": 0.7129, "label": "Southend-on-Sea"}
  ]
}
```

**Notes**
- Returns up to 3 routes, sorted by `moto_score` (highest first)
- Each route is generated with different Valhalla costing parameters (parallel fan-out)
- Near-duplicate routes (within 2% distance / 5% time) are removed
- `shape` is an array of `[lng, lat]` coordinate pairs (GeoJSON convention)
- `moto_score` ranges from 0.0 (poor for motorcycling) to 1.0 (excellent)
- Typical response time: 2-4 seconds for 170-mile routes

---

### POST /api/route/analyze

Detect anomalies in a calculated route and suggest improvements.

**Request Body**
```json
{
  "route": { ... },
  "waypoints": [
    {"lat": 51.816, "lng": -4.504, "label": "St. Clears"},
    {"lat": 51.776, "lng": -4.604, "label": "St. Clears, Wales"},
    {"lat": 51.423, "lng": -0.487, "label": "Staines"},
    {"lat": 51.554, "lng": 0.677, "label": "Southend"}
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `route` | `RouteResult` | Yes | The route to analyse (from `/api/route` response) |
| `waypoints` | `Waypoint[]` | Yes | The waypoints used to plan the route |

**Response** — `RouteAnalysisResponse`
```json
{
  "anomalies": [
    {
      "type": "backtracking",
      "severity": "issue",
      "title": "Backtracking at waypoint 2",
      "description": "Segment 1->2 heads 237 deg but the destination is at 93 deg - a 145 deg deviation.",
      "segment": {
        "start_shape_index": 0,
        "end_shape_index": 3,
        "start_coord": [-4.504, 51.816],
        "end_coord": [-4.604, 51.776]
      },
      "affected_waypoint_index": 1,
      "metric_value": 144.5,
      "metric_threshold": 120.0,
      "fix": {
        "action": "remove_waypoint",
        "waypoint_index": 1,
        "suggested_coord": null,
        "description": "Remove waypoint 2 (St. Clears, Wales) to eliminate backtracking"
      }
    }
  ],
  "overall_health": "fair",
  "analysis_time_ms": 342
}
```

**Anomaly types**

| Type | Severity | Detection |
|------|----------|-----------|
| `backtracking` | issue | Segment bearing deviates >120 degrees from overall route direction |
| `close_proximity` | warning | Consecutive waypoints are <5% of average spacing apart |
| `detour_ratio` | warning | Leg's routed distance is >2.5x the straight-line distance |
| `u_turn` | issue | Route reverses direction >150 degrees for >1km |
| `urban_crawl` | suggestion | Route passes through >3km of urban area when a bypass exists |
| `road_quality_drop` | warning | A segment scores <50% of the route average |
| `missed_high_scoring_road` | suggestion | A high-scoring scenic road within 2km was not used |
| `better_parallel_road` | suggestion | A higher-scoring parallel road exists within 1km |

**Fix actions** — each anomaly now returns a `fixes` array (multiple options):

| Action | Description |
|--------|-------------|
| `remove_waypoint` | Remove the specified waypoint to fix the issue |
| `add_waypoint` | Add a waypoint at `suggested_coord` to improve the route |
| `move_waypoint` | Move the specified waypoint to `suggested_coord` |
| `no_action` | Manual review recommended, no automated fix available |

**Overall health**
- `"good"` — no issues found, 0-1 suggestions
- `"fair"` — 1 issue or 2+ warnings
- `"poor"` — 2+ issues detected

---

### POST /api/route/snap

Snap a coordinate to the nearest motorcycle-routable road using Valhalla's locate API.

**Request Body**
```json
{"lat": 51.5, "lng": -0.1}
```

**Response**
```json
{"lat": 51.500038, "lng": -0.100242, "snapped": true, "way_id": 31765738}
```

If no road is found nearby, returns the original coordinates with `"snapped": false`.

---

## Saved Trips

### GET /api/trips

List all saved trips (summary only, no route data).

**Response**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Welsh Coast Run",
    "description": "Weekend ride through Pembrokeshire",
    "route_type": "scenic",
    "total_distance_m": 285400,
    "total_time_s": 14200,
    "total_moto_score": 0.62,
    "waypoint_count": 4,
    "created_at": "2026-03-27T10:30:00Z",
    "updated_at": "2026-03-27T10:30:00Z"
  }
]
```

### GET /api/trips/{trip_id}

Get full trip detail including waypoints, preferences, and route data.

**Response** — extends `TripSummary` with:
```json
{
  ...summary_fields,
  "waypoints": [...],
  "preferences": {...},
  "route_data": {
    "distance_m": 285400,
    "time_s": 14200,
    "shape": [...],
    "maneuvers": [...],
    "moto_score": 0.62
  }
}
```

### POST /api/trips

Save a new trip.

**Request Body**
```json
{
  "name": "Welsh Coast Run",
  "description": "Weekend ride through Pembrokeshire",
  "route_type": "scenic",
  "waypoints": [...],
  "preferences": {...},
  "selected_route": {...},
  "total_distance_m": 285400,
  "total_time_s": 14200,
  "total_moto_score": 0.62
}
```

### PATCH /api/trips/{trip_id}

Update trip name or description.

**Request Body**
```json
{
  "name": "Updated Name",
  "description": "Updated description"
}
```

### PUT /api/trips/{trip_id}

Full overwrite of a saved route (waypoints, route data, preferences, etc.). Used for in-place save when editing an existing trip.

**Request Body** — same as `POST /api/trips`.

**Response**
```json
{"id": "550e8400-...", "updated": true}
```

### DELETE /api/trips/{trip_id}

Delete a saved trip. Returns `204 No Content` on success.

---

## Multi-Day Trip Planning

Multi-day trips are stored in a separate `trips` table. A trip is one continuous route with **day overlays** — lenses that split the master route into daily segments.

### POST /api/trip-planner/auto-split

Auto-suggest day splits based on a target daily distance.

**Request Body**
```json
{
  "waypoints": [...],
  "legs": [...],
  "daily_target_m": 400000
}
```

**Response** — `AutoSplitResponse` with `day_overlays` including computed stats per day.

### GET /api/trip-planner/trips

List all multi-day trips (summary only).

**Response**
```json
[
  {
    "id": "31f852cc-...",
    "name": "London to Bath 2-Day Tour",
    "description": "Via the Cotswolds",
    "route_type": "scenic",
    "day_count": 2,
    "total_distance_m": 450000,
    "total_time_s": 21600,
    "total_moto_score": 0.55,
    "created_at": "2026-03-27T12:00:00Z"
  }
]
```

### POST /api/trip-planner/trips

Save a new multi-day trip.

**Request Body**
```json
{
  "name": "London to Bath 2-Day Tour",
  "description": "Via the Cotswolds",
  "route_type": "scenic",
  "preferences": {...},
  "waypoints": [...],
  "route_data": {...},
  "day_overlays": [
    {"day": 1, "name": "London to Swindon", "start_waypoint_idx": 0, "end_waypoint_idx": 3},
    {"day": 2, "name": "Swindon to Bath", "start_waypoint_idx": 3, "end_waypoint_idx": 6}
  ],
  "daily_target_m": 400000,
  "total_distance_m": 450000,
  "total_time_s": 21600
}
```

### GET /api/trip-planner/trips/{trip_id}

Get full trip detail including all waypoints, route data, and day overlays.

### PUT /api/trip-planner/trips/{trip_id}

Full overwrite of a multi-day trip. Same body as POST.

### DELETE /api/trip-planner/trips/{trip_id}

Delete a multi-day trip.

### GET /api/trip-planner/trips/{trip_id}/gpx/day/{day_number}

Export a single day's route as a GPX file. Slices waypoints, shape, and maneuvers for that day only.

### GET /api/trip-planner/trips/{trip_id}/gpx/all

Export all days as a ZIP file containing one GPX file per day.

### POST /api/trip-planner/import-trip

Import a multi-day trip from a ZIP of GPX files.

**Request**: `multipart/form-data` with a `file` field containing a `.zip` file.

Each GPX file in the ZIP becomes one day. Files are sorted alphabetically. Waypoints from each day are merged with shared boundary points deduplicated.

**Response**
```json
{
  "name": "Imported Trip",
  "waypoints": [...],
  "day_overlays": [...],
  "day_count": 3,
  "waypoint_count": 12
}
```

### POST /api/trip-planner/trips/{trip_id}/import-day?day_number=N

Import a GPX file as a day leg into an existing multi-day trip.

**Request**: `multipart/form-data` with a `file` field containing a `.gpx` file.

If `day_number` matches an existing day, replaces that day's waypoints. If `day_number` is one more than the last day, appends a new day. The trip's master waypoint list and day overlay indices are updated accordingly.

---

## GPX Import / Export

### GET /api/trips/{trip_id}/gpx

Export a saved trip as a compact GPX 1.1 file.

**Response**: `application/gpx+xml` file download.

GPX structure (compact — no full track dump):
- `<wpt>` elements for each user waypoint (with name, type: start/via/end)
- `<rte>/<rtept>` for **navigation points only** — turns, junctions, roundabouts, merges (extracted from Valhalla maneuvers, typically 30-80 points vs 17,000+ track points)
- `<metadata>` with MotoGPS extensions (route_type, distance, time, moto_score)
- No `<trk>` section — keeps files small and compatible with GPS devices that re-route between route points

### POST /api/gpx/export

Export the current (unsaved) route as GPX. Accepts route data as query parameters.

**Query params**: `name`, `waypoints` (JSON), `route_data` (JSON with shape + maneuvers).

### POST /api/gpx/import

Import a GPX file and extract smart waypoints for route reconstruction.

**Request**: `multipart/form-data` with a `file` field containing the `.gpx` file.

**Smart import logic**:
1. If `<wpt>` + detailed `<rte>/<rtept>` (many nav points): merge named waypoints with sampled route points (~1 per 20km)
2. If `<wpt>` + simple `<rte>` (same count as wpt) + `<trk>`: sample track shape for intermediate shaping points
3. If only `<rte>`: sample route points by distance
4. If only `<trk>`: sample track points (~1 per 20km) with auto-generated start/end labels

**Response**
```json
{
  "name": "Imported Route",
  "description": "A ride through Wales",
  "waypoints": [
    {"lat": 51.816, "lng": -4.504, "label": "St. Clears"},
    {"lat": 51.860, "lng": -4.128, "label": null},
    {"lat": 51.774, "lng": -3.770, "label": null},
    {"lat": 51.554, "lng": 0.677, "label": "Southend"}
  ],
  "track_shape": [...],
  "waypoint_count": 18,
  "track_point_count": 16965
}
```

Compatible with Garmin, Calimoto, Kurviger, Google Earth, and any GPX 1.1 source. Handles MotoGPS namespace prefixes. Max file size: 10MB.

---

## Error Handling

All endpoints return errors in a consistent format:

```json
{
  "detail": "Human-readable error message"
}
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request (invalid waypoints, missing fields) |
| 404 | Resource not found (trip ID doesn't exist) |
| 502 | Upstream failure (Valhalla down, PostGIS query failed) |
