"""Estimate urban density using a heuristic from road tags (no building import needed)."""

import os
import psycopg2
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent / ".env")


def score_urban_density(conn):
    """Estimate urban density from highway type, speed, lighting, and lanes.

    0 = rural, 1 = dense urban.
    Uses a heuristic to avoid importing millions of building footprints.
    """
    cur = conn.cursor()

    cur.execute("""
        UPDATE road_segments
        SET urban_density_score = GREATEST(0.0, LEAST(1.0,
            -- Base score from highway type
            CASE highway
                WHEN 'motorway' THEN 0.2
                WHEN 'motorway_link' THEN 0.2
                WHEN 'trunk' THEN 0.3
                WHEN 'trunk_link' THEN 0.3
                WHEN 'primary' THEN 0.4
                WHEN 'primary_link' THEN 0.4
                WHEN 'secondary' THEN 0.35
                WHEN 'secondary_link' THEN 0.35
                WHEN 'tertiary' THEN 0.3
                WHEN 'tertiary_link' THEN 0.3
                WHEN 'unclassified' THEN 0.15
                WHEN 'residential' THEN 0.7
                WHEN 'service' THEN 0.6
                WHEN 'track' THEN 0.05
                ELSE 0.3
            END
            -- Street lighting = likely urban
            + CASE WHEN lit = TRUE THEN 0.2 ELSE 0.0 END
            -- Low speed limits = likely built-up area
            + CASE
                WHEN maxspeed IS NOT NULL AND maxspeed <= 20 THEN 0.3
                WHEN maxspeed IS NOT NULL AND maxspeed <= 30 THEN 0.2
                WHEN maxspeed IS NOT NULL AND maxspeed <= 40 THEN 0.1
                WHEN maxspeed IS NOT NULL AND maxspeed >= 60 THEN -0.15
                ELSE 0.0
            END
            -- Multiple lanes = likely not rural
            + CASE
                WHEN lanes IS NOT NULL AND lanes >= 4 THEN 0.15
                WHEN lanes IS NOT NULL AND lanes >= 3 THEN 0.1
                WHEN lanes IS NOT NULL AND lanes = 1 THEN -0.1
                ELSE 0.0
            END
        ))
    """)

    conn.commit()
    affected = cur.rowcount
    print(f"  Urban density scoring complete: {affected:,} segments updated")
    cur.close()


if __name__ == "__main__":
    conn = psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", "5434")),
        dbname=os.getenv("POSTGRES_DB", "motogps"),
        user=os.getenv("POSTGRES_USER", "motogps"),
        password=os.getenv("POSTGRES_PASSWORD", "motogps_dev"),
    )
    score_urban_density(conn)
    conn.close()
