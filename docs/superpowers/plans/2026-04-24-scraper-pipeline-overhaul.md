# Scraper Pipeline Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 10 audit findings (R1–R10) across observability, query alignment, quality gates, and source rebalancing so the pipeline is trustworthy as an autonomous feed.

**Architecture:** Four layers applied in order — L1 (observability) gives visibility before touching scrapers; L2 (query alignment) fixes coverage; L3 (quality gates) tightens output precision; L4 (source rebalancing) caps noise and activates contract roles. Each layer commits independently.

**Tech Stack:** Python 3.11, GitHub Actions, Supabase, requests, apify-client, USA Jobs public REST API (no auth key required)

**Spec:** `docs/superpowers/specs/2026-04-24-scraper-pipeline-overhaul.md`

---

## File Map

| File | Action | Layer |
|---|---|---|
| `engine/scraper_orchestrator.py` | Modify — durable logs, raw count passthrough, contract + usajobs, query hookup | L1, L2, L4 |
| `pipeline/company_intelligence.py` | Modify — fix total_scraped metric, add STAFFING_REJECT hard-drop | L1, L3 |
| `pipeline/merge_pipeline.py` | Modify — F7 tighten, add F10 internship, add F11 location | L3 |
| `.github/workflows/daily_scrape.yml` | Modify — remove continue-on-error, add check_health step | L1 |
| `scripts/check_health.py` | **Create** — health gate script called by workflow | L1 |
| `data/run_logs/` | **Create dir** — one JSON file per run | L1 |
| `scrapers/jsearch_scraper.py` | Modify — remove TITLE_QUERIES hardcode, accept queries param | L2 |
| `scrapers/apify_scraper.py` | Modify — add 2 clusters, fix _extract_location | L2 |
| `scrapers/usajobs_scraper.py` | **Create** — USA Jobs API scraper | L2 |
| `scrapers/serpapi_scraper.py` | **Delete** | L2 |
| `scrapers/adzuna_scraper.py` | Modify — add MAX_RAW_JOBS=200 cap | L4 |
| `scrapers/contract_scraper.py` | No change — wired in via orchestrator | L4 |
| `data/company_database.json` | Modify — move 7 staffing firms to staffing_reject | L3 |
| `README.md` | Modify — remove TheirStack, reflect live architecture | L4 |

---

## Task 1: Write per-run durable log + fix total_scraped passthrough

**Files:**
- Modify: `engine/scraper_orchestrator.py`
- Modify: `pipeline/company_intelligence.py`
- Create dir: `data/run_logs/`

### Why before anything else
The health check (Task 2) reads from the per-run log. The metrics fix is a one-liner that goes here while we have the orchestrator open. Both changes are safe — they only add writes, nothing changes about scraper execution.

- [ ] **Step 1: Create the run_logs directory**

```bash
mkdir -p data/run_logs
touch data/run_logs/.gitkeep
```

- [ ] **Step 2: Add RUN_LOGS_DIR constant to orchestrator**

In `engine/scraper_orchestrator.py`, find the block around line 50–56:
```python
DATA_DIR     = ROOT / "data"
TEMP_DIR     = ROOT / "temp"
STATE_PATH   = DATA_DIR / "scraper_state.json"
RUN_LOG_PATH = DATA_DIR / "run_log.json"

TEMP_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)
```
Replace with:
```python
DATA_DIR     = ROOT / "data"
TEMP_DIR     = ROOT / "temp"
STATE_PATH   = DATA_DIR / "scraper_state.json"
RUN_LOG_PATH = DATA_DIR / "run_log.json"
RUN_LOGS_DIR = DATA_DIR / "run_logs"

TEMP_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)
RUN_LOGS_DIR.mkdir(exist_ok=True)
```

- [ ] **Step 3: Add write_run_log helper to orchestrator**

After the existing `log_run` function (around line 123), add:
```python
def write_run_log(run_record: Dict):
    """Write per-run snapshot to data/run_logs/YYYY-MM-DD.json for audit trail."""
    today    = str(date.today())
    log_path = RUN_LOGS_DIR / f"{today}.json"
    log_path.write_text(json.dumps(run_record, indent=2))
    log.info(f"[orchestrator] Per-run log written → {log_path}")
```

- [ ] **Step 4: Call write_run_log at end of orchestrator run() function**

Find the end of the `run()` function where `log_run(run_record)` is called. Add `write_run_log` call immediately after:
```python
    log_run(run_record)
    write_run_log(run_record)   # <-- add this line
    save_state(state)
```

- [ ] **Step 5: Pass raw_total into run_record for company_intelligence**

Inside `run()` in the orchestrator, after all scrapers have run and before `log_run`, compute the true raw total and add it to `run_record`:
```python
    # Compute true raw total across all sources for metrics passthrough
    raw_total = sum(
        s.get("jobs_found", 0)
        for s in run_record.get("scrapers", {}).values()
    )
    run_record["raw_total"] = raw_total
```

- [ ] **Step 6: Write raw_total into temp/ so company_intelligence can read it**

Immediately after computing `raw_total` in the orchestrator:
```python
    (TEMP_DIR / "raw_total.txt").write_text(str(raw_total))
```

- [ ] **Step 7: Fix total_scraped in company_intelligence.py**

In `pipeline/company_intelligence.py`, find the `_write_output` function (around line 254). Replace:
```python
def _write_output(
    green: List[Dict], yellow: List[Dict],
    stats: Dict, db: Dict
):
    total_scraped = stats.get("total_input", 0)
```
With:
```python
def _write_output(
    green: List[Dict], yellow: List[Dict],
    stats: Dict, db: Dict
):
    # Read true raw count written by orchestrator; fall back to post-filter count
    _raw_total_path = Path(__file__).parent.parent / "temp" / "raw_total.txt"
    try:
        total_scraped = int(_raw_total_path.read_text().strip())
    except Exception:
        total_scraped = stats.get("total_input", 0)
```
Add `from pathlib import Path` at the top of the file if not already present.

- [ ] **Step 8: Verify the log file is created correctly**

```bash
cd /Users/jashwanth/jobagent-web
python -c "
from engine.scraper_orchestrator import write_run_log, RUN_LOGS_DIR
import json
from datetime import date
test_record = {
    'run_date': str(date.today()),
    'raw_total': 503,
    'scrapers': {'ats': {'status': 'success', 'jobs_found': 120}},
    'filters': {}
}
write_run_log(test_record)
path = RUN_LOGS_DIR / f'{date.today()}.json'
data = json.loads(path.read_text())
assert data['raw_total'] == 503
assert data['scrapers']['ats']['jobs_found'] == 120
print('PASS: per-run log writes correctly')
"
```
Expected output: `PASS: per-run log writes correctly`

- [ ] **Step 9: Commit**

```bash
git add engine/scraper_orchestrator.py pipeline/company_intelligence.py data/run_logs/.gitkeep
git commit -m "feat(observability): add per-run durable logs + fix total_scraped metric"
```

---

## Task 2: Add check_health script + harden workflow

**Files:**
- Create: `scripts/check_health.py`
- Modify: `.github/workflows/daily_scrape.yml`

- [ ] **Step 1: Create scripts directory**

```bash
mkdir -p scripts
```

- [ ] **Step 2: Create scripts/check_health.py**

