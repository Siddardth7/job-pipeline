#!/usr/bin/env python3
"""
scrapers/theirstack_scraper.py — JobAgent v4.2
TheirStack Daily Scraper

TheirStack aggregates job postings from LinkedIn, Indeed, Glassdoor, and
16,000+ ATS platforms including Greenhouse, Lever, Workday, and more.

This scraper runs DAILY on a fixed credit budget to supplement the primary
scrapers (ATS, JSearch, Apify, SerpAPI). The orchestrator passes
total_primary_jobs=0 to force the daily run; budget is self-managed.

Pricing / quota:
    Free tier:    200 API credits/month (1 credit = 1 job returned)
    Paid starter: $59/month for more credits
    Unused free credits do NOT roll over.

Credit budget strategy:
    MAX_JOBS_PER_RUN = 25 → running daily stays within free tier as long as
    the month has ≤ 8 activation days. Orchestrator controls frequency.

API reference:
    Endpoint: POST https://api.theirstack.com/v1/jobs/search
    Auth:      Bearer token in Authorization header

Env vars:
    THEIRSTACK_API_KEY  — from https://app.theirstack.com/settings/api
"""

import os
import json
import re
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

log = logging.getLogger("theirstack_scraper")

THEIRSTACK_API_KEY = os.environ.get("THEIRSTACK_API_KEY", "")
THEIRSTACK_URL     = "https://api.theirstack.com/v1/jobs/search"

# ── ITAR keywords loaded from shared data file ────────────────────────────────
_DATA_DIR = Path(__file__).parent.parent / "data"
try:
    ITAR_KEYWORDS: List[str] = json.loads((_DATA_DIR / "itar_keywords.json").read_text())
except Exception:
    ITAR_KEYWORDS = ["itar", "security clearance", "export controlled", "u.s. citizen"]

# ── Credit conservation ───────────────────────────────────────────────────────
MAX_JOBS_PER_RUN = 25

# Job title regex patterns — TheirStack supports Python-style regex
TITLE_PATTERNS = [
    r"(?i)manufacturing engineer",
    r"(?i)process engineer",
    r"(?i)materials engineer",
    r"(?i)composites.*engineer",
    r"(?i)composite.*engineer",
    r"(?i)quality engineer",
    r"(?i)industrial engineer",
    r"(?i)tooling engineer",
    r"(?i)npi.*engineer",
    r"(?i)production engineer",
]

# Seniority reject — whole-word match to avoid false positives
# (e.g., "lead" must not match "leading edge" or "lead-free")
_SENIORITY_RE = re.compile(
    r"\b(senior|sr\.|staff|principal|lead|manager|director|vp|vice\s+president|chief|head\s+of)\b",
    re.IGNORECASE,
)


