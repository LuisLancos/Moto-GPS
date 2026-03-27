"""Extract road segments from OSM PBF and import into PostGIS."""

import os
import math
import osmium
import psycopg2
from psycopg2.extras import execute_values
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

# Highway types relevant for motorcycle routing
HIGHWAY_TYPES = {
    "motorway", "motorway_link",
    "trunk", "trunk_link",
    "primary", "primary_link",
    "secondary", "secondary_link",
    "tertiary", "tertiary_link",
    "unclassified", "residential",
    "service", "track",
}


class RoadHandler(osmium.SimpleHandler):
    """Extract road ways with their geometries and tags."""

    def __init__(self):
        super().__init__()
        self.roads = []
        self.count = 0

    def way(self, w):
        highway = w.tags.get("highway")
        if highway not in HIGHWAY_TYPES:
            return

        # Extract node coordinates
        try:
            nodes = [(n.lon, n.lat) for n in w.nodes if n.location.valid()]
        except osmium.InvalidLocationError:
            return

        if len(nodes) < 2:
            return

        self.count += 1
        if self.count % 100000 == 0:
            print(f"    Processed {self.count:,} roads...")

        # Build WKT linestring
        coords = ", ".join(f"{lon} {lat}" for lon, lat in nodes)
        wkt = f"LINESTRING({coords})"

        # Calculate length in meters (haversine approximation)
        length_m = 0
        for i in range(len(nodes) - 1):
            length_m += _haversine(nodes[i][1], nodes[i][0], nodes[i + 1][1], nodes[i + 1][0])

        # Extract tags
        tags = dict(w.tags)

        maxspeed = None
        if "maxspeed" in tags:
            try:
                # Handle "30 mph", "50", etc.
                ms = tags["maxspeed"].replace("mph", "").replace("km/h", "").strip()
                maxspeed = int(float(ms))
            except (ValueError, TypeError):
                pass

        lanes = None
        if "lanes" in tags:
            try:
                lanes = int(tags["lanes"])
            except (ValueError, TypeError):
                pass

        width = None
        if "width" in tags:
            try:
                width = float(tags["width"].replace("m", "").strip())
            except (ValueError, TypeError):
                pass

        self.roads.append({
            "osm_way_id": w.id,
            "name": tags.get("name"),
            "ref": tags.get("ref"),
            "highway": highway,
            "surface": tags.get("surface"),
            "smoothness": tags.get("smoothness"),
            "maxspeed": maxspeed,
            "lanes": lanes,
            "width": width,
            "tracktype": tags.get("tracktype"),
            "lit": tags.get("lit") == "yes" if "lit" in tags else None,
            "oneway": tags.get("oneway") == "yes",
            "wkt": wkt,
            "length_m": length_m,
        })


def _haversine(lat1, lon1, lat2, lon2):
    """Calculate distance in meters between two lat/lng points."""
    R = 6371000  # Earth radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def import_to_postgis(roads: list[dict], batch_size: int = 5000):
    """Bulk insert road segments into PostGIS."""
    conn = psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", "5434")),
        dbname=os.getenv("POSTGRES_DB", "motogps"),
        user=os.getenv("POSTGRES_USER", "motogps"),
        password=os.getenv("POSTGRES_PASSWORD", "motogps_dev"),
    )
    cur = conn.cursor()

    # Clear existing data
    cur.execute("TRUNCATE TABLE road_segments RESTART IDENTITY")
    conn.commit()
    print(f"  Importing {len(roads):,} roads into PostGIS...")

    sql = """
        INSERT INTO road_segments
            (osm_way_id, name, ref, highway, surface, smoothness,
             maxspeed, lanes, width, tracktype, lit, oneway,
             geometry, length_m)
        VALUES %s
    """

    template = """(
        %(osm_way_id)s, %(name)s, %(ref)s, %(highway)s, %(surface)s,
        %(smoothness)s, %(maxspeed)s, %(lanes)s, %(width)s,
        %(tracktype)s, %(lit)s, %(oneway)s,
        ST_GeomFromText(%(wkt)s, 4326), %(length_m)s
    )"""

    for i in range(0, len(roads), batch_size):
        batch = roads[i : i + batch_size]
        execute_values(cur, sql, batch, template=template, page_size=batch_size)
        conn.commit()
        pct = min(100, ((i + batch_size) / len(roads)) * 100)
        print(f"\r  Imported {min(i + batch_size, len(roads)):,} / {len(roads):,} ({pct:.0f}%)", end="")

    print(f"\n  Import complete: {len(roads):,} road segments")

    # Verify
    cur.execute("SELECT count(*) FROM road_segments")
    count = cur.fetchone()[0]
    print(f"  PostGIS count: {count:,}")

    cur.close()
    conn.close()


def extract_and_import(pbf_path: Path):
    """Full pipeline: extract roads from PBF and import to PostGIS."""
    print(f"  Reading PBF: {pbf_path}")
    handler = RoadHandler()
    handler.apply_file(str(pbf_path), locations=True)
    print(f"  Extracted {len(handler.roads):,} road segments from OSM")

    import_to_postgis(handler.roads)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--pbf", type=str, help="Path to PBF file")
    args = parser.parse_args()

    if args.pbf:
        pbf = Path(args.pbf)
    else:
        # Try Valhalla's PBF
        pbf = Path(__file__).parent.parent / "data" / "valhalla" / "great-britain-latest.osm.pbf"
        if not pbf.exists():
            pbf = Path(__file__).parent.parent / "data" / "osm" / "great-britain-latest.osm.pbf"

    if not pbf.exists():
        print(f"PBF not found: {pbf}")
        print("Run: python download.py first, or wait for Valhalla to download it")
        exit(1)

    extract_and_import(pbf)
