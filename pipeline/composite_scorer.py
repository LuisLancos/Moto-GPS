"""Compute composite motorcycle score from individual scores."""

import os
import psycopg2
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent / ".env")


def compute_composite_scores(conn):
    """Compute composite_moto_score and scenic_score.

    composite = weighted combination of all individual scores
    scenic = curvature that is also rural and well-surfaced (the "fun factor")
    """
    cur = conn.cursor()

    # First: compute scenic_score (curvature * rurality * surface quality)
    cur.execute("""
        UPDATE road_segments
        SET scenic_score = GREATEST(0.0, LEAST(1.0,
            curvature_score
            * (1.0 - urban_density_score)
            * surface_score
        ))
    """)

    # Then: composite using default weights
    # These are the baseline weights — user preferences override at query time
    cur.execute("""
        UPDATE road_segments
        SET composite_moto_score = GREATEST(0.0, LEAST(1.0,
            (curvature_score * 0.30)
            + (scenic_score * 0.30)
            + (surface_score * 0.20)
            + ((1.0 - urban_density_score) * 0.10)
            + (elevation_score * 0.10)
        ))
    """)

    conn.commit()
    affected = cur.rowcount

    # Print score distribution
    cur.execute("""
        SELECT
            ROUND(composite_moto_score::numeric, 1) AS bucket,
            count(*) AS cnt
        FROM road_segments
        GROUP BY bucket
        ORDER BY bucket
    """)
    print(f"  Composite scoring complete: {affected:,} segments")
    print("  Score distribution:")
    for bucket, cnt in cur.fetchall():
        bar = "#" * max(1, int(cnt / 5000))
        print(f"    {bucket:>3}: {cnt:>8,} {bar}")

    # Top-scored roads
    cur.execute("""
        SELECT name, ref, highway, road_class,
               ROUND(composite_moto_score::numeric, 3),
               ROUND(curvature_score::numeric, 3),
               ROUND(length_m::numeric, 0)
        FROM road_segments
        WHERE composite_moto_score > 0.6 AND name IS NOT NULL
        ORDER BY composite_moto_score DESC
        LIMIT 10
    """)
    print("\n  Top 10 motorcycle roads:")
    for name, ref, hw, cls, score, curv, length in cur.fetchall():
        ref_str = f" ({ref})" if ref else ""
        print(f"    {score} | {name}{ref_str} | {hw}/{cls} | curv={curv} | {length}m")

    cur.close()


if __name__ == "__main__":
    conn = psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", "5434")),
        dbname=os.getenv("POSTGRES_DB", "motogps"),
        user=os.getenv("POSTGRES_USER", "motogps"),
        password=os.getenv("POSTGRES_PASSWORD", "motogps_dev"),
    )
    compute_composite_scores(conn)
    conn.close()