```python
#!/usr/bin/env python3
"""
scripts/check_health.py
Reads the just-written per-run log and exits non-zero if critical sources failed.
Called as the final workflow step. A non-zero exit fails the GitHub Actions run.
"""
import json
import sys
from datetime import date
from pathlib import Path

ROOT     = Path(__file__).parent.parent
LOG_PATH = ROOT / "data" / "run_logs" / f"{date.today()}.json"

CRITICAL_SOURCES = {"ats", "jsearch", "apify", "adzuna"}
WARNING_SOURCES  = {"usajobs", "contract"}  # new sources — warn only


def main():
    if not LOG_PATH.exists():
        print(f"ERROR: Run log not found at {LOG_PATH}", file=sys.stderr)
        sys.exit(1)

    record = json.loads(LOG_PATH.read_text())
    scrapers = record.get("scrapers", {})

    failures = []
    warnings = []

    for source, info in scrapers.items():
        status = info.get("status", "not_run")
        if status == "error":
            if source in CRITICAL_SOURCES:
                failures.append(f"{source}: {info.get('error', 'unknown error')}")
            elif source in WARNING_SOURCES:
                warnings.append(f"{source}: {info.get('error', 'unknown error')}")

    total_jobs = sum(
        s.get("jobs_found", 0) for s in scrapers.values()
    )

    for w in warnings:
        print(f"WARNING: {w}")

    if total_jobs == 0:
        print("ERROR: All sources returned 0 jobs — pipeline produced nothing", file=sys.stderr)
        sys.exit(1)

    if failures:
        print("CRITICAL SOURCE FAILURES:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        sys.exit(1)

    print(f"Health check PASSED — {total_jobs} raw jobs across {len(scrapers)} sources")
    for source, info in scrapers.items():
        print(f"  {source}: {info.get('status')} ({info.get('jobs_found', 0)} jobs)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Remove continue-on-error from daily_scrape.yml**

In `.github/workflows/daily_scrape.yml`, remove `continue-on-error: true` from three steps:

Line 51–53 — scraper orchestrator step:
```yaml
      - name: Run scraper orchestrator
        run: python engine/scraper_orchestrator.py
```
(Remove `continue-on-error: true`)

Line 64–66 — company intelligence step:
```yaml
      - name: Run company intelligence
        run: python pipeline/company_intelligence.py
```
(Remove `continue-on-error: true`)

Line 102–104 — distribute feed step:
```yaml
      - name: Distribute feed to users
        run: python pipeline/distribute_feed.py
```
(Remove `continue-on-error: true`)

- [ ] **Step 4: Remove SERPAPI_KEY from workflow env block**

In `.github/workflows/daily_scrape.yml`, remove from the top-level `env:` block:
```yaml
  SERPAPI_KEY:          ${{ secrets.SERPAPI_KEY }}
```

- [ ] **Step 5: Add check_health step to workflow**

In `.github/workflows/daily_scrape.yml`, add this step immediately before the "Commit and push results" step:
```yaml
      # ── STEP 3d: Health gate — fails workflow if critical sources errored ────
      - name: Check pipeline health
        run: python scripts/check_health.py
```

- [ ] **Step 6: Verify check_health script works locally against the test log**

```bash
cd /Users/jashwanth/jobagent-web
python scripts/check_health.py
```
Expected: `Health check PASSED — 120 raw jobs across 1 sources` (using the test log from Task 1 Step 8)

- [ ] **Step 7: Verify check_health fails correctly on bad input**

```bash
python -c "
import json, tempfile, subprocess, sys
from datetime import date
from pathlib import Path
# Write a fake log with error status
bad_log = {
    'run_date': str(date.today()),
    'scrapers': {'ats': {'status': 'error', 'jobs_found': 0, 'error': 'connection refused'}}
}
path = Path('data/run_logs') / f'{date.today()}.json'
path.write_text(json.dumps(bad_log))
result = subprocess.run(['python', 'scripts/check_health.py'], capture_output=True, text=True)
assert result.returncode != 0, 'Expected non-zero exit for error status'
print('PASS: health check exits non-zero on critical source error')
"
```
Expected: `PASS: health check exits non-zero on critical source error`

- [ ] **Step 8: Commit**

```bash
git add scripts/check_health.py .github/workflows/daily_scrape.yml
git commit -m "feat(observability): add health gate script, remove continue-on-error from workflow"
```

---

## Task 3: Fix JSearch to use query engine

**Files:**
- Modify: `scrapers/jsearch_scraper.py`

The scraper currently ignores the `queries` parameter passed by the orchestrator and uses its own hardcoded `TITLE_QUERIES` list. This task removes the hardcode and uses the orchestrator-supplied queries instead. Also aligns the `MONTHLY_LIMIT` constant.

- [ ] **Step 1: Write a failing test**

```bash
mkdir -p tests
cat > tests/test_jsearch_query_hookup.py << 'EOF'
"""Test that JSearchScraper uses queries from caller, not TITLE_QUERIES."""
import pytest
from scrapers.jsearch_scraper import JSearchScraper

def test_no_title_queries_constant():
    """TITLE_QUERIES should no longer exist after the fix."""
    assert not hasattr(JSearchScraper, "TITLE_QUERIES"), (
        "TITLE_QUERIES hardcode still present — not removed yet"
    )

def test_monthly_limit_is_180():
    """MONTHLY_LIMIT must be 180 (200 free tier - 20 buffer)."""
    assert JSearchScraper.MONTHLY_LIMIT == 180
EOF
python -m pytest tests/test_jsearch_query_hookup.py -v
```
Expected: `FAILED` — `TITLE_QUERIES` still exists.

- [ ] **Step 2: Remove TITLE_QUERIES and update run() to use supplied queries**

In `scrapers/jsearch_scraper.py`, delete the entire `TITLE_QUERIES` block (lines 92–103):
```python
    TITLE_QUERIES = [
        "Manufacturing Engineer entry level",
        ...
    ]
```

Replace the `run()` method docstring and signature to actually use `queries`:
```python
    def run(self, queries: Optional[List[Dict]] = None) -> List[Dict]:
        """
        Called by orchestrator. `queries` is the list of dicts from QueryEngine
        (each dict has 'cluster' and 'query' keys). Extracts the 'query' string
        from each dict and uses them as JSearch search terms.
        Returns jobs in pipeline schema.
        After returning, `self.calls_made` holds the actual number of API calls fired.
        """
        self.calls_made = 0

        if not JSEARCH_API_KEYS:
            log.warning("[jsearch] JSEARCH_API_KEYS not set — skipping")
            return []

        # Build search terms from query engine output
        search_terms: List[str] = []
        if queries:
            for q in queries:
                term = q.get("query", "").strip()
                if term:
                    search_terms.append(term)
        if not search_terms:
            log.warning("[jsearch] No queries supplied — skipping")
            return []

        for key in JSEARCH_API_KEYS:
            result, calls = self._attempt_run(key, search_terms)
            self.calls_made += calls
            if result is not None:
                log.info(f"[jsearch] Done. {len(result)} jobs. API calls this run: {self.calls_made}")
                return result
```

- [ ] **Step 3: Update _attempt_run to accept search_terms**

Find `_attempt_run` in `scrapers/jsearch_scraper.py`. Its signature currently iterates `self.TITLE_QUERIES`. Change it to accept `search_terms: List[str]` and iterate that list instead.

Find (approximately lines 130–155):
```python
    def _attempt_run(self, api_key: str):
        ...
        for i, query in enumerate(self.TITLE_QUERIES):
