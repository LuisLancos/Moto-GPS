"""Classify road segments into motorcycle-relevant categories."""

import os
import psycopg2
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent / ".env")


def classify_roads(conn):
    """Assign road_class based on highway type, scores, and tags."""
    cur = conn.cursor()

    cur.execute("""
        UPDATE road_segments
        SET road_class = CASE
            -- Dual carriageways: motorways, trunks, or multi-lane high-speed roads
            WHEN highway IN ('motorway', 'motorway_link') THEN 'motorway'
            WHEN highway IN ('trunk', 'trunk_link') THEN 'dual_carriageway'
            WHEN lanes >= 4 AND maxspeed >= 60 THEN 'dual_carriageway'

            -- Tracks and poor-surface roads
            WHEN highway = 'track' THEN 'track'
            WHEN surface IN ('gravel', 'dirt', 'earth', 'mud', 'sand', 'grass', 'ground') THEN 'track'

            -- Scenic rural: has curvature, is rural, decent surface
            WHEN curvature_score > 0.2 AND urban_density_score < 0.35 AND surface_score > 0.4
                THEN 'scenic_rural'

            -- Urban transit: dense urban area
            WHEN urban_density_score > 0.6 THEN 'urban_transit'

            -- Residential
            WHEN highway = 'residential' THEN 'residential'

            -- Default: classify by highway type
            WHEN highway IN ('primary', 'primary_link') THEN 'a_road'
            WHEN highway IN ('secondary', 'secondary_link') THEN 'b_road'
            WHEN highway IN ('tertiary', 'tertiary_link') THEN 'minor_road'
            WHEN highway = 'unclassified' THEN 'unclassified'
            WHEN highway = 'service' THEN 'service'

            ELSE 'other'
        END
    """)

    conn.commit()
    affected = cur.rowcount

    # Print distribution
    cur.execute("""
        SELECT road_class, count(*), ROUND(AVG(composite_moto_score)::numeric, 2)
        FROM road_segments
        GROUP BY road_class
        ORDER BY count(*) DESC
    """)
    print(f"  Road classification complete: {affected:,} segments")
    print("  Distribution:")
    for cls, cnt, avg_score in cur.fetchall():
        print(f"    {cls:20s}: {cnt:>8,} roads (avg score: {avg_score})")

    cur.close()


if __name__ == "__main__":
    conn = psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", "5434")),
        dbname=os.getenv("POSTGRES_DB", "motogps"),
        user=os.getenv("POSTGRES_USER", "motogps"),
        password=os.getenv("POSTGRES_PASSWORD", "motogps_dev"),
    )
    classify_roads(conn)
    conn.close()
