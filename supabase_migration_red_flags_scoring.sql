-- Migration: add red_flags, legitimacy_tier to normalized_jobs
--            add score_breakdown to user_job_feed
-- Date: 2026-04-12
-- Purpose:
--   normalized_jobs gets two new columns:
--     red_flags[]      — array of flag strings detected by pipeline (staffing_agency, etc.)
--     legitimacy_tier  — 'high' | 'caution' | 'suspicious'
--   user_job_feed gets:
--     score_breakdown  — jsonb with 6-dimensional score breakdown per user

-- normalized_jobs additions
ALTER TABLE normalized_jobs
  ADD COLUMN IF NOT EXISTS red_flags       text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS legitimacy_tier text    NOT NULL DEFAULT 'high';

-- Optional index for filtering suspicious jobs quickly
CREATE INDEX IF NOT EXISTS idx_normalized_jobs_legitimacy_tier
  ON normalized_jobs (legitimacy_tier)
  WHERE legitimacy_tier != 'high';

COMMENT ON COLUMN normalized_jobs.red_flags IS
  'Array of legitimacy flags: staffing_agency, us_person_required, vague_description, contract_hidden';

COMMENT ON COLUMN normalized_jobs.legitimacy_tier IS
  'Pipeline legitimacy assessment: high (clean), caution (minor flags), suspicious (critical flags)';

-- user_job_feed addition
ALTER TABLE user_job_feed
  ADD COLUMN IF NOT EXISTS score_breakdown jsonb;

COMMENT ON COLUMN user_job_feed.score_breakdown IS
  '6-dimensional score breakdown: {title_match, h1b_score, itar_clean, entry_level, company_intel, legitimacy}';
