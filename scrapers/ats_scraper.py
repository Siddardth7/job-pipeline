#!/usr/bin/env python3
"""
scrapers/ats_scraper.py — JobAgent v4.2
ATS Direct Scraper — Greenhouse & Lever

Scrapes jobs DIRECTLY from company career pages using the free public APIs
provided by Greenhouse and Lever. No authentication, no third-party service,
no quota limits, no cost.

Why this is the best scraper in the stack:
    • 100% of results come from our target company universe
    • Returns direct company career page apply URLs (never aggregators)
    • Full job descriptions available immediately (no follow-up fetch needed)
    • Title + seniority filtering happens before any data is written to disk
    • Completely free — just plain HTTP GET/POST calls

Supported ATS platforms:
    Greenhouse  →  GET  https://api.greenhouse.io/v1/boards/{slug}/jobs?content=true&updated_after=...
    Lever       →  GET  https://api.lever.co/v0/postings/{slug}?mode=json

Company list is loaded from data/ats_companies.json (edit that file to add/remove
companies — no code changes needed).

No env vars required — this scraper makes no authenticated API calls.
"""

import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional, Tuple

try:
    import requests
except ImportError:
    raise ImportError("Run: pip install requests")

log = logging.getLogger("ats_scraper")

# ── Request config ────────────────────────────────────────────────────────────
REQUEST_TIMEOUT  = 12    # seconds per HTTP request
MAX_JOBS_PER_CO  = 50    # cap to avoid runaway on companies with 1000+ postings
MAX_WORKERS      = 6     # concurrent threads for fetching companies
# Greenhouse updated_after window — fetch only jobs updated in the last N hours.
# Slightly wider than F4's 72h to avoid edge-case drops at the boundary.
GH_UPDATED_AFTER_HOURS = 96

# ── Load company registry from data file ─────────────────────────────────────
_DATA_DIR          = Path(__file__).parent.parent / "data"
_ATS_COMPANIES_PATH = _DATA_DIR / "ats_companies.json"

def _load_companies() -> Tuple[Dict, Dict]:
    """Load Greenhouse and Lever company dicts from data/ats_companies.json."""
    try:
        data = json.loads(_ATS_COMPANIES_PATH.read_text())
        return data.get("greenhouse", {}), data.get("lever", {})
    except Exception as e:
        log.error(f"[ats] Failed to load ats_companies.json: {e}. Using empty company lists.")
        return {}, {}

GREENHOUSE_COMPANIES, LEVER_COMPANIES = _load_companies()

# ── ITAR / seniority keyword lists ────────────────────────────────────────────
try:
    ITAR_KEYWORDS: List[str] = json.loads((_DATA_DIR / "itar_keywords.json").read_text())
except Exception:
    ITAR_KEYWORDS = ["itar", "security clearance", "export controlled", "u.s. citizen"]

SENIORITY_REJECT_PATTERNS = re.compile(
    r"\b(senior|sr\.|staff|principal|lead\s+engineer|manager|director|"
    r"vp|vice\s+president|chief|head\s+of)\b",
    re.IGNORECASE,
)

# Job title keywords — at least one must appear for a title to match our clusters
TITLE_KEYWORDS = [
    "manufacturing", "process", "materials", "composites", "composite",
    "quality", "industrial", "tooling", "metrology", "inspection",
    "production", "npi", "build engineer", "operations engineer",
    "lean", "continuous improvement", "supplier quality", "supplier assurance",
    "m&p", "materials and process",
]


