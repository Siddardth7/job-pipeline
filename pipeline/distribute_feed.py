#!/usr/bin/env python3
"""
pipeline/distribute_feed.py — JobAgent Multi-User Feed Distribution

Reads output/jobs_clean_latest.json (produced by company_intelligence.py),
upserts all jobs into normalized_jobs (shared), then for each user scores
every job based on their role_targets and writes a user_job_feed row if the
score meets that user's feed_min_score threshold.

Run after company_intelligence.py in the daily pipeline.

Env vars:
    SUPABASE_URL           — Supabase project URL
    SUPABASE_SERVICE_KEY   — Service role key (bypasses RLS for pipeline writes)
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    from supabase import create_client
except ImportError:
    print("Run: pip install supabase")
    sys.exit(1)

try:
    from pipeline.batch_upsert import batch_upsert
except ImportError:
    # When run as a script directly (python pipeline/distribute_feed.py),
    # pipeline/ is on sys.path rather than the project root.
    from batch_upsert import batch_upsert

ROOT      = Path(__file__).parent.parent
JOBS_PATH = ROOT / "output" / "jobs_clean_latest.json"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("distribute_feed")


def _get_supabase_client():
    """Create and return Supabase client. Raises SystemExit if env vars missing."""
    url = os.environ.get("SUPABASE_URL",        "").strip()
    key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if not url or not key:
        log.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
        sys.exit(1)
    return create_client(url, key)

# ── Data loading ──────────────────────────────────────────────────────────────

def load_jobs():
    if not JOBS_PATH.exists():
        log.warning(f"No jobs file at {JOBS_PATH} — nothing to distribute")
        return []
    data = json.loads(JOBS_PATH.read_text())
    green  = data.get("green_jobs",  [])
    yellow = data.get("yellow_jobs", [])
    log.info(f"Loaded {len(green)} GREEN + {len(yellow)} YELLOW jobs from pipeline output")
    return green + yellow


def load_users(sb_client):
    """Return list of {user_id, role_targets, preferences} from Supabase."""
    profiles_result = sb_client.table("user_profiles").select("user_id, domain_family").execute()
    targets_result  = (
        sb_client.table("role_targets")
        .select("user_id, title, cluster, priority")
        .eq("active", True)
        .execute()
    )
    prefs_result = sb_client.table("user_preferences").select("user_id, feed_min_score, h1b_filter").execute()

    profiles = {p["user_id"]: p for p in (profiles_result.data  or [])}
    prefs    = {p["user_id"]: p for p in (prefs_result.data     or [])}

    targets_by_user = {}
    for t in (targets_result.data or []):
        targets_by_user.setdefault(t["user_id"], []).append(t)

    users = []
    for uid, profile in profiles.items():
        users.append({
            "user_id":      uid,
            "role_targets": targets_by_user.get(uid, []),
            "preferences":  prefs.get(uid, {"feed_min_score": 30, "h1b_filter": False}),
        })

    log.info(f"Loaded {len(users)} users for distribution")
    return users


# ── Scoring ───────────────────────────────────────────────────────────────────

def score_job_for_user(job, user):
    """
    Compute a 0–100 relevance score for a (job, user) pair.
    Returns (score, matched_clusters[], score_breakdown{}).

    6-dimensional breakdown:
        D1 title_match    0–40  title token hit × priority weight
        D2 h1b_score      0–20  H1B sponsorship signal
        D3 itar_clean     0–10  no ITAR flag = full points
        D4 entry_level    0–15  entry-level boost tags present
        D5 company_intel  0–10  keyword density in description
        D6 legitimacy      0–5  legitimacy_tier signal
    H1B penalty: -25 pts if h1b_filter=True and job h1b != YES (applied after sum)
    """
    title_lower = (job.get("job_title")   or "").lower()
    desc_lower  = (job.get("description") or "").lower()
    matched_clusters = []

    # D1 — Title match (0–40)
    d1 = 0
    for target in user["role_targets"]:
        target_title = target["title"].lower()
        cluster      = target["cluster"]
        priority_w   = max(1, 3 - target.get("priority", 1))  # 1→2, 2+→1
        if target_title in title_lower:
            d1 = min(d1 + 20 * priority_w, 40)
            if cluster not in matched_clusters:
                matched_clusters.append(cluster)

    # D2 — H1B sponsorship (0–20)
    h1b_val = (job.get("h1b") or "").upper()
    if h1b_val == "YES":
        d2 = 20
    elif h1b_val in ("LIKELY", "PROBABLE"):
        d2 = 12
    elif h1b_val in ("NO", "UNLIKELY"):
        d2 = 0
    else:
        d2 = 6  # unknown / blank — partial credit

    # D3 — ITAR clean (0–10)
    d3 = 0 if job.get("itar_flag") else 10

    # D4 — Entry-level signal (0–15)
    d4 = 15 if job.get("boost_tags") else 0

    # D5 — Company intel / keyword density (0–10)
    d5 = 0
    for target in user["role_targets"]:
        cluster_words = target["cluster"].replace("_", " ").split()
        hits = sum(1 for w in cluster_words if w in desc_lower)
        d5 = min(d5 + hits * 2, 10)

    # D6 — Legitimacy (0–5)
    legitimacy_tier = (job.get("legitimacy_tier") or "high")
    if legitimacy_tier == "high":
        d6 = 5
    elif legitimacy_tier == "caution":
        d6 = 2
    else:  # suspicious
        d6 = 0

    raw_score = d1 + d2 + d3 + d4 + d5 + d6  # max = 100

    # H1B filter penalty
    if user["preferences"].get("h1b_filter") and h1b_val != "YES":
        raw_score -= 25

    final_score = min(max(raw_score, 0), 100)

    breakdown = {
        "title_match":  d1,
        "h1b_score":    d2,
        "itar_clean":   d3,
        "entry_level":  d4,
        "company_intel": d5,
        "legitimacy":   d6,
    }

    return final_score, matched_clusters, breakdown


# ── Applied-list filter ───────────────────────────────────────────────────────

def build_applied_set(rows: list) -> set:
    """
    Convert a list of application rows into a set of normalized tuples.
    Each tuple is (company_lower, location_lower, role_lower).
    """
    result = set()
    for row in rows:
        company  = (row.get("company")  or "").lower().strip()
        location = (row.get("location") or "").lower().strip()
        role     = (row.get("role")     or "").lower().strip()
        result.add((company, location, role))
    return result


def is_applied(job: dict, applied_set: set) -> bool:
    """
    Return True if this job matches an entry in applied_set.

    Matching rules:
    - company_name and job_title are always required.
    - If both the feed job and the applied entry have a location, they must match.
    - If either side has an empty location, fall back to a 2-field (company+title) match.
      This handles inconsistent location data across different scrapers.
    """
    company  = (job.get("company_name") or "").lower().strip()
    location = (job.get("location")     or "").lower().strip()
    title    = (job.get("job_title")    or "").lower().strip()

    if not company or not title:
        return False

    # Exact 3-field match (fast path)
    if (company, location, title) in applied_set:
        return True

    # Location-tolerant fallback:
    # Trigger only when at least one side has an empty location.
    if not location:
        # Feed job has no location — check company+title across all applied entries
        return any(c == company and t == title for (c, l, t) in applied_set)
    else:
        # Feed job has a location — check if applied entry had empty location for same job
        return (company, "", title) in applied_set


def load_applied_by_user(sb_client) -> dict:
    """
    Fetch all application rows from Supabase.
    Returns dict[user_id -> set of (company, location, role) tuples].
    Fails open: returns empty dict on error.
    """
    try:
        result = sb_client.table("applications").select("user_id, company, location, role").execute()
        rows   = result.data or []
    except Exception as exc:
        log.warning(f"Could not fetch applied jobs — proceeding with empty set: {exc}")
        return {}

    by_user = {}
    for row in rows:
        uid = row.get("user_id")
        if not uid:
            continue
        by_user.setdefault(uid, []).append(row)

    return {uid: build_applied_set(rows) for uid, rows in by_user.items()}


# ── Main ──────────────────────────────────────────────────────────────────────

def run():
    log.info("=" * 60)
    log.info("Feed Distribution — Starting")

    sb = _get_supabase_client()

    jobs  = load_jobs()
    users = load_users(sb)

    # Load applied jobs for all users (used to skip already-applied jobs in feed)
    applied_by_user = load_applied_by_user(sb)
    log.info(f"Loaded applied sets for {len(applied_by_user)} users")

    if not jobs:
        log.warning("No jobs to distribute. Exiting.")
        return

    if not users:
        log.warning("No user profiles found in Supabase. Exiting.")
        log.info("Tip: Run scripts/migrate_data_to_multiuser.py and set up user_profiles rows.")
        return

    # Step 1: Upsert all jobs into normalized_jobs (shared table, service role)
    log.info(f"Upserting {len(jobs)} jobs into normalized_jobs...")
    job_rows = []
    for job in jobs:
        job_id = job.get("id") or job.get("job_url", "")[:100]
        if not job_id:
            continue
        job_rows.append({
            "id":               job_id,
            "job_title":        job.get("job_title"),
            "company_name":     job.get("company_name"),
            "job_url":          job.get("job_url"),
            "location":         job.get("location"),
            "posted_date":      job.get("posted_date"),
            "description":      (job.get("description") or "")[:10000],
            "source":           job.get("source"),
            "itar_flag":        job.get("itar_flag", False),
            "tier":             job.get("tier"),
            "h1b":              job.get("h1b"),
            "industry":         job.get("industry"),
            "verdict":          job.get("verdict", "GREEN"),
            "relevance_score":  job.get("relevance_score", 50),
            "boost_tags":       job.get("boost_tags") or [],
            "employment_type":  job.get("employment_type", "") or "",
            "red_flags":        job.get("red_flags", []) or [],
            "legitimacy_tier":  job.get("legitimacy_tier", "high") or "high",
        })
    upsert_errors = batch_upsert(sb, "normalized_jobs", job_rows, on_conflict="id")
    log.info(f"normalized_jobs upsert complete ({upsert_errors} errors)")

    # Step 2: Score and distribute to each user's feed
    log.info(f"Distributing to {len(users)} users...")
    total_inserted = 0

    for user in users:
        min_score = user["preferences"].get("feed_min_score", 30)
        uid_short = user["user_id"][:8]
        feed_rows = []

        for job in jobs:
            job_id = job.get("id") or job.get("job_url", "")[:100]
            if not job_id:
                continue

            # Skip jobs already in the user's Applied list
            applied_set = applied_by_user.get(user["user_id"], set())
            if is_applied(job, applied_set):
                continue

            score, matched, breakdown = score_job_for_user(job, user)

            # min_score=0 means "show everything" — bypass threshold
            if min_score > 0 and score < min_score:
                continue

            feed_rows.append({
                "user_id":              user["user_id"],
                "job_id":               job_id,
                "user_relevance_score": score,
                "matched_clusters":     matched,
                "score_breakdown":      breakdown,
                "status":               "new",
                # Force created_at to update on every upsert so the date-based
                # feed filter in the UI correctly shows all jobs from today's run,
                # not just truly-new rows (which is the Supabase INSERT-only default).
                "created_at":           datetime.now(timezone.utc).isoformat(),
            })

        feed_errors = batch_upsert(sb, "user_job_feed", feed_rows, on_conflict="user_id,job_id")
        user_inserts = len(feed_rows)
        log.info(f"  [{uid_short}...] {user_inserts} jobs in feed (threshold={min_score}, errors={feed_errors})")
        total_inserted += user_inserts

    log.info(f"Distribution complete — {total_inserted} total feed rows written")
    log.info("=" * 60)


if __name__ == "__main__":
    run()
