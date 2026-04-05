#!/usr/bin/env python3
"""
pipeline/company_intelligence.py — JobAgent v2 Company Intelligence Layer

Reads temp/jobs_clean_intermediate.json, classifies each job's company
as GREEN or YELLOW, promotes frequently-seen companies, and writes
the final output/jobs_clean_latest.json.

GREEN  — Known, vetted manufacturing/aerospace employer
YELLOW — Unknown company that passes industry keyword check
RED    — Staffing/recruiting agency or fails all checks → dropped
"""

import json
import logging
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Dict, List, Tuple

ROOT = Path(__file__).parent.parent  # pipeline/ subdir → parent.parent = repo root
DATA_DIR = ROOT / "data"
TEMP_DIR = ROOT / "temp"
OUTPUT_DIR = ROOT / "output"

OUTPUT_DIR.mkdir(exist_ok=True)
TEMP_DIR.mkdir(exist_ok=True)

INTERMEDIATE_PATH = TEMP_DIR / "jobs_clean_intermediate.json"
COMPANY_DB_PATH = DATA_DIR / "company_database.json"
FINAL_OUTPUT_PATH = OUTPUT_DIR / "jobs_clean_latest.json"

sys.path.insert(0, str(ROOT))

log = logging.getLogger("company_intelligence")

PROMOTION_THRESHOLD = 3    # appearances in 30 days → promote to GREEN
PROMOTION_WINDOW_DAYS = 30


# ── Entry point ───────────────────────────────────────────────────────────────

def run():
    log.info("=" * 60)
    log.info("Company Intelligence — Starting")
    log.info("=" * 60)

    # Load inputs
    db = _load_db()
    intermediate = _load_intermediate()

    if not intermediate:
        log.warning("No intermediate jobs found. Writing empty output.")
        _write_output([], [], {}, db)
        return

    log.info(f"Classifying {len(intermediate)} jobs...")

    green_jobs, yellow_jobs, dropped = [], [], 0
    itar_guard_triggered = 0

    for job in intermediate:
        company   = job["company_name"]
        job_title = job["job_title"]

        # ── ITAR guard — Company Intelligence must NEVER classify ITAR jobs ──
        # F8 in merge_pipeline.py is the primary ITAR hard-drop.
        # This guard is a belt-and-suspenders safety net. If a job reaches
        # this stage with itar_flag=True it means the pipeline ordering was
        # violated. We log an error and refuse to classify the job.
        if job.get("itar_flag") is True:
            itar_guard_triggered += 1
            log.error(
                f"  ITAR GUARD TRIGGERED: {job_title!r} @ {company} "
                f"reached Company Intelligence with itar_flag=True. "
                f"This job was NOT classified and will NOT appear in output. "
                f"Check that F8 ran before this stage."
            )
            dropped += 1
            continue  # refuse to classify — do not include in any output

        verdict = _classify(company, job.get("description", ""), db)
        job["verdict"] = verdict

        if verdict == "GREEN":
            green_jobs.append(job)
        elif verdict == "YELLOW":
            yellow_jobs.append(job)
        else:  # RED — drop
            dropped += 1
            log.debug(f"  DROP [{verdict}]: {company} — {job_title}")

    if itar_guard_triggered > 0:
        log.error(
            f"  ⚠ PIPELINE INTEGRITY: {itar_guard_triggered} job(s) reached "
            f"Company Intelligence with itar_flag=True. Fix the filter ordering."
        )

    log.info(f"  GREEN:  {len(green_jobs)}")
    log.info(f"  YELLOW: {len(yellow_jobs)}")
    log.info(f"  RED (dropped): {dropped}")

    # Auto-promotion permanently disabled — GREEN list is curated by hand.
    # Reason: promotion counted same-day jobs as multiple appearances, promoting
    # recruiters (Motion Recruitment, Myticas Consulting) into the trusted set.
    log.info("  Promotion check: disabled. Edit data/company_database.json to add GREEN companies.")
    promoted = []

    # Save updated database
    _save_db(db)

    # Write final output
    _write_output(green_jobs, yellow_jobs,
                  {
                      "total_input": len(intermediate),
                      "dropped_red": dropped,
                      "promoted_companies": promoted,
                  },
                  db)

    log.info(f"Final output: {len(green_jobs)} GREEN + {len(yellow_jobs)} YELLOW jobs")

    # ── Final output validation — absolute ITAR safety check ─────────────────
    # Any ITAR job in the clean feed is a critical pipeline failure.
    all_clean_jobs = green_jobs + yellow_jobs
    itar_violations = [j for j in all_clean_jobs if j.get("itar_flag") is True]
    if itar_violations:
        log.error("=" * 60)
        log.error("CRITICAL OUTPUT VALIDATION FAILURE")
        log.error(
            f"{len(itar_violations)} ITAR-flagged job(s) found in the clean "
            f"output feed. These will be forcibly removed before writing."
        )
        for v in itar_violations:
            log.error(
                f"  VIOLATION: {v['job_title']!r} @ {v['company_name']} "
                f"| itar_detail: {v.get('itar_detail', '')}"
            )
        log.error("=" * 60)
        # Force-remove all ITAR violations from final output
        green_jobs  = [j for j in green_jobs  if not j.get("itar_flag")]
        yellow_jobs = [j for j in yellow_jobs if not j.get("itar_flag")]
        # Rewrite the output file with the corrected lists
        _write_output(green_jobs, yellow_jobs,
                      {
                          "total_input": len(intermediate),
                          "dropped_red": dropped + len(itar_violations),
                          "promoted_companies": promoted,
                      },
                      db)
        log.error(
            f"Output rewritten. {len(itar_violations)} ITAR violation(s) removed. "
            f"Final clean counts: {len(green_jobs)} GREEN + {len(yellow_jobs)} YELLOW."
        )
    else:
        log.info("✓ Output validation passed: zero ITAR jobs in clean feed.")

    log.info("=" * 60)
    return green_jobs, yellow_jobs


