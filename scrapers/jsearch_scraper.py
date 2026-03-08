#!/usr/bin/env python3
"""
scrapers/jsearch_scraper.py — JobAgent v4.1
JSearch / RapidAPI Scraper

Queries the JSearch API (RapidAPI) using boolean cluster queries generated
by the QueryEngine. Covers Google Jobs, LinkedIn, Indeed and other boards.

Free tier:  200 requests/month  (~6/day).
Orchestrator budget: 10 queries/day (shared across all 15 clusters).

Env vars:
    JSEARCH_API_KEY  — RapidAPI key from:
                       https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch

Standard output schema (all scrapers match this):
    job_title, company_name, job_url, location, posted_date,
    description (500-char), source, cluster, itar_flag, itar_detail, raw_id
"""

import os
import json
import time
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional

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

JSEARCH_API_KEY  = os.environ.get("JSEARCH_API_KEY", "")
JSEARCH_HOST     = "jsearch.p.rapidapi.com"
JSEARCH_URL      = "https://jsearch.p.rapidapi.com/search"

REQUEST_DELAY    = 1.5   # seconds between API calls
RESULTS_PER_PAGE = 10    # JSearch free tier hard cap per request
DATE_POSTED      = "3days"  # "today" | "3days" | "week" | "month"

# Aggregator domains — if apply link points here, try job_google_link fallback
REJECT_DOMAINS = [
    "indeed.com", "glassdoor.com", "ziprecruiter.com",
    "simplyhired.com", "monster.com", "careerbuilder.com",
    "linkedin.com",
]

ITAR_KEYWORDS = [
    "security clearance", "us person", "itar", "export controlled",
    "classified", "us citizen or permanent resident",
    "must be authorized to work without sponsorship",
    "u.s. citizen", "u.s. national", "permanent resident only",
]


class JSearchScraper:
    """Scrapes jobs via JSearch API using QueryEngine boolean queries."""

    def run(self, queries: List[Dict]) -> List[Dict]:
        if not JSEARCH_API_KEY:
            log.warning("[jsearch] JSEARCH_API_KEY not set — skipping")
            return []

        all_jobs: List[Dict] = []
        seen_ids: set = set()

        for q_dict in queries:
            query_str = q_dict.get("query", "")
            cluster   = q_dict.get("cluster", "unknown")
            log.info(f"[jsearch] Query ({cluster}): {query_str[:80]}...")

            time.sleep(REQUEST_DELAY)
            raw_jobs = self._api_call(query_str)

            for raw in raw_jobs:
                job_id = raw.get("job_id", "")
                if job_id and job_id in seen_ids:
                    continue
                seen_ids.add(job_id)

                normalized = self._normalize(raw, cluster)
                if normalized:
                    all_jobs.append(normalized)

        log.info(f"[jsearch] Total unique jobs: {len(all_jobs)}")
        return all_jobs

    # ── API call ──────────────────────────────────────────────────────────────

    def _api_call(self, query: str, retries: int = 2) -> List[Dict]:
        headers = {
            "X-RapidAPI-Key":  JSEARCH_API_KEY,
            "X-RapidAPI-Host": JSEARCH_HOST,
        }
        params = {
            "query":       query,
            "num_results": str(RESULTS_PER_PAGE),
            "date_posted": DATE_POSTED,
            "country":     "us",
            "language":    "en",
        }
        for attempt in range(retries + 1):
            try:
                r = requests.get(JSEARCH_URL, headers=headers,
                                 params=params, timeout=15)
                if r.status_code == 429:
                    wait = 60 * (attempt + 1)
                    log.warning(f"[jsearch] Rate limited — waiting {wait}s ...")
                    time.sleep(wait)
                    continue
                if r.status_code == 403:
                    log.error("[jsearch] 403 Forbidden — quota exceeded or invalid key.")
                    return []
                if r.status_code != 200:
                    log.warning(f"[jsearch] HTTP {r.status_code} — skipping query")
                    return []
                data = r.json()
                if "error" in data:
                    log.error(f"[jsearch] API error: {data['error']}")
                    return []
                return data.get("data", [])
            except Exception as e:
                log.error(f"[jsearch] Request error (attempt {attempt+1}): {e}")
                if attempt < retries:
                    time.sleep(5)
        return []

    # ── Normalise ─────────────────────────────────────────────────────────────

    def _normalize(self, raw: Dict, cluster: str) -> Optional[Dict]:
        apply_link = raw.get("job_apply_link", "") or ""

        # Try to avoid aggregator links; fall back to google canonical link
        if self._is_aggregator(apply_link):
            fallback = raw.get("job_google_link", "") or ""
            if not self._is_aggregator(fallback):
                apply_link = fallback
            else:
                return None   # both links are aggregators — drop

        if not apply_link:
            return None

        title   = raw.get("job_title",      "") or ""
        company = raw.get("employer_name",  "") or ""
        desc    = raw.get("job_description","") or ""

        city    = raw.get("job_city",  "") or ""
        state   = raw.get("job_state", "") or ""
        location = f"{city}, {state}".strip(", ") or "United States"

        posted_date = self._parse_date(raw.get("job_posted_at_datetime_utc", ""))

        itar_flags = [kw for kw in ITAR_KEYWORDS if kw in desc.lower()]

        return {
            "job_title":    title,
            "company_name": company,
            "job_url":      apply_link,
            "location":     location,
            "posted_date":  posted_date,
            "description":  desc[:500],
            "source":       "jsearch",
            "cluster":      cluster,
            "itar_flag":    bool(itar_flags),
            "itar_detail":  ", ".join(itar_flags),
            "raw_id":       raw.get("job_id", ""),
        }

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _is_aggregator(self, url: str) -> bool:
        if not url:
            return True
        lower = url.lower()
        return any(d in lower for d in REJECT_DOMAINS)

    def _parse_date(self, ts: str) -> str:
        if not ts:
            return ""
        try:
            return (
                datetime.fromisoformat(ts.replace("Z", "+00:00"))
                .strftime("%Y-%m-%d")
            )
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
    print(f"\n{len(jobs)} jobs found")
    if jobs:
        print(json.dumps(jobs[0], indent=2))
