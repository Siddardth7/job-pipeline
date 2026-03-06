# M628 Job Scraping Pipeline v2

Automated early-career job search across 303 aerospace/composites/manufacturing companies.

## What's New in v2

| Fix | Description |
|-----|-------------|
| **Bug 1** | Apify Open Search actor corrected to `bebity/google-jobs-scraper` + pre-flight actor validation |
| **Bug 2** | JSearch now targets entry-level / associate / junior roles. Batch size raised 3→5 |
| **Bug 3** | Zero-result diagnosis: distinguishes "empty board" vs "broken scraper config" |
| **Bug 4** | Pagination fixed: Greenhouse/Lever/Workday now follow next-page links and Load More |
| **Bug 5** | Query redesign: role-family queries with positive early-career framing |
| **Bug 6** | Broader title coverage: Manufacturing/Process/Quality/NPI/Composites/Materials all targeted |
| **Opt 1** | `cache/seen_job_keys.json` — cross-run dedup; skip jobs already seen |
| **Opt 2** | `cache/company_cooldown*.json` — 24/48/72h cooldowns on zero-yield companies |
| **Opt 3** | Budget caps + early-exit when enough new jobs found |
| **Freshness** | Hard 72h max age on all jobs; applied at scrape time AND post-filter |
| **Seniority** | Senior/Lead/Staff/Principal/5+ yrs rejected at query, scrape, and filter levels |

## Architecture

```
┌──────────────────────┐     ┌──────────────────────┐
│   JSearch API        │     │   Apify Actors        │
│   Role-family queries│     │   Greenhouse/Lever/   │
│   Entry-level framing│     │   Workday/Google Jobs │
│   5 companies/day    │     │   15 companies/day    │
│   cache/cooldowns    │     │   cache/cooldowns     │
└──────────┬───────────┘     └──────────┬────────────┘
           │                            │
           └──────────┬─────────────────┘
                      ▼
          ┌───────────────────────┐
          │  merge_pipeline.py    │
          │  Dedup + sort         │
          └───────────┬───────────┘
                      ▼
          ┌───────────────────────┐
          │  post_merge_filter.py │
          │  Freshness ≤ 72h      │
          │  Seniority rejection  │
          │  URL sanity check     │
          └───────────┬───────────┘
                      ▼
          ┌───────────────────────┐
          │  jobs_clean_latest    │
          │  .json (app feed)     │
          └───────────────────────┘
```

## Quick Start

### 1. Install

```bash
pip install requests apify-client python-dotenv
echo "JSEARCH_API_KEY=your_key" > .env
echo "APIFY_TOKEN=your_token" >> .env
```

### 2. Run

```bash
# JSearch only (entry-level roles, 5 companies/day)
python jsearch_scraper.py

# Apify dry run (inspect configs)
python apify_scraper.py

# Apify live run
python apify_scraper.py --run

# Merge + filter → jobs_clean_latest.json
python merge_pipeline.py
```

### 3. Pipeline in one line

```bash
python jsearch_scraper.py && python apify_scraper.py --run && python merge_pipeline.py
```

## File Inventory

| File | Purpose |
|------|---------|
| `jsearch_scraper.py` | JSearch scraper — role-family queries, seniority filter, cache |
| `apify_scraper.py` | Apify orchestrator — actor validation, pagination, diagnostics |
| `merge_pipeline.py` | Merge + invoke post_merge_filter |
| `post_merge_filter.py` | Final freshness + seniority + URL filter |
| `M628_JSEARCH_CONFIG.json` | JSearch config — 303 companies, updated keywords/exclusions |
| `M628_APIFY_CONFIG.json` | Apify ATS configs per company |
| `M628_ENRICHED_MASTER.json` | Full company metadata |
| `cache/seen_job_keys.json` | Cross-run dedup cache (auto-created) |
| `cache/seen_job_keys_apify.json` | Apify dedup cache (auto-created) |
| `cache/company_cooldown.json` | JSearch company cooldown state (auto-created) |
| `cache/company_cooldown_apify.json` | Apify company cooldown state (auto-created) |
| `output/jobs_clean_latest.json` | **Final app feed** |

## Freshness Policy

All jobs must be posted within **72 hours** maximum.

- JSearch: `date_posted=3days` at query time
- Apify Google Jobs: `datePostedRange=threeDays`
- post_merge_filter: hard 72h age gate on all records

## Seniority Policy

Only entry-level / early-career roles are kept:
- ✅ Keep: Engineer I/II, Associate, Junior, New Grad, Level 1/2, 0–3 yrs
- ❌ Reject: Senior, Sr., Staff, Principal, Lead, Manager, III, IV, V, 7+ yrs

## API Usage (Optimized)

| Scenario | Before v2 | After v2 |
|----------|-----------|----------|
| Companies per run | 3 | 5 |
| Queries per company | 2 (exact title) | 2 (role-family) |
| Calls per run | 6 | 10 |
| Repeat scans (zero yield) | Every day | Skipped (cooldown 24–72h) |
| Cross-run duplicates | Re-verified | Skipped (cache) |
| Senior roles processed | All | Rejected at query |
| Effective new jobs per API call | Low | ~3–5× higher |

**Net result: 70–90% reduction in wasted API calls** due to cooldowns, dedup cache,
early-exit budget cap, and smarter query framing.

## Job Output Schema

```json
{
  "role": "Associate Manufacturing Engineer",
  "company": "Joby Aviation",
  "location": "Santa Cruz, CA",
  "type": "Full-time",
  "link": "https://boards.greenhouse.io/jobycareers/12345",
  "posted": "1d ago",
  "posted_ts": "2026-03-05T10:00:00Z",
  "itar_flag": false,
  "itar_detail": "",
  "tier": "Tier 1",
  "h1b": "LIKELY",
  "itar_company": "Partial",
  "industry": "Aerospace",
  "domain_verified": true,
  "source": "jsearch",
  "match": 90,
  "verdict": "GREEN"
}
```

## Automate (GitHub Actions)

```bash
mkdir -p .github/workflows
cp daily_scrape.yml .github/workflows/
# Add secrets: JSEARCH_API_KEY, APIFY_TOKEN
git push
```

Runs daily at 8 AM EST.
