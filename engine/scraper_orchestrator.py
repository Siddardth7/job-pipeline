#!/usr/bin/env python3
"""
engine/scraper_orchestrator.py — JobAgent v2 Scraper Orchestrator

Coordinates query generation, API quota management, and sequential
scraper execution. Continues if any individual scraper fails.

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

# Allow imports from project root
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from engine.query_engine import QueryEngine
from scrapers.jsearch_scraper import JSearchScraper
from scrapers.serpapi_scraper import SerpApiScraper
from scrapers.apify_scraper import ApifyScraper

DATA_DIR = ROOT / "data"
TEMP_DIR = ROOT / "temp"
STATE_PATH = DATA_DIR / "scraper_state.json"
RUN_LOG_PATH = DATA_DIR / "run_log.json"

TEMP_DIR.mkdir(exist_ok=True)

# API daily quotas (free / low-cost tiers)
QUOTAS = {
    "jsearch": 10,   # RapidAPI free: 200/month → ~6/day, buffer to 10
    "serpapi": 10,   # SerpApi free: 100/month → ~3/day, buffer to 10
    "apify":   2,    # Apify runs (actor compute units)
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(ROOT / "orchestrator.log"),
        logging.StreamHandler()
    ]
)
log = logging.getLogger("orchestrator")


# ── State helpers ─────────────────────────────────────────────────────────────

def load_state() -> Dict:
    today = str(date.today())
    if STATE_PATH.exists():
        state = json.loads(STATE_PATH.read_text())
        # Reset counters if it's a new day
        if state.get("last_reset") != today:
            state = {
                "jsearch": {"queries_today": 0},
                "serpapi": {"queries_today": 0},
                "apify":   {"runs_today": 0},
                "last_reset": today
            }
    else:
        state = {
            "jsearch": {"queries_today": 0},
            "serpapi": {"queries_today": 0},
            "apify":   {"runs_today": 0},
            "last_reset": today
        }
    return state


def save_state(state: Dict):
    STATE_PATH.write_text(json.dumps(state, indent=2))


def log_run(run_record: Dict):
    records = json.loads(RUN_LOG_PATH.read_text()) if RUN_LOG_PATH.exists() else []
    records.append(run_record)
    # Keep last 90 days
    records = records[-90:]
    RUN_LOG_PATH.write_text(json.dumps(records, indent=2))


# ── Quota helpers ─────────────────────────────────────────────────────────────

def available_queries(scraper_name: str, state: Dict) -> int:
    key = "runs_today" if scraper_name == "apify" else "queries_today"
    used = state[scraper_name].get(key, 0)
    return max(0, QUOTAS[scraper_name] - used)


def deduct(scraper_name: str, count: int, state: Dict):
    key = "runs_today" if scraper_name == "apify" else "queries_today"
    state[scraper_name][key] = state[scraper_name].get(key, 0) + count


# ── Main orchestration ────────────────────────────────────────────────────────

def run():
    log.info("=" * 60)
    log.info("JobAgent v2 — Scraper Orchestrator Starting")
    log.info("=" * 60)

    start_time = datetime.utcnow()
    state = load_state()

    # Step 1 — Generate queries
    qe = QueryEngine()
    all_queries: List[Dict] = qe.generate_queries()
    log.info(f"Query engine produced {len(all_queries)} queries")

    run_record = {
        "run_date": str(date.today()),
        "run_start_utc": start_time.isoformat() + "Z",
        "queries_generated": len(all_queries),
        "scrapers": {}
    }

    # Step 2 — Run each scraper sequentially
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
            run_record["scrapers"][name] = {"status": "skipped", "reason": "quota_exhausted"}
            continue

        # Allocate queries proportional to quota
        batch = all_queries[:quota]

        try:
            scraper = ScraperClass()
            jobs = scraper.run(batch)
            _write_output(output_path, name, jobs)
            deduct(name, len(batch), state)

            run_record["scrapers"][name] = {
                "status": "success",
                "queries_used": len(batch),
                "jobs_found": len(jobs)
            }
            log.info(f"[{name}] ✓ {len(jobs)} jobs found using {len(batch)} queries")

        except Exception as exc:
            log.error(f"[{name}] Scraper failed: {exc}")
            log.debug(traceback.format_exc())
            _write_empty(output_path, name, str(exc))
            run_record["scrapers"][name] = {"status": "error", "error": str(exc)}

    # Step 3 — Persist state and log
    save_state(state)
    run_record["run_end_utc"] = datetime.utcnow().isoformat() + "Z"
    log_run(run_record)

    total_jobs = sum(
        run_record["scrapers"].get(s, {}).get("jobs_found", 0)
        for s, _, _ in scrapers
    )
    log.info("=" * 60)
    log.info(f"Orchestration complete. Total raw jobs: {total_jobs}")
    log.info("=" * 60)

    return total_jobs


# ── File helpers ──────────────────────────────────────────────────────────────

def _write_output(path: Path, source: str, jobs: List[Dict]):
    payload = {
        "source": source,
        "generated_utc": datetime.utcnow().isoformat() + "Z",
        "count": len(jobs),
        "jobs": jobs
    }
    path.write_text(json.dumps(payload, indent=2))


def _write_empty(path: Path, source: str, reason: str):
    payload = {
        "source": source,
        "generated_utc": datetime.utcnow().isoformat() + "Z",
        "count": 0,
        "error": reason,
        "jobs": []
    }
    path.write_text(json.dumps(payload, indent=2))


if __name__ == "__main__":
    run()
