"""Calculate curvature scores for road segments using circumcircle-radius algorithm."""

import os
import math
import psycopg2
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent / ".env")


def _circumcircle_radius(p1, p2, p3):
    """Calculate the circumcircle radius of three points (lon, lat in degrees).
    Returns radius in meters. Smaller radius = tighter curve.
    """
    # Convert to approximate meters using equirectangular projection
    lat_mid = math.radians((p1[1] + p2[1] + p3[1]) / 3)
    scale_lon = math.cos(lat_mid) * 111320  # meters per degree longitude
    scale_lat = 111320  # meters per degree latitude

    ax = p1[0] * scale_lon
    ay = p1[1] * scale_lat
    bx = p2[0] * scale_lon
    by = p2[1] * scale_lat
    cx = p3[0] * scale_lon
    cy = p3[1] * scale_lat

    # Triangle side lengths
    a = math.sqrt((bx - cx) ** 2 + (by - cy) ** 2)
    b = math.sqrt((ax - cx) ** 2 + (ay - cy) ** 2)
    c = math.sqrt((ax - bx) ** 2 + (ay - by) ** 2)

    # Semi-perimeter
    s = (a + b + c) / 2.0

    # Area via Heron's formula
    area_sq = s * (s - a) * (s - b) * (s - c)
    if area_sq <= 0:
        return float("inf")  # Collinear points = straight road

    area = math.sqrt(area_sq)
    if area < 0.01:
        return float("inf")

    # Circumcircle radius: R = (a * b * c) / (4 * area)
    return (a * b * c) / (4 * area)


def score_curvature(conn):
    """Calculate curvature score for all road segments."""
    cur = conn.cursor()

    # Fetch geometries as coordinate arrays
    cur.execute("""
        SELECT id, ST_AsText(geometry), length_m
        FROM road_segments
        WHERE length_m > 10
        ORDER BY id
    """)

    updates = []
    count = 0

    for row in cur.fetchall():
        seg_id, wkt, length_m = row
        # Parse WKT: "LINESTRING(lon lat, lon lat, ...)"
        coords_str = wkt.replace("LINESTRING(", "").replace(")", "")
        points = []
        for pair in coords_str.split(","):
            parts = pair.strip().split()
            if len(parts) == 2:
                points.append((float(parts[0]), float(parts[1])))

        if len(points) < 3:
            updates.append((0.0, seg_id))
            continue

        # Calculate curvature using sliding window of 3 points
        weighted_curvature = 0.0
        total_length = 0.0

        for i in range(len(points) - 2):
            p1, p2, p3 = points[i], points[i + 1], points[i + 2]
            radius = _circumcircle_radius(p1, p2, p3)

            # Segment length between p1 and p3
            seg_len = math.sqrt(
                ((p3[0] - p1[0]) * 111320 * math.cos(math.radians(p2[1]))) ** 2
                + ((p3[1] - p1[1]) * 111320) ** 2
            )

            # Weight by curvature category
            if radius < 30:
                weight = 3.0  # Hairpin
            elif radius < 100:
                weight = 2.0  # Tight curve
            elif radius < 300:
                weight = 1.0  # Gentle curve
            else:
                weight = 0.0  # Straight

            weighted_curvature += weight * seg_len
            total_length += seg_len

        # Normalize: curvature per km, then scale to 0-1
        if total_length > 0 and length_m and length_m > 0:
            curvature_per_km = (weighted_curvature / total_length) * 1000
            # Typical range: 0 (dead straight) to ~2000 (extremely twisty)
            # Normalize: 500+ = excellent for motorcycling
            score = min(1.0, curvature_per_km / 800.0)
        else:
            score = 0.0

        updates.append((score, seg_id))
        count += 1

        if count % 50000 == 0:
            print(f"    Scored {count:,} segments...")

    # Batch update
    print(f"  Updating {len(updates):,} curvature scores...")
    cur2 = conn.cursor()
    batch_size = 5000
    for i in range(0, len(updates), batch_size):
        batch = updates[i : i + batch_size]
        args = ",".join(
            cur2.mogrify("(%s, %s)", (score, sid)).decode()
            for score, sid in batch
        )
        cur2.execute(f"""
            UPDATE road_segments AS rs
            SET curvature_score = v.score
            FROM (VALUES {args}) AS v(score, id)
            WHERE rs.id = v.id
        """)
        conn.commit()

    print(f"  Curvature scoring complete: {count:,} segments")
    cur.close()
    cur2.close()


if __name__ == "__main__":
    conn = psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", "5434")),
        dbname=os.getenv("POSTGRES_DB", "motogps"),
        user=os.getenv("POSTGRES_USER", "motogps"),
        password=os.getenv("POSTGRES_PASSWORD", "motogps_dev"),
    )
    score_curvature(conn)
    conn.close()