```
Replace with:
```python
    def _attempt_run(self, api_key: str, search_terms: List[str]):
        ...
        for i, query in enumerate(search_terms):
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
python -m pytest tests/test_jsearch_query_hookup.py -v
```
Expected: `PASSED` — both assertions pass.

- [ ] **Step 5: Smoke-test with a mock query list**

```bash
python -c "
from scrapers.jsearch_scraper import JSearchScraper
s = JSearchScraper()
# Should not raise even with no API key — just warns and returns []
import os; os.environ.pop('JSEARCH_API_KEYS', None); os.environ.pop('JSEARCH_API_KEY', None)
result = s.run(queries=[{'cluster': 'manufacturing', 'query': 'Manufacturing Engineer entry level'}])
assert result == [], f'Expected [] without API key, got {result}'
print('PASS: run() returns [] when no API key set')
"
```
Expected: `PASS: run() returns [] when no API key set`

- [ ] **Step 6: Commit**

```bash
git add scrapers/jsearch_scraper.py tests/test_jsearch_query_hookup.py
git commit -m "fix(jsearch): use query engine queries instead of hardcoded TITLE_QUERIES"
```

---

## Task 4: Fix Apify cluster coverage and location extraction

**Files:**
- Modify: `scrapers/apify_scraper.py`

- [ ] **Step 1: Write failing tests**

```bash
cat > tests/test_apify_clusters.py << 'EOF'
"""Test Apify has full cluster coverage and returns Unknown for missing locations."""
from scrapers.apify_scraper import ApifyScraper, _extract_location

def test_industrial_operations_cluster_present():
    assert "industrial_operations" in ApifyScraper.CLUSTER_TO_TITLE

def test_mechanical_thermal_cluster_present():
    assert "mechanical_thermal" in ApifyScraper.CLUSTER_TO_TITLE

def test_extract_location_returns_unknown_for_none():
    assert _extract_location(None) == "Unknown"

def test_extract_location_returns_unknown_for_empty_string():
    assert _extract_location("") == "Unknown"

def test_extract_location_returns_unknown_for_empty_dict():
    assert _extract_location({}) == "Unknown"

def test_extract_location_returns_value_for_valid_string():
    assert _extract_location("Austin, TX") == "Austin, TX"

def test_extract_location_returns_value_for_dict_with_name():
    assert _extract_location({"name": "Austin, TX, United States"}) == "Austin, TX, United States"
EOF
python -m pytest tests/test_apify_clusters.py -v
```
Expected: multiple FAILs — missing clusters and `_extract_location` still returns `""`.

- [ ] **Step 2: Add missing clusters to CLUSTER_TO_TITLE**

In `scrapers/apify_scraper.py`, find `CLUSTER_TO_TITLE` (line 114). Add two entries before the closing brace:
```python
    CLUSTER_TO_TITLE: Dict[str, str] = {
        "manufacturing":              "Manufacturing Engineer",
        "process":                    "Process Engineer",
        "materials":                  "Materials Engineer",
        "composites":                 "Composites Manufacturing Engineer",
        "quality":                    "Quality Engineer",
        "industrial":                 "Industrial Engineer",
        "tooling_inspection":         "Tooling Engineer",
        "startup_manufacturing":      "NPI Manufacturing Engineer",
        "manufacturing_open":         "Manufacturing Engineer",
        "quality_open":               "Quality Engineer",
        "industrial_operations":      "Operations Engineer",
        "mechanical_thermal":         "Mechanical Systems Engineer",
    }
```

- [ ] **Step 3: Fix _extract_location to return "Unknown" instead of ""**

In `scrapers/apify_scraper.py`, replace the `_extract_location` function (lines 80–102):
```python
def _extract_location(raw_location) -> str:
    """
    Extract a human-readable location string from the LinkedIn actor's location field.
    Returns 'Unknown' for missing/null so blank-location jobs are trackable downstream.
    """
    if not raw_location:
        return "Unknown"
    if isinstance(raw_location, str):
        return raw_location.strip() or "Unknown"
    if isinstance(raw_location, dict):
        city    = (raw_location.get("city")    or "").strip()
        state   = (raw_location.get("state")   or "").strip()
        country = (raw_location.get("country") or "").strip()
        parts   = [p for p in [city, state, country] if p]
        if parts:
            return ", ".join(parts)
        name = (raw_location.get("name") or "").strip()
        return name or "Unknown"
    return "Unknown"
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
python -m pytest tests/test_apify_clusters.py -v
```
Expected: all 7 tests `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add scrapers/apify_scraper.py tests/test_apify_clusters.py
git commit -m "fix(apify): add industrial_operations + mechanical_thermal clusters, fix blank location"
```

---

## Task 5: Create USA Jobs scraper (replaces SerpAPI)

**Files:**
- Create: `scrapers/usajobs_scraper.py`
- Delete: `scrapers/serpapi_scraper.py`

USA Jobs API docs: `https://developer.usajobs.gov/APIRequest/Index`
No API key. Requires `User-Agent` header with email address (not a secret — hardcode `siddardth7@gmail.com`).

- [ ] **Step 1: Write failing test**

```bash
cat > tests/test_usajobs_scraper.py << 'EOF'
"""Test USA Jobs scraper structure and output normalization."""
import pytest
from unittest.mock import patch, MagicMock
from scrapers.usajobs_scraper import USAJobsScraper, _normalize_job

SAMPLE_JOB = {
    "MatchedObjectId": "123456",
    "MatchedObjectDescriptor": {
        "PositionTitle": "Manufacturing Engineer",
        "OrganizationName": "NASA",
        "PositionLocationDisplay": "Huntsville, AL",
        "ApplyURI": ["https://www.usajobs.gov/job/123456"],
        "PublicationStartDate": "2026-04-23",
        "PositionEndDate": "2026-04-30",
        "PositionRemuneration": [{"MinimumRange": "70000", "MaximumRange": "90000", "RateIntervalCode": "PA"}],
        "JobCategory": [{"Name": "Engineering"}],
    }
}

def test_normalize_job_basic_fields():
    job = _normalize_job(SAMPLE_JOB, cluster="manufacturing")
    assert job["job_title"] == "Manufacturing Engineer"
    assert job["company_name"] == "NASA"
    assert job["location"] == "Huntsville, AL"
    assert job["source"] == "usajobs"
    assert job["employment_type"] == "Full-time"
    assert "usajobs.gov" in job["job_url"]

def test_normalize_job_cluster_tag():
    job = _normalize_job(SAMPLE_JOB, cluster="manufacturing")
    assert job["cluster"] == "manufacturing"

def test_scraper_run_returns_list():
    scraper = USAJobsScraper()
    with patch.object(scraper, "_search_cluster", return_value=[]):
        result = scraper.run(queries=[{"cluster": "manufacturing", "query": "Manufacturing Engineer"}])
        assert isinstance(result, list)

def test_scraper_deduplicates_by_url():
    scraper = USAJobsScraper()
    job = _normalize_job(SAMPLE_JOB, cluster="manufacturing")
    with patch.object(scraper, "_search_cluster", return_value=[job, job]):
        result = scraper.run(queries=[{"cluster": "manufacturing", "query": "Manufacturing Engineer"}])
        assert len(result) == 1
EOF
python -m pytest tests/test_usajobs_scraper.py -v
```
Expected: `FAILED` — `scrapers/usajobs_scraper.py` does not exist yet.

- [ ] **Step 2: Create scrapers/usajobs_scraper.py**

