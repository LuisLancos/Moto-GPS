"""Download OSM PBF data from Geofabrik."""

import os
import requests
from pathlib import Path

# Geofabrik extract URLs — expand by adding more regions
REGIONS = {
    "uk": "https://download.geofabrik.de/europe/great-britain-latest.osm.pbf",
    # Phase 2: add more regions
    # "france": "https://download.geofabrik.de/europe/france-latest.osm.pbf",
    # "germany": "https://download.geofabrik.de/europe/germany-latest.osm.pbf",
}

DATA_DIR = Path(__file__).parent.parent / "data" / "osm"


def download_pbf(region: str = "uk", force: bool = False) -> Path:
    """Download OSM PBF extract for a region."""
    if region not in REGIONS:
        raise ValueError(f"Unknown region: {region}. Available: {list(REGIONS.keys())}")

    url = REGIONS[region]
    filename = url.split("/")[-1]
    output_path = DATA_DIR / filename

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if output_path.exists() and not force:
        size_mb = output_path.stat().st_size / (1024 * 1024)
        print(f"  PBF already exists: {output_path} ({size_mb:.0f}MB). Use --force to re-download.")
        return output_path

    print(f"  Downloading {url}...")
    print(f"  This is ~1.8GB for UK, may take a few minutes.")

    resp = requests.get(url, stream=True)
    resp.raise_for_status()

    total = int(resp.headers.get("content-length", 0))
    downloaded = 0

    with open(output_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192 * 1024):
            f.write(chunk)
            downloaded += len(chunk)
            if total > 0:
                pct = (downloaded / total) * 100
                print(f"\r  {downloaded / (1024*1024):.0f}MB / {total / (1024*1024):.0f}MB ({pct:.1f}%)", end="")

    print(f"\n  Downloaded to {output_path}")
    return output_path


# We can also reuse the PBF already downloaded by Valhalla
def find_existing_pbf() -> Path | None:
    """Check if Valhalla already downloaded a PBF we can reuse."""
    valhalla_pbf = Path(__file__).parent.parent / "data" / "valhalla" / "great-britain-latest.osm.pbf"
    if valhalla_pbf.exists():
        size_mb = valhalla_pbf.stat().st_size / (1024 * 1024)
        print(f"  Found existing PBF from Valhalla: {valhalla_pbf} ({size_mb:.0f}MB)")
        return valhalla_pbf
    return None


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--region", default="uk")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    # Try Valhalla's PBF first
    pbf = find_existing_pbf()
    if not pbf:
        pbf = download_pbf(args.region, args.force)
    print(f"PBF ready: {pbf}")
