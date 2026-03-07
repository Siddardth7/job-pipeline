#!/usr/bin/env python3
"""
scrapers/serpapi_scraper.py — JobAgent v4 SerpApi Scraper

Queries SerpApi Google Jobs endpoint with generated queries.
Free tier: 100 searches/month (~3/day).

Env vars required:
    SERPAPI_KEY  — from https://serpapi.com/

Bug fixes in this version:
    - chips param was "date_range:3" (invalid) → now "date_posted:3days" (valid)
    - num param was missing → now set to 20 results per request
    - apply_link extraction now tries multiple fields before dropping
    - Pagination added: fetches page 2 when page 1 has results (within quota)
    - SerpAPI error field now checked and logged
"""

import os
import json
import time
import logging
from datetime import datetime, timedelta
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

log = logging.getLogger("serpapi_scraper")

# Accept both SERPAPI_KEY and SERPAPI_API_KEY (SerpAPI's own documented name).
# GitHub secret may be stored under either name depending on when it was added.
SERPAPI_KEY = os.environ.get("SERPAPI_KEY", "") or os.environ.get("SERPAPI_API_KEY", "")
SERPAPI_URL = "https://serpapi.com/search"

REQUEST_DELAY   = 2.0   # seconds between calls (SerpAPI rate limit)
RESULTS_PER_REQ = 20    # Google Jobs supports up to 30-40 per page
# FIX: was "date_range:3" which is NOT a valid Google Jobs chips value.
# Google Jobs chips for date: date_posted:today / date_posted:3days / date_posted:week
CHIPS_FILTER    = "date_posted:3days"

