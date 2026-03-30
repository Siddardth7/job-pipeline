#!/usr/bin/env python3
"""
scrapers/adzuna_scraper.py — JobAgent v4.3
Adzuna Job Search Scraper

Queries Adzuna's US job index using cluster phrases. Adzuna aggregates
postings from thousands of sources and returns genuinely different results
from SerpAPI/Apify (not a Google Jobs re-skin).

Free tier: 250 requests/day — well above our usage (~10 queries/run).
No alternation logic needed; quota is generous enough to run daily.

Env vars:
    ADZUNA_APP_ID   — Application ID from developer.adzuna.com
    ADZUNA_APP_KEY  — Application Key from developer.adzuna.com
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

log = logging.getLogger("adzuna_scraper")

_raw_ids  = os.environ.get("ADZUNA_APP_IDS",  "") or os.environ.get("ADZUNA_APP_ID",  "")
_raw_keys = os.environ.get("ADZUNA_APP_KEYS", "") or os.environ.get("ADZUNA_APP_KEY", "")
ADZUNA_PAIRS = [
    (i.strip(), k.strip())
    for i, k in zip(_raw_ids.split(","), _raw_keys.split(","))
    if i.strip() and k.strip()
]

BASE_URL        = "https://api.adzuna.com/v1/api/jobs/us/search/1"
RESULTS_PER_REQ = 50
MAX_DAYS_OLD    = 14   # only jobs posted in the last 2 weeks
REQUEST_DELAY   = 1.5  # seconds between requests

# Short natural-language phrases per cluster (Adzuna supports plain keywords,
# not boolean operators). Covers both existing and new multi-user clusters.
CLUSTER_QUERIES: Dict[str, str] = {
    "manufacturing":          "Manufacturing Engineer entry level",
    "process":                "Process Engineer manufacturing entry level",
    "materials":              "Materials Engineer entry level",
    "composites":             "Composites Manufacturing Engineer",
    "quality":                "Quality Engineer entry level",
    "industrial":             "Industrial Engineer entry level",
    "tooling_inspection":     "Tooling Engineer manufacturing",
    "startup_manufacturing":  "NPI Manufacturing Engineer",
    "industrial_operations":  "Industrial Engineer operations",
    "mechanical_thermal":     "Mechanical Engineer thermal entry level",
}

# ITAR keywords for flagging — loaded from shared data file
_DATA_DIR = Path(__file__).parent.parent / "data"
try:
    ITAR_KEYWORDS: List[str] = json.loads((_DATA_DIR / "itar_keywords.json").read_text())
except Exception:
    ITAR_KEYWORDS = ["itar", "security clearance", "export controlled", "u.s. citizen"]


class AdzunaScraper:
    """Queries Adzuna US job search API and normalises results to pipeline format."""

    def run(self, queries: List[Dict]) -> List[Dict]:
        if not ADZUNA_PAIRS:
            log.warning("[adzuna] ADZUNA_APP_IDS or ADZUNA_APP_KEYS not set — skipping")
            return []

        for app_id, app_key in ADZUNA_PAIRS:
            result = self._attempt_run(app_id, app_key, queries)
            if result is not None:
                log.info(f"[adzuna] Total unique jobs: {len(result)}")
                return result

        log.warning("[adzuna] All Adzuna credentials failed or quota-exhausted")
        return []

    def _attempt_run(
        self, app_id: str, app_key: str, queries: List[Dict]
    ) -> Optional[List[Dict]]:
        """
        Try all queries with one credential pair. Returns job list on success,
        None if 401/429 (caller should try next pair).
        """
        all_jobs: List[Dict] = []
        seen: set = set()

        for q_dict in queries:
            cluster = q_dict.get("cluster", "unknown")
            phrase  = CLUSTER_QUERIES.get(cluster)

            if not phrase:
                raw_q  = q_dict.get("query", "")
                tokens = [t.strip('"()') for t in raw_q.split()
                          if t.strip('"()') and t.upper() not in ("OR", "AND", "NOT")]
                phrase = " ".join(tokens[:5]).strip()

            if not phrase:
                continue

            log.info(f"[adzuna] Query ({cluster}): {phrase!r}")
            time.sleep(REQUEST_DELAY)

            status, results = self._api_call(phrase, app_id, app_key)
            if status == "quota":
                return None  # 401/429 — rotate to next pair
            for raw in results:
                self._add_if_new(raw, cluster, seen, all_jobs)

        return all_jobs

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _add_if_new(self, raw: Dict, cluster: str, seen: set, out: List):
        key = (
            raw.get("company", {}).get("display_name", "").lower(),
            raw.get("title", "").lower(),
            raw.get("location", {}).get("display_name", "").lower(),
        )
        if key in seen:
            return
        seen.add(key)
        normalized = self._normalize(raw, cluster)
        if normalized:
            out.append(normalized)

    def _api_call(self, query: str, app_id: str, app_key: str):
        """Returns ("ok", results) or ("quota", []) on auth/quota failure."""
        params = {
            "app_id":           app_id,
            "app_key":          app_key,
            "what":             query,
            "where":            "United States",
            "results_per_page": RESULTS_PER_REQ,
            "max_days_old":     MAX_DAYS_OLD,
            "content-type":     "application/json",
        }
        try:
            r = requests.get(BASE_URL, params=params, timeout=20)
            if r.status_code in (401, 403):
                return ("quota", [])
            if r.status_code == 429:
                return ("quota", [])
            if r.status_code != 200:
                log.warning(f"[adzuna] HTTP {r.status_code} for query {query!r}")
                return ("ok", [])
            data = r.json()
            results = data.get("results", [])
            log.info(f"  [adzuna] {len(results)} results")
            return ("ok", results)
        except Exception as exc:
            log.error(f"[adzuna] Request error for {query!r}: {exc}")
            return ("ok", [])

    def _normalize(self, raw: Dict, cluster: str) -> Optional[Dict]:
        title    = raw.get("title",    "") or ""
        company  = raw.get("company",  {}).get("display_name", "") or ""
        location = raw.get("location", {}).get("display_name", "") or ""
        desc     = raw.get("description", "") or ""
        link     = raw.get("redirect_url", "") or ""

        if not link:
            return None

        itar_flags = [kw for kw in ITAR_KEYWORDS if kw in desc.lower()]

        return {
            "job_title":    title,
            "company_name": company,
            "job_url":      link,
            "location":     location,
            "posted_date":  self._parse_created(raw.get("created", "")),
            "description":  desc[:500],
            "salary":       self._format_salary(raw),
            "source":       "adzuna",
            "cluster":      cluster,
            "itar_flag":    bool(itar_flags),
            "itar_detail":  ", ".join(itar_flags),
            "raw_id":       f"adzuna_{raw.get('id', '')}",
        }

    @staticmethod
    def _format_salary(raw: Dict) -> str:
        low  = raw.get("salary_min")
        high = raw.get("salary_max")
        if low and high:
            return f"${int(low):,}–${int(high):,}"
        if low:
            return f"${int(low):,}+"
        return ""

    @staticmethod
    def _parse_created(created: str) -> str:
        """Convert Adzuna ISO timestamp → YYYY-MM-DD."""
        if not created:
            return datetime.utcnow().strftime("%Y-%m-%d")
        try:
            return created[:10]
        except Exception:
            return datetime.utcnow().strftime("%Y-%m-%d")


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s")
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from engine.query_engine import QueryEngine
    queries = QueryEngine().generate_queries()[:3]
    scraper = AdzunaScraper()
    jobs    = scraper.run(queries)
    print(f"\n{len(jobs)} jobs found")
    if jobs:
        print(json.dumps(jobs[0], indent=2))
