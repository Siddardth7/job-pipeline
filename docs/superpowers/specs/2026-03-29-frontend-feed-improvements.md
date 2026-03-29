# Frontend Feed Improvements — Spec

## Overview

Two independent UI improvements to the JobAgent frontend:

1. **Past Runs dropdown** — view the last 7 days of feed snapshots in Find Jobs
2. **Job ID field** — add Job ID input to Job Analysis; networking drafts automatically include it

## Feature 1: Past Runs Dropdown

### Problem

The Find Jobs feed only shows the current live feed. Users want to review yesterday's feed or compare across days.

### Solution

Add a date selector dropdown above the feed list in `FindJobs.jsx`. Selecting a date loads that day's jobs from `user_job_feed` filtered by `created_at` date. Default is today.

### Architecture

**`src/lib/storage.js`** — two new functions:

```js
// Returns sorted unique date strings for last 7 days that have feed rows
// e.g. ['2026-03-29', '2026-03-28', '2026-03-27']
export async function fetchFeedDates()

// Returns jobs for a specific date (same shape as fetchJobs())
// dateStr format: 'YYYY-MM-DD'
export async function fetchJobsByDate(dateStr)
```

`fetchFeedDates()`: query `user_job_feed` selecting `created_at`, filter to last 7 days (`created_at >= now() - interval '7 days'`), deduplicate dates client-side, return sorted descending.

`fetchJobsByDate(dateStr)`: same join/shape as `fetchJobs()` but adds filter:
```js
.gte('created_at', `${dateStr}T00:00:00.000Z`)
.lt('created_at', `${nextDay}T00:00:00.000Z`)
```
where `nextDay` is computed as `dateStr` + 1 day in JS.

**`src/components/FindJobs.jsx`**:

- On mount (or when the feed tab is active), call `fetchFeedDates()` to populate a `feedDates` state array.
- Render a `<select>` dropdown above the job list showing dates. Format: `"Today (Mar 29)"`, `"Yesterday (Mar 28)"`, or `"Mar 27"`.
- `selectedDate` state defaults to the most recent available date.
- When `selectedDate` changes, call `fetchJobsByDate(selectedDate)` and update the jobs list.
- Existing Refresh button reloads dates + current day's jobs.

### Data Notes

`created_at` in `user_job_feed` is set by PostgreSQL `DEFAULT now()` on INSERT and is NOT updated on upsert (since `distribute_feed.py` never includes `created_at` in the payload). This means `created_at` reflects when the job first entered the user's feed — correct behavior for "Past Runs."

## Feature 2: Job ID Field

### Problem

When navigating to Networking after Job Analysis, the AI-drafted connection note has no Job ID to reference. The person receiving the note can't identify which specific posting the user applied to.

### Solution

Add an optional "Job ID" text input to the Job Analysis form next to Location. The value flows through `currentJob` to Networking, where `groq.js` already uses `job?.jobId` in the draft prompt.

### Architecture

**`src/components/JobAnalysis.jsx`**:

- Add `jobId` to local state: `const [jobId, setJobId] = useState(currentJob?.jobId || '')`
- Add input field in the form row alongside Location:
  ```
  [ Role ] [ Company ] [ Location ] [ Job ID (optional) ]
  ```
- Include in `syncToParent` call: `syncToParent({ company: co, role, location: loc, link, jd, jobId })`
- Include in the "Complete & Log" handler so it's saved with the application record if applicable.

**`src/App.jsx` / `currentJob` prop**:

- `currentJob` is a plain object passed as a prop. No schema change needed — just ensure `jobId` is included when `syncToParent` is called from JobAnalysis.

**`src/lib/groq.js`** — no changes needed. Already reads:
```js
const jobId = job?.id || job?.jobId || job?.job_id || '';
```
And already includes in connection note prompt:
```
- Job ID to reference if space allows: ${jobId}
```

### UX Notes

- Field is labeled "Job ID" with placeholder "e.g. 123456789".
- Optional — empty is fine, networking draft just omits the ID reference.
- No persistence to database required — it's a session field used only for drafting.
