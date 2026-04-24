#!/usr/bin/env python3
"""
scripts/check_health.py
Reads the just-written per-run log and exits non-zero if critical sources failed.
Called as the final workflow step. A non-zero exit fails the GitHub Actions run.
"""
import json
import sys
from datetime import date
from pathlib import Path

ROOT     = Path(__file__).parent.parent
LOG_DIR  = ROOT / "data" / "run_logs"

CRITICAL_SOURCES = {"ats", "jsearch", "apify", "adzuna"}
WARNING_SOURCES  = {"usajobs", "contract"}  # new sources — warn only


def _find_latest_log() -> Path:
    """Return the most recently modified log file for today, or raise FileNotFoundError."""
    today_prefix = str(date.today())
    logs = sorted(LOG_DIR.glob(f"{today_prefix}*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not logs:
        raise FileNotFoundError(f"No run log found for {today_prefix} in {LOG_DIR}")
    return logs[0]


def main():
    try:
        log_path = _find_latest_log()
    except FileNotFoundError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    record = json.loads(log_path.read_text())
    scrapers = record.get("scrapers", {})

    failures = []
    warnings = []

    for source, info in scrapers.items():
        status = info.get("status", "not_run")
        if status == "error":
            if source in CRITICAL_SOURCES:
                failures.append(f"{source}: {info.get('error', 'unknown error')}")
            elif source in WARNING_SOURCES:
                warnings.append(f"{source}: {info.get('error', 'unknown error')}")

    total_jobs = sum(
        s.get("jobs_found", 0) for s in scrapers.values()
    )

    for w in warnings:
        print(f"WARNING: {w}")

    if total_jobs == 0:
        print("ERROR: All sources returned 0 jobs — pipeline produced nothing", file=sys.stderr)
        sys.exit(1)

    if failures:
        print("CRITICAL SOURCE FAILURES:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        sys.exit(1)

    print(f"Health check PASSED — {total_jobs} raw jobs across {len(scrapers)} sources")
    for source, info in scrapers.items():
        print(f"  {source}: {info.get('status')} ({info.get('jobs_found', 0)} jobs)")


if __name__ == "__main__":
    main()
