# Road Scoring Pipeline

The pipeline downloads UK road data from OpenStreetMap, imports it into PostGIS, and scores every road segment on 5 dimensions of motorcycle riding quality.

## Overview

```
Step 1: Download     → UK OSM PBF (~2GB) + SRTM elevation tiles
Step 2: Import       → Extract highways → 5.15M road_segments rows in PostGIS
Step 3: Score        → Curvature + Surface + Elevation + Urban + Classification + Composite
```

Total pipeline time: ~20-30 minutes for full UK dataset.

## Running the Pipeline

```bash
cd pipeline
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Run all steps:
python run_pipeline.py --step download,import,score

# Or run individual steps:
python run_pipeline.py --step download    # Download OSM + elevation data
python run_pipeline.py --step import      # Import to PostGIS
python run_pipeline.py --step score       # Run all scorers
```

Requires Docker services running (PostgreSQL on port 5434).

## Pipeline Steps

### 1. Download (`download.py`)

Downloads:
- **UK OSM PBF** from Geofabrik (~2GB): `great-britain-latest.osm.pbf`
- **SRTM elevation tiles** for UK coverage (30m resolution)

Files saved to `data/osm/` and `data/elevation/`.

### 2. Import (`osm_to_postgis.py`)

Extracts highway ways from the OSM PBF using `osmium`:

- Filters 22 highway types: motorway, trunk, primary, secondary, tertiary, unclassified, residential, service, living_street, track, path, cycleway, and their `_link` variants
- Extracts tags: name, ref, surface, smoothness, maxspeed, lanes, width, tracktype, lit, oneway
- Calculates road length using Haversine distance
- Bulk inserts in batches of 5,000 (memory-efficient)
- Truncates existing data before import

Result: ~5.15 million road segments in the `road_segments` table.

### 3. Curvature Scoring (`curvature.py`)

Analyses the geometry of each road segment to measure twistiness.

**Algorithm**: Circumcircle radius on sliding window of 3 consecutive points.

| Radius | Classification | Weight |
|--------|---------------|--------|
| < 30m | Hairpin turn | 3.0 |
| < 100m | Tight curve | 2.0 |
| < 300m | Gentle curve | 1.0 |
| > 300m | Straight | 0.0 |

Curvature per km = sum of weighted curvatures / road length in km.
Normalised to 0-1 where 800 curvature/km = 1.0.

Batch updates: 5,000 segments per commit.

### 4. Surface Scoring (`surface_scorer.py`)

Maps OSM surface and smoothness tags to a quality score.

**Surface tag mapping**:
| Surface | Score |
|---------|-------|
| asphalt, paved | 1.0 |
| concrete | 0.85 |
| compacted | 0.5 |
| gravel, fine_gravel | 0.3 |
| unpaved, dirt | 0.2 |
| grass, mud | 0.05-0.1 |
| No tag (default by highway type) | 0.5-0.95 |

**Smoothness adjustments**: excellent (+0.1), good (+0.05), intermediate (0), bad (-0.2), very_bad (-0.4), horrible (-0.6), impassable (-0.8).

Executed as a single SQL UPDATE statement (fast).

### 5. Urban Density (`urban_density.py`)

Estimates how urban/rural a road segment is using heuristics (avoids expensive building geometry imports).

**Base score by highway type**:
- motorway: 0.2, trunk: 0.3, primary: 0.4
- residential: 0.7, living_street: 0.8, service: 0.6
- track: 0.05, path: 0.05

**Adjustments**:
- +0.2 if street lighting (`lit=yes`)
- +0.3 if speed limit <= 20mph
- -0.15 if speed limit >= 60mph
- +0.15 if 4+ lanes
- -0.1 if single lane

Final score clamped to 0-1. 0 = fully rural, 1 = dense urban.

### 6. Road Classification (`road_classifier.py`)

Assigns a human-readable class to each segment based on multiple factors:

| Class | Criteria |
|-------|---------|
| `motorway` | highway = motorway or motorway_link |
| `dual_carriageway` | trunk/primary with lanes >= 2 and maxspeed >= 60 |
| `scenic_rural` | curvature > 0.2 AND urban < 0.35 AND surface > 0.4 |
| `urban_transit` | urban > 0.6 AND highway in primary/secondary/tertiary |
| `track` | highway = track or surface in (gravel, dirt, grass) |
| `residential` | highway = residential or living_street |
| `b_road` | highway = secondary/tertiary AND ref starts with B |
| `minor_road` | everything else |

### 7. Composite Score (`composite_scorer.py`)

Computes the final motorcycle quality score:

```
scenic_score = curvature * (1 - urban_density) * surface
composite_moto_score = 0.30 * curvature
                     + 0.30 * scenic
                     + 0.20 * surface
                     + 0.10 * (1 - urban_density)
                     + 0.10 * elevation
```

Outputs a distribution histogram and the top 10 highest-scoring roads.

## Score Distribution (typical UK data)

| Score Range | Percentage | Description |
|------------|------------|-------------|
| 0.0 - 0.1 | ~15% | Tracks, poor surface, or dead-end urban |
| 0.1 - 0.2 | ~25% | Standard residential and urban roads |
| 0.2 - 0.3 | ~25% | Decent A-roads and minor roads |
| 0.3 - 0.5 | ~20% | Good B-roads with some character |
| 0.5 - 0.7 | ~10% | Excellent scenic and curvy roads |
| 0.7 - 1.0 | ~5% | The best motorcycle roads in the UK |

## Re-running the Pipeline

To update scores after changing the scoring algorithms:

```bash
# Re-run scoring only (keeps existing road data):
python run_pipeline.py --step score

# Full re-import (if OSM data updated):
python run_pipeline.py --step download,import,score
```

The pipeline is idempotent: re-running `import` truncates and re-imports. Re-running `score` overwrites existing scores.
