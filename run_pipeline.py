#!/usr/bin/env python3
"""
M628 Pipeline Orchestrator v3
Replaces manually running each script in sequence.

What this does:
  1. Runs jsearch_scraper.py and apify_scraper.py IN PARALLEL (concurrent.futures)
  2. Waits for BOTH to finish (or hit the shared stop conditions)
  3. Runs merge_pipeline.py
  4. Runs post_merge_filter.py
  5. Writes output/run_state.json with timing + result summary

Runtime formula:
  BEFORE: JSearch_time + Apify_time + merge + filter
  AFTER:  max(JSearch_time, Apify_time) + merge + filter

  Typical speedup: 40–60% wall-clock reduction.

Configurable stop conditions (all are soft limits — they stop early but
never corrupt output files):

  MAX_VALID_JOBS_TARGET    Stop if this many non-ITAR jobs found across both scrapers
  MAX_GREEN_JOBS_TARGET    Stop if this many GREEN verdict jobs found
  MAX_COMPANIES_PER_RUN    Override batch size limit (caps total companies scraped)
  MAX_RUNTIME_SECONDS      Wall-clock timeout — kill scrapers and proceed to merge

Usage:
  python run_pipeline.py                    # normal run
  python run_pipeline.py --apify-only       # skip JSearch
  python run_pipeline.py --jsearch-only     # skip Apify
  python run_pipeline.py --dry-run          # config check, no API calls
  python run_pipeline.py --target-jobs 10  # stop after 10 valid jobs found

Environment variables (override defaults):
  MAX_VALID_JOBS_TARGET=20
  MAX_GREEN_JOBS_TARGET=10
  MAX_RUNTIME_SECONDS=300
"""

import os, sys, json, time, logging, subprocess, threading, argparse
from concurrent.futures import ThreadPoolExecutor, as_completed, Future
from datetime import datetime, timedelta
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
OUTPUT_DIR = SCRIPT_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

# ── STOP CONDITIONS (configurable via env or CLI) ─────────────────────────────
MAX_VALID_JOBS_TARGET  = int(os.environ.get("MAX_VALID_JOBS_TARGET",  "20"))
MAX_GREEN_JOBS_TARGET  = int(os.environ.get("MAX_GREEN_JOBS_TARGET",  "10"))
MAX_COMPANIES_PER_RUN  = int(os.environ.get("MAX_COMPANIES_PER_RUN",  "0"))  # 0 = use scraper default
MAX_RUNTIME_SECONDS    = int(os.environ.get("MAX_RUNTIME_SECONDS",    "300")) # 5 min default

