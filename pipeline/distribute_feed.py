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
from pathlib import Path

try:
    from supabase import create_client
except ImportError:
    print("Run: pip install supabase")
    sys.exit(1)

ROOT      = Path(__file__).parent.parent
JOBS_PATH = ROOT / "output" / "jobs_clean_latest.json"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("distribute_feed")

SB_URL = os.environ.get("SUPABASE_URL",       "").strip()
SB_KEY = os.environ.get("SUPABASE_SERVICE_KEY","").strip()

if not SB_URL or not SB_KEY:
    log.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    sys.exit(1)

sb = create_client(SB_URL, SB_KEY)


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


def load_users():
    """Return list of {user_id, role_targets, preferences} from Supabase."""
    profiles_result = sb.table("user_profiles").select("user_id, domain_family").execute()
    targets_result  = (
        sb.table("role_targets")
        .select("user_id, title, cluster, priority")
        .eq("active", True)
        .execute()
    )
    prefs_result = sb.table("user_preferences").select("user_id, feed_min_score, h1b_filter").execute()

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
    Returns (score, matched_clusters[]).

    Scoring breakdown:
        Title match:       up to 35 pts × priority weight (max 70 with weight 2)
        Keyword density:   up to 15 pts per cluster keyword hit in description
        Entry-level boost: +10 pts if boost_tags present
        H1B penalty:       -25 pts if user has h1b_filter=True and job h1b != YES
    """
    score = 0
    title_lower = (job.get("job_title") or "").lower()
    desc_lower  = (job.get("description") or "").lower()
    matched_clusters = []

    for target in user["role_targets"]:
        target_title = target["title"].lower()
        cluster      = target["cluster"]
        # priority 1 → weight 2, priority 2 → weight 1, higher → weight 1
        priority_w   = max(1, 3 - target.get("priority", 1))

        if target_title in title_lower:
            score += 35 * priority_w
            if cluster not in matched_clusters:
                matched_clusters.append(cluster)

    # Keyword density: cluster name words appearing in description
    for target in user["role_targets"]:
        cluster_words = target["cluster"].replace("_", " ").split()
        hits = sum(1 for w in cluster_words if w in desc_lower)
        score += min(hits * 4, 15)

    # Entry-level signal boost
    if job.get("boost_tags"):
        score += 10

    # H1B filter penalty
    if user["preferences"].get("h1b_filter") and job.get("h1b") != "YES":
        score -= 25

    return min(max(score, 0), 100), matched_clusters


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
    Return True if all three of (company_name, location, job_title) match
    an entry in applied_set (after normalization). Empty fields never match.
    """
    company  = (job.get("company_name") or "").lower().strip()
    location = (job.get("location")     or "").lower().strip()
    title    = (job.get("job_title")    or "").lower().strip()
    if not company or not location or not title:
        return False
    return (company, location, title) in applied_set


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

    jobs  = load_jobs()
    users = load_users()

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
    upsert_errors = 0
    for job in jobs:
        job_id = job.get("id") or job.get("job_url", "")[:100]
        if not job_id:
            continue
        row = {
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
        }
        try:
            sb.table("normalized_jobs").upsert(row, on_conflict="id").execute()
        except Exception as exc:
            log.warning(f"  Could not upsert job {job_id[:30]}: {exc}")
            upsert_errors += 1

    log.info(f"normalized_jobs upsert complete ({upsert_errors} errors)")

    # Step 2: Score and distribute to each user's feed
    log.info(f"Distributing to {len(users)} users...")
    total_inserted = 0

    for user in users:
        min_score    = user["preferences"].get("feed_min_score", 30)
        user_inserts = 0
        uid_short    = user["user_id"][:8]

        for job in jobs:
            job_id = job.get("id") or job.get("job_url", "")[:100]
            if not job_id:
                continue

            # Skip jobs already in the user's Applied list
            applied_set = applied_by_user.get(user["user_id"], set())
            if is_applied(job, applied_set):
                continue

            score, matched = score_job_for_user(job, user)

            if score < min_score:
                continue

            feed_row = {
                "user_id":              user["user_id"],
                "job_id":               job_id,
                "user_relevance_score": score,
                "matched_clusters":     matched,
                "status":               "new",
            }
            try:
                sb.table("user_job_feed").upsert(feed_row, on_conflict="user_id,job_id").execute()
                user_inserts += 1
            except Exception as exc:
                log.warning(f"  Feed insert failed [{uid_short}] job {job_id[:20]}: {exc}")

        log.info(f"  [{uid_short}...] {user_inserts} jobs in feed (threshold={min_score})")
        total_inserted += user_inserts

    log.info(f"Distribution complete — {total_inserted} total feed rows written")
    log.info("=" * 60)


if __name__ == "__main__":
    run()