AGGREGATOR_DOMAINS = [
    "indeed.com", "glassdoor.com", "ziprecruiter.com",
    "simplyhired.com", "monster.com", "careerbuilder.com",
]

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
        seen:     set = set()

        for q_dict in queries:
            query_str = q_dict["query"]
            cluster   = q_dict.get("cluster", "unknown")
            log.info(f"[serpapi] Query ({cluster}): {query_str[:80]}...")
            time.sleep(REQUEST_DELAY)

            # Page 1
            results, has_next = self._api_call(query_str, start=0)
            for raw in results:
                self._add_if_new(raw, cluster, seen, all_jobs)

            # Page 2 (when page 1 had results — doubles coverage within quota budget)
            if has_next and results:
                time.sleep(REQUEST_DELAY)
                results2, _ = self._api_call(query_str, start=RESULTS_PER_REQ)
                for raw in results2:
                    self._add_if_new(raw, cluster, seen, all_jobs)

        log.info(f"[serpapi] Total unique jobs: {len(all_jobs)}")
        return all_jobs

    def _add_if_new(self, raw: Dict, cluster: str, seen: set, out: List):
        key = (
            raw.get("company_name", "").lower(),
            raw.get("title",        "").lower(),
            raw.get("location",     "").lower(),
        )
        if key in seen:
            return
        seen.add(key)
        normalized = self._normalize(raw, cluster)
        if normalized:
            out.append(normalized)

    def _api_call(self, query: str, start: int = 0) -> tuple[List[Dict], bool]:
        """
        Returns (results, has_next_page).
        Logs the SerpAPI 'error' field if present so failures are visible.
        """
        params = {
            "engine":   "google_jobs",
            "q":        query,
            "hl":       "en",
            "gl":       "us",
            "chips":    CHIPS_FILTER,   # FIX: was "date_range:3"
            "num":      RESULTS_PER_REQ, # FIX: was missing
            "api_key":  SERPAPI_KEY,
        }
        if start > 0:
            params["start"] = start

        try:
            r = requests.get(SERPAPI_URL, params=params, timeout=20)

            if r.status_code == 401:
                log.error("SerpApi: 401 Unauthorized — invalid API key.")
                return [], False
            if r.status_code == 429:
                log.error("SerpApi: 429 Too Many Requests — quota exhausted.")
                return [], False
            if r.status_code != 200:
                log.warning(f"SerpApi: HTTP {r.status_code}")
                return [], False

            data = r.json()

            # FIX: check for API-level error field
            if "error" in data:
                log.error(f"SerpApi API error: {data['error']}")
                return [], False

            results   = data.get("jobs_results", [])
            has_next  = bool(data.get("serpapi_pagination", {}).get("next"))

            if not results:
                log.info(f"  [serpapi] No jobs returned for this query (chips={CHIPS_FILTER})")

            return results, has_next

        except Exception as e:
            log.error(f"SerpApi request error: {e}")
            return [], False

    def _normalize(self, raw: Dict, cluster: str) -> Optional[Dict]:
        title   = raw.get("title",        "") or ""
        company = raw.get("company_name", "") or ""
        location = raw.get("location",   "") or ""
        desc    = raw.get("description",  "") or ""

        # FIX: try multiple URL sources before dropping
        apply_link = self._best_apply_link(raw)
        if not apply_link:
            log.debug(f"  [serpapi] No usable URL for: {title!r} @ {company} — dropping")
            return None

        posted_date = self._parse_ago(
            raw.get("detected_extensions", {}).get("posted_at", "")
        )

        itar_flags = [kw for kw in ITAR_KEYWORDS if kw in desc.lower()]

        return {
            "job_title":    title,
            "company_name": company,
            "job_url":      apply_link,
            "location":     location,
            "posted_date":  posted_date,
            "description":  desc[:500],
            "source":       "serpapi",
            "cluster":      cluster,
            "itar_flag":    len(itar_flags) > 0,
            "itar_detail":  ", ".join(itar_flags),
            "raw_id":       "",
        }

    def _best_apply_link(self, raw: Dict) -> str:
        """
        FIX: Was only checking apply_options and discarding jobs with no direct link.
        Now tries multiple sources in priority order.
        """
        apply_options = raw.get("apply_options", []) or []

        # Priority 1: direct company / non-aggregator apply link
        for opt in apply_options:
            link = opt.get("link", "") or ""
            if link and not self._is_aggregator(link) and "google.com" not in link:
                return link

        # Priority 2: any non-Google link (including aggregators — merge pipeline will filter)
        for opt in apply_options:
            link = opt.get("link", "") or ""
            if link and "google.com" not in link:
                return link

        # Priority 3: job_id-based Google Jobs link (stable canonical URL)
        job_id = raw.get("job_id", "") or ""
        if job_id:
            return f"https://www.google.com/search?q=jobs&ibp=htl;jobs#htivrt=jobs&htidocid={job_id}"

        # Priority 4: any apply link including google
        if apply_options:
            link = apply_options[0].get("link", "") or ""
            if link:
                return link

        return ""

    def _is_aggregator(self, url: str) -> bool:
        lower = url.lower()
        return any(d in lower for d in AGGREGATOR_DOMAINS)

    def _parse_ago(self, text: str) -> str:
        """Convert '3 days ago', '2 hours ago' etc. → ISO date string."""
        if not text:
            return ""
        text_l = text.lower()
        now = datetime.utcnow()
        try:
            if "hour" in text_l or "minute" in text_l or "just" in text_l:
                return now.strftime("%Y-%m-%d")
            if "day" in text_l:
                days = int("".join(c for c in text_l if c.isdigit()) or "1")
                return (now - timedelta(days=days)).strftime("%Y-%m-%d")
            if "week" in text_l:
                weeks = int("".join(c for c in text_l if c.isdigit()) or "1")
                return (now - timedelta(weeks=weeks)).strftime("%Y-%m-%d")
            if "month" in text_l:
                return (now - timedelta(days=30)).strftime("%Y-%m-%d")
        except Exception:
            pass
        return now.strftime("%Y-%m-%d")


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s")
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from engine.query_engine import QueryEngine
    queries = QueryEngine().generate_queries()[:2]
    scraper = SerpApiScraper()
    jobs = scraper.run(queries)
    print(f"\n{len(jobs)} jobs found")
    if jobs:
        print(json.dumps(jobs[0], indent=2))
