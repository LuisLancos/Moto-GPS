"""Scrape biker cafes from ukbikercafes.co.uk into PostGIS.

The site has ~1,463 biker cafes with coordinates, addresses, and names.
Data is paginated (20 per page, ~74 pages).
"""

import os
import re
import json
import time
import psycopg2
from psycopg2.extras import execute_values
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

try:
    import httpx
except ImportError:
    print("Install httpx: pip install httpx")
    raise

try:
    from bs4 import BeautifulSoup
except ImportError:
    print("Install beautifulsoup4: pip install beautifulsoup4")
    raise

BASE_URL = "https://ukbikercafes.co.uk"
CAFE_LIST_URL = f"{BASE_URL}/cafe-list/"
PUB_LIST_URL = f"{BASE_URL}/pub-list/"
ACCOM_LIST_URL = f"{BASE_URL}/accommodation-list/"

HEADERS = {
    "User-Agent": "MotoGPS/1.0 (motorcycle route planner; importing biker-friendly POIs)",
}


def _get_conn():
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", "5434")),
        dbname=os.getenv("POSTGRES_DB", "motogps"),
        user=os.getenv("POSTGRES_USER", "motogps"),
        password=os.getenv("POSTGRES_PASSWORD", "motogps_dev"),
    )


def scrape_listing_pages(base_url: str, category: str) -> list[dict]:
    """Scrape all pages of a listing (cafes, pubs, or accommodation)."""
    client = httpx.Client(headers=HEADERS, timeout=30.0, follow_redirects=True)
    all_pois = []
    page = 1

    while True:
        url = f"{base_url}page/{page}/" if page > 1 else base_url
        print(f"  Page {page}: {url}")

        try:
            resp = client.get(url)
            if resp.status_code != 200:
                print(f"    HTTP {resp.status_code} — stopping")
                break
        except Exception as e:
            print(f"    Error: {e} — stopping")
            break

        soup = BeautifulSoup(resp.text, "html.parser")

        # Extract POIs from the page
        found = 0
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string)
                pois = _extract_from_jsonld(data, category)
                all_pois.extend(pois)
                found += len(pois)
            except (json.JSONDecodeError, TypeError):
                continue

        # Also try extracting from visible listing cards
        for card in soup.select(".jet-listing-grid__item, .elementor-post, .listing-item"):
            poi = _extract_from_card(card, category)
            if poi:
                # Deduplicate by name
                if not any(p["name"] == poi["name"] for p in all_pois):
                    all_pois.append(poi)
                    found += 1

        if found == 0:
            # Try regex for coordinates in page source
            coord_pois = _extract_coords_from_html(resp.text, category)
            for p in coord_pois:
                if not any(existing["name"] == p["name"] for existing in all_pois):
                    all_pois.append(p)
                    found += len(coord_pois)

        print(f"    Found {found} POIs (total: {len(all_pois)})")

        if found == 0:
            break

        page += 1
        time.sleep(1.5)  # Be respectful

    client.close()
    return all_pois


def _extract_from_jsonld(data: dict | list, category: str) -> list[dict]:
    """Extract POIs from JSON-LD schema markup."""
    pois = []

    if isinstance(data, list):
        for item in data:
            pois.extend(_extract_from_jsonld(item, category))
        return pois

    if not isinstance(data, dict):
        return []

    # Check for LocalBusiness or similar schema
    schema_type = data.get("@type", "")
    if isinstance(schema_type, list):
        schema_type = schema_type[0] if schema_type else ""

    geo = data.get("geo", {})
    lat = geo.get("latitude")
    lng = geo.get("longitude")
    name = data.get("name")

    if name and lat and lng:
        try:
            pois.append({
                "name": str(name).strip(),
                "lat": float(lat),
                "lng": float(lng),
                "category": category,
                "address": _format_address(data.get("address", {})),
                "description": data.get("description", ""),
            })
        except (ValueError, TypeError):
            pass

    # Recurse into sub-items
    for key in ("itemListElement", "mainEntity", "hasPart"):
        sub = data.get(key)
        if sub:
            pois.extend(_extract_from_jsonld(sub, category))

    return pois


def _extract_from_card(card, category: str) -> dict | None:
    """Extract POI from an HTML listing card."""
    # Try to find name and coordinates in data attributes or links
    name_el = card.select_one("h2, h3, .listing-title, .jet-listing-dynamic-field__content a")
    if not name_el:
        return None

    name = name_el.get_text(strip=True)
    if not name:
        return None

    # Look for coordinates in data attributes
    lat = card.get("data-lat") or card.get("data-latitude")
    lng = card.get("data-lng") or card.get("data-longitude") or card.get("data-lon")

    if not lat or not lng:
        return None

    try:
        return {
            "name": name,
            "lat": float(lat),
            "lng": float(lng),
            "category": category,
            "address": "",
            "description": "",
        }
    except (ValueError, TypeError):
        return None


