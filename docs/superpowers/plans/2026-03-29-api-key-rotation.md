# API Key Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add try-on-failure key rotation to Apify, JSearch, and Adzuna scrapers so that when one account's quota is exhausted the next key is tried silently, and increase daily run quotas to reflect 3 accounts each.

**Architecture:** Each scraper reads a comma-separated env var (`APIFY_TOKENS`, `JSEARCH_API_KEYS`, `ADZUNA_APP_IDS`/`ADZUNA_APP_KEYS`). Single-key old env vars still work as a fallback. The existing `run()` in each scraper becomes a thin loop over keys that calls a new `_attempt_run(key/pair, ...)` helper; quota/auth errors return `None` to signal rotation, all other errors return `[]` to stop. The orchestrator QUOTAS dict is bumped 3×. The workflow replaces old secret names with plural ones.

**Tech Stack:** Python 3.11, apify-client, requests, GitHub Actions secrets

---

### Task 1: Add key rotation to apify_scraper.py

**Files:**
- Modify: `scrapers/apify_scraper.py`
- Test: `tests/test_apify_rotation.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_apify_rotation.py`:

```python
"""Tests for Apify key rotation logic."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import importlib
import scrapers.apify_scraper as mod


def _reload_with_env(monkeypatch, value):
    monkeypatch.setenv("APIFY_TOKENS", value)
    monkeypatch.delenv("APIFY_TOKEN", raising=False)
    importlib.reload(mod)
    return mod


def test_single_token_parsed(monkeypatch):
    m = _reload_with_env(monkeypatch, "tok_aaa")
    assert m.APIFY_TOKENS == ["tok_aaa"]


def test_three_tokens_parsed(monkeypatch):
    m = _reload_with_env(monkeypatch, "tok_aaa,tok_bbb,tok_ccc")
    assert m.APIFY_TOKENS == ["tok_aaa", "tok_bbb", "tok_ccc"]


def test_tokens_with_spaces_stripped(monkeypatch):
    m = _reload_with_env(monkeypatch, " tok_aaa , tok_bbb ")
    assert m.APIFY_TOKENS == ["tok_aaa", "tok_bbb"]


def test_old_apify_token_fallback(monkeypatch):
    monkeypatch.delenv("APIFY_TOKENS", raising=False)
    monkeypatch.setenv("APIFY_TOKEN", "legacy_tok")
    importlib.reload(mod)
    assert mod.APIFY_TOKENS == ["legacy_tok"]


def test_empty_env_gives_empty_list(monkeypatch):
    monkeypatch.delenv("APIFY_TOKENS", raising=False)
    monkeypatch.delenv("APIFY_TOKEN", raising=False)
    importlib.reload(mod)
    assert mod.APIFY_TOKENS == []


def test_is_apify_quota_error_detects_hard_limit():
    assert mod._is_apify_quota_error("Monthly usage hard limit exceeded")


def test_is_apify_quota_error_detects_402():
    assert mod._is_apify_quota_error("Error 402: payment required")


def test_is_apify_quota_error_ignores_network_error():
    assert not mod._is_apify_quota_error("Connection timeout")


def test_run_skips_if_no_tokens(monkeypatch):
    monkeypatch.delenv("APIFY_TOKENS", raising=False)
    monkeypatch.delenv("APIFY_TOKEN", raising=False)
    importlib.reload(mod)
    scraper = mod.ApifyScraper()
    assert scraper.run([]) == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/jashwanth/jobagent-web && python -m pytest tests/test_apify_rotation.py -v 2>&1 | tail -20
```
Expected: most tests FAIL (attributes don't exist yet).

- [ ] **Step 3: Replace APIFY_TOKEN with APIFY_TOKENS list, add _is_apify_quota_error**

In `scrapers/apify_scraper.py`, replace:
```python
APIFY_TOKEN = os.environ.get("APIFY_TOKEN", "")
```
With:
```python
_raw_tokens = os.environ.get("APIFY_TOKENS", "") or os.environ.get("APIFY_TOKEN", "")
APIFY_TOKENS = [t.strip() for t in _raw_tokens.split(",") if t.strip()]


def _is_apify_quota_error(err: str) -> bool:
    err_l = err.lower()
    return any(kw in err_l for kw in [
        "monthly usage hard limit", "usage limit", "quota",
        "insufficient credits", "402", "payment required", "401",
    ])
```

- [ ] **Step 4: Extract _attempt_run_with_token and refactor run()**

Replace the existing `run()` method body with:

```python
    def run(self, queries: List[Dict]) -> List[Dict]:
        if not APIFY_TOKENS:
            log.warning("[apify] No APIFY_TOKENS set — skipping")
            return []

        job_titles = self._build_job_titles(queries)
        title_to_cluster = {}
        for q in queries:
            cluster = q.get("cluster", "")
            title   = self.CLUSTER_TO_TITLE.get(cluster)
            if title and title not in title_to_cluster:
                title_to_cluster[title.lower()] = cluster.replace("_open", "")

        for token in APIFY_TOKENS:
            result = self._attempt_run_with_token(token, job_titles, title_to_cluster)
            if result is not None:
                return result

        log.warning("[apify] All tokens quota-exhausted or failed")
        return []
```

Add `_attempt_run_with_token` method immediately after `run()`:

```python
    def _attempt_run_with_token(
        self,
        token: str,
        job_titles: List[str],
        title_to_cluster: Dict[str, str],
    ):
        """
        Try one Apify token. Returns list of jobs on success,
        None if quota/auth error (caller should try next token),
        [] on non-quota failure (no point rotating).
        """
        client = ApifyClient(token)
        log.info(
            f"[apify] Actor: {ACTOR_SLUG!r} | "
            f"{len(job_titles)} job titles: {job_titles[:4]}"
            f"{'...' if len(job_titles) > 4 else ''}"
        )
        run_input = {
            "jobTitles":       job_titles,
            "locations":       ["United States"],
            "postedLimit":     "week",
            "experienceLevel": ["entry", "associate"],
            "sortBy":          "date",
            "maxItems":        MAX_ITEMS,
        }
        try:
            run = client.actor(ACTOR_SLUG).call(
                run_input=run_input,
                timeout_secs=RUN_TIMEOUT,
            )
        except Exception as e:
            err = str(e)
            if _is_apify_quota_error(err):
                return None  # quota exhausted — try next token
            if "not found" in err.lower() or "404" in err:
                log.error(
                    f"[apify] Actor '{ACTOR_SLUG}' not found.\n"
                    f"  → Visit https://apify.com/harvestapi/linkedin-job-search\n"
                    f"  Raw error: {err}"
                )
            else:
                log.error(f"[apify] Actor failed to start: {err}")
            return []

        run_status = run.get("status", "UNKNOWN") if run else "NO_RESPONSE"
        dataset_id = run.get("defaultDatasetId", "") if run else ""

        if run_status not in ("SUCCEEDED", "READY"):
            log.error(f"[apify] Run ended with status '{run_status}'.")
            return []
        if not dataset_id:
            log.error("[apify] No defaultDatasetId returned.")
            return []

        log.info(f"[apify] Actor SUCCEEDED — reading dataset {dataset_id} ...")

        all_jobs: List[Dict] = []
        seen:     set        = set()
        item_count            = 0
        try:
            for item in client.dataset(dataset_id).iterate_items():
                item_count += 1
                key = (
                    _coerce_str((item.get("company") or {}).get("name", "")),
                    _coerce_str(item.get("title", "")).lower(),
                    _coerce_str(item.get("location", "")).lower(),
                )
                if key in seen:
                    continue
                seen.add(key)
                normalized = self._normalize(item, title_to_cluster)
                if normalized:
                    all_jobs.append(normalized)
        except Exception as e:
            log.error(f"[apify] Dataset read error: {e}")

        log.info(
            f"[apify] Dataset: {item_count} raw items → "
            f"{len(all_jobs)} unique normalised jobs"
        )
        return all_jobs
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/jashwanth/jobagent-web && python -m pytest tests/test_apify_rotation.py -v 2>&1 | tail -20
```
Expected: all 9 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add scrapers/apify_scraper.py tests/test_apify_rotation.py
git commit -m "feat: add try-on-failure key rotation to apify_scraper (APIFY_TOKENS)"
```

---

### Task 2: Add key rotation to jsearch_scraper.py

**Files:**
- Modify: `scrapers/jsearch_scraper.py`
- Test: `tests/test_jsearch_rotation.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_jsearch_rotation.py`:

```python
"""Tests for JSearch key rotation logic."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import importlib
import scrapers.jsearch_scraper as mod


def _reload(monkeypatch, value):
    monkeypatch.setenv("JSEARCH_API_KEYS", value)
    monkeypatch.delenv("JSEARCH_API_KEY", raising=False)
    importlib.reload(mod)
    return mod


def test_single_key_parsed(monkeypatch):
    m = _reload(monkeypatch, "key_aaa")
    assert m.JSEARCH_API_KEYS == ["key_aaa"]


def test_three_keys_parsed(monkeypatch):
    m = _reload(monkeypatch, "key_aaa,key_bbb,key_ccc")
    assert m.JSEARCH_API_KEYS == ["key_aaa", "key_bbb", "key_ccc"]


def test_old_jsearch_api_key_fallback(monkeypatch):
    monkeypatch.delenv("JSEARCH_API_KEYS", raising=False)
    monkeypatch.setenv("JSEARCH_API_KEY", "legacy_key")
    importlib.reload(mod)
    assert mod.JSEARCH_API_KEYS == ["legacy_key"]


def test_empty_env_gives_empty_list(monkeypatch):
    monkeypatch.delenv("JSEARCH_API_KEYS", raising=False)
    monkeypatch.delenv("JSEARCH_API_KEY", raising=False)
    importlib.reload(mod)
    assert mod.JSEARCH_API_KEYS == []


def test_run_skips_if_no_keys(monkeypatch):
    monkeypatch.delenv("JSEARCH_API_KEYS", raising=False)
    monkeypatch.delenv("JSEARCH_API_KEY", raising=False)
    importlib.reload(mod)
    scraper = mod.JSearchScraper()
    assert scraper.run() == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/jashwanth/jobagent-web && python -m pytest tests/test_jsearch_rotation.py -v 2>&1 | tail -15
```
Expected: most tests FAIL.

- [ ] **Step 3: Replace JSEARCH_API_KEY with JSEARCH_API_KEYS list**

In `scrapers/jsearch_scraper.py`, replace:
```python
JSEARCH_API_KEY = os.environ.get("JSEARCH_API_KEY", "")
```
With:
```python
_raw_keys = os.environ.get("JSEARCH_API_KEYS", "") or os.environ.get("JSEARCH_API_KEY", "")
JSEARCH_API_KEYS = [k.strip() for k in _raw_keys.split(",") if k.strip()]
```

- [ ] **Step 4: Refactor run() and add _attempt_run()**

Replace the existing `run()` method with:

```python
    def run(self, queries: Optional[List[Dict]] = None) -> List[Dict]:
        if not JSEARCH_API_KEYS:
            log.warning("[jsearch] JSEARCH_API_KEYS not set — skipping")
            return []

        for key in JSEARCH_API_KEYS:
            result = self._attempt_run(key)
            if result is not None:
                log.info(f"[jsearch] Done. {len(result)} jobs.")
                return result

        log.warning("[jsearch] All JSearch keys quota-exhausted")
        return []
```

Add `_attempt_run()` immediately after `run()`, containing the existing query-loop logic with `JSEARCH_API_KEY` replaced by the `key` parameter and the exit condition changed to return `None` on exhaustion:

```python
    def _attempt_run(self, key: str) -> Optional[List[Dict]]:
        """
        Try all queries with one key. Returns job list on success,
        None if key is quota-exhausted (caller should try next key).
        """
        headers = {
            "X-RapidAPI-Key":  key,
            "X-RapidAPI-Host": JSEARCH_HOST,
        }
        all_jobs:        List[Dict] = []
        seen_ids:        set        = set()
        api_calls                   = 0
        consecutive_429s            = 0

        for i, query in enumerate(self.TITLE_QUERIES):
            if api_calls >= self.MAX_CALLS_PER_DAY:
                log.info(f"[jsearch] Daily cap ({self.MAX_CALLS_PER_DAY}) reached")
                break

            log.info(f"[jsearch] [{i+1}/{len(self.TITLE_QUERIES)}] Query: {query!r}")
            time.sleep(self.QUERY_DELAY)

            result = self._single_query(headers, query)
            api_calls += 1

            if result == "quota":
                log.info("[jsearch] 403 quota — rotating to next key")
                return None  # exhausted

            if result == "rate_limited":
                consecutive_429s += 1
                log.warning(
                    f"[jsearch] Query {i+1} skipped (rate_limited) — "
                    f"{consecutive_429s}/{self.MAX_CONSECUTIVE_429} consecutive 429s"
                )
                if consecutive_429s >= self.MAX_CONSECUTIVE_429:
                    log.info("[jsearch] Consecutive 429s — rotating to next key")
                    return None  # exhausted
                continue

            if result == "error":
                log.warning(f"[jsearch] Query {i+1} skipped (error)")
                continue

            consecutive_429s = 0

            for job in result:
                job_id = job.get("job_id", "")
                if job_id in seen_ids:
                    continue
                seen_ids.add(job_id)

                apply_link = job.get("job_apply_link", "") or ""
                if is_aggregator(apply_link):
                    apply_link = job.get("job_google_link", "") or apply_link
                    if is_aggregator(apply_link):
                        continue

                desc        = job.get("job_description", "") or ""
                city        = job.get("job_city",  "") or ""
                state       = job.get("job_state", "") or ""
                location    = f"{city}, {state}".strip(", ") or "United States"
                posted_raw  = job.get("job_posted_at_datetime_utc", "") or ""
                posted_date = posted_raw[:10] if posted_raw else datetime.utcnow().strftime("%Y-%m-%d")
                itar_flags  = check_itar(desc)

                all_jobs.append({
                    "job_title":    job.get("job_title", ""),
                    "company_name": job.get("employer_name", ""),
                    "job_url":      apply_link,
                    "location":     location,
                    "posted_date":  posted_date,
                    "description":  desc[:500],
                    "source":       "jsearch",
                    "cluster":      self._cluster(query),
                    "itar_flag":    bool(itar_flags),
                    "itar_detail":  ", ".join(itar_flags),
                    "raw_id":       job_id,
                })

        return all_jobs
```

Also remove the now-unused `log.info(f"[jsearch] Done. {len(all_jobs)} jobs from {api_calls} API calls.")` line from the old `run()` if it's still present.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/jashwanth/jobagent-web && python -m pytest tests/test_jsearch_rotation.py -v 2>&1 | tail -15
```
Expected: all 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add scrapers/jsearch_scraper.py tests/test_jsearch_rotation.py
git commit -m "feat: add try-on-failure key rotation to jsearch_scraper (JSEARCH_API_KEYS)"
```

---

### Task 3: Add key rotation to adzuna_scraper.py

**Files:**
- Modify: `scrapers/adzuna_scraper.py`
- Test: `tests/test_adzuna_rotation.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_adzuna_rotation.py`:

```python
"""Tests for Adzuna key rotation logic."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import importlib
import scrapers.adzuna_scraper as mod


def _reload(monkeypatch, ids, keys):
    monkeypatch.setenv("ADZUNA_APP_IDS",  ids)
    monkeypatch.setenv("ADZUNA_APP_KEYS", keys)
    monkeypatch.delenv("ADZUNA_APP_ID",  raising=False)
    monkeypatch.delenv("ADZUNA_APP_KEY", raising=False)
    importlib.reload(mod)
    return mod


def test_single_pair_parsed(monkeypatch):
    m = _reload(monkeypatch, "id1", "key1")
    assert m.ADZUNA_PAIRS == [("id1", "key1")]


def test_three_pairs_parsed(monkeypatch):
    m = _reload(monkeypatch, "id1,id2,id3", "key1,key2,key3")
    assert m.ADZUNA_PAIRS == [("id1", "key1"), ("id2", "key2"), ("id3", "key3")]


def test_pairs_with_spaces_stripped(monkeypatch):
    m = _reload(monkeypatch, " id1 , id2 ", " key1 , key2 ")
    assert m.ADZUNA_PAIRS == [("id1", "key1"), ("id2", "key2")]


def test_old_single_env_vars_fallback(monkeypatch):
    monkeypatch.delenv("ADZUNA_APP_IDS",  raising=False)
    monkeypatch.delenv("ADZUNA_APP_KEYS", raising=False)
    monkeypatch.setenv("ADZUNA_APP_ID",  "legacy_id")
    monkeypatch.setenv("ADZUNA_APP_KEY", "legacy_key")
    importlib.reload(mod)
    assert mod.ADZUNA_PAIRS == [("legacy_id", "legacy_key")]


def test_empty_env_gives_empty_list(monkeypatch):
    monkeypatch.delenv("ADZUNA_APP_IDS",  raising=False)
    monkeypatch.delenv("ADZUNA_APP_KEYS", raising=False)
    monkeypatch.delenv("ADZUNA_APP_ID",  raising=False)
    monkeypatch.delenv("ADZUNA_APP_KEY", raising=False)
    importlib.reload(mod)
    assert mod.ADZUNA_PAIRS == []


def test_run_skips_if_no_pairs(monkeypatch):
    monkeypatch.delenv("ADZUNA_APP_IDS",  raising=False)
    monkeypatch.delenv("ADZUNA_APP_KEYS", raising=False)
    monkeypatch.delenv("ADZUNA_APP_ID",  raising=False)
    monkeypatch.delenv("ADZUNA_APP_KEY", raising=False)
    importlib.reload(mod)
    scraper = mod.AdzunaScraper()
    assert scraper.run([]) == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/jashwanth/jobagent-web && python -m pytest tests/test_adzuna_rotation.py -v 2>&1 | tail -15
```
Expected: most tests FAIL.

- [ ] **Step 3: Replace module-level vars with ADZUNA_PAIRS**

In `scrapers/adzuna_scraper.py`, replace:
```python
ADZUNA_APP_ID  = os.environ.get("ADZUNA_APP_ID",  "")
ADZUNA_APP_KEY = os.environ.get("ADZUNA_APP_KEY", "")
```
With:
```python
_raw_ids  = os.environ.get("ADZUNA_APP_IDS",  "") or os.environ.get("ADZUNA_APP_ID",  "")
_raw_keys = os.environ.get("ADZUNA_APP_KEYS", "") or os.environ.get("ADZUNA_APP_KEY", "")
ADZUNA_PAIRS = [
    (i.strip(), k.strip())
    for i, k in zip(_raw_ids.split(","), _raw_keys.split(","))
    if i.strip() and k.strip()
]
```

- [ ] **Step 4: Refactor run() and _api_call() to use explicit pair**

Replace `run()` with:

```python
    def run(self, queries: List[Dict]) -> List[Dict]:
        if not ADZUNA_PAIRS:
            log.warning("[adzuna] ADZUNA_APP_IDS or ADZUNA_APP_KEYS not set — skipping")
            return []

        for app_id, app_key in ADZUNA_PAIRS:
            result = self._attempt_run(app_id, app_key, queries)
            if result is not None:
                log.info(f"[adzuna] Total unique jobs: {len(result)}")
                return result

        log.warning("[adzuna] All Adzuna credentials failed or quota-exhausted")
        return []
```

Add `_attempt_run()` immediately after `run()`:

```python
    def _attempt_run(
        self, app_id: str, app_key: str, queries: List[Dict]
    ) -> Optional[List[Dict]]:
        """
        Try all queries with one credential pair. Returns job list on success,
        None if 401/429 (caller should try next pair).
        """
        all_jobs: List[Dict] = []
        seen: set = set()

        for q_dict in queries:
            cluster = q_dict.get("cluster", "unknown")
            phrase  = CLUSTER_QUERIES.get(cluster)

            if not phrase:
                raw_q  = q_dict.get("query", "")
                tokens = [t.strip('"()') for t in raw_q.split()
                          if t.strip('"()') and t.upper() not in ("OR", "AND", "NOT")]
                phrase = " ".join(tokens[:5]).strip()

            if not phrase:
                continue

            log.info(f"[adzuna] Query ({cluster}): {phrase!r}")
            time.sleep(REQUEST_DELAY)

            status, results = self._api_call(phrase, app_id, app_key)
            if status == "quota":
                return None  # 401/429 — rotate to next pair
            for raw in results:
                self._add_if_new(raw, cluster, seen, all_jobs)

        return all_jobs
```

Update `_api_call` signature and body to accept explicit params instead of module globals:

```python
    def _api_call(self, query: str, app_id: str, app_key: str):
        """Returns ("ok", results) or ("quota", []) on auth/quota failure."""
        params = {
            "app_id":           app_id,
            "app_key":          app_key,
            "what":             query,
            "where":            "United States",
            "results_per_page": RESULTS_PER_REQ,
            "max_days_old":     MAX_DAYS_OLD,
            "content-type":     "application/json",
        }
        try:
            r = requests.get(BASE_URL, params=params, timeout=20)
            if r.status_code in (401, 403):
                return ("quota", [])
            if r.status_code == 429:
                return ("quota", [])
            if r.status_code != 200:
                log.warning(f"[adzuna] HTTP {r.status_code} for query {query!r}")
                return ("ok", [])
            data = r.json()
            results = data.get("results", [])
            log.info(f"  [adzuna] {len(results)} results")
            return ("ok", results)
        except Exception as exc:
            log.error(f"[adzuna] Request error for {query!r}: {exc}")
            return ("ok", [])
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/jashwanth/jobagent-web && python -m pytest tests/test_adzuna_rotation.py -v 2>&1 | tail -15
```
Expected: all 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add scrapers/adzuna_scraper.py tests/test_adzuna_rotation.py
git commit -m "feat: add try-on-failure key rotation to adzuna_scraper (ADZUNA_PAIRS)"
```

---

### Task 4: Bump orchestrator quotas

**Files:**
- Modify: `engine/scraper_orchestrator.py`

- [ ] **Step 1: Update QUOTAS and JSEARCH_MONTHLY_LIMIT**

In `engine/scraper_orchestrator.py`, find:
```python
QUOTAS = {
    "jsearch": 10,   # daily cap; monthly cap enforced separately
    "serpapi":  5,   # orchestrator cap; scraper also alternates days
    "apify":    2,   # actor runs per day
}

# JSearch monthly hard ceiling — 200 free tier − 20 buffer
JSEARCH_MONTHLY_LIMIT = 180
```
Replace with:
```python
QUOTAS = {
    "jsearch": 30,   # daily cap; 3 accounts × 10/day
    "serpapi":  5,   # orchestrator cap; scraper also alternates days
    "apify":    6,   # 3 accounts × 2 runs/day
}

# JSearch monthly hard ceiling — 3 accounts × (200 free tier − 20 buffer)
JSEARCH_MONTHLY_LIMIT = 540
```

- [ ] **Step 2: Update scraper_orchestrator docstring quota notes**

Find in the module docstring:
```
    jsearch:    200 req/month → 6/day budget. Monthly cap tracked in state file
                to prevent mid-month exhaustion. Hard monthly ceiling: 180.
    apify:      2 actor runs/day. Each run passes ALL distinct job title phrases
```
Replace with:
```
    jsearch:    3 accounts × 200 req/month → 30/day budget. Monthly cap tracked
                in state file. Hard monthly ceiling: 540.
    apify:      3 accounts × 2 actor runs/day = 6 runs/day. Each run passes ALL
                distinct job title phrases
```

- [ ] **Step 3: Run full test suite to confirm no regressions**

```bash
cd /Users/jashwanth/jobagent-web && python -m pytest tests/ -v 2>&1 | tail -20
```
Expected: all existing tests + new rotation tests pass.

- [ ] **Step 4: Commit**

```bash
git add engine/scraper_orchestrator.py
git commit -m "feat: bump orchestrator quotas for 3-account key rotation (apify 2→6, jsearch 10→30, monthly 180→540)"
```

---

### Task 5: Update GitHub Actions workflow

**Files:**
- Modify: `.github/workflows/daily_scrape.yml`

- [ ] **Step 1: Replace old secret names with plural versions**

In `.github/workflows/daily_scrape.yml`, find the `env:` block:
```yaml
env:
  JSEARCH_API_KEY:      ${{ secrets.JSEARCH_API_KEY }}
  APIFY_TOKEN:          ${{ secrets.APIFY_TOKEN }}
  SERPAPI_KEY:          ${{ secrets.SERPAPI_KEY }}
  ADZUNA_APP_ID:        ${{ secrets.ADZUNA_APP_ID }}
  ADZUNA_APP_KEY:       ${{ secrets.ADZUNA_APP_KEY }}
  SUPABASE_URL:         ${{ secrets.SUPABASE_URL }}
  SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
```
Replace with:
```yaml
env:
  JSEARCH_API_KEYS:     ${{ secrets.JSEARCH_API_KEYS }}
  APIFY_TOKENS:         ${{ secrets.APIFY_TOKENS }}
  SERPAPI_KEY:          ${{ secrets.SERPAPI_KEY }}
  ADZUNA_APP_IDS:       ${{ secrets.ADZUNA_APP_IDS }}
  ADZUNA_APP_KEYS:      ${{ secrets.ADZUNA_APP_KEYS }}
  SUPABASE_URL:         ${{ secrets.SUPABASE_URL }}
  SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/daily_scrape.yml
git commit -m "chore: update workflow secrets to plural key names (APIFY_TOKENS, JSEARCH_API_KEYS, ADZUNA_APP_IDS/KEYS)"
```

- [ ] **Step 3: Add new GitHub secrets**

Run these commands to set the secrets (substitute real key values):

```bash
# Comma-separated list of all Apify tokens from 3 accounts
gh secret set APIFY_TOKENS --body "token1,token2,token3"

# Comma-separated list of all JSearch/RapidAPI keys from 3 accounts
gh secret set JSEARCH_API_KEYS --body "key1,key2,key3"

# Comma-separated Adzuna app IDs — must match order of ADZUNA_APP_KEYS
gh secret set ADZUNA_APP_IDS --body "id1,id2,id3"

# Comma-separated Adzuna app keys — must match order of ADZUNA_APP_IDS
gh secret set ADZUNA_APP_KEYS --body "key1,key2,key3"
```

**Important:** The order matters for Adzuna — id1 pairs with key1, id2 with key2, id3 with key3.

- [ ] **Step 4: Trigger a manual test run and verify**

```bash
gh workflow run daily_scrape.yml
sleep 10
gh run list --workflow=daily_scrape.yml --limit=1
```

Then check the logs:
```bash
gh run view $(gh run list --workflow=daily_scrape.yml --limit=1 --json databaseId --jq '.[0].databaseId') --log 2>/dev/null | grep -E "\[apify\]|\[jsearch\]|\[adzuna\]" | head -30
```
Expected: no "not set — skipping" warnings. Apify and JSearch should show job counts > 0.

---

### Task 6: Run full test suite and push

- [ ] **Step 1: Run all tests**

```bash
cd /Users/jashwanth/jobagent-web && python -m pytest tests/ -v 2>&1 | tail -20
```
Expected: all tests pass (51 JS vitest + new Python rotation tests).

- [ ] **Step 2: Push to origin**

```bash
git push origin main
```

- [ ] **Step 3: Verify deployment**

```bash
npx vercel --prod 2>&1 | tail -5
```
Expected: deployment succeeds (no Python scraper code in frontend build — this is just confirming no broken imports leaked into the frontend).