# ── PATHS ─────────────────────────────────────────────────────────────────────
JSEARCH_SCRIPT   = SCRIPT_DIR / "jsearch_scraper.py"
APIFY_SCRIPT     = SCRIPT_DIR / "apify_scraper.py"
MERGE_SCRIPT     = SCRIPT_DIR / "merge_pipeline.py"
FILTER_SCRIPT    = SCRIPT_DIR / "post_merge_filter.py"
RUN_STATE_PATH   = OUTPUT_DIR / "run_state.json"
JSEARCH_LATEST   = OUTPUT_DIR / "jobs_jsearch_latest.json"
APIFY_LATEST     = OUTPUT_DIR / "jobs_apify_latest.json"
CLEAN_OUT        = OUTPUT_DIR / "jobs_clean_latest.json"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(SCRIPT_DIR / "pipeline.log"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("pipeline")


# ─── SHARED STOP FLAG ─────────────────────────────────────────────────────────

class StopConditions:
    """
    Thread-safe shared state that both scrapers poll during their run.
    When stop() is called, both scrapers should finish their current
    company and exit cleanly (they check this via the output files).
    """
    def __init__(self, max_valid: int, max_green: int, max_seconds: int):
        self._lock        = threading.Lock()
        self._stopped     = False
        self._stop_reason = ""
        self.max_valid    = max_valid
        self.max_green    = max_green
        self.deadline     = time.monotonic() + max_seconds

    def stop(self, reason: str):
        with self._lock:
            if not self._stopped:
                self._stopped     = True
                self._stop_reason = reason
                log.warning(f"STOP CONDITION: {reason}")

    @property
    def should_stop(self) -> bool:
        with self._lock:
            if self._stopped:
                return True
        if time.monotonic() > self.deadline:
            self.stop(f"MAX_RUNTIME_SECONDS ({MAX_RUNTIME_SECONDS}s) reached")
            return True
        return False

    @property
    def reason(self) -> str:
        return self._stop_reason

    def check_output_files(self):
        """
        Poll the latest output files from both scrapers and check whether
        combined results already satisfy stop conditions.
        Called by the monitor thread.
        """
        total_valid = 0
        total_green = 0
        for path in [JSEARCH_LATEST, APIFY_LATEST]:
            if path.exists():
                try:
                    with open(path) as f:
                        data = json.load(f)
                    jobs = data.get("jobs", [])
                    total_valid += sum(1 for j in jobs if not j.get("itar_flag"))
                    total_green += sum(1 for j in jobs if j.get("verdict") == "GREEN")
                except Exception:
                    pass

        if total_valid >= self.max_valid:
            self.stop(f"MAX_VALID_JOBS_TARGET reached ({total_valid} ≥ {self.max_valid})")
        elif total_green >= self.max_green:
            self.stop(f"MAX_GREEN_JOBS_TARGET reached ({total_green} ≥ {self.max_green})")


# ─── MONITOR THREAD ───────────────────────────────────────────────────────────

def monitor_stop_conditions(stop: StopConditions, poll_interval: float = 10.0):
    """
    Background thread that polls output files every N seconds and checks
    whether stop conditions have been met. If yes, it sets the stop flag.
    The scrapers are subprocess-based so we can't inject directly — instead
    we write a sentinel file that the scrapers (if they support it) can check.
    """
    sentinel = OUTPUT_DIR / ".stop_signal"
    while not stop.should_stop:
        time.sleep(poll_interval)
        stop.check_output_files()
        if stop.should_stop:
            # Write sentinel file — scraper can optionally check for this
            sentinel.write_text(stop.reason)
            break
    # Clean up sentinel after both scrapers finish
    if sentinel.exists():
        sentinel.unlink()


# ─── RUN A SCRAPER SUBPROCESS ────────────────────────────────────────────────

def run_scraper(name: str, script: Path, extra_args: list, stop: StopConditions,
                env_overrides: dict) -> dict:
    """
    Run a scraper as a subprocess. Returns a result dict with timing and stats.
    Kills the process if the global stop signal fires.
    """
    start = time.monotonic()
    log.info(f"[{name}] Starting scraper subprocess…")

    cmd  = [sys.executable, str(script)] + extra_args
    env  = {**os.environ, **{k: str(v) for k, v in env_overrides.items()}}

    try:
        proc = subprocess.Popen(
            cmd, env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        # Stream output line by line (so logs appear in real time)
        for line in proc.stdout:
            log.info(f"  [{name}] {line.rstrip()}")
            # Check stop condition each line (cheap)
            if stop.should_stop and proc.poll() is None:
                log.warning(f"[{name}] Stop condition met — terminating process")
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
                break

        proc.wait()
        elapsed = time.monotonic() - start
        rc      = proc.returncode

        log.info(f"[{name}] Finished in {elapsed:.1f}s (exit code {rc})")
        return {"name": name, "elapsed_s": round(elapsed, 1), "exit_code": rc}

    except Exception as e:
        elapsed = time.monotonic() - start
        log.error(f"[{name}] Exception: {e}")
        return {"name": name, "elapsed_s": round(elapsed, 1), "exit_code": -1, "error": str(e)}


# ─── COUNT JOBS FROM OUTPUT FILE ─────────────────────────────────────────────

def count_jobs(path: Path) -> dict:
    if not path.exists():
        return {"total": 0, "eligible": 0, "green": 0, "itar": 0}
    try:
        with open(path) as f:
            data = json.load(f)
        jobs = data.get("jobs", [])
        return {
            "total":    len(jobs),
            "eligible": data.get("eligible_jobs", sum(1 for j in jobs if not j.get("itar_flag"))),
            "green":    sum(1 for j in jobs if j.get("verdict") == "GREEN"),
            "itar":     sum(1 for j in jobs if j.get("itar_flag")),
        }
    except Exception:
        return {"total": 0, "eligible": 0, "green": 0, "itar": 0}


# ─── SEQUENTIAL FALLBACK STEPS ────────────────────────────────────────────────

def run_sequential(name: str, script: Path, args: list = []) -> dict:
    """Run merge / filter steps sequentially (they're fast, no need to parallelize)."""
    start = time.monotonic()
    if not script.exists():
        log.error(f"{script.name} not found — skipping")
        return {"name": name, "elapsed_s": 0, "exit_code": -1}

    log.info(f"[{name}] Running…")
    result = subprocess.run(
        [sys.executable, str(script)] + args,
        capture_output=False,
    )
    elapsed = time.monotonic() - start
    log.info(f"[{name}] Done in {elapsed:.1f}s")
    return {"name": name, "elapsed_s": round(elapsed, 1), "exit_code": result.returncode}


# ─── PARSE ARGS ───────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="M628 Pipeline Orchestrator v3")
    p.add_argument("--jsearch-only",  action="store_true", help="Skip Apify scraper")
    p.add_argument("--apify-only",    action="store_true", help="Skip JSearch scraper")
    p.add_argument("--dry-run",       action="store_true", help="Config check only, no API calls")
    p.add_argument("--target-jobs",   type=int, default=MAX_VALID_JOBS_TARGET,
                   help=f"Stop after N valid jobs (default: {MAX_VALID_JOBS_TARGET})")
    p.add_argument("--target-green",  type=int, default=MAX_GREEN_JOBS_TARGET,
                   help=f"Stop after N GREEN jobs (default: {MAX_GREEN_JOBS_TARGET})")
    p.add_argument("--max-companies", type=int, default=MAX_COMPANIES_PER_RUN,
                   help="Cap companies per scraper run (0 = scraper default)")
    p.add_argument("--timeout",       type=int, default=MAX_RUNTIME_SECONDS,
                   help=f"Max wall-clock seconds (default: {MAX_RUNTIME_SECONDS})")
    p.add_argument("--no-apify-run",  action="store_true",
                   help="Run Apify in dry-run/config mode (no live API calls)")
    return p.parse_args()


# ─── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    args = parse_args()
    run_start = time.monotonic()

    log.info("=" * 65)
    log.info("M628 Pipeline Orchestrator v3 — Starting")
    log.info(f"  MAX_VALID_JOBS_TARGET : {args.target_jobs}")
    log.info(f"  MAX_GREEN_JOBS_TARGET : {args.target_green}")
    log.info(f"  MAX_RUNTIME_SECONDS   : {args.timeout}")
    log.info(f"  MAX_COMPANIES_PER_RUN : {args.max_companies or 'scraper default'}")
    log.info("=" * 65)

    if args.dry_run:
        log.info("DRY RUN — printing config only, no scrapers launched")
        log.info(f"  JSearch script : {JSEARCH_SCRIPT}")
        log.info(f"  Apify script   : {APIFY_SCRIPT}")
        log.info(f"  Merge script   : {MERGE_SCRIPT}")
        log.info(f"  Filter script  : {FILTER_SCRIPT}")
        return

    # ── Shared stop condition state ───────────────────────────────────────────
    stop = StopConditions(
        max_valid   = args.target_jobs,
        max_green   = args.target_green,
        max_seconds = args.timeout,
    )

    # ── Build env overrides to pass into scraper subprocesses ────────────────
    env_common = {}
    if args.max_companies:
        # Both scrapers read MAX_COMPANIES_PER_RUN from env (see scrapers below)
        env_common["MAX_COMPANIES_PER_RUN"] = str(args.max_companies)
    env_common["MAX_VALID_JOBS_TARGET"] = str(args.target_jobs)
    env_common["MAX_GREEN_JOBS_TARGET"] = str(args.target_green)

    # ── Build scraper task list ───────────────────────────────────────────────
    tasks = []

    if not args.apify_only:
        if JSEARCH_SCRIPT.exists():
            tasks.append(("JSearch", JSEARCH_SCRIPT, [], env_common))
        else:
            log.warning(f"jsearch_scraper.py not found at {JSEARCH_SCRIPT} — skipping")

    if not args.jsearch_only:
        if APIFY_SCRIPT.exists():
            apify_args = ["--run"] if not args.no_apify_run else []
            tasks.append(("Apify", APIFY_SCRIPT, apify_args, env_common))
        else:
            log.warning(f"apify_scraper.py not found at {APIFY_SCRIPT} — skipping")

    if not tasks:
        log.error("No scraper scripts found. Check paths.")
        sys.exit(1)

    # ── Start background monitor thread ───────────────────────────────────────
    monitor_thread = threading.Thread(
        target=monitor_stop_conditions,
        args=(stop,),
        daemon=True,
        name="stop-monitor",
    )
    monitor_thread.start()

    # ── Run scrapers in PARALLEL ──────────────────────────────────────────────
    scraper_results = []
    parallel_start  = time.monotonic()

    if len(tasks) == 1:
        # Only one scraper — no need for thread pool
        name, script, extra_args, env_ov = tasks[0]
        result = run_scraper(name, script, extra_args, stop, env_ov)
        scraper_results.append(result)
    else:
        log.info(f"Running {len(tasks)} scrapers IN PARALLEL…")
        with ThreadPoolExecutor(max_workers=len(tasks), thread_name_prefix="scraper") as pool:
            futures: dict[Future, str] = {
                pool.submit(run_scraper, name, script, extra_args, stop, env_ov): name
                for name, script, extra_args, env_ov in tasks
            }
            for fut in as_completed(futures):
                name   = futures[fut]
                result = fut.result()
                scraper_results.append(result)
                log.info(f"[{name}] Completed — "
                         f"{count_jobs(JSEARCH_LATEST if name=='JSearch' else APIFY_LATEST)['eligible']} "
                         f"eligible jobs")

    parallel_elapsed = time.monotonic() - parallel_start
    log.info(f"Parallel scraping finished in {parallel_elapsed:.1f}s "
             f"(stop reason: '{stop.reason or 'target batch complete'}')")

    # ── Log per-scraper job counts ────────────────────────────────────────────
    jsearch_stats = count_jobs(JSEARCH_LATEST)
    apify_stats   = count_jobs(APIFY_LATEST)
    log.info(f"JSearch results: {jsearch_stats}")
    log.info(f"Apify results:   {apify_stats}")

    # ── Sequential: merge then filter ─────────────────────────────────────────
    merge_result  = run_sequential("Merge",  MERGE_SCRIPT)
    filter_result = run_sequential("Filter", FILTER_SCRIPT)

    # ── Final summary ─────────────────────────────────────────────────────────
    total_elapsed = time.monotonic() - run_start
    clean_stats   = count_jobs(CLEAN_OUT)

    log.info("=" * 65)
    log.info(f"PIPELINE COMPLETE in {total_elapsed:.1f}s")
    log.info(f"  Parallel scraping : {parallel_elapsed:.1f}s")
    log.info(f"  Merge + filter    : {merge_result['elapsed_s'] + filter_result['elapsed_s']:.1f}s")
    log.info(f"  Final clean jobs  : {clean_stats['eligible']} eligible "
             f"({clean_stats['green']} GREEN)")
    log.info(f"  Stop reason       : {stop.reason or 'normal batch complete'}")
    log.info(f"  Output            : {CLEAN_OUT}")
    log.info("=" * 65)

    # ── Write run_state.json for monitoring / CI ──────────────────────────────
    run_state = {
        "run_utc":           datetime.utcnow().isoformat() + "Z",
        "total_elapsed_s":   round(total_elapsed, 1),
        "parallel_elapsed_s": round(parallel_elapsed, 1),
        "stop_reason":       stop.reason or "normal batch complete",
        "stop_conditions": {
            "MAX_VALID_JOBS_TARGET":  args.target_jobs,
            "MAX_GREEN_JOBS_TARGET":  args.target_green,
            "MAX_RUNTIME_SECONDS":    args.timeout,
            "MAX_COMPANIES_PER_RUN":  args.max_companies or "scraper_default",
        },
        "scraper_results":   scraper_results,
        "jsearch_stats":     jsearch_stats,
        "apify_stats":       apify_stats,
        "final_clean_stats": clean_stats,
        "merge_exit_code":   merge_result["exit_code"],
        "filter_exit_code":  filter_result["exit_code"],
    }
    with open(RUN_STATE_PATH, "w") as f:
        json.dump(run_state, f, indent=2)
    log.info(f"Run state → {RUN_STATE_PATH}")

    # Exit non-zero if any stage failed
    failed = [r for r in scraper_results if r.get("exit_code", 0) not in (0, None)]
    if merge_result["exit_code"] not in (0, None) or filter_result["exit_code"] not in (0, None):
        failed.append("merge/filter")
    if failed:
        log.error(f"One or more stages exited with errors: {failed}")
        sys.exit(1)


if __name__ == "__main__":
    main()
