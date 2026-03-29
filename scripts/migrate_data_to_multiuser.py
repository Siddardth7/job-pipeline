#!/usr/bin/env python3
"""
scripts/migrate_data_to_multiuser.py

One-time migration: assigns Siddardth's existing data to his user_id
after the multi-user schema (supabase_schema_v2.sql) has been deployed.

Run ONCE after:
  1. supabase_schema_v2.sql has been executed in the Supabase SQL editor
  2. Siddardth's account has been created in Supabase Auth → Users
  3. SIDDARDTH_USER_ID env var is set to his auth.users UUID

Usage:
  SIDDARDTH_USER_ID=<uuid> \
  SUPABASE_URL=<url> \
  SUPABASE_SERVICE_KEY=<service-role-key> \
  python3 scripts/migrate_data_to_multiuser.py

The service role key bypasses RLS — never expose it client-side.
Find it in Supabase dashboard → Project Settings → API → service_role key.
"""

import os
import sys

try:
    from supabase import create_client
except ImportError:
    print("ERROR: Run: pip install supabase")
    sys.exit(1)

USER_ID = os.environ.get("SIDDARDTH_USER_ID", "").strip()
SB_URL  = os.environ.get("SUPABASE_URL",       "").strip()
SB_KEY  = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()  # service role — bypasses RLS

if not all([USER_ID, SB_URL, SB_KEY]):
    print("ERROR: Missing required environment variables.")
    print("  SIDDARDTH_USER_ID  — UUID from Supabase Auth → Users")
    print("  SUPABASE_URL       — e.g. https://xxxx.supabase.co")
    print("  SUPABASE_SERVICE_KEY — service_role key (Project Settings → API)")
    sys.exit(1)

sb = create_client(SB_URL, SB_KEY)

print(f"JobAgent multi-user migration")
print(f"Target user_id: {USER_ID}")
print("-" * 50)


# ── Step 1: Assign existing rows in user-owned tables to Siddardth ────────────

USER_OWNED_TABLES = [
    "applications",
    "netlog",
    "contacts",
    "templates",
    "linkedin_dm_contacts",
]

print("\n[1/3] Assigning existing rows to Siddardth's user_id...")
for table in USER_OWNED_TABLES:
    try:
        result = (
            sb.table(table)
            .update({"user_id": USER_ID})
            .is_("user_id", "null")
            .execute()
        )
        count = len(result.data) if result.data else 0
        print(f"  ✓ {table}: {count} rows assigned")
    except Exception as exc:
        print(f"  ✗ {table}: ERROR — {exc}")


# ── Step 2: Copy jobs → normalized_jobs ───────────────────────────────────────

print("\n[2/3] Migrating jobs → normalized_jobs...")
try:
    jobs_result = sb.table("jobs").select("*").execute()
    jobs = jobs_result.data or []
    print(f"  Found {len(jobs)} jobs to migrate")
except Exception as exc:
    print(f"  ✗ Could not fetch jobs: {exc}")
    jobs = []

migrated = 0
skipped  = 0
for job in jobs:
    normalized = {
        "id":               job["id"],
        "job_title":        job.get("role"),
        "company_name":     job.get("company"),
        "job_url":          job.get("link"),
        "location":         job.get("location"),
        "posted_date":      job.get("posted"),
        "description":      job.get("jd"),
        "source":           job.get("source"),
        "itar_flag":        job.get("itar_flag", False),
        "tier":             job.get("tier"),
        "h1b":              job.get("h1b"),
        "industry":         job.get("industry"),
        "verdict":          job.get("verdict", "GREEN"),
        "relevance_score":  job.get("match") or 50,
        "pipeline_run_date": None,
    }
    try:
        sb.table("normalized_jobs").upsert(normalized, on_conflict="id").execute()
        migrated += 1
    except Exception as exc:
        print(f"  WARN: could not migrate job {job['id']}: {exc}")
        skipped += 1

print(f"  ✓ {migrated} jobs migrated to normalized_jobs ({skipped} skipped)")


# ── Step 3: Create user_job_feed rows for Siddardth's existing jobs ───────────

print("\n[3/3] Creating user_job_feed rows for Siddardth...")
feed_created = 0
feed_skipped = 0
for job in jobs:
    feed_row = {
        "user_id":              USER_ID,
        "job_id":               job["id"],
        "user_relevance_score": job.get("match") or 50,
        "in_pipeline":          job.get("in_pipeline", False),
        "pipeline_added_at":    job.get("pipeline_added_at"),
        "analysis_result":      job.get("analysis_result"),
        "resume_variant":       job.get("resume_variant"),
        "status":               "viewed" if job.get("in_pipeline") else "new",
    }
    try:
        sb.table("user_job_feed").upsert(feed_row, on_conflict="user_id,job_id").execute()
        feed_created += 1
    except Exception as exc:
        print(f"  WARN: could not create feed row for {job['id']}: {exc}")
        feed_skipped += 1

print(f"  ✓ {feed_created} user_job_feed rows created ({feed_skipped} skipped)")


# ── Done ──────────────────────────────────────────────────────────────────────

print("\n" + "=" * 50)
print("Migration complete.")
print("\nNext steps:")
print("  1. In Supabase → Table Editor, verify row counts look correct:")
print("     - applications, netlog, contacts, templates, linkedin_dm_contacts")
print("       should all have user_id = your UUID")
print("     - normalized_jobs should match the jobs table count")
print("     - user_job_feed should have one row per job for Siddardth")
print()
print("  2. In Supabase SQL editor, remove the temporary anon policy:")
print("     DROP POLICY \"temp_anon_settings_read\" ON settings;")
print()
print("  3. Then add authenticated-only access to settings:")
print("     CREATE POLICY \"authenticated_settings\" ON settings")
print("       FOR ALL TO authenticated USING (true) WITH CHECK (true);")
print()
print("  4. Deploy the frontend (Phase C) and verify login works.")
