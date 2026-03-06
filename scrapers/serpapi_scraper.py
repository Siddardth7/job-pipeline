#!/usr/bin/env python3
"""
scrapers/serpapi_scraper.py — JobAgent v2 SerpApi Scraper

Queries SerpApi Google Jobs endpoint with generated queries.
Free tier: 100 searches/month (~3/day).

Env vars required:
    SERPAPI_KEY  — from https://serpapi.com/
"""

import os
import json
import time
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Dict

try:
    import requests
except ImportError:
    raise ImportError("Run: pip install requests")

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

log = logging.getLogger("serpapi_scraper")

SERPAPI_KEY = os.environ.get("SERPAPI_KEY", "")
SERPAPI_URL = "https://serpapi.com/search"

REQUEST_DELAY = 2.0
CHIPS_FILTER = "date_range:3"  # last 3 days on Google Jobs

ITAR_KEYWORDS = [
    "security clearance", "us person", "itar", "export controlled",
    "classified", "us citizen or permanent resident",
    "must be authorized to work without sponsorship",
    "u.s. citizen", "u.s. national", "permanent resident only"
]


class SerpApiScraper:
    """Scrapes Google Jobs via SerpApi."""

    def run(self, queries: List[Dict]) -> List[Dict]:
        if not SERPAPI_KEY:
            log.warning("SERPAPI_KEY not set — returning empty results")
            return []

        all_jobs: List[Dict] = []
        seen: set = set()

        for q_dict in queries:
            query_str = q_dict["query"]
            cluster = q_dict.get("cluster", "unknown")
            log.info(f"[serpapi] Query ({cluster}): {query_str[:80]}...")
            time.sleep(REQUEST_DELAY)

            raw_results = self._api_call(query_str)
            for raw in raw_results:
                key = (raw.get("company_name", ""),
                       raw.get("title", ""),
                       raw.get("location", ""))
                if key in seen:
                    continue
                seen.add(key)

                normalized = self._normalize(raw, cluster)
                if normalized:
                    all_jobs.append(normalized)

        log.info(f"[serpapi] Total unique jobs: {len(all_jobs)}")
        return all_jobs

    def _api_call(self, query: str) -> List[Dict]:
        params = {
            "engine": "google_jobs",
            "q": query,
            "hl": "en",
            "gl": "us",
            "chips": CHIPS_FILTER,
            "api_key": SERPAPI_KEY,
        }
        try:
            r = requests.get(SERPAPI_URL, params=params, timeout=20)
            if r.status_code == 401:
                log.error("SerpApi: Invalid API key or quota exhausted.")
                return []
            if r.status_code != 200:
                log.warning(f"SerpApi returned {r.status_code}")
                return []
            data = r.json()
            return data.get("jobs_results", [])
        except Exception as e:
            log.error(f"SerpApi request error: {e}")
            return []

    def _normalize(self, raw: Dict, cluster: str) -> Dict | None:
        title = raw.get("title", "") or ""
        company = raw.get("company_name", "") or ""
        location = raw.get("location", "") or ""
        desc = raw.get("description", "") or ""

        # Get best apply link
        apply_link = ""
        for option in raw.get("apply_options", []):
            link = option.get("link", "")
            if link and "google.com" not in link:
                apply_link = link
                break
        if not apply_link:
            apply_link = raw.get("apply_options", [{}])[0].get("link", "") if raw.get("apply_options") else ""

        if not apply_link:
            return None

        posted_date = self._parse_ago(raw.get("detected_extensions", {}).get("posted_at", ""))

        itar_flags = [kw for kw in ITAR_KEYWORDS if kw in desc.lower()]

        return {
            "job_title": title,
            "company_name": company,
            "job_url": apply_link,
            "location": location,
            "posted_date": posted_date,
            "description": desc[:500],
            "source": "serpapi",
            "cluster": cluster,
            "itar_flag": len(itar_flags) > 0,
            "itar_detail": ", ".join(itar_flags),
            "raw_id": "",
        }

    def _parse_ago(self, text: str) -> str:
        """Convert '3 days ago' → approximate ISO date."""
        if not text:
            return ""
        from datetime import timedelta
        text_l = text.lower()
        now = datetime.utcnow()
        try:
            if "hour" in text_l:
                return now.strftime("%Y-%m-%d")
            if "day" in text_l:
                days = int("".join(c for c in text_l if c.isdigit()) or "1")
                return (now - timedelta(days=days)).strftime("%Y-%m-%d")
            if "week" in text_l:
                return (now - timedelta(weeks=1)).strftime("%Y-%m-%d")
        except Exception:
            pass
        return datetime.utcnow().strftime("%Y-%m-%d")


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s")
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from engine.query_engine import QueryEngine
    queries = QueryEngine().generate_queries()[:3]
    scraper = SerpApiScraper()
    jobs = scraper.run(queries)
    print(json.dumps(jobs[:3], indent=2))