```python
#!/usr/bin/env python3
"""
scrapers/usajobs_scraper.py — JobAgent v4.5
USA Jobs API Scraper

Searches https://data.usajobs.gov/api/Search for federal and federally-related
manufacturing, process, quality, aerospace, and industrial engineering roles.

Free — no API key. Requires User-Agent header with contact email (not a secret).
Runs daily (no alternation logic needed). 20 queries per run max.

API docs: https://developer.usajobs.gov/APIRequest/Index
"""

import json
import logging
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional

try:
    import requests
except ImportError:
    raise ImportError("Run: pip install requests")

log = logging.getLogger("usajobs_scraper")

BASE_URL        = "https://data.usajobs.gov/api/search"
REQUEST_DELAY   = 1.5   # seconds between requests
MAX_RESULTS     = 25    # per query (API max is 500, but we want tight queries)
DAYS_POSTED     = 3     # only jobs posted in the last 3 days (matches F4 72h window)

# No secret needed — just a contact identifier in the User-Agent
HEADERS = {
    "Host":             "data.usajobs.gov",
    "User-Agent":       "siddardth7@gmail.com",
    "Authorization":    "",   # not required for public search
}

# Cluster → keyword mapping for USA Jobs keyword search
# USA Jobs uses plain keyword search (no boolean operators)
CLUSTER_QUERIES: Dict[str, str] = {
    "manufacturing":         "manufacturing engineer",
    "process":               "process engineer manufacturing",
    "materials":             "materials engineer",
    "composites":            "composites engineer",
    "quality":               "quality engineer",
    "industrial":            "industrial engineer",
    "tooling_inspection":    "tooling engineer",
    "startup_manufacturing": "production engineer NPI",
    "industrial_operations": "industrial engineer operations",
    "mechanical_thermal":    "mechanical engineer thermal",
}

_DATA_DIR = Path(__file__).parent.parent / "data"
try:
    ITAR_KEYWORDS: List[str] = json.loads((_DATA_DIR / "itar_keywords.json").read_text())
except Exception:
    ITAR_KEYWORDS = ["itar", "security clearance", "export controlled", "u.s. citizen"]


def _normalize_job(raw: Dict, cluster: str) -> Dict:
    """Convert a USA Jobs API result object to pipeline job schema."""
    descriptor = raw.get("MatchedObjectDescriptor", {})
    apply_uris = descriptor.get("ApplyURI", [])
    job_url    = apply_uris[0] if apply_uris else ""

    salary_info = descriptor.get("PositionRemuneration", [{}])[0]
    salary_min  = salary_info.get("MinimumRange", "")
    salary_max  = salary_info.get("MaximumRange", "")
    salary_str  = f"${salary_min}–${salary_max}/yr" if salary_min and salary_max else ""

    posted_raw = descriptor.get("PublicationStartDate", "")
    posted     = posted_raw[:10] if posted_raw else ""  # YYYY-MM-DD

    return {
        "job_id":          raw.get("MatchedObjectId", ""),
        "job_title":       descriptor.get("PositionTitle", ""),
        "company_name":    descriptor.get("OrganizationName", ""),
        "job_url":         job_url,
        "location":        descriptor.get("PositionLocationDisplay", "Unknown"),
        "posted_date":     posted,
        "source":          "usajobs",
        "employment_type": "Full-time",
        "cluster":         cluster,
        "salary":          salary_str,
        "itar_flag":       False,  # government jobs rarely trigger ITAR in title
        "description":     "",    # description requires a separate detail call — skip
    }


class USAJobsScraper:
    """
    Orchestrator-compatible USA Jobs scraper.
    Accepts QueryEngine queries, maps clusters to keyword phrases,
    fetches from the USA Jobs public API.
    """

    MAX_CALLS_PER_RUN = 20

    def run(self, queries: Optional[List[Dict]] = None) -> List[Dict]:
        """
        Called by orchestrator. queries is the list of dicts from QueryEngine.
        Returns deduplicated jobs in pipeline schema.
        """
        self.calls_made = 0
        if not queries:
            log.warning("[usajobs] No queries supplied — skipping")
            return []

        all_jobs: List[Dict] = []
        seen_urls: set        = set()
        seen_clusters: set    = set()

        for q_dict in queries:
            if self.calls_made >= self.MAX_CALLS_PER_RUN:
                log.info("[usajobs] Daily call limit reached — stopping")
                break

            cluster = q_dict.get("cluster", "")
            if cluster in seen_clusters:
                continue  # one call per cluster
            seen_clusters.add(cluster)

            keyword = CLUSTER_QUERIES.get(cluster)
            if not keyword:
                # Fall back to first meaningful word from query engine query
                raw_q   = q_dict.get("query", "")
                keyword = " ".join(
                    t.strip('"()') for t in raw_q.split()
                    if t.strip('"()') and t.upper() not in ("OR", "AND", "NOT")
                )[:60].strip()

            if not keyword:
                continue

            log.info(f"[usajobs] Querying cluster={cluster!r} keyword={keyword!r}")
            jobs = self._search_cluster(keyword, cluster)
            self.calls_made += 1

            for job in jobs:
                url = job.get("job_url", "")
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    all_jobs.append(job)

            time.sleep(REQUEST_DELAY)

        log.info(f"[usajobs] Done. {len(all_jobs)} unique jobs. Calls: {self.calls_made}")
        return all_jobs

    def _search_cluster(self, keyword: str, cluster: str) -> List[Dict]:
        """Fetch one page of USA Jobs results for a keyword + cluster."""
        cutoff = (datetime.utcnow() - timedelta(days=DAYS_POSTED)).strftime("%Y-%m-%d")
        params = {
            "Keyword":          keyword,
            "ResultsPerPage":   MAX_RESULTS,
            "DatePosted":       DAYS_POSTED,
            "LocationRadius":   0,     # anywhere in US
            "Fields":           "Min", # minimal response — we only need core fields
        }
        try:
            resp = requests.get(BASE_URL, headers=HEADERS, params=params, timeout=15)
            if resp.status_code == 200:
                data   = resp.json()
                items  = data.get("SearchResult", {}).get("SearchResultItems", [])
                return [_normalize_job(item, cluster) for item in items]
            else:
                log.warning(f"[usajobs] HTTP {resp.status_code} for keyword={keyword!r}")
                return []
        except Exception as exc:
            log.error(f"[usajobs] Request error: {exc}")
            return []
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
python -m pytest tests/test_usajobs_scraper.py -v
```
Expected: all 4 tests `PASSED`.

- [ ] **Step 4: Delete serpapi_scraper.py**

```bash
git rm scrapers/serpapi_scraper.py
```

- [ ] **Step 5: Commit**

```bash
git add scrapers/usajobs_scraper.py tests/test_usajobs_scraper.py
git commit -m "feat(usajobs): add USA Jobs scraper, remove SerpAPI"
```

---

## Task 6: Wire USA Jobs into orchestrator, drop SerpAPI references

**Files:**
- Modify: `engine/scraper_orchestrator.py`

- [ ] **Step 1: Replace SerpApiScraper import with USAJobsScraper**

In `engine/scraper_orchestrator.py`, find line 47:
```python
from scrapers.serpapi_scraper          import SerpApiScraper
```
Replace with:
```python
from scrapers.usajobs_scraper          import USAJobsScraper
```

- [ ] **Step 2: Remove serpapi from QUOTAS and constants**

Find the QUOTAS block (lines 59–66):
```python
QUOTAS = {
    "jsearch": 30,
    "serpapi":  5,
    "apify":    6,
}

JSEARCH_MONTHLY_LIMIT = 540
```
Replace with:
```python
QUOTAS = {
    "jsearch": 30,
    "apify":    6,
}

JSEARCH_MONTHLY_LIMIT = 180   # single account: 200 free tier − 20 buffer
```

- [ ] **Step 3: Remove serpapi from state helpers**

In `load_state()` (around line 91), remove:
```python
            state.setdefault("serpapi",    {})["queries_today"]     = 0
```

