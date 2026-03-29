# Frontend Feed Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Past Runs date selector to Find Jobs (last 7 days from Supabase) and a Job ID field to Job Analysis (flows to networking AI draft automatically).

**Architecture:** Add two storage functions for date-filtered feed queries; add date-selector UI to FindJobs feed tab; add jobId state + input to JobAnalysis and wire through syncToParent. No schema changes needed — `created_at` in `user_job_feed` already reflects first-seen date.

**Tech Stack:** React 18, Supabase JS client, Vitest, lucide-react v0.263

---

### Task 1: Add fetchFeedDates and fetchJobsByDate to storage.js

**Files:**
- Modify: `src/lib/storage.js`
- Test: `tests/storage-feed-dates.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/storage-feed-dates.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase module
vi.mock('../src/supabase.js', () => ({
  supabase: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from: vi.fn(),
  },
}));

import { supabase } from '../src/supabase.js';
import { fetchFeedDates } from '../src/lib/storage.js';

describe('fetchFeedDates', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns sorted unique date strings descending', async () => {
    const rows = [
      { created_at: '2026-03-29T10:00:00Z' },
      { created_at: '2026-03-29T11:00:00Z' },
      { created_at: '2026-03-28T09:00:00Z' },
      { created_at: '2026-03-27T08:00:00Z' },
    ];
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: rows, error: null }),
    });

    const dates = await fetchFeedDates();
    expect(dates).toEqual(['2026-03-29', '2026-03-28', '2026-03-27']);
  });

  it('returns empty array when no rows', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const dates = await fetchFeedDates();
    expect(dates).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/jashwanth/jobagent-web && npm test -- tests/storage-feed-dates.test.js 2>&1 | tail -20
```
Expected: FAIL — `fetchFeedDates is not a function` or named export not found.

- [ ] **Step 3: Add fetchFeedDates to storage.js**

Read `src/lib/storage.js`. Add after the `fetchJobs()` function (after line ~113):

```js
// Returns sorted unique date strings (YYYY-MM-DD) for the last 7 days that have feed rows
// e.g. ['2026-03-29', '2026-03-28']
export async function fetchFeedDates() {
  const userId = await getUserId();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('user_job_feed')
    .select('created_at')
    .eq('user_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const seen = new Set();
  const dates = [];
  for (const row of (data || [])) {
    const d = row.created_at.slice(0, 10); // 'YYYY-MM-DD'
    if (!seen.has(d)) { seen.add(d); dates.push(d); }
  }
  return dates; // already descending
}

// Returns jobs for a specific date in YYYY-MM-DD format (same shape as fetchJobs())
export async function fetchJobsByDate(dateStr) {
  const userId = await getUserId();
  const start  = `${dateStr}T00:00:00.000Z`;
  const end    = new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('user_job_feed')
    .select(`
      *,
      job:normalized_jobs (
        id, job_title, company_name, job_url, location, posted_date,
        description, source, itar_flag, tier, h1b, industry,
        verdict, relevance_score, boost_tags
      )
    `)
    .eq('user_id', userId)
    .gte('created_at', start)
    .lt('created_at', end)
    .order('created_at', { ascending: false });
  if (error) throw error;

  return (data || []).map(row => ({
    id:               row.job_id,
    role:             row.job?.job_title       ?? null,
    company:          row.job?.company_name    ?? null,
    link:             row.job?.job_url         ?? null,
    location:         row.job?.location        ?? null,
    posted:           row.job?.posted_date     ?? null,
    jd:               row.job?.description     ?? null,
    source:           row.job?.source          ?? null,
    itar_flag:        row.job?.itar_flag       ?? false,
    tier:             row.job?.tier            ?? null,
    h1b:              row.job?.h1b             ?? null,
    industry:         row.job?.industry        ?? null,
    verdict:          row.job?.verdict         ?? null,
    match:            row.user_relevance_score ?? row.job?.relevance_score ?? null,
    in_pipeline:      row.in_pipeline,
    pipeline_added_at: row.pipeline_added_at,
    analysis_result:  row.analysis_result,
    analysisResult:   row.analysis_result,
    resume_variant:   row.resume_variant,
    resumeVariant:    row.resume_variant,
    status:           row.status,
    locationType:     null,
    _feedId:          row.id,
  }));
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/jashwanth/jobagent-web && npm test -- tests/storage-feed-dates.test.js
```
Expected: 2 tests PASS

