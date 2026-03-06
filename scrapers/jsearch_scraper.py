#!/usr/bin/env python3
"""
scrapers/jsearch_scraper.py — JobAgent v2 JSearch Scraper

Queries RapidAPI JSearch with generated boolean queries.
Free tier: 200 requests/month (~6/day).

Env vars required:
    JSEARCH_API_KEY  — from https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
"""

import os
import json
import time
import logging
from datetime import datetime, timezone
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

log = logging.getLogger("jsearch_scraper")

JSEARCH_API_KEY = os.environ.get("JSEARCH_API_KEY", "")
JSEARCH_HOST = "jsearch.p.rapidapi.com"
JSEARCH_URL = "https://jsearch.p.rapidapi.com/search"

REQUEST_DELAY = 1.5       # seconds between calls
MAX_PAGES = 1
RESULTS_PER_PAGE = 10
DATE_POSTED = "3days"     # "today" | "3days" | "week" | "month"

REJECT_DOMAINS = [
    "indeed.com", "glassdoor.com", "ziprecruiter.com",
    "simplyhired.com", "monster.com", "careerbuilder.com",
    "linkedin.com"
]

ITAR_KEYWORDS = [
    "security clearance", "us person", "itar", "export controlled",
    "classified", "us citizen or permanent resident",
    "must be authorized to work without sponsorship",
    "u.s. citizen", "u.s. national", "permanent resident only"
]


class JSearchScraper:
    """Scrapes jobs via JSearch API using generated query strings."""

    def run(self, queries: List[Dict]) -> List[Dict]:
        """Execute all queries and return deduplicated job list."""
        if not JSEARCH_API_KEY:
            log.warning("JSEARCH_API_KEY not set — returning empty results")
            return []

        all_jobs: List[Dict] = []
        seen_ids: set = set()

        for q_dict in queries:
            query_str = q_dict["query"]
            cluster = q_dict.get("cluster", "unknown")
            log.info(f"[jsearch] Query ({cluster}): {query_str[:80]}...")
            time.sleep(REQUEST_DELAY)

            raw_jobs = self._api_call(query_str)
            for raw in raw_jobs:
                job_id = raw.get("job_id", "")
                if job_id in seen_ids:
                    continue
                seen_ids.add(job_id)

                normalized = self._normalize(raw, cluster)
                if normalized:
                    all_jobs.append(normalized)

        log.info(f"[jsearch] Total unique jobs: {len(all_jobs)}")
        return all_jobs

    def _api_call(self, query: str, retries: int = 2) -> List[Dict]:
        headers = {
            "X-RapidAPI-Key": JSEARCH_API_KEY,
            "X-RapidAPI-Host": JSEARCH_HOST
        }
        params = {
            "query": query,
            "page": "1",
            "num_pages": str(MAX_PAGES),
            "date_posted": DATE_POSTED,
            "country": "us",
            "language": "en",
        }
        for attempt in range(retries + 1):
            try:
                r = requests.get(JSEARCH_URL, headers=headers,
                                 params=params, timeout=15)
                if r.status_code == 429:
                    wait = 60 * (attempt + 1)
                    log.warning(f"Rate limited. Waiting {wait}s...")
                    time.sleep(wait)
                    continue
                if r.status_code == 403:
                    log.error("JSearch quota exceeded or invalid key.")
                    return []
                if r.status_code != 200:
                    log.warning(f"JSearch returned {r.status_code}")
                    return []
                return r.json().get("data", [])
            except Exception as e:
                log.error(f"JSearch request error: {e}")
                if attempt < retries:
                    time.sleep(5)
        return []

    def _normalize(self, raw: Dict, cluster: str) -> Dict | None:
        """Convert JSearch raw job to standard schema."""
        apply_link = raw.get("job_apply_link", "") or ""

        # Reject aggregator links
        if self._is_aggregator(apply_link):
            apply_link = raw.get("job_google_link", apply_link) or apply_link
            if self._is_aggregator(apply_link):
                return None

        title = raw.get("job_title", "") or ""
        company = raw.get("employer_name", "") or ""
        desc = raw.get("job_description", "") or ""

        city = raw.get("job_city", "") or ""
        state = raw.get("job_state", "") or ""
        location = f"{city}, {state}".strip(", ") or "Unknown"

        # Parse posted date
        posted_raw = raw.get("job_posted_at_datetime_utc", "")
        posted_date = self._parse_date(posted_raw)

        itar_flags = [kw for kw in ITAR_KEYWORDS if kw in desc.lower()]

        return {
            "job_title": title,
            "company_name": company,
            "job_url": apply_link,
            "location": location,
            "posted_date": posted_date,
            "description": desc[:500],  # truncate for storage
            "source": "jsearch",
            "cluster": cluster,
            "itar_flag": len(itar_flags) > 0,
            "itar_detail": ", ".join(itar_flags),
            "raw_id": raw.get("job_id", ""),
        }

    def _is_aggregator(self, url: str) -> bool:
        if not url:
            return True
        lower = url.lower()
        return any(d in lower for d in REJECT_DOMAINS)

    def _parse_date(self, ts: str) -> str:
        if not ts:
            return ""
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            return dt.strftime("%Y-%m-%d")
        except Exception:
            return ts[:10] if len(ts) >= 10 else ts


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s")
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from engine.query_engine import QueryEngine
    queries = QueryEngine().generate_queries()[:3]
    scraper = JSearchScraper()
    jobs = scraper.run(queries)
    print(json.dumps(jobs[:3], indent=2))
