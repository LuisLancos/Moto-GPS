"""Orchestrator: runs all pipeline steps in order."""

import os
import sys
import time
import argparse
import psycopg2
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

# Add pipeline dir to path
sys.path.insert(0, str(Path(__file__).parent))

from download import find_existing_pbf, download_pbf
from osm_to_postgis import extract_and_import
from curvature import score_curvature
from surface_scorer import score_surfaces
from urban_density import score_urban_density
from road_classifier import classify_roads
from composite_scorer import compute_composite_scores


ALL_STEPS = ["download", "import", "curvature", "surface", "urban", "classify", "composite"]


def get_connection():
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", "5434")),
        dbname=os.getenv("POSTGRES_DB", "motogps"),
        user=os.getenv("POSTGRES_USER", "motogps"),
        password=os.getenv("POSTGRES_PASSWORD", "motogps_dev"),
    )


def run_step(name: str, pbf_path: Path | None = None):
    """Run a single pipeline step."""
    start = time.time()
    print(f"\n{'='*60}")
    print(f"Step: {name}")
    print(f"{'='*60}")

    if name == "download":
        pbf = find_existing_pbf()
        if not pbf:
            pbf = download_pbf("uk")
        return pbf

    elif name == "import":
        if not pbf_path:
            pbf_path = find_existing_pbf()
        if not pbf_path:
            print("ERROR: No PBF found. Run download step first.")
            return None
        extract_and_import(pbf_path)

    elif name == "curvature":
        conn = get_connection()
        score_curvature(conn)
        conn.close()

    elif name == "surface":
        conn = get_connection()
        score_surfaces(conn)
        conn.close()

    elif name == "urban":
        conn = get_connection()
        score_urban_density(conn)
        conn.close()

    elif name == "classify":
        conn = get_connection()
        classify_roads(conn)
        conn.close()

    elif name == "composite":
        conn = get_connection()
        compute_composite_scores(conn)
        conn.close()

    else:
        print(f"Unknown step: {name}")
        return None

    elapsed = time.time() - start
    print(f"  Completed in {elapsed:.1f}s")
    return pbf_path


def main():
    parser = argparse.ArgumentParser(description="Moto-GPS data pipeline")
    parser.add_argument(
        "--step",
        type=str,
        help=f"Comma-separated steps to run. Available: {', '.join(ALL_STEPS)}. Default: all",
    )
    parser.add_argument("--region", default="uk", help="Region to download (default: uk)")
    args = parser.parse_args()

    steps = args.step.split(",") if args.step else ALL_STEPS

    print(f"Moto-GPS Pipeline")
    print(f"Steps: {', '.join(steps)}")
    total_start = time.time()

    pbf_path = None

    for step in steps:
        step = step.strip()
        result = run_step(step, pbf_path)
        if step == "download" and result:
            pbf_path = result

    total_elapsed = time.time() - total_start
    print(f"\n{'='*60}")
    print(f"Pipeline complete in {total_elapsed:.1f}s")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
