"""Extract POIs from OSM PBF and import into PostGIS.

Uses osmium WITHOUT locations=True (which is very slow on large PBFs).
Instead reads node lat/lon directly from the node() callback.
"""

import os
import json
import osmium
import psycopg2
from psycopg2.extras import execute_values
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")


def _get_conn():
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", "5434")),
        dbname=os.getenv("POSTGRES_DB", "motogps"),
        user=os.getenv("POSTGRES_USER", "motogps"),
        password=os.getenv("POSTGRES_PASSWORD", "motogps_dev"),
    )


def load_category_rules() -> dict[str, dict]:
    """Load category → OSM tag mapping from poi_categories table."""
    conn = _get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id, osm_tags FROM poi_categories WHERE enabled = TRUE")
    rules = {}
    for cat_id, osm_tags in cur.fetchall():
        if isinstance(osm_tags, str):
            osm_tags = json.loads(osm_tags)
        rules[cat_id] = osm_tags
    cur.close()
    conn.close()
    return rules


def build_tag_lookup(category_rules: dict[str, dict]) -> dict[tuple[str, str], str]:
    """Pre-build (tag_key, tag_value) → category_id lookup."""
    lookup: dict[tuple[str, str], str] = {}
    for cat_id, osm_tags in category_rules.items():
        for tag_key, tag_values in osm_tags.items():
            for val in tag_values:
                lookup[(tag_key, val)] = cat_id
    return lookup


class POIHandler(osmium.SimpleHandler):
    """Extract POI nodes directly (no locations index needed)."""

    def __init__(self, tag_lookup: dict[tuple[str, str], str]):
        super().__init__()
        self.tag_lookup = tag_lookup
        self.pois: list[dict] = []
        self.count = 0
        self.total_nodes = 0

    def node(self, n):
        self.total_nodes += 1
        if self.total_nodes % 10_000_000 == 0:
            print(f"    Scanned {self.total_nodes:,} nodes, found {self.count:,} POIs...")

        # Quick check: does this node have any relevant tags?
        tags = dict(n.tags)
        if not tags.get("name"):
            return

        # Check classification
        category = None
        for tag_key in ("amenity", "tourism", "historic"):
            tag_val = tags.get(tag_key)
            if tag_val:
                cat = self.tag_lookup.get((tag_key, tag_val))
                if cat:
                    category = cat
                    break

        if not category:
            return

        # Get coordinates directly from node (no locations index)
        lat = n.location.lat
        lon = n.location.lon
        if lat == 0 and lon == 0:
            return

        self.count += 1
        self.pois.append({
            "osm_id": n.id,
            "name": tags["name"],
            "category": category,
            "subcategory": tags.get("brand") or tags.get("cuisine") or tags.get("operator") or None,
            "lat": lat,
            "lng": lon,
            "tags": json.dumps(tags),
        })


def import_to_postgis(pois: list[dict], batch_size: int = 5000):
    """Bulk insert POIs into PostGIS."""
    conn = _get_conn()
    cur = conn.cursor()

    cur.execute("TRUNCATE TABLE pois RESTART IDENTITY")
    conn.commit()
    print(f"  Importing {len(pois):,} POIs into PostGIS...")

    sql = """
        INSERT INTO pois (osm_id, name, category, subcategory, geometry, lat, lng, tags)
        VALUES %s
    """

    template = """(
        %(osm_id)s, %(name)s, %(category)s, %(subcategory)s,
        ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326),
        %(lat)s, %(lng)s, %(tags)s
    )"""

    total = len(pois)
    for i in range(0, total, batch_size):
        batch = pois[i : i + batch_size]
        execute_values(cur, sql, batch, template=template)
        conn.commit()
        done = min(i + batch_size, total)
        if done % 20000 == 0 or done == total:
            print(f"    {done:,} / {total:,} ({done * 100 // total}%)")

    cur.close()
    conn.close()
    print(f"  ✓ Imported {total:,} POIs")


def run(pbf_path: str | None = None):
    """Run the full POI import pipeline."""
    if pbf_path is None:
        data_dir = Path(__file__).parent.parent / "data"
        for p in [
            data_dir / "valhalla" / "great-britain-latest.osm.pbf",
            data_dir / "osm" / "great-britain-latest.osm.pbf",
        ]:
            if p.exists():
                pbf_path = str(p)
                break

        if pbf_path is None:
            print("ERROR: No OSM PBF file found.")
            return

    print("Step 1: Loading category rules...")
    rules = load_category_rules()
    print(f"  {len(rules)} categories: {list(rules.keys())}")

    tag_lookup = build_tag_lookup(rules)
    print(f"  {len(tag_lookup)} tag→category mappings")

    print(f"\nStep 2: Extracting POIs from {Path(pbf_path).name} ({Path(pbf_path).stat().st_size / 1e9:.1f} GB)...")
    handler = POIHandler(tag_lookup)
    # Do NOT use locations=True — it builds a huge index for ALL nodes
    handler.apply_file(pbf_path)
    print(f"  Scanned {handler.total_nodes:,} nodes total")
    print(f"  Extracted {handler.count:,} POIs")

    if not handler.pois:
        print("  No POIs found — check category rules")
        return

    print(f"\nStep 3: Importing to PostGIS...")
    import_to_postgis(handler.pois)

    # Summary
    conn = _get_conn()
    cur = conn.cursor()
    cur.execute("SELECT category, count(*) FROM pois GROUP BY category ORDER BY count(*) DESC")
    print("\n  POI Summary:")
    for cat, count in cur.fetchall():
        print(f"    {cat}: {count:,}")
    cur.close()
    conn.close()
    print("\n  ✓ POI import complete!")


if __name__ == "__main__":
    import sys
    pbf = sys.argv[1] if len(sys.argv) > 1 else None
    run(pbf)
