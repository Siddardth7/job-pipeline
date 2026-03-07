#!/usr/bin/env python3
"""
engine/scraper_orchestrator.py — JobAgent v4 Scraper Orchestrator

Coordinates query generation, API quota management, and sequential
scraper execution. Continues if any individual scraper fails.

Changes from v2:
    - Stack traces now logged at WARNING (were DEBUG → invisible in GitHub Actions)
    - Zero-result scrapers now generate explicit WARNING (were logged as 'success')
    - Scraper health summary block printed at end of every run
    - Version label updated to v4

Usage:
    python engine/scraper_orchestrator.py
"""

import json
import logging
import sys
import traceback
from datetime import date, datetime
from pathlib import Path
from typing import List, Dict

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from engine.query_engine import QueryEngine
from scrapers.jsearch_scraper import JSearchScraper
from scrapers.serpapi_scraper import SerpApiScraper
from scrapers.apify_scraper   import ApifyScraper

DATA_DIR     = ROOT / "data"
TEMP_DIR     = ROOT / "temp"
STATE_PATH   = DATA_DIR / "scraper_state.json"
RUN_LOG_PATH = DATA_DIR / "run_log.json"

TEMP_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)

# Daily query/run budgets (free / low-cost tiers)
QUOTAS = {
    "jsearch": 10,   # RapidAPI free: 200/month → ~6/day; budget 10 to be safe
    "serpapi": 10,   # SerpApi free: 100/month → ~3/day; budget 10
    "apify":    2,   # Apify actor runs (each run fetches multiple queries)
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(ROOT / "orchestrator.log"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("orchestrator")


# ── State helpers ─────────────────────────────────────────────────────────────

def load_state() -> Dict:
    today = str(date.today())
    if STATE_PATH.exists():
        state = json.loads(STATE_PATH.read_text())
        if state.get("last_reset") != today:
            state = _fresh_state(today)
    else:
        state = _fresh_state(today)
    return state


def _fresh_state(today: str) -> Dict:
    return {
        "jsearch": {"queries_today": 0},
        "serpapi": {"queries_today": 0},
        "apify":   {"runs_today":    0},
        "last_reset": today,
    }


def save_state(state: Dict):
    STATE_PATH.write_text(json.dumps(state, indent=2))


def log_run(run_record: Dict):
    records = json.loads(RUN_LOG_PATH.read_text()) if RUN_LOG_PATH.exists() else []
    records.append(run_record)
    records = records[-90:]   # keep last 90 runs
    RUN_LOG_PATH.write_text(json.dumps(records, indent=2))


# ── Quota helpers ─────────────────────────────────────────────────────────────

def available_queries(name: str, state: Dict) -> int:
    key  = "runs_today" if name == "apify" else "queries_today"
    used = state[name].get(key, 0)
    return max(0, QUOTAS[name] - used)


def deduct(name: str, count: int, state: Dict):
    key = "runs_today" if name == "apify" else "queries_today"
    state[name][key] = state[name].get(key, 0) + count


# ── Main orchestration ────────────────────────────────────────────────────────

def run():
    log.info("=" * 60)
    log.info("JobAgent v4 — Scraper Orchestrator Starting")
    log.info("=" * 60)

    start_time = datetime.utcnow()
    state      = load_state()

    # Step 1 — Generate queries
    qe          = QueryEngine()
    all_queries: List[Dict] = qe.generate_queries()
    log.info(f"Query engine produced {len(all_queries)} queries")

    run_record: Dict = {
        "run_date":         str(date.today()),
        "run_start_utc":    start_time.isoformat() + "Z",
        "queries_generated": len(all_queries),
        "scrapers":         {},
    }

    # Step 2 — Run each scraper sequentially with fail-safe wrapping
    scrapers = [
        ("jsearch", JSearchScraper,  TEMP_DIR / "jobs_jsearch.json"),
        ("serpapi", SerpApiScraper,  TEMP_DIR / "jobs_serpapi.json"),
        ("apify",   ApifyScraper,    TEMP_DIR / "jobs_apify.json"),
    ]

    for name, ScraperClass, output_path in scrapers:
        quota = available_queries(name, state)
        log.info(f"[{name}] Quota remaining today: {quota}")

        if quota <= 0:
            log.warning(f"[{name}] Daily quota exhausted — skipping")
            _write_empty(output_path, name, "quota_exhausted")
            run_record["scrapers"][name] = {
                "status": "skipped",
                "reason": "quota_exhausted",
                "jobs_found": 0,
            }
            continue

        batch = all_queries[:quota]

        try:
            scraper   = ScraperClass()
            jobs      = scraper.run(batch)
            jobs_found = len(jobs)

            _write_output(output_path, name, jobs)
            deduct(name, len(batch), state)

            # ── FIX: warn on zero results even when scraper didn't crash ──────
            if jobs_found == 0:
                log.warning(
                    f"[{name}] ⚠ WARNING: scraper ran successfully but returned "
                    f"0 jobs. Check API key, quota, and input parameters."
                )
                run_record["scrapers"][name] = {
                    "status":       "zero_results",
                    "queries_used": len(batch),
                    "jobs_found":   0,
                }
            else:
                log.info(f"[{name}] ✓ {jobs_found} jobs found from {len(batch)} queries")
                run_record["scrapers"][name] = {
                    "status":       "success",
                    "queries_used": len(batch),
                    "jobs_found":   jobs_found,
                }

        except Exception as exc:
            log.error(f"[{name}] Scraper raised an exception: {exc}")
            # ── FIX: was log.debug → invisible in Actions; now WARNING ──────
            log.warning(
                f"[{name}] Full traceback:\n{traceback.format_exc()}"
            )
            _write_empty(output_path, name, str(exc))
            run_record["scrapers"][name] = {
                "status":     "error",
                "error":      str(exc),
                "jobs_found": 0,
            }

    # Step 3 — Persist quota state and run log
    save_state(state)
    run_record["run_end_utc"] = datetime.utcnow().isoformat() + "Z"
    log_run(run_record)

    # Step 4 — Print scraper health summary
    _print_health_summary(run_record["scrapers"])

    total_jobs = sum(
        v.get("jobs_found", 0)
        for v in run_record["scrapers"].values()
    )
    log.info(f"Orchestration complete. Total raw jobs: {total_jobs}")
    log.info("=" * 60)
    return total_jobs


# ── Health summary ────────────────────────────────────────────────────────────

def _print_health_summary(scrapers: Dict):
    """Print a clearly visible health block at the end of every run."""
    log.info("")
    log.info("SCRAPER HEALTH")
    log.info("-" * 40)

    any_warning = False
    for name, info in scrapers.items():
        status    = info.get("status",     "unknown")
        found     = info.get("jobs_found", 0)
        queries   = info.get("queries_used", 0)

        if status == "success":
            log.info(f"  {name:<10}: {found:>4} jobs  ({queries} queries)")
        elif status == "zero_results":
            log.warning(f"  {name:<10}: {found:>4} jobs  ⚠ WARNING: 0 results")
            any_warning = True
        elif status == "skipped":
            log.warning(f"  {name:<10}:    — SKIPPED ({info.get('reason', '')})")
            any_warning = True
        elif status == "error":
            log.error(  f"  {name:<10}:    — ERROR   ({info.get('error', '')[:60]})")
            any_warning = True
        else:
            log.warning(f"  {name:<10}: {found:>4} jobs  [{status}]")

    log.info("-" * 40)
    if any_warning:
        log.warning(
            "  ⚠ One or more scrapers did not return results. "
            "Verify API keys/tokens in GitHub Secrets: "
            "JSEARCH_API_KEY, SERPAPI_KEY (or SERPAPI_API_KEY), APIFY_TOKEN"
        )
    log.info("")


# ── File helpers ──────────────────────────────────────────────────────────────

def _write_output(path: Path, source: str, jobs: List[Dict]):
    path.write_text(json.dumps({
        "source":        source,
        "generated_utc": datetime.utcnow().isoformat() + "Z",
        "count":         len(jobs),
        "jobs":          jobs,
    }, indent=2))


def _write_empty(path: Path, source: str, reason: str):
    path.write_text(json.dumps({
        "source":        source,
        "generated_utc": datetime.utcnow().isoformat() + "Z",
        "count":         0,
        "error":         reason,
        "jobs":          [],
    }, indent=2))


if __name__ == "__main__":
    run()
