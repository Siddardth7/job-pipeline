#!/usr/bin/env python3
"""
scrapers/apify_scraper.py — JobAgent v4 Apify / LinkedIn Scraper

Runs the Bebity LinkedIn Jobs Scraper actor via the Apify API.

Env vars required:
    APIFY_TOKEN     — from https://console.apify.com/account/integrations
    APIFY_ACTOR_ID  — (optional) override the actor ID/slug if the default
                      changes. Find it on https://apify.com/bebity/linkedin-jobs-scraper
                      Default: bebity/linkedin-jobs-scraper

Bug fixes vs original:
    FIXED-1  'keywords' input key → 'queries'  (actor ignores unknown keys silently)
    FIXED-2  'Past 3 Days' datePosted → 'Past Week'
    FIXED-3  'maxItems' limit key → 'rows'
    FIXED-4  Actor run status validated before reading dataset
    FIXED-5  _parse_date: broken ts[:len(fmt)] → fromisoformat()
    FIXED-6  URL extraction expanded: 5-field fallback chain
    FIXED-7  (run 2) Actor ID hKByXkMQaIasn7ATK not found → now reads from
             APIFY_ACTOR_ID env var; default changed to slug 'bebity/linkedin-jobs-scraper'
"""

import os
import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional

try:
    from apify_client import ApifyClient
except ImportError:
    raise ImportError("Run: pip install apify-client")

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

log = logging.getLogger("apify_scraper")

APIFY_TOKEN = os.environ.get("APIFY_TOKEN", "")

# FIXED-7: The hardcoded actor ID hKByXkMQaIasn7ATK returned "Actor was not found"
# in the 2026-03-07 run. Actor IDs can change when authors update/rename actors.
# Now reads from APIFY_ACTOR_ID env var so you can update it without a code change.
# Default is the username/actor-name slug which is more stable than a raw ID.
# To find the current ID: https://apify.com/bebity/linkedin-jobs-scraper
_DEFAULT_ACTOR = "bebity/linkedin-jobs-scraper"
ACTOR_ID = os.environ.get("APIFY_ACTOR_ID", _DEFAULT_ACTOR) or _DEFAULT_ACTOR

# FIXED-3: 'rows' is per-query item limit; 25 per query × up to 8 queries ≈ 200 max
ROWS_PER_QUERY   = 25
RUN_TIMEOUT_SECS = 300   # 5 minutes hard ceiling

ITAR_KEYWORDS = [
    "security clearance", "us person", "itar", "export controlled",
    "classified", "us citizen or permanent resident",
    "must be authorized to work without sponsorship",
    "u.s. citizen", "u.s. national", "permanent resident only",
]


