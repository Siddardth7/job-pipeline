#!/usr/bin/env python3
"""
M628 Post-Merge Filter v2
Applies strict final gates on the merged job feed:

  1. Freshness: keep only jobs posted within 24–72 hours
  2. Seniority: reject senior / lead / staff / principal / 5+ yrs titles
  3. Early-career priority scoring boost
  4. URL sanity: reject empty or fake URLs
  5. Writes output/jobs_clean_latest.json (consumed by the web app)

Run after merge_pipeline.py:
  python post_merge_filter.py
"""

import json, re, logging
from datetime import datetime, timedelta
from pathlib import Path

SCRIPT_DIR  = Path(__file__).parent
OUTPUT_DIR  = SCRIPT_DIR / "output"
INPUT_FILE  = OUTPUT_DIR / "jobs_merged_latest.json"
OUTPUT_FILE = OUTPUT_DIR / "jobs_clean_latest.json"

# ── FRESHNESS ─────────────────────────────────────────────────────────────────
MAX_AGE_HOURS = 72   # hard upper limit
MIN_AGE_HOURS = 0    # accept brand-new (0 h)

# ── SENIORITY REJECTION ───────────────────────────────────────────────────────
# If any of these appear in the role title → REJECT
SENIOR_TITLE_TERMS = [
    "senior", "sr.", " sr ", "staff ", "principal", "lead ",
    "tech lead", "manager", "director", "vp ", "vice president",
    "head of", "architect", "distinguished", "fellow", "chief",
    "supervisor", "superintendent",
    "engineer iii", "engineer iv", "engineer v",
    "level iii", "level iv", "level v",
    " iii", " iv",                      # e.g. "Technician IV"
]

# If any of these appear in the description → REJECT
SENIOR_DESC_TERMS = [
    "7+ years", "8+ years", "9+ years", "10+ years",
    "minimum 7 years", "minimum 8 years",
    "at least 7 years", "7 or more years",
    "5+ years experience required",        # 5+ required (not preferred)
    "minimum 6 years",
]

# ── EARLY-CAREER POSITIVE SIGNALS ─────────────────────────────────────────────
EARLY_CAREER_TERMS = [
    "entry level", "entry-level", "associate ", "junior", "new grad",
    "recent graduate", "engineer i", "engineer 1", "engineer ii", "engineer 2",
    "level i", "level 1", "level ii", "level 2",
    "0-3 years", "0 to 3 years", "1-3 years", "early career",
]

