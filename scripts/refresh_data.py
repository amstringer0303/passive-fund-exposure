#!/usr/bin/env python3
"""
refresh_data.py — Fetch public sources, update /data/*.json and feed.xml.

Run by GitHub Actions on a daily cron. Commits if any data changed.

Data sources (all public, no auth required):
  - SEC EDGAR full-text search: https://efts.sec.gov/LATEST/search-index?q=...
  - SEC EDGAR company search: https://www.sec.gov/cgi-bin/browse-edgar
  - Nasdaq methodology pages (HTML scrape)
  - S&P DJI methodology PDF (HEAD check for updates)
  - Issuer ETF holdings pages (HTML/CSV scrape per fund)

IMPORTANT: This script must never transmit user-supplied data. It only reads
public index and regulatory sources and writes to /data/*.json and feed.xml.
"""

import json
import sys
import hashlib
import datetime
from pathlib import Path

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("ERROR: pip install requests beautifulsoup4", file=sys.stderr)
    sys.exit(1)

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR  = REPO_ROOT / "data"
FEED_PATH = REPO_ROOT / "feed.xml"

EDGAR_SEARCH = "https://efts.sec.gov/LATEST/search-index?q=%22SpaceX%22+%228-A%22&dateRange=custom&startdt=2026-01-01&forms=8-A12B"
EDGAR_FULLTEXT = "https://efts.sec.gov/LATEST/search-index?q=%22SPCX%22&forms=8-A12B,S-1,424B4"

# Map ticker → issuer holdings CSV/JSON URL (to be filled in per fund)
HOLDINGS_URLS: dict[str, str] = {
    # "QQQ": "https://www.invesco.com/.../QQQ_holdings.csv",  # TODO
    # "QQQM": "...",  # TODO
    # "VOO": "...",   # TODO
}

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "passive-fund-exposure/1.0 (github.com/amstringer0303/passive-fund-exposure; educational research)"})


def hash_file(path: Path) -> str:
    if not path.exists():
        return ""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fetch(url: str, timeout: int = 20) -> requests.Response | None:
    try:
        r = SESSION.get(url, timeout=timeout)
        r.raise_for_status()
        return r
    except requests.RequestException as e:
        print(f"  WARN: fetch failed for {url}: {e}", file=sys.stderr)
        return None


# ─── EDGAR: check for new large IPO filings ───────────────────────────────────

def check_edgar_ipo_filings() -> list[dict]:
    """
    Query SEC EDGAR for new 8-A12B (exchange registration) filings by large-cap
    companies. Returns a list of filing metadata dicts.

    TODO: Expand to include S-1 and 424B4 (final prospectus) filings.
    Filter by: filer size = large accelerated, sector = technology.
    """
    print("  Checking EDGAR for new IPO/exchange registrations...")
    r = fetch(EDGAR_SEARCH)
    if not r:
        return []
    try:
        data = r.json()
        hits = data.get("hits", {}).get("hits", [])
        filings = []
        for hit in hits[:10]:
            src = hit.get("_source", {})
            filings.append({
                "accession": src.get("accession_no"),
                "entity": src.get("entity_name"),
                "filed": src.get("file_date"),
                "form": src.get("form_type"),
                "url": f"https://www.sec.gov/Archives/edgar/data/{src.get('entity_id', '')}/{src.get('accession_no', '').replace('-','')}/",
            })
        return filings
    except (json.JSONDecodeError, KeyError) as e:
        print(f"  WARN: EDGAR parse error: {e}", file=sys.stderr)
        return []


# ─── Events: merge new filings into events.json ──────────────────────────────

def update_events(new_filings: list[dict]) -> bool:
    """Load events.json, merge in any new EDGAR-detected events, write back. Returns True if changed."""
    path = DATA_DIR / "events.json"
    events = json.loads(path.read_text(encoding="utf-8"))
    existing_ids = {e.get("id") for e in events}
    changed = False

    for filing in new_filings:
        if not filing.get("accession"):
            continue
        evt_id = f"edgar-{filing['accession']}"
        if evt_id in existing_ids:
            continue
        events.append({
            "id": evt_id,
            "date": filing.get("filed", ""),
            "type": "ipo_filing",
            "title": f"{filing.get('entity','Unknown')} — {filing.get('form','Filing')} Filed",
            "summary": f"SEC {filing.get('form')} filing detected for {filing.get('entity')}. Review the filing to assess index eligibility.",
            "affected_indexes": [],
            "source_url": filing.get("url", ""),
            "as_of": datetime.date.today().isoformat(),
            "confidence": "auto-detected from EDGAR — manual review required",
        })
        print(f"  + New event: {evt_id} ({filing.get('entity')})")
        changed = True

    if changed:
        path.write_text(json.dumps(events, indent=2, ensure_ascii=False), encoding="utf-8")
    return changed


