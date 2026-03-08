#!/usr/bin/env python3
"""
scrapers/apify_scraper.py — JobAgent v4.1
Apify / LinkedIn Scraper (harvestapi/linkedin-job-search)

Uses the HarvestAPI "Advanced LinkedIn Job Scraper (No Cookies)" actor
which is already saved in your Apify account under Recent & Bookmarked.

Actor:   harvestapi/linkedin-job-search
ID:      zn01OAlzP853oqn4Z
Pricing: Pay-per-event — $1 per 1,000 jobs. Apify free plan = $5/mo = ~5,000 jobs free.
Docs:    https://apify.com/harvestapi/linkedin-job-search

Input schema (harvestapi/linkedin-job-search):
    jobTitles        list[str]   required — job title keyword phrases
    locations        list[str]   optional — LinkedIn location strings
    postedLimit      str         optional — "Past 24 hours" | "Past Week" | "Past Month"
    experienceLevel  list[str]   optional — ["Entry Level"] | ["Mid Level"] | ["Senior Level"]  (MUST be array)
    sortBy           str         optional — "relevance" | "date"
    maxItems         int         optional — max results per job title query (0 = all pages)

Output fields (per job item):
    title, linkedinUrl, postedDate, descriptionText, company.name, location, jobState

Env vars:
    APIFY_TOKEN  — from https://console.apify.com/account/integrations
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

# Actor slug — stable identifier for harvestapi LinkedIn scraper
# This actor is bookmarked in your Apify account (15 successful runs as of 2026-02-06)
ACTOR_SLUG      = "harvestapi/linkedin-job-search"
MAX_ITEMS       = 25    # per job title; 25 × 8 = 200 max raw jobs per run
RUN_TIMEOUT     = 300   # 5 minutes hard ceiling

ITAR_KEYWORDS = [
    "security clearance", "us person", "itar", "export controlled",
    "classified", "us citizen or permanent resident",
    "must be authorized to work without sponsorship",
    "u.s. citizen", "u.s. national", "permanent resident only",
]


class ApifyScraper:
    """
    Runs harvestapi/linkedin-job-search for LinkedIn job discovery.
    Sends jobTitles[] from our cluster map — short natural language phrases only.
    """

    # QueryEngine cluster name → LinkedIn job title keyword phrase.
    # LinkedIn is natural language; no boolean operators.
    CLUSTER_TO_TITLE: Dict[str, str] = {
        "manufacturing":              "Manufacturing Engineer",
        "process":                    "Process Engineer",
        "materials":                  "Materials Engineer",
        "composites":                 "Composites Manufacturing Engineer",
        "quality":                    "Quality Engineer",
        "industrial":                 "Industrial Engineer",
        "tooling_inspection":         "Tooling Engineer",
        "startup_manufacturing":      "NPI Manufacturing Engineer",
        "manufacturing_open":         "Manufacturing Engineer",
        "quality_open":               "Quality Engineer",
        "composites_open":            "Composites Engineer",
        "materials_open":             "Materials Engineer",
        "process_open":               "Process Engineer",
        "startup_manufacturing_open": "NPI Engineer",
        "industrial_open":            "Industrial Engineer",
    }

    def run(self, queries: List[Dict]) -> List[Dict]:
        if not APIFY_TOKEN:
            log.warning("[apify] APIFY_TOKEN not set — skipping")
            return []

        client = ApifyClient(APIFY_TOKEN)
        job_titles = self._build_job_titles(queries)

        log.info(
            f"[apify] Actor: {ACTOR_SLUG!r} | "
            f"{len(job_titles)} job titles: {job_titles[:4]}"
            f"{'...' if len(job_titles) > 4 else ''}"
        )

        run_input = {
            "jobTitles":       job_titles,
            "locations":       ["United States"],
            "postedLimit":     "Past Week",
            "experienceLevel": ["Entry Level"],
            "sortBy":          "date",
            "maxItems":        MAX_ITEMS,
        }
        log.debug(f"[apify] run_input: {json.dumps(run_input)}")

        # ── Start actor run ───────────────────────────────────────────────────
        try:
            run = client.actor(ACTOR_SLUG).call(
                run_input=run_input,
                timeout_secs=RUN_TIMEOUT,
            )
        except Exception as e:
            err = str(e)
            if "not found" in err.lower() or "404" in err:
                log.error(
                    f"[apify] Actor '{ACTOR_SLUG}' was not found.\n"
                    f"  → Visit https://apify.com/harvestapi/linkedin-job-search\n"
                    f"  → Verify your APIFY_TOKEN is valid in GitHub Secrets.\n"
                    f"  Raw error: {err}"
                )
            else:
                log.error(f"[apify] Actor failed to start: {err}")
            return []

        # ── Validate run status ───────────────────────────────────────────────
        run_status = run.get("status", "UNKNOWN") if run else "NO_RESPONSE"
        dataset_id = run.get("defaultDatasetId", "") if run else ""

        if run_status not in ("SUCCEEDED", "READY"):
            log.error(
                f"[apify] Actor run ended with status '{run_status}'. "
                f"Expected SUCCEEDED. No jobs returned."
            )
            return []

        if not dataset_id:
            log.error("[apify] No defaultDatasetId returned.")
            return []

        log.info(f"[apify] Actor SUCCEEDED — reading dataset {dataset_id} ...")

        # ── Fetch and normalize dataset ───────────────────────────────────────
        all_jobs: List[Dict] = []
        seen:     set        = set()
        item_count = 0

        try:
            for item in client.dataset(dataset_id).iterate_items():
                item_count += 1
                key = (
                    (item.get("company") or {}).get("name", "").lower(),
                    (item.get("title", "") or "").lower(),
                    (item.get("location", "") or "").lower(),
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
            f"[apify] Dataset: {item_count} raw items → "
            f"{len(all_jobs)} unique normalised jobs"
        )
        return all_jobs

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _build_job_titles(self, queries: List[Dict]) -> List[str]:
        """Convert QueryEngine cluster list → deduplicated LinkedIn job title phrases."""
        titles: List[str] = []
        seen: set = set()
        for q in queries:
            cluster = q.get("cluster", "")
            title   = self.CLUSTER_TO_TITLE.get(cluster)
            if title and title not in seen:
                titles.append(title)
                seen.add(title)
        return titles or ["Manufacturing Engineer"]

    def _normalize(self, raw: Dict) -> Optional[Dict]:
        """
        Map harvestapi output fields to the standard JobAgent schema.
        harvestapi fields: title, linkedinUrl, postedDate, descriptionText,
                           company.name, location, jobState
        """
        title    = raw.get("title", "") or ""
        company  = (raw.get("company") or {}).get("name", "") or ""
        location = raw.get("location", "") or ""
        desc     = raw.get("descriptionText", "") or raw.get("description", "") or ""
        url      = raw.get("linkedinUrl", "") or raw.get("jobUrl", "") or ""

        if not url:
            log.debug(
                f"  [apify] No URL for {title!r} @ {company} — dropping. "
                f"Available keys: {list(raw.keys())}"
            )
            return None

        posted_date = self._parse_date(raw.get("postedDate", "") or "")
        itar_flags  = [kw for kw in ITAR_KEYWORDS if kw in desc.lower()]

        return {
            "job_title":    title,
            "company_name": company,
            "job_url":      url,
            "location":     location,
            "posted_date":  posted_date,
            "description":  desc[:500],
            "source":       "apify",
            "cluster":      "linkedin",
            "itar_flag":    bool(itar_flags),
            "itar_detail":  ", ".join(itar_flags),
            "raw_id":       str(raw.get("id", "") or ""),
        }

    def _parse_date(self, ts: str) -> str:
        """Parse ISO 8601 date from harvestapi (e.g. '2025-05-14T17:12:41.000Z')."""
        if not ts:
            return datetime.utcnow().strftime("%Y-%m-%d")
        try:
            return (
                datetime.fromisoformat(ts.replace("Z", "+00:00"))
                .strftime("%Y-%m-%d")
            )
        except Exception:
            pass
        try:
            return datetime.strptime(ts[:10], "%Y-%m-%d").strftime("%Y-%m-%d")
        except Exception:
            pass
        # Relative text fallback: "2 days ago", "3 hours ago"
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
