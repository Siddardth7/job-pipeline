-- Migration: add employment_type to normalized_jobs
-- Date: 2026-04-12
-- Purpose: Support contract role tagging from contract_scraper.py.
--          All existing rows default to empty string (= FTE / unspecified).
--          The contract_scraper sets this to "Contract" for contract postings.
--          FindJobs.jsx renders a CONTRACT badge when employment_type = 'Contract'.

ALTER TABLE normalized_jobs
  ADD COLUMN IF NOT EXISTS employment_type text NOT NULL DEFAULT '';

-- Optional index for the Contract filter chip query
CREATE INDEX IF NOT EXISTS idx_normalized_jobs_employment_type
  ON normalized_jobs (employment_type)
  WHERE employment_type != '';

COMMENT ON COLUMN normalized_jobs.employment_type IS
  'Employment type sourced from scraper. "Contract" = contract/temp role from contract_scraper.py. Empty = FTE or unspecified.';