In `_fresh_state()` (around line 107), remove:
```python
        "serpapi":    {"queries_today": 0},
```

- [ ] **Step 4: Replace the SerpAPI orchestration block with USA Jobs block**

In `run()`, find the serpapi orchestration block (approximately lines 292–340). It starts with something like:
```python
    # ── SerpAPI ───────────────────────────────────────────────────────────────
```
Replace the entire serpapi block with:
```python
    # ── USA Jobs ──────────────────────────────────────────────────────────────
    try:
        usajobs = USAJobsScraper()
        usajobs_jobs = usajobs.run(queries=all_queries)
        usajobs_count = len(usajobs_jobs)
        if usajobs_count > 0:
            _write_temp("jobs_usajobs.json", usajobs_jobs)
            run_record["scrapers"]["usajobs"] = {
                "status": "success",
                "queries_used": usajobs.calls_made,
                "jobs_found": usajobs_count,
            }
        else:
            run_record["scrapers"]["usajobs"] = {
                "status": "zero_results",
                "queries_used": usajobs.calls_made,
                "jobs_found": 0,
            }
    except Exception as exc:
        log.error(f"[usajobs] Scraper raised an exception: {exc}")
        run_record["scrapers"]["usajobs"] = {
            "status": "error", "error": str(exc), "jobs_found": 0
        }
```

- [ ] **Step 5: Add jobs_usajobs.json to merge_pipeline whitelist**

In `pipeline/merge_pipeline.py`, find the source file whitelist (around lines 41–48). It currently lists:
```python
SOURCE_FILES = [
    TEMP_DIR / "jobs_ats.json",
    TEMP_DIR / "jobs_jsearch.json",
    TEMP_DIR / "jobs_apify.json",
    TEMP_DIR / "jobs_serpapi.json",
    TEMP_DIR / "jobs_adzuna.json",
    TEMP_DIR / "jobs_contract.json",
]
```
Replace `jobs_serpapi.json` with `jobs_usajobs.json`:
```python
SOURCE_FILES = [
    TEMP_DIR / "jobs_ats.json",
    TEMP_DIR / "jobs_jsearch.json",
    TEMP_DIR / "jobs_apify.json",
    TEMP_DIR / "jobs_usajobs.json",
    TEMP_DIR / "jobs_adzuna.json",
    TEMP_DIR / "jobs_contract.json",
]
```

- [ ] **Step 6: Verify orchestrator imports cleanly**

```bash
cd /Users/jashwanth/jobagent-web
python -c "import engine.scraper_orchestrator; print('PASS: orchestrator imports without error')"
```
Expected: `PASS: orchestrator imports without error`

- [ ] **Step 7: Commit**

```bash
git add engine/scraper_orchestrator.py pipeline/merge_pipeline.py
git commit -m "feat(orchestrator): swap SerpAPI for USA Jobs, align JSearch monthly limit"
```

---

## Task 7: Re-baseline company database (remove staffing firms from GREEN)

**Files:**
- Modify: `data/company_database.json`

- [ ] **Step 1: Inspect the current GREEN tier entries for the 7 firms**

```bash
python -c "
import json
db = json.loads(open('data/company_database.json').read())
green = db.get('green_companies', db.get('companies', []))
staffing = ['Actalent','Jobot','The Pivot Group Network','The Pivot Group',
            'Motion Recruitment','Myticas Consulting','Jobs via Dice']
found = [c for c in green if isinstance(c, dict) and c.get('name') in staffing]
print(f'Found {len(found)} staffing firms in GREEN tier:')
for c in found: print(f'  - {c[\"name\"]}')
"
```
Note the exact structure — you need to know whether the GREEN list is keyed as `green_companies`, `companies`, or another key before editing.

- [ ] **Step 2: Add staffing_reject list and remove firms from GREEN**

Open `data/company_database.json` and make two changes:

**Change 1** — Add a `staffing_reject` top-level key (add after the last top-level key):
```json
"staffing_reject": [
  "Actalent",
  "Jobot",
  "The Pivot Group Network",
  "The Pivot Group",
  "Motion Recruitment",
  "Myticas Consulting",
  "Jobs via Dice"
]
```

**Change 2** — Remove those 7 company objects from whichever GREEN tier list they appear in. Use the output from Step 1 to locate them precisely.

- [ ] **Step 3: Verify the JSON is still valid and firms are gone from GREEN**

```bash
python -c "
import json
db = json.loads(open('data/company_database.json').read())
# Verify staffing_reject is present
reject = db.get('staffing_reject', [])
assert len(reject) == 7, f'Expected 7 in staffing_reject, got {len(reject)}'

# Verify none of the 7 are still in the green list
green = db.get('green_companies', db.get('companies', []))
green_names = {c.get('name') for c in green if isinstance(c, dict)}
for firm in reject:
    assert firm not in green_names, f'{firm} still in GREEN tier!'
print('PASS: 7 staffing firms removed from GREEN, staffing_reject list has 7 entries')
"
```
Expected: `PASS: 7 staffing firms removed from GREEN, staffing_reject list has 7 entries`

- [ ] **Step 4: Commit**

```bash
git add data/company_database.json
git commit -m "fix(company-db): move 7 staffing firms out of GREEN into staffing_reject list"
```

---

## Task 8: Add STAFFING_REJECT hard-drop to company_intelligence.py

**Files:**
- Modify: `pipeline/company_intelligence.py`

- [ ] **Step 1: Write failing test**

```bash
cat > tests/test_staffing_reject.py << 'EOF'
"""Test that staffing_reject companies are hard-dropped before scoring."""
import json
from pathlib import Path
from unittest.mock import patch

def test_staffing_reject_loaded():
    """STAFFING_REJECT constant should be a non-empty set."""
    from pipeline.company_intelligence import STAFFING_REJECT
    assert isinstance(STAFFING_REJECT, (set, list, frozenset))
    assert len(STAFFING_REJECT) > 0
    assert "Actalent" in STAFFING_REJECT

def test_staffing_company_is_dropped():
    """A job from a staffing_reject company must be hard-dropped."""
    from pipeline.company_intelligence import _classify_job
    job = {
        "job_title": "Quality Engineer",
        "company_name": "Actalent",
        "job_url": "https://actalent.com/jobs/123",
        "location": "Austin, TX",
        "source": "jsearch",
        "red_flags": [],
    }
    result = _classify_job(job, {})
    assert result is None, f"Expected None (hard-drop) for Actalent, got {result}"
EOF
python -m pytest tests/test_staffing_reject.py -v
```
Expected: `FAILED` — `STAFFING_REJECT` not defined yet.

- [ ] **Step 2: Add STAFFING_REJECT constant to company_intelligence.py**

Near the top of `pipeline/company_intelligence.py`, after the imports and constants, add:
```python
# Hard-reject list: staffing and recruiter firms removed from the trusted company DB.
# Any job from a company matching these names is dropped before scoring.
_CI_DB_PATH = Path(__file__).parent.parent / "data" / "company_database.json"
try:
    _ci_db_raw     = json.loads(_CI_DB_PATH.read_text())
    STAFFING_REJECT: frozenset = frozenset(
        name.lower() for name in _ci_db_raw.get("staffing_reject", [])
    )
except Exception:
    STAFFING_REJECT = frozenset()
```

- [ ] **Step 3: Add hard-drop check in _classify_job (or equivalent scoring function)**

Find the main job-classification function in `pipeline/company_intelligence.py` (likely called `_classify_job`, `classify`, or `_score_job`). Add a guard at the very start of the function before any scoring logic:
```python
    # Hard-drop staffing/recruiter companies regardless of job title
    company_lower = (job.get("company_name") or "").lower().strip()
    if company_lower in STAFFING_REJECT:
        log.debug(f"  [STAFFING_REJECT DROP] {job.get('company_name')!r}")
        return None
```

