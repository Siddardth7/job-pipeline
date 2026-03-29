# API Key Rotation — Spec

**Date:** 2026-03-29
**Goal:** Support multiple API keys per scraper (Apify, JSearch, Adzuna) using a try-on-failure chain. Multiply effective daily quotas by the number of keys without changing scraper logic beyond key selection.

---

## Problem

- Apify is the only scraper producing jobs. If its single token exhausts, 0 jobs.
- JSearch and Adzuna are returning 0 — partially a quota/key issue.
- Pipeline runs once/day but quota limits cap raw job volume.

## Approach: Try-on-failure chain (Option A)

Store keys as comma-separated env vars. Each scraper tries key[0], catches a quota/auth error, silently tries key[1], then key[2]. No state changes, no extra API calls.

**Errors that trigger rotation (silent):**
- HTTP 429 (rate limit / quota exceeded)
- HTTP 402 (payment required / quota)
- HTTP 401 (auth failure — bad or exhausted key)
- Apify: exception message contains "usage limit", "quota", "insufficient credits", "402", "401"
- JSearch/Adzuna: response `message` field contains "quota", "limit exceeded", "unauthorized"

**Errors that do NOT trigger rotation (raise normally):**
- HTTP 500, network errors, malformed responses — these are infrastructure issues, not quota issues

**Backward compatibility:** Single-key env vars still work. The scraper splits on comma, so `APIFY_TOKENS=singlekey` is valid.

---

## Env Var Changes

| Old Secret | New Secret | Format |
|---|---|---|
| `APIFY_TOKEN` | `APIFY_TOKENS` | `token1,token2,token3` |
| `JSEARCH_API_KEY` | `JSEARCH_API_KEYS` | `key1,key2,key3` |
| `ADZUNA_APP_ID` | `ADZUNA_APP_IDS` | `id1,id2,id3` |
| `ADZUNA_APP_KEY` | `ADZUNA_APP_KEYS` | `key1,key2,key3` |

Adzuna IDs and keys are paired by index: `ADZUNA_APP_IDS[i]` goes with `ADZUNA_APP_KEYS[i]`.

---

## Quota Increases

| Scraper | Old daily cap | New daily cap | Reason |
|---|---|---|---|
| Apify actor runs | 2 | 6 | 3 accounts × 2 runs each |
| JSearch queries/day | 10 | 30 | 3 accounts × 10 each |
| JSearch monthly ceiling | 180 | 540 | 3 accounts × 180 each |
| Adzuna | 250 req/day | 750 req/day | 3 accounts × 250 each |
| SerpAPI | unchanged | unchanged | single account |

**MAX_ITEMS per Apify title: unchanged at 25** (conservative for beta week).

---

## Files Changed

1. **`scrapers/apify_scraper.py`** — read `APIFY_TOKENS` (comma-split), add `_run_with_key_rotation(keys, run_input)` helper that tries each key
2. **`scrapers/jsearch_scraper.py`** — read `JSEARCH_API_KEYS`, add `_fetch_with_key_rotation(keys, params)` helper
3. **`scrapers/adzuna_scraper.py`** — read `ADZUNA_APP_IDS` + `ADZUNA_APP_KEYS` (paired), add `_fetch_with_key_rotation(pairs, params)` helper
4. **`engine/scraper_orchestrator.py`** — update `QUOTAS` dict: apify 2→6, jsearch daily 10→30, monthly 180→540; no change to adzuna (it self-limits internally)
5. **`.github/workflows/daily_scrape.yml`** — replace old single-key secret refs with new plural names

---

## Key Rotation Helper Pattern

Each scraper implements a local `_try_keys` helper (not shared — each scraper has different error shapes):

```python
def _try_keys(keys, call_fn):
    """Try each key in order. Return result of first success. Return None if all exhausted."""
    for key in keys:
        try:
            result = call_fn(key)
            return result
        except QuotaError:
            continue  # silent rotation
    return None  # all keys exhausted
```

Where `QuotaError` is detected by inspecting the exception message or HTTP status code specific to each API.

---

## Scraper State

`data/scraper_state.json` tracks monthly JSearch usage. With 3 keys, the monthly ceiling increases to 540. The state file tracks a single `queries_this_month` counter — this is the combined usage across all keys (conservative: we stop at 540 total regardless of how usage is distributed across keys).

---

## What Does NOT Change

- `MAX_ITEMS` in apify_scraper stays at 25 per title
- Filter stack (F1–F9) unchanged
- Company intelligence unchanged
- Pipeline flow unchanged
- SerpAPI unchanged (single account)
