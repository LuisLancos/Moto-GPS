"""Score road surface quality from OSM tags."""

import os
import psycopg2
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent / ".env")

# Surface quality mapping (0 = worst, 1 = best for motorcycling)
SURFACE_SCORES = {
    "asphalt": 1.0,
    "paved": 0.9,
    "concrete": 0.85,
    "concrete:plates": 0.8,
    "concrete:lanes": 0.8,
    "paving_stones": 0.65,
    "sett": 0.5,
    "cobblestone": 0.4,
    "metal": 0.7,
    "compacted": 0.5,
    "fine_gravel": 0.4,
    "gravel": 0.3,
    "pebblestone": 0.25,
    "unpaved": 0.2,
    "ground": 0.15,
    "dirt": 0.1,
    "earth": 0.1,
    "mud": 0.05,
    "sand": 0.05,
    "grass": 0.05,
    "wood": 0.6,
}

# Smoothness adjustments
SMOOTHNESS_ADJUSTMENTS = {
    "excellent": 0.1,
    "good": 0.05,
    "intermediate": 0.0,
    "bad": -0.15,
    "very_bad": -0.3,
    "horrible": -0.4,
    "very_horrible": -0.5,
    "impassable": -0.8,
}

# Default score when no surface tag exists, based on highway type
HIGHWAY_SURFACE_DEFAULTS = {
    "motorway": 0.95,
    "motorway_link": 0.95,
    "trunk": 0.9,
    "trunk_link": 0.9,
    "primary": 0.85,
    "primary_link": 0.85,
    "secondary": 0.8,
    "secondary_link": 0.8,
    "tertiary": 0.75,
    "tertiary_link": 0.75,
    "unclassified": 0.6,
    "residential": 0.7,
    "service": 0.6,
    "track": 0.2,
}


def score_surfaces(conn):
    """Score surface quality for all road segments."""
    cur = conn.cursor()

    cur.execute("""
        UPDATE road_segments
        SET surface_score = CASE
            WHEN surface IS NOT NULL THEN
                GREATEST(0.0, LEAST(1.0,
                    COALESCE(
                        CASE surface
                            {surface_cases}
                        END, 0.5)
                    + COALESCE(
                        CASE smoothness
                            {smoothness_cases}
                        END, 0.0)
                ))
            ELSE
                COALESCE(
                    CASE highway
                        {default_cases}
                    END, 0.5)
        END
    """.format(
        surface_cases=" ".join(
            f"WHEN '{k}' THEN {v}" for k, v in SURFACE_SCORES.items()
        ),
        smoothness_cases=" ".join(
            f"WHEN '{k}' THEN {v}" for k, v in SMOOTHNESS_ADJUSTMENTS.items()
        ),
        default_cases=" ".join(
            f"WHEN '{k}' THEN {v}" for k, v in HIGHWAY_SURFACE_DEFAULTS.items()
        ),
    ))

    conn.commit()
    affected = cur.rowcount
    print(f"  Surface scoring complete: {affected:,} segments updated")
    cur.close()


if __name__ == "__main__":
    conn = psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", "5434")),
        dbname=os.getenv("POSTGRES_DB", "motogps"),
        user=os.getenv("POSTGRES_USER", "motogps"),
        password=os.getenv("POSTGRES_PASSWORD", "motogps_dev"),
    )
    score_surfaces(conn)
    conn.close()