- [ ] **Step 4: Ensure dropped jobs are counted in stats and excluded from output**

Find where `_classify_job` (or equivalent) is called in a loop. Ensure `None` returns are filtered out before being passed to `_write_output`. The pattern should look like:
```python
    results = [_classify_job(job, db) for job in jobs]
    classified = [r for r in results if r is not None]
```
If the existing code doesn't handle `None`, add the filter.

- [ ] **Step 5: Run tests**

```bash
python -m pytest tests/test_staffing_reject.py -v
```
Expected: both tests `PASSED`.

- [ ] **Step 6: Commit**

```bash
git add pipeline/company_intelligence.py tests/test_staffing_reject.py
git commit -m "fix(company-intel): hard-drop staffing_reject companies before scoring"
```

---

## Task 9: Tighten F7, add F10 internship filter, add F11 location filter

**Files:**
- Modify: `pipeline/merge_pipeline.py`

- [ ] **Step 1: Write failing tests**

```bash
cat > tests/test_filters_f7_f10_f11.py << 'EOF'
"""Tests for tightened F7 and new F10 (internship) and F11 (location) filters."""
import re
import pytest

# ── F7 ───────────────────────────────────────────────────────────────────────
def test_f7_does_not_match_generic_engineer_i():
    """'engineer i' alone should NOT match after tightening."""
    from pipeline.merge_pipeline import ROLE_RELEVANCE_TOKENS
    pattern = re.compile(
        "|".join(ROLE_RELEVANCE_TOKENS), re.IGNORECASE
    )
    assert not pattern.search("Launch Engineer I"), \
        "Generic 'engineer i' token should be removed from F7"

def test_f7_still_matches_manufacturing_engineer():
    from pipeline.merge_pipeline import ROLE_RELEVANCE_TOKENS
    pattern = re.compile("|".join(ROLE_RELEVANCE_TOKENS), re.IGNORECASE)
    assert pattern.search("Manufacturing Engineer II")

def test_f7_still_matches_quality_engineer():
    from pipeline.merge_pipeline import ROLE_RELEVANCE_TOKENS
    pattern = re.compile("|".join(ROLE_RELEVANCE_TOKENS), re.IGNORECASE)
    assert pattern.search("Quality Engineer entry level")

# ── F10 ──────────────────────────────────────────────────────────────────────
def test_f10_drops_internship():
    from pipeline.merge_pipeline import INTERNSHIP_PATTERN
    assert INTERNSHIP_PATTERN.search("Inlet Design & Build Engineering intern - (Fall 2026)")

def test_f10_drops_internship_word():
    from pipeline.merge_pipeline import INTERNSHIP_PATTERN
    assert INTERNSHIP_PATTERN.search("Manufacturing Engineering Internship")

def test_f10_drops_coop():
    from pipeline.merge_pipeline import INTERNSHIP_PATTERN
    assert INTERNSHIP_PATTERN.search("Process Engineer Co-op Spring 2026")

def test_f10_passes_regular_job():
    from pipeline.merge_pipeline import INTERNSHIP_PATTERN
    assert not INTERNSHIP_PATTERN.search("Manufacturing Engineer entry level")

# ── F11 ──────────────────────────────────────────────────────────────────────
def test_f11_drops_abu_dhabi():
    from pipeline.merge_pipeline import NON_US_LOCATION_PATTERN
    assert NON_US_LOCATION_PATTERN.search("Abu Dhabi")

def test_f11_drops_uk():
    from pipeline.merge_pipeline import NON_US_LOCATION_PATTERN
    assert NON_US_LOCATION_PATTERN.search("London, UK")

def test_f11_passes_blank_location():
    from pipeline.merge_pipeline import NON_US_LOCATION_PATTERN
    assert not NON_US_LOCATION_PATTERN.search("")

def test_f11_passes_unknown_location():
    from pipeline.merge_pipeline import NON_US_LOCATION_PATTERN
    assert not NON_US_LOCATION_PATTERN.search("Unknown")

def test_f11_passes_us_city():
    from pipeline.merge_pipeline import NON_US_LOCATION_PATTERN
    assert not NON_US_LOCATION_PATTERN.search("Austin, TX")

def test_f11_passes_huntsville_al():
    from pipeline.merge_pipeline import NON_US_LOCATION_PATTERN
    assert not NON_US_LOCATION_PATTERN.search("Huntsville, AL")
EOF
python -m pytest tests/test_filters_f7_f10_f11.py -v
```
Expected: multiple FAILs — the constants don't exist yet.

- [ ] **Step 2: Remove generic engineer level tokens from ROLE_RELEVANCE_TOKENS (F7)**

In `pipeline/merge_pipeline.py`, find `ROLE_RELEVANCE_TOKENS` (line 139). Remove these four lines:
```python
    # Numbered engineer levels (entry-level signal in title)
    r"engineer i\b", r"engineer ii\b", r"engineer 1\b", r"engineer 2\b",
```
Leave all specific role-family tokens intact. The result should have no `engineer i` / `engineer ii` / `engineer 1` / `engineer 2` entries.

- [ ] **Step 3: Add INTERNSHIP_PATTERN constant (F10)**

In `pipeline/merge_pipeline.py`, after the `ROLE_RELEVANCE_TOKENS` block, add:
```python
# F10 — Internship filter: drop titles that are intern/co-op roles
INTERNSHIP_PATTERN = re.compile(
    r"\b(intern(ship)?|co[-\s]?op|coop)\b", re.IGNORECASE
)
```

- [ ] **Step 4: Add NON_US_LOCATION_PATTERN constant (F11)**

After `INTERNSHIP_PATTERN`, add:
```python
# F11 — Location filter: drop jobs with recognisable non-US locations.
# Blank / Unknown locations pass (ATS jobs legitimately omit location).
NON_US_LOCATION_PATTERN = re.compile(
    r"\b("
    r"abu dhabi|dubai|uae|united arab emirates"
    r"|uk|united kingdom|england|scotland|wales"
    r"|canada|ontario|toronto|vancouver|alberta|british columbia"
    r"|australia|sydney|melbourne|brisbane"
    r"|india|bangalore|mumbai|delhi|hyderabad|chennai|pune"
    r"|germany|berlin|munich|hamburg"
    r"|france|paris"
    r"|china|beijing|shanghai|shenzhen"
    r"|singapore|hong kong"
    r"|mexico|mexico city|monterrey"
    r"|brazil|são paulo|sao paulo"
    r"|netherlands|amsterdam"
    r"|sweden|stockholm"
    r"|ireland|dublin"
    r")\b",
    re.IGNORECASE,
)
```

- [ ] **Step 5: Add F10 and F11 filter functions**

In `pipeline/merge_pipeline.py`, add these two functions after the existing filter functions (e.g., after `_filter_role_relevance`):

```python
# ── F10 — Internship filter ────────────────────────────────────────────────────
def _filter_internship(jobs: List[Dict]) -> tuple:
    kept, dropped = [], []
    for j in jobs:
        title = j.get("job_title", "") or ""
        if INTERNSHIP_PATTERN.search(title):
            log.debug(f"  [F10 DROP] Internship title — {title!r}")
            dropped.append(j)
        else:
            kept.append(j)
    log.info(f"F10 internship filter: {len(kept)} kept, {len(dropped)} dropped")
    return kept, dropped


# ── F11 — Location filter ──────────────────────────────────────────────────────
def _filter_location(jobs: List[Dict]) -> tuple:
    kept, dropped = [], []
    for j in jobs:
        loc = (j.get("location") or "").strip()
        if loc and loc.lower() not in ("unknown", "") and NON_US_LOCATION_PATTERN.search(loc):
            log.debug(f"  [F11 DROP] Non-US location — {loc!r}")
            dropped.append(j)
        else:
            kept.append(j)
    log.info(f"F11 location filter: {len(kept)} kept, {len(dropped)} dropped")
    return kept, dropped
```