class ApifyScraper:
    """Runs the Apify LinkedIn Jobs Scraper actor for job discovery."""

    def run(self, queries: List[Dict]) -> List[Dict]:
        if not APIFY_TOKEN:
            log.warning("APIFY_TOKEN not set — returning empty results")
            return []

        client = ApifyClient(APIFY_TOKEN)

        # Build search term list from query engine output
        search_terms = self._extract_search_terms(queries)
        log.info(
            f"[apify] Actor: {ACTOR_ID!r} | "
            f"{len(search_terms)} search terms: "
            f"{search_terms[:4]}{'...' if len(search_terms) > 4 else ''}"
        )

        # ── FIXED-1: 'queries' not 'keywords'
        # ── FIXED-2: 'Past Week' not 'Past 3 Days'  (only valid LinkedIn values:
        #             'Past 24 hours', 'Past Week', 'Past Month')
        # ── FIXED-3: 'rows' not 'maxItems'
        run_input = {
            "queries":    search_terms,          # FIXED-1
            "datePosted": "Past Week",           # FIXED-2
            "rows":       ROWS_PER_QUERY,        # FIXED-3
            "location":   "United States",
        }

        log.debug(f"[apify] run_input: {json.dumps(run_input)}")

        # ── Start actor run ───────────────────────────────────────────────────
        try:
            run = client.actor(ACTOR_ID).call(
                run_input=run_input,
                timeout_secs=RUN_TIMEOUT_SECS,
            )
        except Exception as e:
            err = str(e)
            if "not found" in err.lower() or "404" in err:
                log.error(
                    f"[apify] Actor '{ACTOR_ID}' was not found on the Apify platform. "
                    f"The actor may have been renamed or removed. To fix:\n"
                    f"  1. Go to https://apify.com/bebity/linkedin-jobs-scraper\n"
                    f"  2. Copy the actor ID from the URL or the 'API' tab\n"
                    f"  3. Add GitHub Secret: APIFY_ACTOR_ID=<new-id>\n"
                    f"  Raw error: {err}"
                )
            else:
                log.error(f"[apify] Actor failed to start: {err}")
            return []

        # ── FIXED-4: validate run status before reading dataset ───────────────
        run_status = run.get("status", "UNKNOWN") if run else "NO_RESPONSE"
        dataset_id = run.get("defaultDatasetId", "") if run else ""

        if run_status not in ("SUCCEEDED", "READY"):
            log.error(
                f"[apify] Actor run ended with status '{run_status}'. "
                f"Expected SUCCEEDED. No jobs will be returned."
            )
            return []

        if not dataset_id:
            log.error("[apify] Actor returned no defaultDatasetId.")
            return []

        log.info(f"[apify] Actor SUCCEEDED. Reading dataset {dataset_id}...")

        # ── Fetch dataset items ───────────────────────────────────────────────
        all_jobs: List[Dict] = []
        seen:     set        = set()
        item_count = 0

        try:
            for item in client.dataset(dataset_id).iterate_items():
                item_count += 1
                key = (
                    (item.get("companyName", "") or "").lower(),
                    (item.get("title",       "") or "").lower(),
                    (item.get("location",    "") or "").lower(),
                )
                if key in seen:
                    continue
                seen.add(key)

                normalized = self._normalize(item)
                if normalized:
                    all_jobs.append(normalized)

        except Exception as e:
            log.error(f"[apify] Dataset read error: {e}")

        log.info(
            f"[apify] Dataset had {item_count} items → "
            f"{len(all_jobs)} unique normalised jobs"
        )
        return all_jobs

    # ── Query → search term conversion ───────────────────────────────────────

    def _extract_search_terms(self, queries: List[Dict]) -> List[str]:
        """
        Map query engine cluster names to plain-English LinkedIn search terms.
        LinkedIn search works best with simple keyword phrases, not boolean queries.
        """
        CLUSTER_TO_TERM = {
            "manufacturing":             "Manufacturing Engineer entry level",
            "process":                   "Process Engineer entry level",
            "materials":                 "Materials Engineer",
            "composites":                "Composites Manufacturing Engineer",
            "quality":                   "Quality Engineer Associate",
            "industrial":                "Industrial Engineer entry level",
            "tooling_inspection":        "Tooling Engineer",
            "startup_manufacturing":     "Manufacturing Engineer NPI",
            # Open-sweep clusters
            "manufacturing_open":        "Manufacturing Engineer",
            "quality_open":              "Quality Engineer",
            "composites_open":           "Composites Engineer",
            "materials_open":            "Materials Engineer",
            "process_open":              "Process Engineer",
            "startup_manufacturing_open":"NPI Engineer",
            "industrial_open":           "Industrial Engineer",
        }
        terms:    List[str] = []
        seen_kws: set       = set()

        for q in queries:
            cluster = q.get("cluster", "")
            term    = CLUSTER_TO_TERM.get(cluster)
            if term and term not in seen_kws:
                terms.append(term)
                seen_kws.add(term)

        return terms or ["Manufacturing Engineer entry level"]

    # ── Normalise a raw dataset item ─────────────────────────────────────────

    def _normalize(self, raw: Dict) -> Optional[Dict]:
        title   = raw.get("title",       "") or ""
        company = raw.get("companyName", "") or ""
        location = raw.get("location",   "") or ""
        desc    = raw.get("description", "") or ""
        posted_raw = (
            raw.get("postedDate",    "")
            or raw.get("postedAt",   "")
            or raw.get("publishedAt","")
            or ""
        )

        # ── FIXED-6: expanded URL fallback chain ─────────────────────────────
        url = (
            raw.get("applyUrl",          "") or
            raw.get("jobUrl",            "") or
            raw.get("url",               "") or
            raw.get("externalApplyLink", "") or
            raw.get("jobPostingUrl",     "") or
            ""
        )
        if not url:
            log.debug(
                f"  [apify] No URL found for: {title!r} @ {company} — dropping. "
                f"Available keys: {list(raw.keys())}"
            )
            return None

        # ── FIXED-5: robust ISO date parsing ─────────────────────────────────
        posted_date = self._parse_date(posted_raw)

        itar_flags = [kw for kw in ITAR_KEYWORDS if kw in desc.lower()]

        return {
            "job_title":    title,
            "company_name": company,
            "job_url":      url,
            "location":     location,
            "posted_date":  posted_date,
            "description":  desc[:500],
            "source":       "apify",
            "cluster":      "linkedin",
            "itar_flag":    len(itar_flags) > 0,
            "itar_detail":  ", ".join(itar_flags),
            "raw_id":       str(raw.get("id", "") or ""),
        }

    # ── Date parser ──────────────────────────────────────────────────────────

    def _parse_date(self, ts: str) -> str:
        """
        FIXED-5: original used ts[:len(fmt)] where len(fmt) counted % codes as
        single characters — sliced too short, stripped trailing 'Z', strptime
        always raised ValueError, every date fell back to today().

        Now uses datetime.fromisoformat() which handles all ISO 8601 variants,
        with a plain date-only fallback.
        """
        if not ts:
            return datetime.utcnow().strftime("%Y-%m-%d")

        # ISO 8601: "2024-01-15T10:30:00.000Z", "2024-01-15T10:30:00Z", etc.
        try:
            return (
                datetime.fromisoformat(ts.replace("Z", "+00:00"))
                .strftime("%Y-%m-%d")
            )
        except Exception:
            pass

        # Plain date-only: "2024-01-15"
        try:
            return datetime.strptime(ts[:10], "%Y-%m-%d").strftime("%Y-%m-%d")
        except Exception:
            pass

        # Relative text: "2 days ago", "3 hours ago" (some actor versions)
        ts_l = ts.lower()
        try:
            now = datetime.utcnow()
            if "hour" in ts_l or "minute" in ts_l:
                return now.strftime("%Y-%m-%d")
            if "day" in ts_l:
                days = int("".join(c for c in ts_l if c.isdigit()) or "1")
                return (now - timedelta(days=days)).strftime("%Y-%m-%d")
            if "week" in ts_l:
                return (now - timedelta(weeks=1)).strftime("%Y-%m-%d")
        except Exception:
            pass

        # Last resort: treat as today (fresh)
        log.debug(f"  [apify] Unparseable date {ts!r} — defaulting to today")
        return datetime.utcnow().strftime("%Y-%m-%d")


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s")
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from engine.query_engine import QueryEngine
    queries = QueryEngine().generate_queries()[:5]
    scraper = ApifyScraper()
    jobs = scraper.run(queries)
    print(f"\n{len(jobs)} jobs found")
    if jobs:
        print(json.dumps(jobs[0], indent=2))
