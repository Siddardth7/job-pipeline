# JobAgent v2 — Discovery-First Job Intelligence Pipeline

Replaces the static-company-list approach with an **open discovery** architecture
that searches for jobs by title queries, aggregates from multiple APIs, and grows
a company database automatically over time.

## Architecture

```
Query Engine
    → Scraper Orchestrator
        → JSearch Scraper      (RapidAPI — free: 200 req/month)
        → SerpApi Scraper      (Google Jobs — free: 100 req/month)
        → Apify Scraper        (LinkedIn — pay-per-compute-unit)
    → Merge & Filtering Pipeline
    → Company Intelligence Layer
    → output/jobs_clean_latest.json
```

## Repository Structure

```
job-agent/
├── engine/
│   ├── query_engine.py          # Generates boolean search queries
│   └── scraper_orchestrator.py  # Coordinates scraper execution + quotas
├── scrapers/
│   ├── jsearch_scraper.py       # RapidAPI JSearch
│   ├── serpapi_scraper.py       # SerpApi Google Jobs
│   └── apify_scraper.py         # Apify LinkedIn
├── pipeline/
│   ├── merge_pipeline.py        # Normalize, deduplicate, filter, score
│   └── company_intelligence.py  # Classify GREEN / YELLOW, promotion logic
├── data/
│   ├── query_engine.json        # Cluster definitions & exclusions
│   ├── company_database.json    # Known GREEN companies + promotion tracking
│   ├── job_history.json         # Seen job URLs (dedup across days)
│   ├── scraper_state.json       # Daily API quota tracking
│   └── run_log.json             # Per-run metrics
├── temp/                        # Scraper output buffers (not committed)
├── output/
│   └── jobs_clean_latest.json   # ← Final clean feed consumed by JobAgent UI
├── .github/workflows/
│   └── daily_scrape.yml         # Runs at 13:00 UTC daily
└── requirements.txt
```

## Setup

### 1. API Keys

Add as GitHub repository secrets:

| Secret | Source |
|--------|--------|
| `JSEARCH_API_KEY` | https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch |
| `SERPAPI_KEY` | https://serpapi.com/ |
| `APIFY_TOKEN` | https://console.apify.com/account/integrations |

For local development, create a `.env` file:
```env
JSEARCH_API_KEY=your_key
SERPAPI_KEY=your_key
APIFY_TOKEN=your_token
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Run Manually

```bash
# Full pipeline
python -m engine.scraper_orchestrator
python -m pipeline.merge_pipeline
python -m pipeline.company_intelligence

# Or individual scrapers for testing
python engine/query_engine.py
python scrapers/jsearch_scraper.py
```

## Target Performance

| Metric | Target |
|--------|--------|
| Jobs scraped / day | 80–150 |
| Jobs after filtering | 40–60 |
| GREEN jobs | 20–40 |
| YELLOW jobs | 10–20 |

## Classification Logic

**GREEN** — Company is in `data/company_database.json` (41 seeded + auto-promoted)

**YELLOW** — Unknown company that matches industry keywords (Manufacturing, Aerospace, Automotive, etc.)

**RED** — Staffing/recruiting agencies → **dropped from output**

**Promotion Rule**: Any YELLOW company that appears ≥3 times within 30 days is
automatically promoted to GREEN and added to the database.

## Target Roles

- Manufacturing Engineering
- Process Engineering
- Materials Engineering
- Composites Engineering
- Quality Engineering
- Industrial Engineering

All filtered for entry-level positions (Engineer I/II, Associate, New Grad, Early Career).
Senior/Staff/Principal/Manager/Director roles are excluded.
