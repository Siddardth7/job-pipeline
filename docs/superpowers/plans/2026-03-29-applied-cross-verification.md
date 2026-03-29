# Applied Cross-Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace cross-run history dedup in the pipeline with an applied-list triple-match filter so jobs recur in the feed until the user actually applies to them.

**Architecture:** Remove `_load_history`, `_filter_history`, `_update_history` and `JOB_HISTORY_PATH` from `company_intelligence.py`. Add `load_applied_by_user(sb)` to `distribute_feed.py` and check each job against the user's applied set (company + location + role title, normalized) before inserting into `user_job_feed`.

**Tech Stack:** Python 3.11, supabase-py, Supabase `applications` table (fields: `user_id`, `company`, `location`, `role`)

---

### Task 1: Remove history dedup from company_intelligence.py

**Files:**
- Modify: `pipeline/company_intelligence.py`

The goal is to remove all history-related code so every job that passes classification flows through to the output file. We remove: `JOB_HISTORY_PATH`, `_load_history()`, `_filter_history()`, `_update_history()`, and all call sites.

- [ ] **Step 1: Read the current file**

Read `pipeline/company_intelligence.py` fully before making any edits.

- [ ] **Step 2: Remove JOB_HISTORY_PATH constant**

Find and remove this line (around line 31):
```python
JOB_HISTORY_PATH = DATA_DIR / "job_history.json"
```

- [ ] **Step 3: Remove `history = _load_history()` from run()**

Find in the `run()` function (around line 52):
```python
history = _load_history()
```
Remove it.

- [ ] **Step 4: Fix the early-return call to _write_output**

Find (around line 56):
```python
_write_output([], [], {}, history, db)
```
Replace with:
```python
_write_output([], [], {}, db)
```

- [ ] **Step 5: Remove history filter + update calls from run()**

Find and remove these lines (around lines 126-133):
```python
    # Remove duplicates against historical job URLs
    green_jobs, yellow_jobs, history_dupes = _filter_history(
        green_jobs, yellow_jobs, history
    )
    log.info(f"  Removed {history_dupes} jobs already seen in history")

    # Add today's jobs to history
    _update_history(history, green_jobs + yellow_jobs)
```

- [ ] **Step 6: Remove history_dupes from stats dicts**

There are two `_write_output` calls in `run()` (the normal one ~line 136 and the ITAR-correction one ~line 168). In both, remove `"history_dupes": history_dupes,` from the stats dict. Also remove the `history` argument from both calls.

Normal call — change from:
```python
    _write_output(green_jobs, yellow_jobs,
                  {
                      "total_input": len(intermediate),
                      "dropped_red": dropped,
                      "history_dupes": history_dupes,
                      "promoted_companies": promoted,
                  },
                  history, db)
```
To:
```python
    _write_output(green_jobs, yellow_jobs,
                  {
                      "total_input": len(intermediate),
                      "dropped_red": dropped,
                      "promoted_companies": promoted,
                  },
                  db)
```

ITAR-correction call — change from:
```python
        _write_output(green_jobs, yellow_jobs,
                      {
                          "total_input": len(intermediate),
                          "dropped_red": dropped + len(itar_violations),
                          "history_dupes": history_dupes,
                          "promoted_companies": promoted,
                      },
                      history, db)
```
To:
```python
        _write_output(green_jobs, yellow_jobs,
                      {
                          "total_input": len(intermediate),
                          "dropped_red": dropped + len(itar_violations),
                          "promoted_companies": promoted,
                      },
                      db)
```

- [ ] **Step 7: Update _write_output signature and body**

Find `_write_output` function definition (around line 333):
```python
def _write_output(
    green: List[Dict], yellow: List[Dict],
    stats: Dict, history: List[Dict], db: Dict
):
    ...
    summary = {
        ...
        "duplicates_removed": stats.get("history_dupes", 0),
        ...
    }
```