def _extract_coords_from_html(html: str, category: str) -> list[dict]:
    """Last resort: extract coordinates from raw HTML using regex."""
    pois = []
    # Look for patterns like data-lat="52.123" data-lng="-1.456"
    pattern = r'(?:data-lat|latitude)["\s:=]+([0-9.-]+).*?(?:data-l(?:ng|on)|longitude)["\s:=]+([0-9.-]+)'
    for match in re.finditer(pattern, html, re.IGNORECASE | re.DOTALL):
        try:
            lat = float(match.group(1))
            lng = float(match.group(2))
            if 49 < lat < 61 and -8 < lng < 2:  # UK bounds
                pois.append({
                    "name": f"Biker {category} at {lat:.3f},{lng:.3f}",
                    "lat": lat,
                    "lng": lng,
                    "category": category,
                    "address": "",
                    "description": "",
                })
        except (ValueError, TypeError):
            continue
    return pois


def _format_address(addr) -> str:
    """Format a schema.org PostalAddress into a string."""
    if isinstance(addr, str):
        return addr
    if isinstance(addr, dict):
        parts = []
        for key in ("streetAddress", "addressLocality", "addressRegion", "postalCode"):
            val = addr.get(key)
            if val:
                parts.append(str(val).strip())
        return ", ".join(parts)
    return ""


def import_to_postgis(pois: list[dict]):
    """Insert scraped biker POIs into PostGIS."""
    conn = _get_conn()
    cur = conn.cursor()

    # Ensure biker categories exist
    for cat_id, label, icon in [
        ("biker_cafe", "Biker Cafes", "☕"),
        ("biker_pub", "Biker Pubs", "🍺"),
        ("biker_accommodation", "Biker Accommodation", "🏨"),
    ]:
        cur.execute(
            "INSERT INTO poi_categories (id, label, icon, osm_tags, display_order) "
            "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING",
            (cat_id, label, icon, json.dumps({"source": "ukbikercafes.co.uk"}), 20),
        )
    conn.commit()

    # Remove old biker cafe data
    cur.execute("DELETE FROM pois WHERE category IN ('biker_cafe', 'biker_pub', 'biker_accommodation')")
    conn.commit()

    print(f"  Importing {len(pois)} biker POIs...")

    sql = """
        INSERT INTO pois (osm_id, name, category, subcategory, geometry, lat, lng, tags)
        VALUES %s
    """

    # Use negative IDs to distinguish from OSM data
    template = """(
        %(osm_id)s, %(name)s, %(category)s, %(subcategory)s,
        ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326),
        %(lat)s, %(lng)s, %(tags)s
    )"""

    rows = []
    for i, p in enumerate(pois):
        rows.append({
            "osm_id": -(i + 1),  # Negative IDs for non-OSM data
            "name": p["name"],
            "category": p["category"],
            "subcategory": "ukbikercafes.co.uk",
            "lat": p["lat"],
            "lng": p["lng"],
            "tags": json.dumps({"source": "ukbikercafes.co.uk", "address": p.get("address", "")}),
        })

    execute_values(cur, sql, rows, template=template)
    conn.commit()
    cur.close()
    conn.close()
    print(f"  ✓ Imported {len(rows)} biker POIs")


def run():
    """Scrape all categories from ukbikercafes.co.uk."""
    all_pois = []

    print("Step 1: Scraping biker cafes...")
    cafes = scrape_listing_pages(CAFE_LIST_URL, "biker_cafe")
    all_pois.extend(cafes)

    print(f"\nStep 2: Scraping biker pubs...")
    pubs = scrape_listing_pages(PUB_LIST_URL, "biker_pub")
    all_pois.extend(pubs)

    print(f"\nStep 3: Scraping biker accommodation...")
    accom = scrape_listing_pages(ACCOM_LIST_URL, "biker_accommodation")
    all_pois.extend(accom)

    print(f"\nTotal scraped: {len(all_pois)} POIs")
    print(f"  Cafes: {len(cafes)}")
    print(f"  Pubs: {len(pubs)}")
    print(f"  Accommodation: {len(accom)}")

    if all_pois:
        print(f"\nStep 4: Importing to PostGIS...")
        import_to_postgis(all_pois)

        # Summary
        conn = _get_conn()
        cur = conn.cursor()
        cur.execute("SELECT category, count(*) FROM pois WHERE category LIKE 'biker_%' GROUP BY category")
        print("\n  Biker POI Summary:")
        for cat, count in cur.fetchall():
            print(f"    {cat}: {count}")
        cur.close()
        conn.close()

    print("\n  ✓ Biker cafe scrape complete!")


if __name__ == "__main__":
    run()