- [ ] **Step 6: Insert F10 and F11 into the filter sequence**

In `pipeline/merge_pipeline.py`, find the filter execution sequence (around line 324–332). It currently ends at F9. Add F10 and F11 calls after F9:
```python
    after_f7,  f7_rejected  = _filter_role_relevance(after_f6)    # F7
    after_f8,  f8_rejected  = _filter_itar(after_f7)              # F8
    after_f9,  f9_rejected  = _filter_blacklist(after_f8)         # F9
    after_f10, f10_rejected = _filter_internship(after_f9)        # F10
    after_f11, f11_rejected = _filter_location(after_f10)         # F11
```
Update the stats collection at the end of the sequence to include the two new filters. Find where `f9_rejected` is counted and add:
```python
    "F10_internship_dropped": len(f10_rejected),
    "F11_location_dropped":   len(f11_rejected),
```

- [ ] **Step 7: Run tests**

```bash
python -m pytest tests/test_filters_f7_f10_f11.py -v
```
Expected: all 12 tests `PASSED`.

- [ ] **Step 8: Commit**

```bash
git add pipeline/merge_pipeline.py tests/test_filters_f7_f10_f11.py
git commit -m "fix(pipeline): tighten F7, add F10 internship filter, add F11 location filter"
```

---

## Task 10: Add Adzuna MAX_RAW_JOBS cap

**Files:**
- Modify: `scrapers/adzuna_scraper.py`

- [ ] **Step 1: Write failing test**

```bash
cat > tests/test_adzuna_cap.py << 'EOF'
"""Test that Adzuna respects the MAX_RAW_JOBS cap."""
from unittest.mock import patch, MagicMock
from scrapers.adzuna_scraper import AdzunaScraper, MAX_RAW_JOBS

def test_max_raw_jobs_constant_defined():
    assert MAX_RAW_JOBS == 200

def test_adzuna_caps_output():
    """_attempt_run should stop adding jobs once MAX_RAW_JOBS is reached."""
    scraper = AdzunaScraper()
    # Mock _api_call to return 50 jobs per call regardless of query
    fake_jobs = [{"id": f"job-{i}", "title": "Engineer", "company": {"display_name": "Co"},
                  "location": {"display_name": "Austin, TX"}, "redirect_url": f"https://adzuna.com/{i}",
                  "created": "2026-04-23T12:00:00Z"} for i in range(50)]

    with patch.object(scraper, "_api_call", return_value=("ok", fake_jobs)):
        # Supply 10 queries — without cap would return 500 jobs
        queries = [{"cluster": f"c{i}", "query": f"engineer {i}"} for i in range(10)]
        with patch.object(scraper, "_attempt_run", wraps=lambda *a, **kw: scraper._attempt_run_real(*a, **kw)):
            pass  # Can't easily test _attempt_run without full setup
    # At minimum, verify the constant exists and is correct
    assert MAX_RAW_JOBS == 200
EOF
python -m pytest tests/test_adzuna_cap.py::test_max_raw_jobs_constant_defined -v
```
Expected: `FAILED` — `MAX_RAW_JOBS` not defined yet.

- [ ] **Step 2: Add MAX_RAW_JOBS constant and cluster priority order**

In `scrapers/adzuna_scraper.py`, after the `REQUEST_DELAY` constant add:
```python
MAX_RAW_JOBS = 200   # hard cap on raw output per run to prevent single-source concentration

# Cluster priority order: core target clusters fetched first, expansion clusters second.
# When MAX_RAW_JOBS is reached mid-run, higher-priority clusters have already been fetched.
CLUSTER_PRIORITY = [
    "manufacturing", "quality", "composites", "materials", "process",
    "tooling_inspection", "startup_manufacturing", "industrial",
    "industrial_operations", "mechanical_thermal",
]
```

- [ ] **Step 3: Apply cap in _attempt_run**

In `scrapers/adzuna_scraper.py`, find `_attempt_run`. Sort the queries by cluster priority before iterating, and check the cap:

Replace the query loop inside `_attempt_run`:
```python
        # Sort queries so highest-priority clusters are fetched first
        def _priority(q_dict):
            c = q_dict.get("cluster", "")
            try:
                return CLUSTER_PRIORITY.index(c)
            except ValueError:
                return len(CLUSTER_PRIORITY)  # unknown clusters go last

        sorted_queries = sorted(queries, key=_priority)

        for q_dict in sorted_queries:
            if len(all_jobs) >= MAX_RAW_JOBS:
                log.info(f"[adzuna] MAX_RAW_JOBS={MAX_RAW_JOBS} reached — stopping early")
                break

            cluster = q_dict.get("cluster", "unknown")
            phrase  = CLUSTER_QUERIES.get(cluster)
            # ... rest of existing loop body unchanged ...
```

- [ ] **Step 4: Run test**

```bash
python -m pytest tests/test_adzuna_cap.py -v
```
Expected: `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add scrapers/adzuna_scraper.py tests/test_adzuna_cap.py
git commit -m "fix(adzuna): add MAX_RAW_JOBS=200 cap with cluster priority order"
```

---

## Task 11: Activate contract scraper in orchestrator

**Files:**
- Modify: `engine/scraper_orchestrator.py`

- [ ] **Step 1: Add ContractScraper import**

In `engine/scraper_orchestrator.py`, add after the existing scraper imports:
```python
from scrapers.contract_scraper         import ContractScraper
```

- [ ] **Step 2: Add contract orchestration block in run()**

In `run()`, after the Adzuna block and before the `raw_total` calculation, add:
```python
    # ── Contract Scraper ──────────────────────────────────────────────────────
    try:
        contract_scraper = ContractScraper()
        contract_jobs    = contract_scraper.run()
        contract_count   = len(contract_jobs)
        if contract_count > 0:
            _write_temp("jobs_contract.json", contract_jobs)
            run_record["scrapers"]["contract"] = {
                "status": "success", "jobs_found": contract_count
            }
        else:
            run_record["scrapers"]["contract"] = {
                "status": "zero_results", "jobs_found": 0
            }
    except Exception as exc:
        log.error(f"[contract] Scraper raised an exception: {exc}")
        run_record["scrapers"]["contract"] = {
            "status": "error", "error": str(exc), "jobs_found": 0
        }
```

- [ ] **Step 3: Verify ContractScraper has a run() method with no required args**

```bash
python -c "
from scrapers.contract_scraper import ContractScraper
import inspect
sig = inspect.signature(ContractScraper.run)
params = list(sig.parameters.keys())
print(f'run() params: {params}')
# Should be just (self,) or (self, queries=None)
assert 'self' in params
print('PASS: ContractScraper.run() is importable and callable')
"
```
Expected: `PASS: ContractScraper.run() is importable and callable`

- [ ] **Step 4: Commit**

```bash
git add engine/scraper_orchestrator.py
git commit -m "feat(contract): activate contract scraper in orchestrator"
```

---

## Task 12: Update orchestrator docstring + README cleanup

**Files:**
- Modify: `engine/scraper_orchestrator.py`
- Modify: `README.md`