Change to:
```python
def _write_output(
    green: List[Dict], yellow: List[Dict],
    stats: Dict, db: Dict
):
    ...
    summary = {
        ...
        "duplicates_removed": 0,
        ...
    }
```
(Keep `duplicates_removed: 0` in summary so the GitHub Actions summary script doesn't break.)

- [ ] **Step 8: Remove _filter_history, _update_history, _load_history functions**

Remove all three function definitions from the file. They are around lines 266-297 (`_filter_history`, `_update_history`) and lines 324-328 (`_load_history`). Delete each complete function block.

- [ ] **Step 9: Verify the file runs without syntax errors**

Run:
```bash
cd /Users/jashwanth/jobagent-web && python -c "import pipeline.company_intelligence"
```
Expected: no output (imports cleanly, no syntax errors)

- [ ] **Step 10: Commit**

```bash
git add pipeline/company_intelligence.py
git commit -m "feat: remove job_history dedup from company_intelligence pipeline"
```

---

### Task 2: Add applied-list filter in distribute_feed.py

**Files:**
- Modify: `pipeline/distribute_feed.py`
- Create: `tests/test_distribute_feed.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_distribute_feed.py`:

```python
"""Tests for distribute_feed applied-list triple-match filter."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from pipeline.distribute_feed import build_applied_set, is_applied


def test_exact_match_is_filtered():
    applied = {("acme corp", "austin, tx", "software engineer")}
    job = {"company_name": "Acme Corp", "location": "Austin, TX", "job_title": "Software Engineer"}
    assert is_applied(job, applied) is True


def test_partial_match_two_of_three_passes():
    applied = {("acme corp", "austin, tx", "software engineer")}
    job = {"company_name": "Acme Corp", "location": "Austin, TX", "job_title": "Senior Engineer"}
    assert is_applied(job, applied) is False


def test_empty_job_field_passes_through():
    applied = {("acme corp", "austin, tx", "software engineer")}
    job = {"company_name": "Acme Corp", "location": "", "job_title": "Software Engineer"}
    assert is_applied(job, applied) is False


def test_empty_applied_set_passes_all():
    applied = set()
    job = {"company_name": "Acme Corp", "location": "Austin, TX", "job_title": "Software Engineer"}
    assert is_applied(job, applied) is False


def test_build_applied_set_normalizes():
    rows = [{"company": "  Acme Corp  ", "location": "Austin, TX", "role": "Software ENGINEER"}]
    result = build_applied_set(rows)
    assert ("acme corp", "austin, tx", "software engineer") in result


def test_build_applied_set_empty_input():
    assert build_applied_set([]) == set()
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/jashwanth/jobagent-web && python -m pytest tests/test_distribute_feed.py -v 2>&1 | head -30
```
Expected: ImportError or AttributeError — `build_applied_set` and `is_applied` don't exist yet.

- [ ] **Step 3: Add build_applied_set and is_applied to distribute_feed.py**

Read `pipeline/distribute_feed.py` fully first. Then add these two functions after the `score_job_for_user` function (before the `# ── Main` section):

```python
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


def load_applied_by_user(sb) -> dict:
    """
    Fetch all application rows from Supabase.
    Returns dict[user_id -> set of (company, location, role) tuples].
    Fails open: returns empty dict on error.
    """
    try:
        result = sb.table("applications").select("user_id, company, location, role").execute()
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
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/jashwanth/jobagent-web && python -m pytest tests/test_distribute_feed.py -v
```
Expected: 6 tests PASS

- [ ] **Step 5: Wire load_applied_by_user into run()**

Read the `run()` function in `distribute_feed.py`. After `users = load_users()`, add:

```python
    # Load applied jobs for all users (used to skip already-applied jobs in feed)
    applied_by_user = load_applied_by_user(sb)
    log.info(f"Loaded applied sets for {len(applied_by_user)} users")
```

Then inside the per-user loop (the `for user in users:` block), after `job_id = job.get("id") or job.get("job_url", "")[:100]` and before the `score_job_for_user` call, add:

```python
            # Skip jobs already in the user's Applied list
            applied_set = applied_by_user.get(user["user_id"], set())
            if is_applied(job, applied_set):
                continue
```

The full inner loop after the change should look like:
```python
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
            ...
```

- [ ] **Step 6: Verify no syntax errors**

```bash
cd /Users/jashwanth/jobagent-web && python -c "import pipeline.distribute_feed"
```
Expected: no output

- [ ] **Step 7: Run Python tests**

```bash
cd /Users/jashwanth/jobagent-web && pip install pytest -q && python -m pytest tests/test_distribute_feed.py -v
```
Expected: 6 tests PASS

- [ ] **Step 7b: Run JS test suite**

```bash
cd /Users/jashwanth/jobagent-web && npm test
```
Expected: all vitest tests pass

- [ ] **Step 8: Commit**

```bash
git add pipeline/distribute_feed.py tests/test_distribute_feed.py
git commit -m "feat: add applied-list cross-verification filter to feed distribution"
```
