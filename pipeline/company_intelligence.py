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

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
TEMP_DIR = ROOT / "temp"
OUTPUT_DIR = ROOT / "output"

OUTPUT_DIR.mkdir(exist_ok=True)
TEMP_DIR.mkdir(exist_ok=True)

INTERMEDIATE_PATH = TEMP_DIR / "jobs_clean_intermediate.json"
COMPANY_DB_PATH = DATA_DIR / "company_database.json"
JOB_HISTORY_PATH = DATA_DIR / "job_history.json"
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
    history = _load_history()

    if not intermediate:
        log.warning("No intermediate jobs found. Writing empty output.")
        _write_output([], [], {}, history, db)
        return

    log.info(f"Classifying {len(intermediate)} jobs...")

    green_jobs, yellow_jobs, dropped = [], [], 0

    for job in intermediate:
        company = job["company_name"]
        verdict = _classify(company, job.get("description", ""), db)
        job["verdict"] = verdict

        if verdict == "GREEN":
            green_jobs.append(job)
        elif verdict == "YELLOW":
            yellow_jobs.append(job)
        else:  # RED — drop
            dropped += 1
            log.debug(f"  DROP [{verdict}]: {company} — {job['job_title']}")

    log.info(f"  GREEN:  {len(green_jobs)}")
    log.info(f"  YELLOW: {len(yellow_jobs)}")
    log.info(f"  RED (dropped): {dropped}")

    # Update promotion tracking with today's new jobs
    _update_promotions(db, green_jobs + yellow_jobs)

    # Check for promotions: YELLOW companies that crossed threshold
    promoted = _check_promotions(db)
    if promoted:
        log.info(f"  Promoted to GREEN: {promoted}")
        # Re-classify yellow jobs from promoted companies
        still_yellow, now_green = [], []
        for job in yellow_jobs:
            if job["company_name"] in promoted:
                job["verdict"] = "GREEN"
                now_green.append(job)
            else:
                still_yellow.append(job)
        green_jobs.extend(now_green)
        yellow_jobs = still_yellow

    # Save updated database
    _save_db(db)

    # Remove duplicates against historical job URLs
    green_jobs, yellow_jobs, history_dupes = _filter_history(
        green_jobs, yellow_jobs, history
    )
    log.info(f"  Removed {history_dupes} jobs already seen in history")

    # Add today's jobs to history
    _update_history(history, green_jobs + yellow_jobs)

    # Write final output
    _write_output(green_jobs, yellow_jobs,
                  {
                      "total_input": len(intermediate),
                      "dropped_red": dropped,
                      "history_dupes": history_dupes,
                      "promoted_companies": promoted,
                  },
                  history, db)

    log.info(f"Final output: {len(green_jobs)} GREEN + {len(yellow_jobs)} YELLOW jobs")
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
    """Track how often each YELLOW company appears across runs."""
    tracking = db.setdefault("promotion_tracking", {})
    today = str(date.today())

    for job in jobs:
        company = job["company_name"]
        if not _is_green(company, db):
            if company not in tracking:
                tracking[company] = []
            tracking[company].append(today)


def _check_promotions(db: Dict) -> List[str]:
    """Return list of companies that crossed the promotion threshold."""
    tracking = db.get("promotion_tracking", {})
    cutoff = date.today() - timedelta(days=PROMOTION_WINDOW_DAYS)
    promoted = []

    for company, dates in tracking.items():
        recent = [d for d in dates if _parse_date(d) >= cutoff]
        tracking[company] = [str(d) for d in recent]  # trim old dates
        if len(recent) >= PROMOTION_THRESHOLD:
            if not _is_green(company, db):
                db["green"].append({"name": company, "domain": "", "industry": "Auto-promoted"})
                promoted.append(company)

    return promoted


def _is_green(company: str, db: Dict) -> bool:
    cl = company.lower()
    return any(e["name"].lower() == cl for e in db.get("green", []))


def _parse_date(d):
    from datetime import date as _date
    if isinstance(d, _date):
        return d
    return datetime.strptime(str(d)[:10], "%Y-%m-%d").date()


# ── History deduplication ─────────────────────────────────────────────────────

def _filter_history(
    green: List[Dict], yellow: List[Dict], history: List[Dict]
) -> Tuple[List[Dict], List[Dict], int]:
    seen_urls = {entry["job_url"] for entry in history if "job_url" in entry}
    dupes = 0

    def clean(jobs):
        nonlocal dupes
        out = []
        for j in jobs:
            if j["job_url"] in seen_urls:
                dupes += 1
            else:
                out.append(j)
                seen_urls.add(j["job_url"])
        return out

    return clean(green), clean(yellow), dupes


def _update_history(history: List[Dict], new_jobs: List[Dict]):
    today = str(date.today())
    for job in new_jobs:
        history.append({
            "job_url": job["job_url"],
            "company_name": job["company_name"],
            "job_title": job["job_title"],
            "seen_date": today,
        })
    # Keep last 90 days of history
    cutoff = str(date.today() - timedelta(days=90))
    history[:] = [e for e in history if e.get("seen_date", "9999") >= cutoff]
    JOB_HISTORY_PATH.write_text(json.dumps(history, indent=2))


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


def _load_history() -> List[Dict]:
    if not JOB_HISTORY_PATH.exists():
        return []
    try:
        return json.loads(JOB_HISTORY_PATH.read_text())
    except Exception:
        return []


def _write_output(
    green: List[Dict], yellow: List[Dict],
    stats: Dict, history: List[Dict], db: Dict
):
    total_scraped = stats.get("total_input", 0)
    summary = {
        "run_date": str(date.today()),
        "generated_utc": datetime.utcnow().isoformat() + "Z",
        "total_scraped": total_scraped,
        "duplicates_removed": stats.get("history_dupes", 0),
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