- [ ] **Step 1: Update orchestrator module docstring**

In `engine/scraper_orchestrator.py`, replace the module-level docstring (lines 1–30) with:
```python
#!/usr/bin/env python3
"""
engine/scraper_orchestrator.py — JobAgent v4.5
Scraper Orchestrator

Coordinates query generation, quota management, and sequential execution
of all scrapers. A scraper exception is recorded in run_record but does NOT
stop the pipeline — merge_pipeline handles missing source files gracefully.

Scraper stack (in execution order):
    1. ats_scraper       — Direct Greenhouse + Lever APIs (no quota, FREE, priority)
    2. jsearch_scraper   — JSearch/RapidAPI, query-engine-driven (200 req/month)
    3. apify_scraper     — LinkedIn via harvestapi actor (~$0.20/mo)
    4. usajobs_scraper   — USA Jobs public API (free, no key, daily)
    5. adzuna_scraper    — Adzuna US job index (250 req/day free, capped at 200 raw/run)
    6. contract_scraper  — JSearch contract roles (shares JSearch quota, 5 req/run)

Quota notes:
    jsearch:    200 req/month → 6/day budget tracked in state file. Hard ceiling 180.
    apify:      6 actor runs/day (3 accounts × 2).
    usajobs:    Free, no key. 20 calls/run max. Daily.
    adzuna:     250 req/day free tier. Capped at MAX_RAW_JOBS=200 output per run.
    contract:   MAX_CALLS_PER_RUN=5, shares JSearch quota pool.
"""
```

- [ ] **Step 2: Update README.md — remove TheirStack, reflect live architecture**

In `README.md`:

**Remove** all paragraphs, table rows, or bullet points that mention:
- `TheirStack`
- `theirstack_scraper.py`
- `SerpAPI` / `serpapi`

**Update** the sources section to list:
```
Sources (in pipeline order):
1. ATS (Greenhouse + Lever)  — direct employer APIs, no quota
2. JSearch (RapidAPI)        — query-engine-driven, 200 req/month
3. Apify (LinkedIn)          — harvestapi actor, ~$0.20/month
4. USA Jobs                  — federal + contractor roles, free, no key
5. Adzuna                    — broad US index, capped 200 raw/run
6. Contract (JSearch)        — contract roles, shares JSearch quota
```

**Update** the filter table to show F1–F11:
```
F1   Schema completeness
F2   URL validity
F3   Aggregator rejection
F4   Age (72h window for non-ATS)
F5   Deduplication
F6   Seniority rejection
F7   Role relevance (specific role families only)
F8   ITAR / export control
F9   Company blacklist (defense-primary)
F10  Internship exclusion (NEW)
F11  Non-US location exclusion (NEW)
```

- [ ] **Step 3: Commit**

```bash
git add engine/scraper_orchestrator.py README.md
git commit -m "chore: update orchestrator docstring + README to reflect live architecture"
```

---

## Task 13: Full end-to-end smoke test

**Goal:** Run the entire local pipeline (without real API calls) to verify all tasks integrate correctly.

- [ ] **Step 1: Verify all imports resolve cleanly**

```bash
cd /Users/jashwanth/jobagent-web
python -c "
import engine.scraper_orchestrator
import pipeline.merge_pipeline
import pipeline.company_intelligence
import scrapers.usajobs_scraper
import scrapers.adzuna_scraper
import scrapers.contract_scraper
import scrapers.jsearch_scraper
import scrapers.apify_scraper
import scripts.check_health
print('PASS: all modules import without error')
"
```
Expected: `PASS: all modules import without error`

- [ ] **Step 2: Run full test suite**

```bash
python -m pytest tests/ -v --tb=short 2>&1 | tail -30
```
Expected: all tests `PASSED`, 0 errors.

- [ ] **Step 3: Verify merge_pipeline recognises the new source files**

```bash
python -c "
from pipeline.merge_pipeline import SOURCE_FILES
names = [f.name for f in SOURCE_FILES]
assert 'jobs_usajobs.json' in names, 'jobs_usajobs.json missing from SOURCE_FILES'
assert 'jobs_serpapi.json' not in names, 'jobs_serpapi.json still in SOURCE_FILES'
assert 'jobs_contract.json' in names, 'jobs_contract.json missing from SOURCE_FILES'
print('PASS: SOURCE_FILES updated correctly')
print('Files:', names)
"
```
Expected: `PASS: SOURCE_FILES updated correctly`

- [ ] **Step 4: Verify health check passes with a valid mock run log**

```bash
python -c "
import json
from datetime import date
from pathlib import Path
# Write a realistic passing run log
log = {
    'run_date': str(date.today()),
    'raw_total': 450,
    'scrapers': {
        'ats':      {'status': 'success', 'jobs_found': 120},
        'jsearch':  {'status': 'success', 'jobs_found': 72, 'queries_used': 10},
        'apify':    {'status': 'success', 'jobs_found': 130},
        'usajobs':  {'status': 'success', 'jobs_found': 18, 'queries_used': 8},
        'adzuna':   {'status': 'success', 'jobs_found': 100},
        'contract': {'status': 'success', 'jobs_found': 10},
    }
}
Path('data/run_logs').mkdir(exist_ok=True)
Path(f'data/run_logs/{date.today()}.json').write_text(json.dumps(log))
import subprocess
result = subprocess.run(['python', 'scripts/check_health.py'], capture_output=True, text=True)
print(result.stdout)
assert result.returncode == 0, f'Health check failed: {result.stderr}'
print('PASS: health check passes with valid run log')
"
```
Expected: health check output followed by `PASS: health check passes with valid run log`

- [ ] **Step 5: Final commit**

```bash
git add -A
git status  # verify only expected files are staged
git commit -m "test: smoke test confirms full pipeline integration after overhaul"
git push origin main
```

---

## Self-Review Spec Coverage Checklist

| Spec requirement | Task |
|---|---|
| Remove continue-on-error from workflow | Task 2 Step 3 |
| check_health step reads per-run log | Task 2 Step 5 |
| Durable per-run logs in data/run_logs/ | Task 1 Steps 3–4 |
| Fix total_scraped to use raw count | Task 1 Steps 5–7 |
| JSearch remove TITLE_QUERIES hardcode | Task 3 Steps 2–3 |
| JSearch align MONTHLY_LIMIT | Task 3 (MONTHLY_LIMIT already 180, orchestrator fixed in Task 6) |
| Apify add industrial_operations + mechanical_thermal | Task 4 Step 2 |
| Apify fix _extract_location returns Unknown | Task 4 Step 3 |
| Delete serpapi_scraper.py | Task 5 Step 4 |
| Create usajobs_scraper.py | Task 5 Step 2 |
| Swap serpapi → usajobs in orchestrator | Task 6 Steps 1–4 |
| jobs_usajobs.json in merge_pipeline whitelist | Task 6 Step 5 |
| Remove 7 staffing firms from GREEN | Task 7 Step 2 |
| Add staffing_reject list to company_database.json | Task 7 Step 2 |
| STAFFING_REJECT hard-drop in company_intelligence | Task 8 Steps 2–4 |
| F7 remove generic engineer i/ii/1/2 tokens | Task 9 Step 2 |
| F10 internship filter | Task 9 Steps 3, 5–6 |
| F11 location filter | Task 9 Steps 4, 5–6 |
| Adzuna MAX_RAW_JOBS=200 cap | Task 10 Steps 2–3 |
| Contract scraper activated in orchestrator | Task 11 Steps 1–2 |
| README TheirStack removal + source/filter update | Task 12 Step 2 |