- [ ] **Step 5: Run full test suite**

```bash
cd /Users/jashwanth/jobagent-web && npm test
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/storage.js tests/storage-feed-dates.test.js
git commit -m "feat: add fetchFeedDates and fetchJobsByDate to storage.js"
```

---

### Task 2: Add Past Runs date selector to FindJobs.jsx

**Files:**
- Modify: `src/components/FindJobs.jsx`

- [ ] **Step 1: Read the current file**

Read `src/components/FindJobs.jsx` fully before making any edits.

- [ ] **Step 2: Add imports**

At the top of `FindJobs.jsx`, add `fetchFeedDates` and `fetchJobsByDate` to the existing storage import:

Change:
```js
import { fetchJobs } from '../lib/storage.js';
```
To:
```js
import { fetchJobs, fetchFeedDates, fetchJobsByDate } from '../lib/storage.js';
```

- [ ] **Step 3: Add feedDates and selectedDate state**

In the component body, after the existing `useState` declarations, add:

```js
  const [feedDates, setFeedDates]       = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
```

- [ ] **Step 4: Update handleRefresh to also load dates**

The current `handleRefresh` is:
```js
  const handleRefresh = async () => {
    setLoading(true);
    setError("");
    try {
      const jobs = await fetchJobs();
      setSearchResults(jobs.filter(j => !j.in_pipeline));
      setLastUpdated(new Date().toISOString());
    } catch(e) {
      setError("Failed to load feed: " + e.message);
    }
    setLoading(false);
  };
```

Replace it with:
```js
  const handleRefresh = async () => {
    setLoading(true);
    setError("");
    try {
      const [jobs, dates] = await Promise.all([fetchJobs(), fetchFeedDates()]);
      setSearchResults(jobs.filter(j => !j.in_pipeline));
      setFeedDates(dates);
      setSelectedDate(dates[0] || '');
      setLastUpdated(new Date().toISOString());
    } catch(e) {
      setError("Failed to load feed: " + e.message);
    }
    setLoading(false);
  };
```

- [ ] **Step 5: Add handleDateChange handler**

After `handleRefresh`, add:

```js
  const handleDateChange = async (dateStr) => {
    setSelectedDate(dateStr);
    setLoading(true);
    setError("");
    try {
      const jobs = await fetchJobsByDate(dateStr);
      setSearchResults(jobs.filter(j => !j.in_pipeline));
    } catch(e) {
      setError("Failed to load feed for date: " + e.message);
    }
    setLoading(false);
  };
```

- [ ] **Step 6: Add date selector dropdown in the feed tab UI**

Read the feed tab section of `FindJobs.jsx` (look for the `{/* TAB: Your Feed */}` comment, around line 157). Find the row that contains the Refresh button. Add the date selector immediately before or after the Refresh button row.

The date label helper (add as a `const` inside the component, before the return):
```js
  const formatDateLabel = (d) => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (d === today)     return `Today (${d})`;
    if (d === yesterday) return `Yesterday (${d})`;
    return d;
  };
```

Add the dropdown inside the feed tab, right above the Refresh button (find the div containing the Refresh `<button>`):
```jsx
{feedDates.length > 1 && (
  <select
    value={selectedDate}
    onChange={e => handleDateChange(e.target.value)}
    style={{
      background: t.card, border: `1px solid ${t.border}`, borderRadius: 8,
      padding: '6px 10px', color: t.tx, fontSize: 13, fontFamily: 'inherit',
      cursor: 'pointer', outline: 'none',
    }}
  >
    {feedDates.map(d => (
      <option key={d} value={d}>{formatDateLabel(d)}</option>
    ))}
  </select>
)}
```