class TheirStackScraper:
    """
    Daily supplemental scraper using TheirStack Jobs API.
    Runs every day on a fixed per-run credit budget.
    The orchestrator passes total_primary_jobs=0 to indicate daily always-on mode.
    """

    def run(self,
            queries: List[Dict] = None,
            total_primary_jobs: int = 0) -> List[Dict]:
        """
        Args:
            queries:            QueryEngine output (used for cluster labels only)
            total_primary_jobs: When 0, runs in daily always-on mode (orchestrator default).
                                When > 0, the orchestrator is signaling a fallback scenario.
        """
        if not THEIRSTACK_API_KEY:
            log.warning("[theirstack] THEIRSTACK_API_KEY not set — skipping")
            return []

        log.info(
            f"[theirstack] Daily fixed-budget run — consuming up to {MAX_JOBS_PER_RUN} credits "
            f"(budget: 200 credits/month @ {MAX_JOBS_PER_RUN}/day)"
        )

        raw_jobs = self._fetch_jobs()
        if not raw_jobs:
            return []

        all_jobs: List[Dict] = []
        seen: set = set()

        for raw in raw_jobs:
            j = self._normalize(raw)
            if not j:
                continue
            key = (j["company_name"].lower(), j["job_title"].lower(), j["location"].lower())
            if key in seen:
                continue
            seen.add(key)
            all_jobs.append(j)

        log.info(f"[theirstack] {len(raw_jobs)} raw → {len(all_jobs)} unique normalised jobs")
        return all_jobs

    # ── API call ──────────────────────────────────────────────────────────────

    def _fetch_jobs(self) -> List[Dict]:
        headers = {
            "Authorization": f"Bearer {THEIRSTACK_API_KEY}",
            "Content-Type":  "application/json",
            "Accept":        "application/json",
        }
        payload = {
            "job_title_pattern_or":  TITLE_PATTERNS,
            "posted_at_max_age_days": 7,
            "job_country_code_or":   ["US"],
            "limit":                 MAX_JOBS_PER_RUN,
            "page":                  0,
            "order_by": [
                {"field": "date_posted", "desc": True}
            ],
        }
        log.debug(f"[theirstack] POST {THEIRSTACK_URL} payload={json.dumps(payload)[:200]}")
        try:
            r = requests.post(
                THEIRSTACK_URL, headers=headers,
                json=payload, timeout=20
            )
            if r.status_code == 401:
                log.error("[theirstack] 401 Unauthorized — check THEIRSTACK_API_KEY in GitHub Secrets")
                return []
            if r.status_code == 402:
                log.error("[theirstack] 402 Payment Required — free-tier credits exhausted for this month")
                return []
            if r.status_code == 422:
                log.error(f"[theirstack] 422 Unprocessable — request validation failed: {r.text[:300]}")
                return []
            if r.status_code != 200:
                log.warning(f"[theirstack] HTTP {r.status_code}: {r.text[:200]}")
                return []

            data  = r.json()
            jobs  = data.get("data", []) or data.get("jobs", []) or []
            total = data.get("total", len(jobs))
            log.info(f"[theirstack] API returned {len(jobs)} jobs (total available: {total})")
            return jobs

        except Exception as e:
            log.error(f"[theirstack] Request error: {e}")
            return []

    # ── Normalise ─────────────────────────────────────────────────────────────

    def _normalize(self, raw: Dict) -> Optional[Dict]:
        if not isinstance(raw, dict):
            log.debug(f"[theirstack] _normalize: non-dict ({type(raw)}) — skipping")
            return None

        title = raw.get("title", "") or raw.get("job_title", "") or ""

        raw_company = raw.get("company") or ""
        if isinstance(raw_company, dict):
            company = raw_company.get("name", "") or ""
        elif isinstance(raw_company, str):
            company = raw_company
        else:
            company = ""
        company = company or raw.get("company_name", "") or ""

        location = (
            raw.get("location", "")
            or raw.get("city", "")
            or "United States"
        )
        url  = raw.get("url", "") or raw.get("job_url", "") or ""
        desc = raw.get("description", "") or raw.get("job_description", "") or ""

        if not url or not title:
            return None

        # Filter out senior roles post-response using whole-word regex
        if _SENIORITY_RE.search(title):
            return None

        posted_raw  = raw.get("date_posted", "") or raw.get("discovered_at", "") or ""
        posted_date = self._parse_date(posted_raw)

        itar_flags = [kw for kw in ITAR_KEYWORDS if kw in desc.lower()]

        return {
            "job_title":    title,
            "company_name": company,
            "job_url":      url,
            "location":     location,
            "posted_date":  posted_date,
            "description":  desc[:500],
            "source":       "theirstack",
            "cluster":      self._infer_cluster(title),
            "itar_flag":    bool(itar_flags),
            "itar_detail":  ", ".join(itar_flags),
            "raw_id":       str(raw.get("id", "") or ""),
        }

    def _infer_cluster(self, title: str) -> str:
        t = title.lower()
        if "composit"    in t:                   return "composites"
        if "material"    in t:                   return "materials"
        if "quality"     in t or "supplier" in t: return "quality"
        if "process"     in t:                   return "process"
        if "industrial"  in t or "lean" in t:    return "industrial"
        if "tooling"     in t or "metrology" in t: return "tooling_inspection"
        if "npi"         in t or "prototype" in t: return "startup_manufacturing"
        return "manufacturing"

    def _parse_date(self, ts: str) -> str:
        if not ts:
            return datetime.utcnow().strftime("%Y-%m-%d")
        try:
            return (
                datetime.fromisoformat(ts.replace("Z", "+00:00"))
                .strftime("%Y-%m-%d")
            )
        except Exception:
            return ts[:10] if len(ts) >= 10 else datetime.utcnow().strftime("%Y-%m-%d")


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s")
    scraper = TheirStackScraper()
    jobs = scraper.run(total_primary_jobs=0)
    print(f"\n{len(jobs)} jobs found")
    if jobs:
        print(json.dumps(jobs[0], indent=2))