# ── URL SANITY ────────────────────────────────────────────────────────────────
FAKE_URL_PATTERNS = [
    r"^$",                     # empty
    r"^https?://$",            # bare scheme
    r"example\.com",
    r"placeholder",
    r"javascript:",
    r"localhost",
]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(SCRIPT_DIR / "post_filter.log"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("post_filter")


# ─── HELPERS ─────────────────────────────────────────────────────────────────

def parse_age_hours(job: dict) -> float | None:
    """Return job age in hours, or None if undeterminable."""
    # Try ISO timestamp field (from JSearch)
    ts = job.get("posted_ts", "")
    if ts:
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            return (datetime.now(dt.tzinfo) - dt).total_seconds() / 3600
        except Exception:
            pass

    # Try human string field (from Apify / merged)
    posted = (job.get("posted") or "").lower()
    if not posted or posted in ("", "unknown", "n/a"):
        return None

    if "today" in posted or "just" in posted or "hour" in posted or "minute" in posted:
        return 4.0   # treat as ~4h

    m = re.search(r"(\d+)\s*d", posted)
    if m:
        return int(m.group(1)) * 24.0

    if "week" in posted:
        return 7 * 24.0
    if "month" in posted:
        return 30 * 24.0

    return None


def is_within_freshness_window(job: dict) -> bool:
    age = parse_age_hours(job)
    if age is None:
        # No timestamp at all — keep but flag for manual review
        return True
    return MIN_AGE_HOURS <= age <= MAX_AGE_HOURS


def is_senior_role(job: dict) -> bool:
    title = (job.get("role") or "").lower()
    desc  = (job.get("description") or "").lower()

    if any(t in title for t in SENIOR_TITLE_TERMS):
        return True
    if any(t in desc for t in SENIOR_DESC_TERMS):
        return True
    return False


def is_early_career(job: dict) -> bool:
    combined = (
        (job.get("role") or "") + " " + (job.get("description") or "")
    ).lower()
    return any(t in combined for t in EARLY_CAREER_TERMS)


def is_valid_url(url: str) -> bool:
    if not url:
        return False
    for pattern in FAKE_URL_PATTERNS:
        if re.search(pattern, url, re.IGNORECASE):
            return False
    return url.startswith("http")


def score_job(job: dict) -> int:
    """Adjust match score based on early-career signals."""
    base = job.get("match", 70)
    if is_early_career(job):
        return min(base + 5, 95)
    return base


# ─── MAIN FILTER ─────────────────────────────────────────────────────────────

def run_filter():
    log.info("=" * 60)
    log.info("M628 Post-Merge Filter v2 — Starting")
    log.info("=" * 60)

    if not INPUT_FILE.exists():
        log.error(f"Input file not found: {INPUT_FILE}")
        log.error("Run merge_pipeline.py first.")
        return

    with open(INPUT_FILE) as f:
        merged = json.load(f)

    all_jobs = merged.get("jobs", [])
    log.info(f"Input: {len(all_jobs)} jobs from merged feed")

    kept          = []
    rejected_stale    = []
    rejected_senior   = []
    rejected_bad_url  = []
    dedup_seen    = set()

    for job in all_jobs:
        role = job.get("role", "")
        link = job.get("link", "")
        key  = (job.get("company","").lower(), role.lower(), job.get("location","").lower())

        # ── Dedup ────────────────────────────────────────────────────────────
        if key in dedup_seen:
            continue
        dedup_seen.add(key)

        # ── URL sanity ────────────────────────────────────────────────────────
        if not is_valid_url(link):
            rejected_bad_url.append(role)
            log.debug(f"REJECT bad URL: {role} @ {job.get('company')}")
            continue

        # ── Freshness gate ────────────────────────────────────────────────────
        if not is_within_freshness_window(job):
            rejected_stale.append(role)
            log.debug(f"REJECT stale: {role} ({job.get('posted')})")
            continue

        # ── Seniority gate ────────────────────────────────────────────────────
        if is_senior_role(job):
            rejected_senior.append(role)
            log.debug(f"REJECT senior: {role}")
            continue

        # ── Boost early-career score ──────────────────────────────────────────
        job["match"] = score_job(job)
        kept.append(job)

    # ── Final sort ─────────────────────────────────────────────────────────────
    verdict_order = {"GREEN": 0, "YELLOW": 1, "RED": 2}
    kept.sort(key=lambda j: (verdict_order.get(j["verdict"], 9), -j["match"]))

    output = {
        "generated_utc": datetime.utcnow().isoformat() + "Z",
        "filter_version": "v2",
        "total_input":   len(all_jobs),
        "total_kept":    len(kept),
        "rejected_stale":   len(rejected_stale),
        "rejected_senior":  len(rejected_senior),
        "rejected_bad_url": len(rejected_bad_url),
        "jobs": kept,
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    log.info("=" * 60)
    log.info(f"DONE. {len(kept)} clean jobs → {OUTPUT_FILE}")
    log.info(f"  Rejected stale (>{MAX_AGE_HOURS}h): {len(rejected_stale)}")
    log.info(f"  Rejected senior titles:           {len(rejected_senior)}")
    log.info(f"  Rejected bad/fake URLs:           {len(rejected_bad_url)}")
    log.info(f"  GREEN:  {sum(1 for j in kept if j['verdict']=='GREEN')}")
    log.info(f"  YELLOW: {sum(1 for j in kept if j['verdict']=='YELLOW')}")
    log.info(f"  RED:    {sum(1 for j in kept if j['verdict']=='RED')}")
    log.info("=" * 60)


if __name__ == "__main__":
    run_filter()