- [ ] **Step 7: Build to confirm no errors**

```bash
cd /Users/jashwanth/jobagent-web && npm run build 2>&1 | tail -20
```
Expected: build succeeds with no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/FindJobs.jsx
git commit -m "feat: add past runs date selector to FindJobs feed tab"
```

---

### Task 3: Add Job ID field to JobAnalysis.jsx

**Files:**
- Modify: `src/components/JobAnalysis.jsx`

`groq.js` already reads `job?.jobId` and includes it in the networking prompt — no changes needed there. We just need to add the field to the form and wire it through.

- [ ] **Step 1: Read the current file**

Read `src/components/JobAnalysis.jsx` fully before making any edits.

- [ ] **Step 2: Add jobId state**

In the component body (around line 377 where `co`, `role`, `loc`, `link`, `jd` are declared), add:

```js
  const [jobId, setJobId] = useState(currentJob?.jobId || "");
```

- [ ] **Step 3: Sync jobId from currentJob**

In the `useEffect` that syncs from `currentJob` (around line 392-401), add `jobId` sync:

Find:
```js
    if (currentJob) {
      setCo(currentJob.company || "");
      setRole(currentJob.role || "");
      setLoc(currentJob.location || "");
      setLink(currentJob.link || "");
      setJd(currentJob.jd || "");
      setResult(currentJob.analysisResult || null);
```
Replace with:
```js
    if (currentJob) {
      setCo(currentJob.company || "");
      setRole(currentJob.role || "");
      setLoc(currentJob.location || "");
      setJobId(currentJob.jobId || "");
      setLink(currentJob.link || "");
      setJd(currentJob.jd || "");
      setResult(currentJob.analysisResult || null);
```

Also add `currentJob?.jobId` to the dependency array of the useEffect:

Find the dep array (around line 401):
```js
  }, [currentJob?.id, currentJob?.location, currentJob?.company, currentJob?.role, currentJob?.jd]);
```
Replace with:
```js
  }, [currentJob?.id, currentJob?.location, currentJob?.company, currentJob?.role, currentJob?.jd, currentJob?.jobId]);
```

- [ ] **Step 4: Add Job ID input field in the form**

Find where the Location input is rendered. It will look roughly like:
```jsx
<input value={loc} onChange={handleLocChange} placeholder="Location" ... />
```

After the Location input, add:
```jsx
<input
  value={jobId}
  onChange={e => { setJobId(e.target.value); syncToParent({ jobId: e.target.value }); }}
  placeholder="Job ID (optional)"
  style={{flex:1, background:t.bg, border:`1px solid ${t.border}`, borderRadius:8, padding:'8px 12px', color:t.tx, fontSize:13, fontFamily:'inherit', outline:'none'}}
/>
```

Match the existing input style — copy `style` from the Location or Role input in the same row.

- [ ] **Step 5: Include jobId in the Find Contacts syncToParent call**

Find (around line 882):
```js
<Btn onClick={() => { syncToParent({company:co,role,location:loc,link,jd}); setPage("networking"); }} t={t}>
```
Replace with:
```js
<Btn onClick={() => { syncToParent({company:co,role,location:loc,link,jd,jobId}); setPage("networking"); }} t={t}>
```

- [ ] **Step 6: Build to confirm no errors**

```bash
cd /Users/jashwanth/jobagent-web && npm run build 2>&1 | tail -20
```
Expected: build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/JobAnalysis.jsx
git commit -m "feat: add Job ID field to Job Analysis, wired to networking draft"
```

---

### Task 4: Deploy

- [ ] **Step 1: Run full test suite one final time**

```bash
cd /Users/jashwanth/jobagent-web && npm test
```
Expected: all tests pass.

- [ ] **Step 2: Push to origin**

```bash
git push origin main
```
Expected: push succeeds, Vercel auto-deployment triggers.

- [ ] **Step 3: Verify Vercel deployment**

```bash
cd /Users/jashwanth/jobagent-web && npx vercel --prod 2>&1 | tail -10
```
Expected: deployment URL printed, status: Ready.
