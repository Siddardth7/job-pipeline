#!/usr/bin/env python3
"""
scrapers/serpapi_scraper.py — JobAgent v4.2
SerpAPI / Google Jobs Scraper

Queries Google Jobs via SerpAPI using short natural-language phrases.
Google Jobs does NOT support boolean operators — short keyword phrases only.

Quota management (free tier: 100 searches/month):
    - Runs ONLY on odd calendar days (date.toordinal() % 2 == 1)
      → ~15 active days/month × 5 queries/day = 75 searches/month
      → Safely under the 100/month cap with 25 searches headroom
    - Orchestrator hard cap: 5 queries per run

To override the day-alternation for testing:
    Set env var  SERPAPI_FORCE_RUN=1

Env vars:
    SERPAPI_KEY      — API key from https://serpapi.com
    SERPAPI_API_KEY  — Accepted as fallback (SerpAPI's documented name)
    SERPAPI_FORCE_RUN — Set to "1" to bypass day-alternation check
"""

import os
import json
import time
import logging
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional, Tuple

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

SERPAPI_KEY = (
    os.environ.get("SERPAPI_KEY", "")
    or os.environ.get("SERPAPI_API_KEY", "")
)
SERPAPI_URL = "https://serpapi.com/search"

REQUEST_DELAY   = 2.0
RESULTS_PER_REQ = 20
CHIPS_FILTER    = "date_posted:week"

AGGREGATOR_DOMAINS = [
    "indeed.com", "glassdoor.com", "ziprecruiter.com",
    "simplyhired.com", "monster.com", "careerbuilder.com",
]

# ── ITAR keywords loaded from shared data file ────────────────────────────────
_DATA_DIR = Path(__file__).parent.parent / "data"
try:
    ITAR_KEYWORDS: List[str] = json.loads((_DATA_DIR / "itar_keywords.json").read_text())
except Exception:
    ITAR_KEYWORDS = ["itar", "security clearance", "export controlled", "u.s. citizen"]