# ─── Holdings: update fund concentration numbers ─────────────────────────────

def update_fund_holdings() -> bool:
    """
    For each fund in HOLDINGS_URLS, fetch the issuer's holdings file and update
    top10_weight_pct and megacap_share_pct in funds.json.

    TODO: Implement per-fund parsers as holding URLs are confirmed.
    """
    if not HOLDINGS_URLS:
        print("  Holdings URLs not yet configured — skipping concentration update.")
        return False

    path = DATA_DIR / "funds.json"
    funds = json.loads(path.read_text(encoding="utf-8"))
    fund_map = {f["ticker"]: f for f in funds}
    changed = False

    for ticker, url in HOLDINGS_URLS.items():
        if ticker not in fund_map:
            continue
        print(f"  Fetching holdings for {ticker}...")
        r = fetch(url)
        if not r:
            continue
        # TODO: parse holdings CSV/JSON, compute top10_weight_pct and megacap_share_pct
        # fund_map[ticker]["top10_weight_pct"] = computed_value
        # fund_map[ticker]["megacap_share_pct"] = computed_value
        # fund_map[ticker]["as_of"] = datetime.date.today().isoformat()
        # fund_map[ticker]["data_status"] = "sourced"
        # changed = True

    if changed:
        updated = [fund_map[f["ticker"]] if f["ticker"] in fund_map else f for f in funds]
        path.write_text(json.dumps(updated, indent=2, ensure_ascii=False), encoding="utf-8")
    return changed


# ─── RSS feed ─────────────────────────────────────────────────────────────────

def regenerate_feed(events: list[dict]) -> bool:
    """Regenerate feed.xml from current events.json. Returns True if file changed."""
    today = datetime.date.today().isoformat()
    items = []
    for e in sorted(events, key=lambda x: x.get("date",""), reverse=True)[:20]:
        src = e.get("source_url","")
        link = src if src.startswith("http") else "https://amstringer0303.github.io/passive-fund-exposure/tracker/"
        items.append(f"""  <item>
    <title><![CDATA[{e.get("title","")}]]></title>
    <link>{link}</link>
    <guid isPermaLink="false">{e.get("id","")}</guid>
    <pubDate>{e.get("date","")} 00:00:00 +0000</pubDate>
    <description><![CDATA[{e.get("summary","")}]]></description>
    <category>{e.get("type","")}</category>
  </item>""")

    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Passive Fund Exposure — Index Events Feed</title>
    <link>https://amstringer0303.github.io/passive-fund-exposure/</link>
    <description>Index methodology changes, IPO filings, eligibility windows, and reconstitution dates affecting passive retirement funds.</description>
    <language>en-us</language>
    <lastBuildDate>{today}</lastBuildDate>
    <atom:link href="https://amstringer0303.github.io/passive-fund-exposure/feed.xml" rel="self" type="application/rss+xml"/>
{chr(10).join(items)}
  </channel>
</rss>"""

    old_hash = hash_file(FEED_PATH)
    FEED_PATH.write_text(xml, encoding="utf-8")
    return hash_file(FEED_PATH) != old_hash


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    print(f"refresh_data: starting run {datetime.datetime.utcnow().isoformat()}Z\n")
    any_changed = False

    print("Step 1: Check EDGAR for new IPO filings")
    new_filings = check_edgar_ipo_filings()
    print(f"  Found {len(new_filings)} recent filings.")
    if update_events(new_filings):
        any_changed = True

    print("\nStep 2: Update fund concentration data from issuer holdings")
    if update_fund_holdings():
        any_changed = True

    print("\nStep 3: Regenerate RSS feed")
    events = json.loads((DATA_DIR / "events.json").read_text(encoding="utf-8"))
    if regenerate_feed(events):
        print("  feed.xml updated.")
        any_changed = True
    else:
        print("  feed.xml unchanged.")

    print()
    if any_changed:
        print("refresh_data: data changed — commit will be created by Actions workflow.")
    else:
        print("refresh_data: no changes detected.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
