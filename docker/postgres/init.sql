-- Moto-GPS Database Schema
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Road segments with motorcycle quality scores
CREATE TABLE road_segments (
    id BIGSERIAL PRIMARY KEY,
    osm_way_id BIGINT NOT NULL,
    name TEXT,
    ref TEXT,                          -- road reference (A303, B3212, M4, etc.)
    highway TEXT NOT NULL,             -- OSM highway tag
    surface TEXT,
    smoothness TEXT,
    maxspeed INTEGER,
    lanes INTEGER,
    width REAL,
    tracktype TEXT,
    lit BOOLEAN,
    oneway BOOLEAN DEFAULT FALSE,
    geometry GEOMETRY(LINESTRING, 4326) NOT NULL,

    -- Computed scores (0.0 = worst, 1.0 = best for motorcycling)
    curvature_score REAL DEFAULT 0,
    scenic_score REAL DEFAULT 0,
    surface_score REAL DEFAULT 0,
    urban_density_score REAL DEFAULT 0,    -- 0 = rural, 1 = dense urban
    elevation_score REAL DEFAULT 0,         -- 0 = flat, 1 = interesting elevation
    composite_moto_score REAL DEFAULT 0,    -- weighted combination

    -- Classification
    road_class TEXT,                        -- scenic_rural, urban_transit, dual_carriageway, track, residential

    -- Elevation data
    length_m REAL,
    avg_elevation REAL,
    elevation_gain REAL,
    elevation_loss REAL,

    -- Region for future expansion (uk, europe, etc.)
    region TEXT DEFAULT 'uk',

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_road_segments_geom ON road_segments USING GIST(geometry);
CREATE INDEX idx_road_segments_highway ON road_segments(highway);
CREATE INDEX idx_road_segments_class ON road_segments(road_class);
CREATE INDEX idx_road_segments_composite ON road_segments(composite_moto_score);
CREATE INDEX idx_road_segments_region ON road_segments(region);
CREATE INDEX idx_road_segments_osm_way ON road_segments(osm_way_id);

-- Saved routes
CREATE TABLE saved_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    waypoints JSONB NOT NULL,              -- [{lat, lng, label}]
    preferences JSONB NOT NULL,            -- {scenic_weight, curvature_weight, ...}
    route_geometry GEOMETRY(LINESTRING, 4326),
    route_data JSONB,                      -- full route response (segments, scores, directions)
    total_distance_m REAL,
    total_time_s REAL,
    total_moto_score REAL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_saved_routes_created ON saved_routes(created_at DESC);

-- User preferences (Phase 1: single anonymous user)
CREATE TABLE user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scenic_weight REAL DEFAULT 0.3,
    curvature_weight REAL DEFAULT 0.3,
    surface_weight REAL DEFAULT 0.2,
    elevation_weight REAL DEFAULT 0.1,
    urban_avoidance_weight REAL DEFAULT 0.1,
    max_detour_factor REAL DEFAULT 1.5,    -- max 1.5x the direct route time
    avoid_motorways BOOLEAN DEFAULT FALSE,
    avoid_dual_carriageways BOOLEAN DEFAULT TRUE,
    prefer_a_roads BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default preferences
INSERT INTO user_preferences (scenic_weight, curvature_weight, surface_weight, elevation_weight, urban_avoidance_weight)
VALUES (0.3, 0.3, 0.2, 0.1, 0.1);
