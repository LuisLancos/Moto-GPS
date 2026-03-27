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

-- ============================================
-- Users & Authentication
-- ============================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    is_blocked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_users_email ON users(email);

CREATE TABLE invite_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    used_by UUID REFERENCES users(id) ON DELETE SET NULL,
    used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_invite_codes_code ON invite_codes(code);

-- ============================================
-- Vehicles
-- ============================================

CREATE TABLE vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'Motorcycle',
    brand TEXT NOT NULL,
    model TEXT NOT NULL,
    year INTEGER,
    picture_base64 TEXT,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_vehicles_user_id ON vehicles(user_id);

-- ============================================
-- Adventure Groups
-- ============================================

CREATE TABLE adventure_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    target_date DATE,
    duration_days INTEGER,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_adventure_groups_created_by ON adventure_groups(created_by);

CREATE TABLE group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES adventure_groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'viewer',
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(group_id, user_id)
);
CREATE INDEX idx_group_members_group ON group_members(group_id);
CREATE INDEX idx_group_members_user ON group_members(user_id);

CREATE TABLE group_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES adventure_groups(id) ON DELETE CASCADE,
    invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invited_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'viewer',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    responded_at TIMESTAMPTZ,
    UNIQUE(group_id, invited_user_id)
);
CREATE INDEX idx_invitations_user_status ON group_invitations(invited_user_id, status);

CREATE TABLE group_shared_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES adventure_groups(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,
    item_id UUID NOT NULL,
    shared_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shared_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_shared_items_group ON group_shared_items(group_id);
CREATE INDEX idx_shared_items_item ON group_shared_items(item_type, item_id);

-- ============================================
-- Saved routes (single-day)
-- ============================================

CREATE TABLE saved_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    route_type TEXT DEFAULT 'balanced',
    waypoints JSONB NOT NULL,
    preferences JSONB NOT NULL,
    route_geometry GEOMETRY(LINESTRING, 4326),
    route_data JSONB,
    total_distance_m REAL,
    total_time_s REAL,
    total_moto_score REAL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_saved_routes_created ON saved_routes(created_at DESC);
CREATE INDEX idx_saved_routes_user ON saved_routes(user_id);

-- ============================================
-- Multi-day trips
-- ============================================

CREATE TABLE trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    route_type TEXT DEFAULT 'balanced',
    preferences JSONB,
    waypoints JSONB,
    route_data JSONB,
    day_overlays JSONB DEFAULT '[]'::jsonb,
    daily_target_m REAL DEFAULT 400000,
    total_distance_m REAL,
    total_time_s REAL,
    total_moto_score REAL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_trips_user ON trips(user_id);
CREATE INDEX idx_trips_created ON trips(created_at DESC);

-- ============================================
-- User preferences (legacy, single anonymous user)
-- ============================================

CREATE TABLE user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scenic_weight REAL DEFAULT 0.3,
    curvature_weight REAL DEFAULT 0.3,
    surface_weight REAL DEFAULT 0.2,
    elevation_weight REAL DEFAULT 0.1,
    urban_avoidance_weight REAL DEFAULT 0.1,
    max_detour_factor REAL DEFAULT 1.5,
    avoid_motorways BOOLEAN DEFAULT FALSE,
    avoid_dual_carriageways BOOLEAN DEFAULT TRUE,
    prefer_a_roads BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO user_preferences (scenic_weight, curvature_weight, surface_weight, elevation_weight, urban_avoidance_weight)
VALUES (0.3, 0.3, 0.2, 0.1, 0.1);
