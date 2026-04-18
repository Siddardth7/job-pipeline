-- Run ONLY after verifying contacts table has all expected rows
-- Check: SELECT count(*) FROM contacts WHERE outreach_sent = true;
-- Should match former netlog row count.

-- Remove netlog_meta from settings
DELETE FROM settings WHERE key LIKE '%:netlog_meta';

-- Drop netlog table
DROP TABLE IF EXISTS netlog;
