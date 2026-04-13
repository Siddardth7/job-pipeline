#!/usr/bin/env python3
"""
scrapers/contract_scraper.py — JobAgent v4.4
Contract Role Scraper — JSearch / RapidAPI

Searches specifically for contract/temp quality engineering roles using the
JSearch API with employment_types=CONTRACTOR filter.

All jobs returned by this scraper are tagged with employment_type="Contract"
so the UI can display them with a distinct "Contract" badge in the Find Jobs feed.

This scraper runs alongside the regular pipeline scrapers. It outputs to
temp/jobs_contract.json (whitelisted in merge_pipeline.py).

F4 age filter: contract postings stay live much longer than FTE postings.
The merge pipeline treats source="contract_search" as fresh, same as ATS
direct sources, to prevent age-filter false-drops on valid contract roles.

Monthly quota: shares JSEARCH_API_KEY(S) with jsearch_scraper.py.
Contract scraper budget: MAX_CALLS_PER_RUN = 5 (conservative).

Env vars:
    JSEARCH_API_KEY   — from https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
    JSEARCH_API_KEYS  — comma-separated list for key rotation
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

log = logging.getLogger("contract_scraper")

# ── Config ────────────────────────────────────────────────────────────────────
_raw_keys = os.environ.get("JSEARCH_API_KEYS", "") or os.environ.get("JSEARCH_API_KEY", "")
JSEARCH_API_KEYS = [k.strip() for k in _raw_keys.split(",") if k.strip()]
JSEARCH_HOST     = "jsearch.p.rapidapi.com"
JSEARCH_URL      = "https://jsearch.p.rapidapi.com/search"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; JobAgentBot/4.4; "
        "+https://github.com/Siddardth7/job-pipeline)"
    ),
    "Accept": "application/json",
}

# Specific contract role queries — narrow and quality-engineering focused.
# Keep this list short to stay within the shared monthly quota budget.
CONTRACT_QUERIES = [
    "contract quality engineer aerospace",
    "contract manufacturing quality engineer",
    "contract NPI quality engineer",
    "contract supplier quality engineer",
    "quality assurance engineer contract aerospace composites",
]

MAX_CALLS_PER_RUN    = 5     # hard cap per pipeline run
RETRY_WAIT           = 10    # seconds before one 429 retry
QUERY_DELAY          = 2.0   # seconds between queries
MAX_CONSECUTIVE_429  = 2     # abort after this many consecutive 429s

# ── ITAR keywords ─────────────────────────────────────────────────────────────
_DATA_DIR = Path(__file__).parent.parent / "data"
try:
    ITAR_KEYWORDS: List[str] = json.loads((_DATA_DIR / "itar_keywords.json").read_text())
except Exception:
    ITAR_KEYWORDS = ["itar", "security clearance", "export controlled", "u.s. citizen"]

# Aggregator domains to reject at scraper level
REJECT_DOMAINS = [
    "indeed.com", "glassdoor.com", "ziprecruiter.com",
    "simplyhired.com", "monster.com", "careerbuilder.com",
]


def check_itar(text: str) -> List[str]:
    if not text:
        return []
    lower = text.lower()
    return [kw for kw in ITAR_KEYWORDS if kw in lower]


def is_aggregator(url: str) -> bool:
    if not url:
        return True
    lower = url.lower()
    return any(d in lower for d in REJECT_DOMAINS)


class ContractScraper:
    """
    Searches JSearch with employment_types=CONTRACTOR for quality engineering
    contract roles. Returns jobs tagged employment_type="Contract".
    """

    def run(self) -> List[Dict]:
        """
        Returns list of contract job dicts in pipeline schema.
        Sets employment_type="Contract" on every job.
        """
        self.calls_made = 0

        if not JSEARCH_API_KEYS:
            log.warning("[contract] JSEARCH_API_KEYS not set — skipping")
            return []

        for key in JSEARCH_API_KEYS:
            result, calls = self._attempt_run(key)
            self.calls_made += calls
            if result is not None:
                log.info(
                    f"[contract] Done. {len(result)} contract jobs. "
                    f"API calls this run: {self.calls_made}"
                )
                return result

        log.warning("[contract] All JSearch keys quota-exhausted for contract scraper")
        return []

    def _attempt_run(self, key: str):
        """
        Try all contract queries with one key.
        Returns (job_list, api_calls) on success, (None, api_calls) on quota exhaustion.
        """
        headers = {
            "X-RapidAPI-Key":  key,
            "X-RapidAPI-Host": JSEARCH_HOST,
        }
        all_jobs: List[Dict] = []
        seen_ids: set = set()
        api_calls = 0
        consecutive_429s = 0

        for i, query in enumerate(CONTRACT_QUERIES):
            if api_calls >= MAX_CALLS_PER_RUN:
                log.info(f"[contract] Run cap ({MAX_CALLS_PER_RUN}) reached")
                break

            log.info(f"[contract] [{i+1}/{len(CONTRACT_QUERIES)}] Query: {query!r}")
            time.sleep(QUERY_DELAY)

            result = self._single_query(headers, query)
            api_calls += 1

            if result == "quota":
                log.info("[contract] 403 quota — rotating to next key")
                return None, api_calls

            if result == "rate_limited":
                consecutive_429s += 1
                log.warning(
                    f"[contract] Query {i+1} rate limited — "
                    f"{consecutive_429s}/{MAX_CONSECUTIVE_429} consecutive 429s"
                )
                if consecutive_429s >= MAX_CONSECUTIVE_429:
                    log.info("[contract] Too many 429s — rotating to next key")
                    return None, api_calls
                continue

            if result == "error":
                log.warning(f"[contract] Query {i+1} skipped (error)")
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
                posted_date = posted_raw[:10] if posted_raw else ""
                date_confidence = "actual" if posted_date else "unknown"
                itar_flags  = check_itar(job.get("job_title", "") + " " + desc)

                all_jobs.append({
                    "job_title":         job.get("job_title", ""),
                    "company_name":      job.get("employer_name", ""),
                    "job_url":           apply_link,
                    "location":          location,
                    "posted_date":       posted_date,
                    "date_confidence":   date_confidence,
                    "description":       desc[:500],
                    "source":            "contract_search",
                    "cluster":           "quality",
                    "itar_flag":         bool(itar_flags),
                    "itar_detail":       ", ".join(itar_flags),
                    "raw_id":            job_id,
                    "employment_type":   "Contract",   # ← key field
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
            "query":            query,
            "page":             "1",
            "num_pages":        "1",
            "employment_types": "CONTRACTOR",   # key difference vs regular jsearch
            "date_posted":      "month",         # wider window — contract roles stay live longer
            "country":          "us",
            "language":         "en",
        }
        merged_headers = {**HEADERS, **headers}
        for attempt in range(2):
            try:
                r = requests.get(
                    JSEARCH_URL, headers=merged_headers, params=params, timeout=15
                )
                if r.status_code == 200:
                    return r.json().get("data", [])
                if r.status_code == 429:
                    if attempt == 0:
                        log.warning(
                            f"[contract] 429 rate limit — waiting {RETRY_WAIT}s before retry"
                        )
                        time.sleep(RETRY_WAIT)
                        continue
                    return "rate_limited"
                if r.status_code == 403:
                    return "quota"
                log.warning(f"[contract] HTTP {r.status_code} for query {query!r}")
                return "error"
            except Exception as exc:
                log.error(f"[contract] Request error for {query!r}: {exc}")
                return "error"
        return "rate_limited"


def main():
    """Standalone entry point: scrape contract jobs and write to temp/jobs_contract.json."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    ROOT      = Path(__file__).parent.parent
    OUT_PATH  = ROOT / "temp" / "jobs_contract.json"
    OUT_PATH.parent.mkdir(exist_ok=True)

    scraper = ContractScraper()
    jobs    = scraper.run()

    payload = {
        "source":      "contract_search",
        "scraped_at":  datetime.utcnow().isoformat() + "Z",
        "job_count":   len(jobs),
        "jobs":        jobs,
    }
    OUT_PATH.write_text(json.dumps(payload, indent=2))
    log.info(f"[contract] Wrote {len(jobs)} contract jobs to {OUT_PATH}")


if __name__ == "__main__":
    main()
