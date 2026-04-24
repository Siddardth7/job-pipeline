#!/usr/bin/env python3
"""
scrapers/usajobs_scraper.py — JobAgent v4.5
USA Jobs API Scraper

Searches https://data.usajobs.gov/api/Search for federal and federally-related
manufacturing, process, quality, aerospace, and industrial engineering roles.

Free — no API key. Requires User-Agent header with contact email (not a secret).
Runs daily (no alternation logic needed). 20 queries per run max.

API docs: https://developer.usajobs.gov/APIRequest/Index
"""

import json
import logging
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional

try:
    import requests
except ImportError:
    raise ImportError("Run: pip install requests")

log = logging.getLogger("usajobs_scraper")

BASE_URL        = "https://data.usajobs.gov/api/search"
REQUEST_DELAY   = 1.5   # seconds between requests
MAX_RESULTS     = 25    # per query (API max is 500, but we want tight queries)
DAYS_POSTED     = 3     # only jobs posted in the last 3 days (matches F4 72h window)

# No secret needed — just a contact identifier in the User-Agent
HEADERS = {
    "Host":             "data.usajobs.gov",
    "User-Agent":       "siddardth7@gmail.com",
    "Authorization":    "",   # not required for public search
}

# Cluster → keyword mapping for USA Jobs keyword search
CLUSTER_QUERIES: Dict[str, str] = {
    "manufacturing":         "manufacturing engineer",
    "process":               "process engineer manufacturing",
    "materials":             "materials engineer",
    "composites":            "composites engineer",
    "quality":               "quality engineer",
    "industrial":            "industrial engineer",
    "tooling_inspection":    "tooling engineer",
    "startup_manufacturing": "production engineer NPI",
    "industrial_operations": "industrial engineer operations",
    "mechanical_thermal":    "mechanical engineer thermal",
}

_DATA_DIR = Path(__file__).parent.parent / "data"
try:
    ITAR_KEYWORDS: List[str] = json.loads((_DATA_DIR / "itar_keywords.json").read_text())
except Exception:
    ITAR_KEYWORDS = ["itar", "security clearance", "export controlled", "u.s. citizen"]


def _normalize_job(raw: Dict, cluster: str) -> Dict:
    """Convert a USA Jobs API result object to pipeline job schema."""
    descriptor = raw.get("MatchedObjectDescriptor", {})
    apply_uris = descriptor.get("ApplyURI", [])
    job_url    = apply_uris[0] if apply_uris else ""

    salary_info = descriptor.get("PositionRemuneration", [{}])[0]
    salary_min  = salary_info.get("MinimumRange", "")
    salary_max  = salary_info.get("MaximumRange", "")
    salary_str  = f"${salary_min}–${salary_max}/yr" if salary_min and salary_max else ""

    posted_raw = descriptor.get("PublicationStartDate", "")
    posted     = posted_raw[:10] if posted_raw else ""  # YYYY-MM-DD

    return {
        "job_id":          raw.get("MatchedObjectId", ""),
        "job_title":       descriptor.get("PositionTitle", ""),
        "company_name":    descriptor.get("OrganizationName", ""),
        "job_url":         job_url,
        "location":        descriptor.get("PositionLocationDisplay", "Unknown"),
        "posted_date":     posted,
        "source":          "usajobs",
        "employment_type": "Full-time",
        "cluster":         cluster,
        "salary":          salary_str,
        "itar_flag":       False,
        "description":     "",
    }


class USAJobsScraper:
    """
    Orchestrator-compatible USA Jobs scraper.
    Accepts QueryEngine queries, maps clusters to keyword phrases,
    fetches from the USA Jobs public API.
    """

    MAX_CALLS_PER_RUN = 20

    def run(self, queries: Optional[List[Dict]] = None) -> List[Dict]:
        """
        Called by orchestrator. queries is the list of dicts from QueryEngine.
        Returns deduplicated jobs in pipeline schema.
        """
        self.calls_made = 0
        if not queries:
            log.warning("[usajobs] No queries supplied — skipping")
            return []

        all_jobs: List[Dict] = []
        seen_urls: set        = set()
        seen_clusters: set    = set()

        for q_dict in queries:
            if self.calls_made >= self.MAX_CALLS_PER_RUN:
                log.info("[usajobs] Daily call limit reached — stopping")
                break

            cluster = q_dict.get("cluster", "")
            if cluster in seen_clusters:
                continue  # one call per cluster
            seen_clusters.add(cluster)

            keyword = CLUSTER_QUERIES.get(cluster)
            if not keyword:
                # Fall back to first meaningful word from query engine query
                raw_q   = q_dict.get("query", "")
                keyword = " ".join(
                    t.strip('"()') for t in raw_q.split()
                    if t.strip('"()') and t.upper() not in ("OR", "AND", "NOT")
                )[:60].strip()

            if not keyword:
                continue

            log.info(f"[usajobs] Querying cluster={cluster!r} keyword={keyword!r}")
            jobs = self._search_cluster(keyword, cluster)
            self.calls_made += 1

            for job in jobs:
                url = job.get("job_url", "")
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    all_jobs.append(job)

            time.sleep(REQUEST_DELAY)

        log.info(f"[usajobs] Done. {len(all_jobs)} unique jobs. Calls: {self.calls_made}")
        return all_jobs

    def _search_cluster(self, keyword: str, cluster: str) -> List[Dict]:
        """Fetch one page of USA Jobs results for a keyword + cluster."""
        params = {
            "Keyword":          keyword,
            "ResultsPerPage":   MAX_RESULTS,
            "DatePosted":       DAYS_POSTED,
            "LocationRadius":   0,
            "Fields":           "Min",
        }
        try:
            resp = requests.get(BASE_URL, headers=HEADERS, params=params, timeout=15)
            if resp.status_code == 200:
                data   = resp.json()
                items  = data.get("SearchResult", {}).get("SearchResultItems", [])
                return [_normalize_job(item, cluster) for item in items]
            else:
                log.warning(f"[usajobs] HTTP {resp.status_code} for keyword={keyword!r}")
                return []
        except Exception as exc:
            log.error(f"[usajobs] Request error: {exc}")
            return []
