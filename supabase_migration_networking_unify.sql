-- ─────────────────────────────────────────────────────────────────────────────
-- Networking Unification Migration
-- Promotes linkedin_dm_contacts → contacts (canonical unified table)
-- Adds outreach tracking + snooze field
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 0: Drop legacy search-cache contacts table (no storage.js references, safe)
-- VERIFICATION BEFORE RUN:
--   SELECT count(*) FROM contacts;
-- If > 0, verify those are stale search results (typically from old find-contacts.js calls).
-- If they are old search cache, safe to drop. If actual contacts, handle migration first.
DROP TABLE IF EXISTS contacts CASCADE;

-- Step 1: Rename linkedin_dm_contacts → contacts
ALTER TABLE linkedin_dm_contacts RENAME TO contacts;

-- Step 2: Add outreach tracking + snooze columns
-- These columns support the new outreach workflow:
--   source: track where contact came from (linkedin_import, manual, serper, etc.)
--   outreach_sent: boolean flag for "have we sent an initial message?"
--   outreach_date: when the first outreach was sent (ISO format: YYYY-MM-DD)
--   outreach_status: status of the last outreach attempt (Sent, Accepted, Replied, etc.)
--   outreach_status_changed_at: timestamp of the last status change
--   follow_up_snoozed_until: snooze follow-up suggestions until this date (user can dismiss for later)
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS outreach_sent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS outreach_date DATE,
  ADD COLUMN IF NOT EXISTS outreach_status TEXT,
  ADD COLUMN IF NOT EXISTS outreach_status_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS follow_up_snoozed_until DATE;

-- Step 3: Update RLS policy name (table renamed, old policy references old table name)
-- The old policy on linkedin_dm_contacts is "user_owns_linkedin_contacts"
-- After rename, that policy is orphaned. Drop it and create the new one.
DROP POLICY IF EXISTS "user_owns_linkedin_contacts" ON contacts;
CREATE POLICY "user_owns_contacts" ON contacts
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Step 4: Indexes (Postgres automatically renames indexes on table rename)
-- No action needed — verify with: SELECT * FROM pg_indexes WHERE tablename = 'contacts';

-- Step 5: Migrate netlog rows into contacts
-- This step is handled by scripts/migrate-netlog-data.js (Task 3)
-- The SQL stub below is for reference only (DO NOT RUN — handled by migration script):
--
-- INSERT INTO contacts (
--   id, user_id, name, company, position, linkedin_url, email,
--   outreach_sent, outreach_date, outreach_status, source
-- )
-- SELECT
--   id, user_id, name, company, role, linkedin_url, email,
--   true, CAST(date AS DATE), 'Sent', 'manual'
-- FROM netlog
-- WHERE user_id IS NOT NULL
-- ON CONFLICT (id) DO UPDATE SET
--   outreach_sent = EXCLUDED.outreach_sent,
--   outreach_date = EXCLUDED.outreach_date,
--   outreach_status = EXCLUDED.outreach_status,
--   source = EXCLUDED.source;
