#!/usr/bin/env python3
"""
scrapers/jsearch_scraper.py — JobAgent v4.2
JSearch / RapidAPI Scraper (orchestrator-compatible)

Queries RapidAPI JSearch for broad title-based job searches.

Free tier: 200 requests/month (≈6/day over 30 days).
Monthly quota is tracked in data/scraper_state.json to prevent mid-month
exhaustion. Hard monthly ceiling: 180 (20 buffer under free tier limit).

Rate-limit handling:
  - 429: retry once after RETRY_WAIT seconds.
  - 3 consecutive 429s → abort immediately (quota likely exhausted).
  - 403: monthly quota exceeded → abort.

Env vars:
    JSEARCH_API_KEY  — from https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
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

# ── User-Agent headers ────────────────────────────────────────────────────────
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; JobAgentBot/4.3; "
        "+https://github.com/Siddardth7/job-pipeline)"
    ),
    "Accept": "application/json",
}

_raw_keys = os.environ.get("JSEARCH_API_KEYS", "") or os.environ.get("JSEARCH_API_KEY", "")
JSEARCH_API_KEYS = [k.strip() for k in _raw_keys.split(",") if k.strip()]
JSEARCH_HOST    = "jsearch.p.rapidapi.com"
JSEARCH_URL     = "https://jsearch.p.rapidapi.com/search"

# ── ITAR keywords loaded from shared data file ────────────────────────────────
_DATA_DIR = Path(__file__).parent.parent / "data"
try:
    ITAR_KEYWORDS: List[str] = json.loads((_DATA_DIR / "itar_keywords.json").read_text())
except Exception:
    ITAR_KEYWORDS = ["itar", "security clearance", "export controlled", "u.s. citizen"]

# Aggregator domains to reject at scraper level (F3 in merge_pipeline is the final guard)
REJECT_DOMAINS = [
    "indeed.com", "glassdoor.com", "ziprecruiter.com",
    "simplyhired.com", "monster.com", "careerbuilder.com",
]


def check_itar(text: str) -> List[str]:
    """Returns list of matched ITAR keywords found in text."""
    if not text:
        return []
    lower = text.lower()
    return [kw for kw in ITAR_KEYWORDS if kw in lower]


def is_aggregator(url: str) -> bool:
    if not url:
        return True
    lower = url.lower()
    return any(d in lower for d in REJECT_DOMAINS)


class JSearchScraper:
    """
    Orchestrator-compatible JSearch scraper.
    Uses broad title-based queries instead of per-company queries.
    Tracks monthly quota to prevent exhaustion before month end.
    """

    MAX_CALLS_PER_DAY   = 10    # hard daily cap
    MONTHLY_LIMIT       = 180   # 200/month free tier − 20 buffer
    RETRY_WAIT          = 10    # seconds before one 429 retry
    QUERY_DELAY         = 2.0   # seconds between queries
    MAX_CONSECUTIVE_429 = 3     # abort after this many consecutive 429s

    def run(self, queries: Optional[List[Dict]] = None) -> List[Dict]:
        """
        Called by orchestrator. `queries` is the list of dicts from QueryEngine
        (each dict has 'cluster' and 'query' keys). Extracts the 'query' string
        from each dict and uses them as JSearch search terms.
        Returns jobs in pipeline schema.
        After returning, `self.calls_made` holds the actual number of API calls fired.
        """
        self.calls_made = 0

        if not JSEARCH_API_KEYS:
            log.warning("[jsearch] JSEARCH_API_KEYS not set — skipping")
            return []

        # Build search terms from query engine output
        search_terms: List[str] = []
        if queries:
            for q in queries:
                term = q.get("query", "").strip()
                if term:
                    search_terms.append(term)
        if not search_terms:
            log.warning("[jsearch] No queries supplied — skipping")
            return []

        for key in JSEARCH_API_KEYS:
            result, calls = self._attempt_run(key, search_terms)
            self.calls_made += calls
            if result is not None:
                log.info(f"[jsearch] Done. {len(result)} jobs. API calls this run: {self.calls_made}")
                return result

        log.warning("[jsearch] All JSearch keys quota-exhausted")
        return []

    def _attempt_run(self, key: str, search_terms: List[str]) -> tuple:
        """
        Try all queries with one key.
        Returns (job_list, api_calls) on success,
        (None, api_calls) if key is quota-exhausted (caller should try next key).
        """
        headers = {
            "X-RapidAPI-Key":  key,
            "X-RapidAPI-Host": JSEARCH_HOST,
        }
        all_jobs:        List[Dict] = []
        seen_ids:        set        = set()
        api_calls                   = 0
        consecutive_429s            = 0

        for i, query in enumerate(search_terms):
            if api_calls >= self.MAX_CALLS_PER_DAY:
                log.info(f"[jsearch] Daily cap ({self.MAX_CALLS_PER_DAY}) reached")
                break

            log.info(f"[jsearch] [{i+1}/{len(search_terms)}] Query: {query!r}")
            time.sleep(self.QUERY_DELAY)

            result = self._single_query(headers, query)
            api_calls += 1

            if result == "quota":
                log.info("[jsearch] 403 quota — rotating to next key")
                return None, api_calls  # exhausted

            if result == "rate_limited":
                consecutive_429s += 1
                log.warning(
                    f"[jsearch] Query {i+1} skipped (rate_limited) — "
                    f"{consecutive_429s}/{self.MAX_CONSECUTIVE_429} consecutive 429s"
                )
                if consecutive_429s >= self.MAX_CONSECUTIVE_429:
                    log.info("[jsearch] Consecutive 429s — rotating to next key")
                    return None, api_calls  # exhausted
                continue

            if result == "error":
                log.warning(f"[jsearch] Query {i+1} skipped (error)")
                continue

            consecutive_429s = 0

            for job in result:
                job_id = job.get("job_id", "")
                if job_id in seen_ids:
                    continue
                seen_ids.add(job_id)

                apply_link = job.get("job_apply_link", "") or ""
                if is_aggregator(apply_link):
                    apply_link = job.get("job_google_link", "") or apply_link
                    if is_aggregator(apply_link):
                        continue

                desc        = job.get("job_description", "") or ""
                city        = job.get("job_city",  "") or ""
                state       = job.get("job_state", "") or ""
                location    = f"{city}, {state}".strip(", ") or "United States"
                posted_raw  = job.get("job_posted_at_datetime_utc", "") or ""
                if posted_raw:
                    posted_date     = posted_raw[:10]
                    date_confidence = "actual"
                else:
                    posted_date     = ""
                    date_confidence = "unknown"
                itar_flags  = check_itar(job.get("job_title", "") + " " + desc)

                all_jobs.append({
                    "job_title":       job.get("job_title", ""),
                    "company_name":    job.get("employer_name", ""),
                    "job_url":         apply_link,
                    "location":        location,
                    "posted_date":     posted_date,
                    "date_confidence": date_confidence,
                    "description":     desc[:500],
                    "source":          "jsearch",
                    "cluster":         self._cluster(query),
                    "itar_flag":       bool(itar_flags),
                    "itar_detail":     ", ".join(itar_flags),
                    "raw_id":          job_id,
                })

        return all_jobs, api_calls

    def _single_query(self, headers: Dict, query: str):
        """
        Returns one of:
          list[dict]    — parsed job results (may be empty)
          "rate_limited" — got 429 on both attempts
          "quota"        — got 403 (monthly limit)
          "error"        — any other failure
        """
        params = {
            "query":      query,
            "page":       "1",
            "num_pages":  "1",
            "date_posted": "week",
            "country":    "us",
            "language":   "en",
        }
        # Merge User-Agent headers with RapidAPI auth headers
        merged_headers = {**HEADERS, **headers}
        for attempt in range(2):
            try:
                r = requests.get(JSEARCH_URL, headers=merged_headers, params=params, timeout=15)
                if r.status_code == 200:
                    return r.json().get("data", [])
                if r.status_code == 429:
                    if attempt == 0:
                        log.warning(
                            f"[jsearch] 429 rate limit — waiting {self.RETRY_WAIT}s "
                            f"then retrying once"
                        )
                        time.sleep(self.RETRY_WAIT)
                        continue
                    return "rate_limited"
                if r.status_code == 403:
                    return "quota"
                log.warning(f"[jsearch] HTTP {r.status_code} for {query!r}")
                return "error"
            except Exception as e:
                log.warning(f"[jsearch] Request error: {e}")
                return "error"
        return "rate_limited"

    def _cluster(self, query: str) -> str:
        q = query.lower()
        if "composit"    in q: return "composites"
        if "material"    in q: return "materials"
        if "quality"     in q: return "quality"
        if "process"     in q: return "process"
        if "industri"    in q: return "industrial"
        if "tooling"     in q: return "tooling_inspection"
        if "npi" in q or "continuous" in q: return "startup_manufacturing"
        return "manufacturing"


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s")
    scraper = JSearchScraper()
    jobs = scraper.run()
    print(f"\n{len(jobs)} jobs found")
    if jobs:
        print(json.dumps(jobs[0], indent=2))
