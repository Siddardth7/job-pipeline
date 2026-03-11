#!/usr/bin/env python3
"""
engine/scraper_orchestrator.py — JobAgent v4.1
Scraper Orchestrator

Coordinates query generation, quota management, and sequential execution
of all 5 scrapers. Continues if any individual scraper fails.

Scraper stack (in execution order):
    1. ats_scraper       — Direct Greenhouse + Lever APIs (no quota, FREE, priority)
    2. jsearch_scraper   — JSearch/RapidAPI broad search (200 req/month)
    3. apify_scraper     — LinkedIn via harvestapi actor (Pay-per-event, ~$0.20/mo)
    4. serpapi_scraper   — Google Jobs via SerpAPI (100 searches/month, alternate days)
    5. theirstack_scraper— TheirStack backup (200 credits/month, CONDITIONAL only)

TheirStack activation:
    Runs daily with a 6 jobs/day budget (200 credits/month free tier ÷ 30 days).

Changes from v4.0:
    - Added ats_scraper (scraper 1 — always runs first, no quota)
    - Added theirstack_scraper (scraper 5 — conditional fallback)
    - serpapi now runs every day (day-alternation removed)
    - State tracking expanded for ats and theirstack
    - Health summary updated for all 5 scrapers
    - Version bumped to v4.1
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

from engine.query_engine              import QueryEngine
from scrapers.ats_scraper             import AtsScraper
from scrapers.jsearch_scraper         import JSearchScraper
from scrapers.apify_scraper           import ApifyScraper
from scrapers.serpapi_scraper         import SerpApiScraper
from scrapers.theirstack_scraper      import TheirStackScraper

DATA_DIR     = ROOT / "data"
TEMP_DIR     = ROOT / "temp"
STATE_PATH   = DATA_DIR / "scraper_state.json"
RUN_LOG_PATH = DATA_DIR / "run_log.json"

TEMP_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)

# ── Daily query/run budgets ───────────────────────────────────────────────────
# Quotas removed — all scrapers run unrestricted for full monitoring coverage.
# ats:        No quota — direct free APIs, unlimited.
# jsearch:    No daily cap — runs full batch rotation every day.
# apify:      No daily cap — runs every day.
# serpapi:    No daily cap — runs every day (day-alternation also removed in scraper).
# theirstack: 200 credits/month (1 credit/job). Runs daily at 6 jobs/day budget.
QUOTAS: dict = {}  # Empty — quota checks disabled; all scrapers always run

# TheirStack now runs daily — no threshold gating

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
        "jsearch":     {"queries_today": 0},
        "serpapi":     {"queries_today": 0},
        "apify":       {"runs_today":    0},
        "theirstack":  {"activations_today": 0},
        "last_reset":  today,
    }


def save_state(state: Dict):
    STATE_PATH.write_text(json.dumps(state, indent=2))


def log_run(run_record: Dict):
    records = json.loads(RUN_LOG_PATH.read_text()) if RUN_LOG_PATH.exists() else []
    records.append(run_record)
    records = records[-90:]
    RUN_LOG_PATH.write_text(json.dumps(records, indent=2))


# ── Quota helpers ─────────────────────────────────────────────────────────────

def available_queries(name: str, state: Dict) -> int:
    """Always returns a large number — quotas have been removed."""
    return 9999


def deduct(name: str, count: int, state: Dict):
    """No-op — quota tracking disabled."""
    pass


# ── Main orchestration ────────────────────────────────────────────────────────

def run():
    log.info("=" * 60)
    log.info("JobAgent v4.1 — Scraper Orchestrator Starting")
    log.info("=" * 60)

    start_time = datetime.utcnow()
    state      = load_state()

    qe          = QueryEngine()
    all_queries: List[Dict] = qe.generate_queries()
    log.info(f"Query engine produced {len(all_queries)} queries")

    run_record: Dict = {
        "version":          "4.1",
        "run_date":         str(date.today()),
        "run_start_utc":    start_time.isoformat() + "Z",
        "queries_generated": len(all_queries),
        "scrapers":         {},
    }

    total_primary_jobs = 0

    # ── Step 1: ATS Scraper (no quota, always runs first) ─────────────────────
    log.info("[ats] Starting ATS direct scraper (Greenhouse + Lever)...")
    ats_jobs = []
    try:
        scraper  = AtsScraper()
        ats_jobs = scraper.run()
        _write_output(TEMP_DIR / "jobs_ats.json", "ats", ats_jobs)
        count = len(ats_jobs)
        total_primary_jobs += count
        if count == 0:
            log.warning("[ats] ⚠ 0 jobs returned. Check company slugs and network access.")
            run_record["scrapers"]["ats"] = {"status": "zero_results", "jobs_found": 0}
        else:
            log.info(f"[ats] ✓ {count} jobs from direct ATS APIs")
            run_record["scrapers"]["ats"] = {"status": "success", "jobs_found": count}
    except Exception as exc:
        log.error(f"[ats] Scraper raised an exception: {exc}")
        log.warning(f"[ats] Full traceback:\n{traceback.format_exc()}")
        _write_empty(TEMP_DIR / "jobs_ats.json", "ats", str(exc))
        run_record["scrapers"]["ats"] = {"status": "error", "error": str(exc), "jobs_found": 0}

    # ── Steps 2–4: Quota-managed scrapers ─────────────────────────────────────
    quota_scrapers = [
        ("jsearch", JSearchScraper,  TEMP_DIR / "jobs_jsearch.json"),
        ("apify",   ApifyScraper,    TEMP_DIR / "jobs_apify.json"),
        ("serpapi", SerpApiScraper,  TEMP_DIR / "jobs_serpapi.json"),
    ]

    for name, ScraperClass, output_path in quota_scrapers:
        quota = available_queries(name, state)

        try:
            scraper    = ScraperClass()
            jobs       = scraper.run(all_queries)
            jobs_found = len(jobs)

            _write_output(output_path, name, jobs)
            total_primary_jobs += jobs_found

            if jobs_found == 0:
                log.warning(
                    f"[{name}] ⚠ Ran successfully but returned 0 jobs. "
                    f"Check API key, quota, and input parameters."
                )
                run_record["scrapers"][name] = {
                    "status": "zero_results", "queries_used": len(all_queries), "jobs_found": 0
                }
            else:
                log.info(f"[{name}] ✓ {jobs_found} jobs from {len(all_queries)} queries")
                run_record["scrapers"][name] = {
                    "status": "success", "queries_used": len(all_queries), "jobs_found": jobs_found
                }

        except Exception as exc:
            log.error(f"[{name}] Scraper raised an exception: {exc}")
            log.warning(f"[{name}] Full traceback:\n{traceback.format_exc()}")
            _write_empty(output_path, name, str(exc))
            run_record["scrapers"][name] = {
                "status": "error", "error": str(exc), "jobs_found": 0
            }

    # ── Step 5: TheirStack — runs daily (6 jobs/day budget) ──────────────────
    log.info(
        f"[theirstack] Running daily. Primary scrapers found {total_primary_jobs} jobs."
    )
    theirstack_output = TEMP_DIR / "jobs_theirstack.json"
    try:
        ts_scraper = TheirStackScraper()
        ts_jobs    = ts_scraper.run(
            queries=all_queries,
            total_primary_jobs=total_primary_jobs,
        )
        ts_count = len(ts_jobs)
        _write_output(theirstack_output, "theirstack", ts_jobs)

        if ts_count > 0:
            state.setdefault("theirstack", {})
            state["theirstack"]["activations_today"] = (
                state["theirstack"].get("activations_today", 0) + 1
            )
            total_primary_jobs += ts_count
            log.info(f"[theirstack] ✓ {ts_count} jobs added")
            run_record["scrapers"]["theirstack"] = {
                "status":    "success",
                "jobs_found": ts_count,
            }
        else:
            run_record["scrapers"]["theirstack"] = {
                "status": "zero_results", "jobs_found": 0
            }

    except Exception as exc:
        log.error(f"[theirstack] Scraper raised an exception: {exc}")
        log.warning(f"[theirstack] Full traceback:\n{traceback.format_exc()}")
        _write_empty(theirstack_output, "theirstack", str(exc))
        run_record["scrapers"]["theirstack"] = {
            "status": "error", "error": str(exc), "jobs_found": 0
        }

    # ── Finalise ──────────────────────────────────────────────────────────────
    save_state(state)
    run_record["run_end_utc"] = datetime.utcnow().isoformat() + "Z"
    log_run(run_record)

    _print_health_summary(run_record["scrapers"])

    grand_total = sum(v.get("jobs_found", 0) for v in run_record["scrapers"].values())
    log.info(f"Orchestration complete. Total raw jobs: {grand_total}")
    log.info("=" * 60)
    return grand_total


# ── Health summary ────────────────────────────────────────────────────────────

def _print_health_summary(scrapers: Dict):
    log.info("")
    log.info("SCRAPER HEALTH  (JobAgent v4.1)")
    log.info("-" * 48)

    any_warning = False
    display_order = ["ats", "jsearch", "apify", "serpapi", "theirstack"]

    for name in display_order:
        info = scrapers.get(name, {})
        status  = info.get("status",     "not_run")
        found   = info.get("jobs_found", 0)
        queries = info.get("queries_used", "—")

        if status == "success":
            log.info(f"  {'['+name+']':<16} ✓  {found:>4} jobs  ({queries} queries)")
        elif status == "activated":
            log.info(f"  {'['+name+']':<16} ✓  {found:>4} jobs  [BACKUP ACTIVATED]")
        elif status == "zero_results":
            log.warning(f"  {'['+name+']':<16} ⚠   {found:>3} jobs  WARNING: 0 results")
            any_warning = True
        elif status == "skipped":
            reason = info.get("reason", "")
            log.info(f"  {'['+name+']':<16}    —        SKIPPED ({reason})")
            # Only flag as warning if skipped for a non-quota reason
            if reason not in ("quota_exhausted",):
                any_warning = True
        elif status == "error":
            log.error(f"  {'['+name+']':<16} ✗   —        ERROR ({info.get('error','')[:50]})")
            any_warning = True
        elif status == "not_run":
            log.info(f"  {'['+name+']':<16}    —        (not run)")

    log.info("-" * 48)

    if any_warning:
        # Only mention the scrapers that actually had issues (not quota-skipped ones)
        problem_scrapers = [
            name for name in display_order
            if scrapers.get(name, {}).get("status") in ("zero_results", "error")
        ]
        if problem_scrapers:
            log.warning(
                f"  ⚠ One or more scrapers had issues ({', '.join(problem_scrapers)}). "
                f"Check GitHub Secrets:\n"
                f"    JSEARCH_API_KEY, SERPAPI_KEY, APIFY_TOKEN, THEIRSTACK_API_KEY"
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
