#!/usr/bin/env python3
"""
scrapers/apify_scraper.py — JobAgent v2 Apify Scraper

Runs Apify LinkedIn Jobs Scraper actor via keyword queries.
Requires Apify account with compute units available.

Env vars required:
    APIFY_TOKEN  — from https://console.apify.com/account/integrations
"""

import os
import json
import time
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict

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

# LinkedIn Jobs Scraper actor ID
ACTOR_ID = "hKByXkMQaIasn7ATK"

# Limit results per run to stay within compute budget
MAX_ITEMS_PER_RUN = 100
RUN_TIMEOUT_SECS = 300   # 5 minutes

ITAR_KEYWORDS = [
    "security clearance", "us person", "itar", "export controlled",
    "classified", "us citizen or permanent resident",
    "must be authorized to work without sponsorship",
    "u.s. citizen", "u.s. national", "permanent resident only"
]


class ApifyScraper:
    """Runs Apify LinkedIn scraper for job discovery."""

    def run(self, queries: List[Dict]) -> List[Dict]:
        if not APIFY_TOKEN:
            log.warning("APIFY_TOKEN not set — returning empty results")
            return []

        client = ApifyClient(APIFY_TOKEN)

        # Build keyword list from queries (extract first cluster title each)
        keywords = self._extract_keywords(queries)
        log.info(f"[apify] Running actor with {len(keywords)} keywords")

        run_input = {
            "keywords": keywords,
            "location": "United States",
            "datePosted": "Past 3 Days",
            "maxItems": MAX_ITEMS_PER_RUN,
        }

        try:
            run = client.actor(ACTOR_ID).call(
                run_input=run_input,
                timeout_secs=RUN_TIMEOUT_SECS
            )
        except Exception as e:
            log.error(f"[apify] Actor run failed: {e}")
            return []

        # Fetch results from dataset
        all_jobs: List[Dict] = []
        seen: set = set()

        try:
            for item in client.dataset(run["defaultDatasetId"]).iterate_items():
                title = item.get("title", "") or ""
                company = item.get("companyName", "") or ""
                url = item.get("applyUrl", "") or item.get("jobUrl", "") or ""
                location = item.get("location", "") or ""

                key = (company.lower(), title.lower(), location.lower())
                if key in seen:
                    continue
                seen.add(key)

                normalized = self._normalize(item)
                if normalized:
                    all_jobs.append(normalized)

        except Exception as e:
            log.error(f"[apify] Dataset fetch error: {e}")

        log.info(f"[apify] Total unique jobs: {len(all_jobs)}")
        return all_jobs

    def _extract_keywords(self, queries: List[Dict]) -> List[str]:
        """
        Convert query dicts into keyword phrases suitable for LinkedIn search.
        Uses cluster name to pick representative titles.
        """
        CLUSTER_KEYWORDS = {
            "manufacturing": "Manufacturing Engineer entry level",
            "process": "Process Engineer entry level",
            "materials": "Materials Engineer",
            "composites": "Composites Manufacturing Engineer",
            "quality": "Quality Engineer Associate",
            "industrial": "Industrial Engineer entry level",
            "tooling_inspection": "Tooling Engineer",
            "startup_manufacturing": "Manufacturing Engineer NPI",
            "manufacturing_open": "Manufacturing Engineer",
            "quality_open": "Quality Engineer",
            "composites_open": "Composites Engineer",
            "materials_open": "Materials Engineer",
            "process_open": "Process Engineer",
            "startup_manufacturing_open": "NPI Engineer",
            "industrial_open": "Industrial Engineer",
        }
        keywords = []
        seen_kws = set()
        for q in queries:
            cluster = q.get("cluster", "")
            kw = CLUSTER_KEYWORDS.get(cluster)
            if kw and kw not in seen_kws:
                keywords.append(kw)
                seen_kws.add(kw)
        return keywords or ["Manufacturing Engineer entry level"]

    def _normalize(self, raw: Dict) -> Dict | None:
        title = raw.get("title", "") or ""
        company = raw.get("companyName", "") or ""
        url = raw.get("applyUrl", "") or raw.get("jobUrl", "") or ""
        location = raw.get("location", "") or ""
        desc = raw.get("description", "") or ""
        posted_raw = raw.get("postedDate", "") or raw.get("postedAt", "") or ""

        if not url:
            return None

        posted_date = self._parse_date(posted_raw)
        itar_flags = [kw for kw in ITAR_KEYWORDS if kw in desc.lower()]

        return {
            "job_title": title,
            "company_name": company,
            "job_url": url,
            "location": location,
            "posted_date": posted_date,
            "description": desc[:500],
            "source": "apify",
            "cluster": "linkedin",
            "itar_flag": len(itar_flags) > 0,
            "itar_detail": ", ".join(itar_flags),
            "raw_id": str(raw.get("id", "")),
        }

    def _parse_date(self, ts: str) -> str:
        if not ts:
            return datetime.utcnow().strftime("%Y-%m-%d")
        for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
            try:
                return datetime.strptime(ts[:len(fmt)], fmt).strftime("%Y-%m-%d")
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
    print(json.dumps(jobs[:3], indent=2))