# ── Classification ────────────────────────────────────────────────────────────

def _classify(company: str, description: str, db: Dict) -> str:
    company_lower = company.lower()
    desc_lower = description.lower()

    # Check GREEN list
    for entry in db.get("green", []):
        if entry["name"].lower() == company_lower:
            return "GREEN"
        # Partial match on domain keyword
        if entry["name"].lower() in company_lower:
            return "GREEN"

    # Check if it's a staffing/recruiting firm
    for reject_kw in db.get("reject_keywords", []):
        if reject_kw.lower() in company_lower or reject_kw.lower() in desc_lower:
            return "RED"

    # Check for known bad companies
    if company in db.get("rejected_companies", []):
        return "RED"

    # Industry keyword check → YELLOW
    for industry_kw in db.get("industry_keywords", []):
        if industry_kw.lower() in desc_lower:
            return "YELLOW"

    # Generic engineering companies without clear rejection → YELLOW by default
    # (conservative approach: let the user decide rather than dropping)
    return "YELLOW"


# ── Promotion logic ───────────────────────────────────────────────────────────

def _update_promotions(db: Dict, jobs: List[Dict]):
    """Track how often each YELLOW company appears across runs.

    DISABLED — no longer called from run(). Auto-promotion has been permanently
    disabled. The GREEN list is curated by hand only.
    See the comment in run() for the full rationale.
    """
    # Disabled — kept for reference only.
    pass


def _check_promotions(db: Dict) -> List[str]:
    """Return list of companies that crossed the promotion threshold.

    DISABLED — no longer called from run(). Auto-promotion has been permanently
    disabled. The GREEN list is curated by hand only.
    See the comment in run() for the full rationale.
    """
    # Disabled — always returns empty list. No companies are auto-promoted.
    return []


def _is_green(company: str, db: Dict) -> bool:
    cl = company.lower()
    return any(e["name"].lower() == cl for e in db.get("green", []))


def _parse_date(d):
    from datetime import date as _date
    if isinstance(d, _date):
        return d
    return datetime.strptime(str(d)[:10], "%Y-%m-%d").date()


# ── I/O helpers ───────────────────────────────────────────────────────────────

def _load_intermediate() -> List[Dict]:
    if not INTERMEDIATE_PATH.exists():
        log.warning(f"Intermediate file not found: {INTERMEDIATE_PATH}")
        return []
    data = json.loads(INTERMEDIATE_PATH.read_text())
    return data.get("jobs", [])


def _load_db() -> Dict:
    if not COMPANY_DB_PATH.exists():
        log.error(f"Company database not found: {COMPANY_DB_PATH}")
        return {"green": [], "promotion_tracking": {},
                "rejected_companies": [], "industry_keywords": [],
                "reject_keywords": []}
    return json.loads(COMPANY_DB_PATH.read_text())


def _save_db(db: Dict):
    COMPANY_DB_PATH.write_text(json.dumps(db, indent=2))


def _write_output(
    green: List[Dict], yellow: List[Dict],
    stats: Dict, db: Dict
):
    total_scraped = stats.get("total_input", 0)
    summary = {
        "run_date": str(date.today()),
        "generated_utc": datetime.utcnow().isoformat() + "Z",
        "total_scraped": total_scraped,
        "duplicates_removed": 0,
        "filtered_jobs": stats.get("dropped_red", 0),
        "green_jobs": len(green),
        "yellow_jobs": len(yellow),
        "promoted_companies": stats.get("promoted_companies", []),
    }

    payload = {
        "green_jobs": green,
        "yellow_jobs": yellow,
        "summary": summary,
    }

    FINAL_OUTPUT_PATH.write_text(json.dumps(payload, indent=2))
    log.info(f"Wrote final output → {FINAL_OUTPUT_PATH}")


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s")
    result = run()
    if result:
        g, y = result
        print(f"\n✓ Classification complete: {len(g)} GREEN, {len(y)} YELLOW")
