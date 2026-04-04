#!/usr/bin/env python3
"""
engine/scraper_orchestrator.py — JobAgent v4.3
Scraper Orchestrator

Coordinates query generation, quota management, and sequential execution
of all scrapers. Continues if any individual scraper fails.

Scraper stack (in execution order):
    1. ats_scraper       — Direct Greenhouse + Lever APIs (no quota, FREE, priority)
    2. jsearch_scraper   — JSearch/RapidAPI broad search (200 req/month)
    3. apify_scraper     — LinkedIn via harvestapi actor (Pay-per-event, ~$0.20/mo)
    4. serpapi_scraper   — Google Jobs via SerpAPI (100 searches/month, alternate days)
    5. adzuna_scraper    — Adzuna US job index (250 req/day free)

Quota notes:
    jsearch:    200 req/month → 6/day budget. Monthly cap tracked in state file
                to prevent mid-month exhaustion. Hard monthly ceiling: 180.
    apify:      2 actor runs/day. Each run passes ALL distinct job title phrases
                (not limited to 2 queries) to maximise jobs per run.
    serpapi:    100 searches/month. 5/day; scraper internally alternates days.
                Even-day skips are logged as 'skipped', not 'zero_results'.
    adzuna:     250 req/day free tier. Runs daily on all queries. Genuine aggregator
                index — different results from SerpAPI/Apify. No alternation needed.

Changes from v4.2:
    - Added industrial_operations and mechanical_thermal query clusters (query_engine)
    - Added 12 industrial/thermal ATS companies to ats_companies.json
    - Version bumped to v4.3
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

from engine.query_engine               import QueryEngine
from scrapers.ats_scraper              import AtsScraper
from scrapers.jsearch_scraper          import JSearchScraper
from scrapers.apify_scraper            import ApifyScraper
from scrapers.serpapi_scraper          import SerpApiScraper
from scrapers.adzuna_scraper           import AdzunaScraper

DATA_DIR     = ROOT / "data"
TEMP_DIR     = ROOT / "temp"
STATE_PATH   = DATA_DIR / "scraper_state.json"
RUN_LOG_PATH = DATA_DIR / "run_log.json"

TEMP_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)

# ── Daily query/run budgets ───────────────────────────────────────────────────
QUOTAS = {
    "jsearch": 30,   # daily cap; monthly cap enforced separately (3 accounts × 10)
    "serpapi":  5,   # orchestrator cap; scraper also alternates days
    "apify":    6,   # actor runs per day (3 accounts × 2)
}

# JSearch monthly hard ceiling — 3 accounts × (200 free tier − 20 buffer)
JSEARCH_MONTHLY_LIMIT = 540

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
    today         = str(date.today())
    current_month = today[:7]  # "YYYY-MM"

    if STATE_PATH.exists():
        state = json.loads(STATE_PATH.read_text())

        # Daily reset
        if state.get("last_reset") != today:
            state["jsearch"].update({"queries_today": 0})
            state.setdefault("serpapi",    {})["queries_today"]     = 0
            state.setdefault("apify",      {})["runs_today"]        = 0
            state["last_reset"] = today

        # Monthly reset — only affects jsearch monthly counter
        if state.get("month_year") != current_month:
            state.setdefault("jsearch", {})["queries_this_month"] = 0
            state["month_year"] = current_month
    else:
        state = _fresh_state(today)

    return state


def _fresh_state(today: str) -> Dict:
    return {
        "jsearch":    {"queries_today": 0, "queries_this_month": 0},
        "serpapi":    {"queries_today": 0},
        "apify":      {"runs_today":    0},
        "last_reset": today,
        "month_year": today[:7],
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
    """Return how many more queries/runs this scraper can consume today."""
    key      = "runs_today" if name == "apify" else "queries_today"
    used     = state.get(name, {}).get(key, 0)
    daily_remaining = max(0, QUOTAS[name] - used)

    # Monthly limit only applies to jsearch
    if name == "jsearch":
        used_monthly    = state.get("jsearch", {}).get("queries_this_month", 0)
        monthly_remaining = max(0, JSEARCH_MONTHLY_LIMIT - used_monthly)
        if monthly_remaining == 0:
            log.warning(
                f"[jsearch] Monthly quota reached "
                f"({used_monthly}/{JSEARCH_MONTHLY_LIMIT}). "
                f"Skipping until next month."
            )
        return min(daily_remaining, monthly_remaining)

    return daily_remaining


def deduct(name: str, count: int, state: Dict):
    key = "runs_today" if name == "apify" else "queries_today"
    state.setdefault(name, {})[key] = state[name].get(key, 0) + count

    # Also track monthly for jsearch
    if name == "jsearch":
        state["jsearch"]["queries_this_month"] = (
            state["jsearch"].get("queries_this_month", 0) + count
        )


# ── Main orchestration ────────────────────────────────────────────────────────

def run():
    log.info("=" * 60)
    log.info("JobAgent v4.3 — Scraper Orchestrator Starting")
    log.info("=" * 60)

    start_time = datetime.utcnow()
    state      = load_state()

    qe          = QueryEngine()
    all_queries: List[Dict] = qe.generate_queries()
    log.info(f"Query engine produced {len(all_queries)} queries")

    run_record: Dict = {
        "version":           "4.3",
        "run_date":          str(date.today()),
        "run_start_utc":     start_time.isoformat() + "Z",
        "queries_generated": len(all_queries),
        "scrapers":          {},
    }

    total_primary_jobs = 0

    # ── Step 1: ATS Scraper ───────────────────────────────────────────────────
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

    # ── Step 2: JSearch ───────────────────────────────────────────────────────
    jsearch_output = TEMP_DIR / "jobs_jsearch.json"
    quota = available_queries("jsearch", state)
    log.info(
        f"[jsearch] Quota remaining today: {quota} "
        f"(monthly: {state.get('jsearch', {}).get('queries_this_month', 0)}/{JSEARCH_MONTHLY_LIMIT})"
    )

    if quota <= 0:
        log.warning("[jsearch] Daily or monthly quota exhausted — skipping")
        _write_empty(jsearch_output, "jsearch", "quota_exhausted")
        run_record["scrapers"]["jsearch"] = {
            "status": "skipped", "reason": "quota_exhausted", "jobs_found": 0
        }
    else:
        try:
            scraper    = JSearchScraper()
            jobs       = scraper.run()   # uses hardcoded TITLE_QUERIES, quota managed internally
            jobs_found = len(jobs)
            _write_output(jsearch_output, "jsearch", jobs)
            # Use actual API calls fired by the scraper, not a pre-run estimate
            calls_used = scraper.calls_made
            log.info(f"  [jsearch] actual queries used this run: {calls_used}")
            deduct("jsearch", calls_used, state)
            total_primary_jobs += jobs_found

            if jobs_found == 0:
                log.warning("[jsearch] ⚠ Ran successfully but returned 0 jobs. Check API key and quota.")
                run_record["scrapers"]["jsearch"] = {
                    "status": "zero_results", "queries_used": calls_used, "jobs_found": 0
                }
            else:
                log.info(f"[jsearch] ✓ {jobs_found} jobs")
                run_record["scrapers"]["jsearch"] = {
                    "status": "success", "queries_used": calls_used, "jobs_found": jobs_found
                }
        except Exception as exc:
            log.error(f"[jsearch] Scraper raised an exception: {exc}")
            log.warning(f"[jsearch] Full traceback:\n{traceback.format_exc()}")
            _write_empty(jsearch_output, "jsearch", str(exc))
            run_record["scrapers"]["jsearch"] = {
                "status": "error", "error": str(exc), "jobs_found": 0
            }

    # ── Step 3: Apify — pass ALL queries (not limited by run quota) ───────────
    # The apify quota tracks actor runs (not job titles). Each actor run can
    # accept all 8+ distinct job titles at once. Pass all_queries so every
    # cluster is covered in a single run.
    apify_output = TEMP_DIR / "jobs_apify.json"
    apify_quota  = available_queries("apify", state)
    log.info(f"[apify] Quota remaining today: {apify_quota} actor run(s)")

    if apify_quota <= 0:
        log.warning("[apify] Daily quota exhausted — skipping")
        _write_empty(apify_output, "apify", "quota_exhausted")
        run_record["scrapers"]["apify"] = {
            "status": "skipped", "reason": "quota_exhausted", "jobs_found": 0
        }
    else:
        try:
            scraper    = ApifyScraper()
            jobs       = scraper.run(all_queries)   # all clusters → all distinct titles
            jobs_found = len(jobs)
            _write_output(apify_output, "apify", jobs)
            deduct("apify", 1, state)               # 1 actor run consumed
            total_primary_jobs += jobs_found

            if jobs_found == 0:
                log.warning("[apify] ⚠ Ran successfully but returned 0 jobs. Check APIFY_TOKEN.")
                run_record["scrapers"]["apify"] = {
                    "status": "zero_results", "queries_used": 1, "jobs_found": 0
                }
            else:
                log.info(f"[apify] ✓ {jobs_found} jobs from {len(all_queries)} queries")
                run_record["scrapers"]["apify"] = {
                    "status": "success", "queries_used": len(all_queries), "jobs_found": jobs_found
                }
        except Exception as exc:
            log.error(f"[apify] Scraper raised an exception: {exc}")
            log.warning(f"[apify] Full traceback:\n{traceback.format_exc()}")
            _write_empty(apify_output, "apify", str(exc))
            run_record["scrapers"]["apify"] = {
                "status": "error", "error": str(exc), "jobs_found": 0
            }

    # ── Step 4: SerpAPI — check even-day gate before running ─────────────────
    serpapi_output = TEMP_DIR / "jobs_serpapi.json"
    serpapi_quota  = available_queries("serpapi", state)

    if SerpApiScraper.is_scheduled_off():
        today_ord = date.today().toordinal()
        log.info(
            f"[serpapi] Even-ordinal day ({today_ord}) — scheduled OFF. "
            f"Runs on odd days to stay within 100 searches/month. "
            f"Set SERPAPI_FORCE_RUN=1 to override."
        )
        _write_empty(serpapi_output, "serpapi", "scheduled_off")
        run_record["scrapers"]["serpapi"] = {
            "status": "skipped", "reason": "scheduled_off", "jobs_found": 0
        }
    elif serpapi_quota <= 0:
        log.warning("[serpapi] Daily quota exhausted — skipping")
        _write_empty(serpapi_output, "serpapi", "quota_exhausted")
        run_record["scrapers"]["serpapi"] = {
            "status": "skipped", "reason": "quota_exhausted", "jobs_found": 0
        }
    else:
        log.info(f"[serpapi] Quota remaining today: {serpapi_quota}")
        batch = all_queries[:serpapi_quota]
        try:
            scraper    = SerpApiScraper()
            jobs       = scraper.run(batch)
            jobs_found = len(jobs)
            _write_output(serpapi_output, "serpapi", jobs)
            deduct("serpapi", len(batch), state)
            total_primary_jobs += jobs_found

            if jobs_found == 0:
                log.warning("[serpapi] ⚠ Ran but returned 0 jobs. Check SERPAPI_KEY and quota.")
                run_record["scrapers"]["serpapi"] = {
                    "status": "zero_results", "queries_used": len(batch), "jobs_found": 0
                }
            else:
                log.info(f"[serpapi] ✓ {jobs_found} jobs from {len(batch)} queries")
                run_record["scrapers"]["serpapi"] = {
                    "status": "success", "queries_used": len(batch), "jobs_found": jobs_found
                }
        except Exception as exc:
            log.error(f"[serpapi] Scraper raised an exception: {exc}")
            log.warning(f"[serpapi] Full traceback:\n{traceback.format_exc()}")
            _write_empty(serpapi_output, "serpapi", str(exc))
            run_record["scrapers"]["serpapi"] = {
                "status": "error", "error": str(exc), "jobs_found": 0
            }

    # ── Step 5: Adzuna — daily always-on (250 req/day free tier) ─────────────
    log.info("[adzuna] Running. Quota: 250 req/day free tier.")
    adzuna_output = TEMP_DIR / "jobs_adzuna.json"
    try:
        adzuna_scraper = AdzunaScraper()
        adzuna_jobs    = adzuna_scraper.run(queries=all_queries)
        az_count = len(adzuna_jobs)
        _write_output(adzuna_output, "adzuna", adzuna_jobs)
        log.info(f"[adzuna] ✓ {az_count} jobs collected")
        run_record["scrapers"]["adzuna"] = {
            "status": "success", "jobs_found": az_count,
            "queries_used": len(all_queries),
        }
    except Exception as exc:
        log.error(f"[adzuna] Scraper raised an exception: {exc}")
        log.warning(f"[adzuna] Full traceback:\n{traceback.format_exc()}")
        _write_empty(adzuna_output, "adzuna", str(exc))
        run_record["scrapers"]["adzuna"] = {
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
    log.info("SCRAPER HEALTH  (JobAgent v4.3)")
    log.info("-" * 48)

    any_warning    = False
    display_order  = ["ats", "jsearch", "apify", "serpapi", "adzuna"]

    for name in display_order:
        info    = scrapers.get(name, {})
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
        elif status == "error":
            log.error(f"  {'['+name+']':<16} ✗   —        ERROR ({info.get('error','')[:50]})")
            any_warning = True
        elif status == "not_run":
            log.info(f"  {'['+name+']':<16}    —        (not run)")

    log.info("-" * 48)

    if any_warning:
        log.warning(
            "  ⚠ One or more scrapers had issues. Check GitHub Secrets:\n"
            "    JSEARCH_API_KEY, SERPAPI_KEY, APIFY_TOKEN"
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