class AtsScraper:
    """
    Scrapes jobs directly from Greenhouse and Lever public APIs.
    No authentication, no quota, no cost. Targeted to our company universe
    defined in data/ats_companies.json.
    """

    def run(self, queries: List[Dict] = None) -> List[Dict]:
        """
        queries: not used (ATS scraper targets fixed company list, not query-engine output).
        Accepted for interface compatibility with other scrapers.
        """
        all_jobs: List[Dict] = []
        seen: set = set()

        gh_companies = dict(GREENHOUSE_COMPANIES)
        lv_companies = dict(LEVER_COMPANIES)

        total_gh = len(gh_companies)
        total_lv = len(lv_companies)
        log.info(
            f"[ats] Starting — {total_gh} Greenhouse companies, "
            f"{total_lv} Lever companies"
        )

        # Compute updated_after cutoff for Greenhouse requests
        gh_cutoff = (
            datetime.utcnow() - timedelta(hours=GH_UPDATED_AFTER_HOURS)
        ).strftime("%Y-%m-%dT%H:%M:%SZ")

        # ── Fetch all companies concurrently ──────────────────────────────────
        gh_futures = {}
        lv_futures = {}

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            for slug, meta in gh_companies.items():
                fut = pool.submit(self._fetch_greenhouse, slug, meta, gh_cutoff)
                gh_futures[fut] = (slug, meta)
            for slug, meta in lv_companies.items():
                fut = pool.submit(self._fetch_lever, slug, meta)
                lv_futures[fut] = (slug, meta)

            for fut in as_completed({**gh_futures, **lv_futures}):
                jobs = fut.result()
                for j in jobs:
                    key = (j["company_name"].lower(), j["job_title"].lower(), j["location"].lower())
                    if key not in seen:
                        seen.add(key)
                        all_jobs.append(j)

        log.info(f"[ats] Total unique jobs after title/seniority filter: {len(all_jobs)}")
        return all_jobs

    # ── Greenhouse ────────────────────────────────────────────────────────────

    def _fetch_greenhouse(self, slug: str, meta: Dict, updated_after: str = "") -> List[Dict]:
        url = f"https://api.greenhouse.io/v1/boards/{slug}/jobs?content=true"
        if updated_after:
            url += f"&updated_after={updated_after}"
        try:
            r = requests.get(url, timeout=REQUEST_TIMEOUT)
            if r.status_code == 404:
                log.warning(
                    f"  [ats/gh] {meta['name']!r} — 404 (slug={slug!r}). "
                    f"Verify slug at boards.greenhouse.io/{slug}"
                )
                return []
            if r.status_code != 200:
                log.warning(f"  [ats/gh] {meta['name']!r} — HTTP {r.status_code}")
                return []
            data = r.json()
        except Exception as e:
            log.warning(f"  [ats/gh] {meta['name']!r} — request error: {e}")
            return []

        raw_jobs = data.get("jobs", [])
        matched = []
        for raw in raw_jobs[:MAX_JOBS_PER_CO]:
            j = self._normalize_greenhouse(raw, slug, meta)
            if j:
                matched.append(j)

        log.info(f"  [ats/gh] {meta['name']}: {len(raw_jobs)} raw → {len(matched)} matched")
        return matched

    def _normalize_greenhouse(self, raw: Dict, slug: str, meta: Dict) -> Optional[Dict]:
        title = raw.get("title", "") or ""
        if not self._title_matches(title):
            return None

        location_list = raw.get("location", {}) or {}
        location = location_list.get("name", "") or "United States"

        job_id = str(raw.get("id", "") or "")
        url    = raw.get("absolute_url", "") or f"https://boards.greenhouse.io/{slug}/jobs/{job_id}"

        content = raw.get("content", "") or ""
        desc    = _strip_html(content)

        posted_raw  = raw.get("updated_at", "") or raw.get("created_at", "")
        posted_date = self._parse_iso(posted_raw)

        itar_combined = (title + " " + desc).lower()
        itar_flags = [kw for kw in ITAR_KEYWORDS if kw in itar_combined]

        return {
            "job_title":    title,
            "company_name": meta["name"],
            "job_url":      url,
            "location":     location,
            "posted_date":  posted_date,
            "description":  desc[:500],
            "source":       "ats_greenhouse",
            "cluster":      self._infer_cluster(title),
            "itar_flag":    bool(itar_flags),
            "itar_detail":  ", ".join(itar_flags),
            "raw_id":       job_id,
            "ats_tier":     meta.get("tier", ""),
            "h1b":          meta.get("h1b", ""),
        }

    # ── Lever ─────────────────────────────────────────────────────────────────

    def _fetch_lever(self, slug: str, meta: Dict) -> List[Dict]:
        url = f"https://api.lever.co/v0/postings/{slug}?mode=json"
        try:
            r = requests.get(url, timeout=REQUEST_TIMEOUT)
            if r.status_code == 404:
                log.warning(
                    f"  [ats/lv] {meta['name']!r} — 404 (slug={slug!r}). "
                    f"Verify at jobs.lever.co/{slug}"
                )
                return []
            if r.status_code != 200:
                log.warning(f"  [ats/lv] {meta['name']!r} — HTTP {r.status_code}")
                return []
            raw_jobs = r.json()
            if not isinstance(raw_jobs, list):
                log.warning(f"  [ats/lv] {meta['name']!r} — unexpected response type")
                return []
        except Exception as e:
            log.warning(f"  [ats/lv] {meta['name']!r} — request error: {e}")
            return []

        matched = []
        for raw in raw_jobs[:MAX_JOBS_PER_CO]:
            j = self._normalize_lever(raw, meta)
            if j:
                matched.append(j)

        log.info(f"  [ats/lv] {meta['name']}: {len(raw_jobs)} raw → {len(matched)} matched")
        return matched

    def _normalize_lever(self, raw: Dict, meta: Dict) -> Optional[Dict]:
        title = raw.get("text", "") or ""
        if not self._title_matches(title):
            return None

        categories = raw.get("categories", {}) or {}
        location   = categories.get("location", "") or "United States"

        url    = raw.get("hostedUrl", "") or raw.get("applyUrl", "") or ""
        job_id = raw.get("id", "") or ""

        desc_blocks = raw.get("description", "") or ""
        desc_extra  = " ".join(
            item.get("content", "") or ""
            for item in (raw.get("lists") or [])
        )
        desc = _strip_html(desc_blocks + " " + desc_extra)

        # Lever returns all currently OPEN postings (no date filter available).
        # Use today's date so F4 doesn't age-drop live jobs that were created weeks ago.
        posted_date = datetime.utcnow().strftime("%Y-%m-%d")

        itar_combined = (title + " " + desc).lower()
        itar_flags = [kw for kw in ITAR_KEYWORDS if kw in itar_combined]

        return {
            "job_title":    title,
            "company_name": meta["name"],
            "job_url":      url,
            "location":     location,
            "posted_date":  posted_date,
            "description":  desc[:500],
            "source":       "ats_lever",
            "cluster":      self._infer_cluster(title),
            "itar_flag":    bool(itar_flags),
            "itar_detail":  ", ".join(itar_flags),
            "raw_id":       str(job_id),
            "ats_tier":     meta.get("tier", ""),
            "h1b":          meta.get("h1b", ""),
        }

    # ── Shared helpers ────────────────────────────────────────────────────────

    def _title_matches(self, title: str) -> bool:
        t = title.lower()
        has_keyword = any(kw in t for kw in TITLE_KEYWORDS)
        if not has_keyword:
            return False
        if SENIORITY_REJECT_PATTERNS.search(title):
            return False
        return True

    def _infer_cluster(self, title: str) -> str:
        t = title.lower()
        if "composit"    in t:                              return "composites"
        if "material"    in t:                              return "materials"
        if "quality"     in t or "supplier" in t:          return "quality"
        if "process"     in t:                              return "process"
        if "industrial"  in t or "lean" in t:              return "industrial"
        if "tooling"     in t or "metrology" in t:         return "tooling_inspection"
        if "npi"         in t or "prototype" in t or "build" in t: return "startup_manufacturing"
        return "manufacturing"

    def _parse_iso(self, ts: str) -> str:
        if not ts:
            return datetime.utcnow().strftime("%Y-%m-%d")
        try:
            return (
                datetime.fromisoformat(ts.replace("Z", "+00:00"))
                .strftime("%Y-%m-%d")
            )
        except Exception:
            return ts[:10] if len(ts) >= 10 else datetime.utcnow().strftime("%Y-%m-%d")


# ── HTML stripping utility ────────────────────────────────────────────────────

def _strip_html(text: str) -> str:
    """Remove HTML tags and normalise whitespace."""
    if not text:
        return ""
    clean = re.sub(r"<[^>]+>", " ", text)
    clean = re.sub(r"&nbsp;", " ", clean)
    clean = re.sub(r"&amp;",  "&", clean)
    clean = re.sub(r"&lt;",   "<", clean)
    clean = re.sub(r"&gt;",   ">", clean)
    clean = re.sub(r"\s+",    " ", clean).strip()
    return clean


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s")
    scraper = AtsScraper()
    jobs = scraper.run()
    print(f"\n{len(jobs)} jobs found")
    for j in jobs[:5]:
        print(f"  [{j['source']}] {j['company_name']} — {j['job_title']} ({j['location']})")
    if jobs:
        print("\nSample job:")
        print(json.dumps(jobs[0], indent=2))
