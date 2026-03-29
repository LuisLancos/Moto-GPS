"""Scrape ALL biker cafes from ukbikercafes.co.uk using Playwright.

The site is JavaScript-rendered (Elementor), so we need a headless browser.
Extracts name, coordinates, and address from each page of listings.
"""

import os
import json
import time
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


def scrape_all_cafes() -> list[dict]:
    """Scrape all cafe listings using Playwright."""
    from playwright.sync_api import sync_playwright

    all_cafes: list[dict] = []
    seen_names: set[str] = set()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_default_timeout(15000)

        base_url = "https://ukbikercafes.co.uk/cafe-list/"
        page_num = 1

        while True:
            url = f"{base_url}page/{page_num}/" if page_num > 1 else base_url
            print(f"  Page {page_num}: {url}")

            try:
                page.goto(url, wait_until="networkidle", timeout=30000)
                time.sleep(1)  # Let lazy content load
            except Exception as e:
                print(f"    Navigation error: {e}")
                break

            # Extract cafe data via JavaScript
            cafes = page.evaluate("""() => {
                const results = [];
                // Look for listing items with data attributes or structured content
                const items = document.querySelectorAll('.jet-listing-grid__item, .elementor-post, [data-lat]');

                for (const item of items) {
                    const lat = item.getAttribute('data-lat') || item.querySelector('[data-lat]')?.getAttribute('data-lat');
                    const lng = item.getAttribute('data-lng') || item.getAttribute('data-lon')
                        || item.querySelector('[data-lng]')?.getAttribute('data-lng')
                        || item.querySelector('[data-lon]')?.getAttribute('data-lon');

                    const nameEl = item.querySelector('h2 a, h3 a, .jet-listing-dynamic-field__content a, .elementor-heading-title a');
                    const name = nameEl?.textContent?.trim();

                    const addrEl = item.querySelector('.listing-address, .elementor-icon-list-text, [class*="address"]');
                    const address = addrEl?.textContent?.trim() || '';

                    if (name && lat && lng) {
                        results.push({ name, lat: parseFloat(lat), lng: parseFloat(lng), address });
                    }
                }

                // Fallback: try to find coordinates in script tags
                if (results.length === 0) {
                    const scripts = document.querySelectorAll('script');
                    for (const script of scripts) {
                        const text = script.textContent || '';
                        const matches = text.matchAll(/"lat":\s*([0-9.-]+)\s*,\s*"lng":\s*([0-9.-]+)/g);
                        for (const m of matches) {
                            const lat = parseFloat(m[1]);
                            const lng = parseFloat(m[2]);
                            if (lat > 49 && lat < 61 && lng > -8 && lng < 2) {
                                results.push({ name: `Biker Cafe ${lat.toFixed(3)}`, lat, lng, address: '' });
                            }
                        }
                    }
                }

                // Another fallback: extract from visible text with coordinates
                if (results.length === 0) {
                    const allLinks = document.querySelectorAll('a[href*="directory-cafes/listing/"]');
                    for (const link of allLinks) {
                        const name = link.textContent?.trim();
                        if (name && name.length > 2) {
                            results.push({ name, lat: 0, lng: 0, address: '' });
                        }
                    }
                }

                return results;
            }""")

            if not cafes:
                print(f"    No cafes found — stopping")
                break

            new_count = 0
            for cafe in cafes:
                key = cafe["name"]
                if key not in seen_names and cafe["lat"] != 0:
                    seen_names.add(key)
                    all_cafes.append(cafe)
                    new_count += 1

            print(f"    Found {len(cafes)} items, {new_count} new (total: {len(all_cafes)})")

            if new_count == 0:
                # Try to check if there's a next page
                has_next = page.evaluate("""() => {
                    const next = document.querySelector('a.next, .nav-links .next, [rel="next"]');
                    return !!next;
                }""")
                if not has_next:
                    print(f"    No next page — done")
                    break

            page_num += 1
            time.sleep(1.5)  # Be respectful

        # If we got names without coordinates, try to get coords from individual pages
        no_coords = [c for c in all_cafes if c["lat"] == 0]
        if no_coords:
            print(f"\n  Fetching coordinates for {len(no_coords)} cafes without coords...")
            # We'll skip this for now — most should have coords from the listing

        browser.close()

    return all_cafes


def import_to_postgis(cafes: list[dict]):
    """Import scraped biker cafes into PostGIS."""
    conn = _get_conn()
    cur = conn.cursor()

    # Ensure category exists
    cur.execute("""
        INSERT INTO poi_categories (id, label, icon, osm_tags, display_order)
        VALUES ('biker_cafe', 'Biker Cafes ★', '☕', '{"source": "ukbikercafes.co.uk"}', 0)
        ON CONFLICT (id) DO UPDATE SET display_order = 0, label = 'Biker Cafes ★'
    """)
    conn.commit()

    # Remove old biker cafe data
    cur.execute("DELETE FROM pois WHERE category = 'biker_cafe'")
    conn.commit()

    # Filter out entries without valid coordinates
    valid = [c for c in cafes if c["lat"] != 0 and c["lng"] != 0 and 49 < c["lat"] < 61 and -8 < c["lng"] < 2]
    print(f"  Importing {len(valid)} biker cafes (of {len(cafes)} total, {len(cafes)-len(valid)} skipped without coords)...")

    sql = "INSERT INTO pois (osm_id, name, category, subcategory, geometry, lat, lng, tags) VALUES %s"
    tmpl = "(%(oid)s, %(name)s, 'biker_cafe', 'ukbikercafes.co.uk', ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326), %(lat)s, %(lng)s, %(tags)s)"

    rows = [
        {
            "oid": -(i + 100000),
            "name": c["name"],
            "lat": c["lat"],
            "lng": c["lng"],
            "tags": json.dumps({"source": "ukbikercafes.co.uk", "address": c.get("address", "")}),
        }
        for i, c in enumerate(valid)
    ]

    if rows:
        execute_values(cur, sql, rows, template=tmpl)
        conn.commit()

    print(f"  ✓ Imported {len(rows)} biker cafes")

    cur.close()
    conn.close()


def run():
    """Full scrape + import pipeline."""
    print("Step 1: Scraping ukbikercafes.co.uk with Playwright...")
    cafes = scrape_all_cafes()
    print(f"\n  Total scraped: {len(cafes)} cafes")

    if cafes:
        print(f"\nStep 2: Importing to PostGIS...")
        import_to_postgis(cafes)

    # Summary
    conn = _get_conn()
    cur = conn.cursor()
    cur.execute("SELECT count(*) FROM pois WHERE category = 'biker_cafe'")
    total = cur.fetchone()[0]
    print(f"\n  Total biker cafes in DB: {total}")
    cur.close()
    conn.close()
    print("  ✓ Done!")


if __name__ == "__main__":
    run()
