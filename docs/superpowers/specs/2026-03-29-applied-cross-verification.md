# Applied Cross-Verification — Spec

## Overview

Replace the current cross-run history deduplication in the scraper pipeline with an applied-list cross-verification filter. Instead of permanently filtering jobs that appeared in any previous run, jobs are only excluded from a user's feed if the user has already applied to them (triple-match: company + location + role title).

## Problem

The current `company_intelligence.py` reads `data/job_history.json` and permanently filters out any job URL seen in a previous run. This means jobs the user never acted on disappear from the feed after one day. Users miss recurring opportunities they didn't get around to reviewing.

## Solution

- Remove history dedup from `company_intelligence.py` entirely.
- In `distribute_feed.py`, fetch each user's `applications` table rows and skip any feed job that triple-matches an applied entry (normalized company + location + role title).
- Result: jobs recur in the feed until the user applies to them.

## Architecture

### Files Changed

- **`pipeline/company_intelligence.py`** — remove `load_history()`, `save_history()`, `JOB_HISTORY_PATH`, and the history-filter loop. No other changes to this file.
- **`pipeline/distribute_feed.py`** — add `load_applied_by_user(sb)` function and integrate triple-match filter into the distribution loop.
- **`data/job_history.json`** — no longer written to; existing file can remain as dead artifact (pipeline stops touching it).

### `load_applied_by_user(sb)`

Fetches all rows from the `applications` table (all users, service-role key bypasses RLS). Groups by `user_id`. For each user, builds a `set` of normalized tuples:

```python
(company.lower().strip(), location.lower().strip(), role.lower().strip())
```

Returns `dict[user_id, set[tuple]]`.

### Distribution loop filter

Before inserting a `user_job_feed` row, check:

```python
job_key = (
    (job.get("company_name") or "").lower().strip(),
    (job.get("location")     or "").lower().strip(),
    (job.get("job_title")    or "").lower().strip(),
)
if job_key in applied_set_for_user:
    continue  # already applied — skip
```

### Normalization

Lowercase + strip only. No fuzzy matching. All three fields must match exactly (after normalization) for the job to be excluded. If any field is empty in either the job or the application, it won't match — job passes through.

## Data Flow

```
company_intelligence.py
  → output/jobs_clean_latest.json (all jobs, no history filter)

distribute_feed.py
  → load_applied_by_user() → applications table (Supabase)
  → for each user:
      for each job:
          if triple-match with applied → skip
          else → score → insert user_job_feed if score >= threshold
```

## Error Handling

- If `applications` fetch fails, log a warning and proceed with an empty applied set (fail open — better to show duplicate jobs than to crash the feed).
- Empty `company_name`, `location`, or `job_title` on either side → no match → job passes through.

## Testing

- Unit test `load_applied_by_user` with mock Supabase response.
- Unit test triple-match logic: exact match excluded, partial match (2/3 fields) passes through, empty fields pass through.
- Integration: run pipeline with a known applied job — verify it doesn't appear in feed.