class SerpApiScraper:
    """Scrapes Google Jobs via SerpAPI using short cluster phrases."""

    # Short natural-language phrases per cluster.
    # IMPORTANT: Google Jobs rejects boolean OR/AND operators entirely.
    CLUSTER_QUERIES = {
        "manufacturing":              "Manufacturing Engineer entry level",
        "process":                    "Process Engineer entry level",
        "materials":                  "Materials Engineer entry level",
        "composites":                 "Composites Manufacturing Engineer",
        "quality":                    "Quality Engineer entry level",
        "industrial":                 "Industrial Engineer entry level",
        "tooling_inspection":         "Tooling Engineer manufacturing",
        "startup_manufacturing":      "Manufacturing Engineer NPI startup",
        "manufacturing_open":         "Manufacturing Engineer",
        "quality_open":               "Quality Engineer",
        "composites_open":            "Composites Engineer",
        "materials_open":             "Materials Engineer",
        "process_open":               "Process Engineer",
        "startup_manufacturing_open": "NPI Engineer",
        "industrial_open":            "Industrial Engineer",
    }

    @staticmethod
    def is_scheduled_off() -> bool:
        """
        Returns True when SerpAPI should be SKIPPED today (even-ordinal day).
        The orchestrator calls this before running to set the correct status
        ('skipped' vs 'zero_results'). SERPAPI_FORCE_RUN=1 overrides this.
        """
        if os.environ.get("SERPAPI_FORCE_RUN", "").strip() == "1":
            return False
        return (date.today().toordinal() % 2 == 0)

    def run(self, queries: List[Dict]) -> List[Dict]:
        if not SERPAPI_KEY:
            log.warning("[serpapi] SERPAPI_KEY not set — skipping")
            return []

        # Day-alternation check — orchestrator checks is_scheduled_off() before
        # calling run(), so this is a belt-and-suspenders guard only.
        if self.is_scheduled_off():
            log.info(
                f"[serpapi] Even-ordinal day — scheduled OFF today. "
                f"Runs on odd days to stay within 100 searches/month free tier. "
                f"Set SERPAPI_FORCE_RUN=1 to override."
            )
            return []

        all_jobs:     List[Dict] = []
        seen:         set        = set()
        seen_phrases: set        = set()

        for q_dict in queries:
            cluster = q_dict.get("cluster", "unknown")
            phrase  = self.CLUSTER_QUERIES.get(cluster)

            if not phrase:
                raw_q = q_dict.get("query", "")
                phrase = " ".join(
                    w for w in raw_q.replace('"', '').replace('(', '').split()
                    if w.upper() not in ("OR", "AND", "NOT")
                )[:60].strip()

            if not phrase or phrase in seen_phrases:
                continue
            seen_phrases.add(phrase)

            log.info(f"[serpapi] Query ({cluster}): {phrase!r}")
            time.sleep(REQUEST_DELAY)

            results, has_next = self._api_call(phrase, start=0)
            for raw in results:
                self._add_if_new(raw, cluster, seen, all_jobs)

            if has_next and results:
                time.sleep(REQUEST_DELAY)
                results2, _ = self._api_call(phrase, start=RESULTS_PER_REQ)
                for raw in results2:
                    self._add_if_new(raw, cluster, seen, all_jobs)

        log.info(f"[serpapi] Total unique jobs: {len(all_jobs)}")
        return all_jobs

    # ── Internal helpers ──────────────────────────────────────────────────────

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

    def _api_call(self, query: str, start: int = 0) -> Tuple[List[Dict], bool]:
        """
        Returns (results, has_next_page).
        Attempt 1: with chips filter. On HTTP 400, retries without chips.
        """
        base_params = {
            "engine":  "google_jobs",
            "q":       query,
            "hl":      "en",
            "gl":      "us",
            "api_key": SERPAPI_KEY,
        }
        if start > 0:
            base_params["start"] = start

        for attempt, chips_val in enumerate([CHIPS_FILTER, None]):
            params = dict(base_params)
            if chips_val:
                params["chips"] = chips_val

            try:
                r = requests.get(SERPAPI_URL, params=params, timeout=20)
                if r.status_code == 401:
                    log.error("[serpapi] 401 Unauthorized — check SERPAPI_KEY")
                    return [], False
                if r.status_code == 429:
                    log.error("[serpapi] 429 Too Many Requests — quota exhausted")
                    return [], False
                if r.status_code == 400:
                    if attempt == 0:
                        log.warning("[serpapi] HTTP 400 with chips — retrying without chips")
                        continue
                    log.warning("[serpapi] HTTP 400 without chips — skipping query")
                    return [], False
                if r.status_code != 200:
                    log.warning(f"[serpapi] HTTP {r.status_code}")
                    return [], False

                data = r.json()
                if "error" in data:
                    log.error(f"[serpapi] API error: {data['error']}")
                    return [], False

                results  = data.get("jobs_results", [])
                has_next = bool(data.get("serpapi_pagination", {}).get("next"))
                if not results:
                    log.info(f"  [serpapi] 0 results (chips={chips_val or 'none'})")
                return results, has_next

            except Exception as e:
                log.error(f"[serpapi] Request error: {e}")
                return [], False

        return [], False

    def _normalize(self, raw: Dict, cluster: str) -> Optional[Dict]:
        title    = raw.get("title",        "") or ""
        company  = raw.get("company_name", "") or ""
        location = raw.get("location",     "") or ""
        desc     = raw.get("description",  "") or ""

        apply_link = self._best_apply_link(raw)
        if not apply_link:
            log.debug(f"  [serpapi] No usable URL for {title!r} @ {company} — dropping")
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
            "itar_flag":    bool(itar_flags),
            "itar_detail":  ", ".join(itar_flags),
            "raw_id":       "",
        }

    def _best_apply_link(self, raw: Dict) -> str:
        options = raw.get("apply_options", []) or []

        for opt in options:
            link = opt.get("link", "") or ""
            if link and not self._is_aggregator(link) and "google.com" not in link:
                return link

        for opt in options:
            link = opt.get("link", "") or ""
            if link and "google.com" not in link:
                return link

        job_id = raw.get("job_id", "") or ""
        if job_id:
            return (
                f"https://www.google.com/search?q=jobs&ibp=htl;jobs"
                f"#htivrt=jobs&htidocid={job_id}"
            )

        if options:
            link = options[0].get("link", "") or ""
            if link:
                return link

        return ""

    def _is_aggregator(self, url: str) -> bool:
        lower = url.lower()
        return any(d in lower for d in AGGREGATOR_DOMAINS)

    def _parse_ago(self, text: str) -> str:
        """Convert '3 days ago', '2 hours ago' → ISO date string."""
        if not text:
            return ""
        t = text.lower()
        now = datetime.utcnow()
        try:
            if "hour" in t or "minute" in t or "just" in t:
                return now.strftime("%Y-%m-%d")
            if "day" in t:
                days = int("".join(c for c in t if c.isdigit()) or "1")
                return (now - timedelta(days=days)).strftime("%Y-%m-%d")
            if "week" in t:
                weeks = int("".join(c for c in t if c.isdigit()) or "1")
                return (now - timedelta(weeks=weeks)).strftime("%Y-%m-%d")
            if "month" in t:
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
