#!/usr/bin/env python3
"""
M628 Apify Scraper — Two modes in one script:

  MODE 1 — TARGETED (default):
    Scrapes ATS career pages for M628 companies using Greenhouse/Lever/Workday
    actors or falls back to Google Jobs actor. Batch-rotates daily.

  MODE 2 — OPEN SEARCH:
    Runs the Google Jobs actor with broad keyword queries (no company filter).
    Surfaces companies NOT in M628. Runs after targeted mode, same budget.

  Both write separate output files. merge_pipeline.py combines all four
  sources (jsearch_targeted, jsearch_open, apify_targeted, apify_open).

SETUP:
  pip install apify-client python-dotenv
  .env: APIFY_TOKEN=your_token_here
  Run dry:  python apify_scraper.py
  Run live: python apify_scraper.py --run
"""

import os, sys, json, time, logging
from datetime import datetime
from pathlib import Path

try:
    from apify_client import ApifyClient
except ImportError:
    print("Install apify-client: pip install apify-client")
    ApifyClient = None

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ─── CONFIG ───────────────────────────────────────────────────────────────────
APIFY_TOKEN = os.environ.get("APIFY_TOKEN", "")

SCRIPT_DIR  = Path(__file__).parent
CONFIG_PATH = SCRIPT_DIR / "M628_APIFY_CONFIG.json"
MASTER_PATH = SCRIPT_DIR / "M628_ENRICHED_MASTER.json"
OUTPUT_DIR  = SCRIPT_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

ACTORS = {
    "web_scraper":  "apify/web-scraper",
    "puppeteer":    "apify/puppeteer-scraper",
    "google_jobs":  "apify/google-jobs-scraper",   # BUG FIX: was stale community actor
}

BATCH_SIZE             = 15   # companies per targeted run
OPEN_SEARCH_QUERIES_N  = 4    # broad Google Jobs queries per run (set 0 to disable)

# BUG FIX 1: title filter — normalize_job now rejects non-target roles
TARGET_TITLE_KW = [
    "manufacturing engineer", "process engineer", "composites engineer",
    "composite engineer", "materials engineer", "quality engineer",
    "manufacturing process", "advanced manufacturing", "composite manufacturing",
    "structural manufacturing", "propulsion manufacturing", "production engineer",
    "quality systems engineer", "manufacturing technology", "r&d manufacturing",
    "npi engineer", "new product introduction", "process development engineer",
]

# BUG FIX 2: reject non-engineering and wrong-discipline roles
EXCLUDE_TITLE_KW = [
    "software engineer", "electrical engineer", "firmware", "embedded",
    "director", "vice president", "vp ", " vp,", "chief ", "head of",
    "marketing", "business development", "accountant", "finance",
    "hr ", "hrbp", "recruiter", "talent acquisition",
    "technician", "operator", "inspector", "co-op", "internship", "intern ",
    "data scientist", "machine learning", "cloud engineer", "devops",
    "program manager", "product manager", "project manager",
    "contracts manager", "legal", "attorney",
]

ITAR_KEYWORDS = [
    "security clearance", "us person", "itar", "export controlled",
    "classified", "us citizen or permanent resident",
    "must be authorized to work without sponsorship",
    "u.s. citizen", "u.s. national", "permanent resident only",
]

# Open search query pool — rotated daily
OPEN_SEARCH_QUERY_POOL = [
    "Composites Manufacturing Engineer California",
    "Composites Manufacturing Engineer Washington",
    "Composites Manufacturing Engineer Texas",
    "Process Engineer composites aerospace",
    "Materials Engineer aerospace manufacturing",
    "Advanced Manufacturing Engineer aerospace",
    "Quality Engineer composites aerospace",
    "Manufacturing Engineer eVTOL",
    "NPI Engineer manufacturing aerospace",
    "Composites Engineer space",
    "Manufacturing Engineer defense composites",
    "Quality Systems Engineer manufacturing",
    "Process Development Engineer aerospace",
    "Manufacturing Engineer carbon fiber",
    "Structural Manufacturing Engineer",
    "Production Engineer aerospace",
    "Manufacturing Engineer Michigan composites",
    "Manufacturing Engineer Colorado aerospace",
    "Composites Engineer Florida aerospace",
    "Advanced Manufacturing Engineer space",
]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(SCRIPT_DIR / "apify.log"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("apify")


# ─── TITLE FILTER ─────────────────────────────────────────────────────────────
def passes_title_filter(title):
    """Return True only if title matches target roles and not exclusion list."""
    if not title:
        return False
    lower = title.lower()
    if not any(kw in lower for kw in TARGET_TITLE_KW):
        return False
    if any(ex in lower for ex in EXCLUDE_TITLE_KW):
        return False
    return True


# ─── LOAD CONFIG ──────────────────────────────────────────────────────────────
def load_config():
    with open(CONFIG_PATH) as f:
        return json.load(f)


def load_master_lookup():
    if MASTER_PATH.exists():
        with open(MASTER_PATH) as f:
            return {c["company_id"]: c for c in json.load(f)}
    return {}


# ─── ATS-SPECIFIC ACTOR CONFIGS ───────────────────────────────────────────────
def greenhouse_config(company):
    board_url = company["apify_entrypoint_urls"][0]
    return {
        "actor": ACTORS["web_scraper"],
        "input": {
            "startUrls": [{"url": board_url}],
            "pageFunction": """
async function pageFunction(context) {
    const jobs = [];
    const cards = document.querySelectorAll('.opening');
    for (const card of cards) {
        const titleEl = card.querySelector('a');
        const locEl   = card.querySelector('.location');
        if (titleEl) {
            jobs.push({
                title:    titleEl.textContent.trim(),
                url:      titleEl.href,
                location: locEl ? locEl.textContent.trim() : '',
                company:  '""" + company["company_name"] + """',
            });
        }
    }
    return jobs;
}""",
            "proxyConfiguration": {"useApifyProxy": True},
            "maxConcurrency": 1,
        }
    }


def lever_config(company):
    board_url = company["apify_entrypoint_urls"][0]
    return {
        "actor": ACTORS["web_scraper"],
        "input": {
            "startUrls": [{"url": board_url}],
            "pageFunction": """
async function pageFunction(context) {
    const jobs = [];
    const postings = document.querySelectorAll('.posting');
    for (const p of postings) {
        const titleEl = p.querySelector('.posting-title h5, .posting-title a');
        const locEl   = p.querySelector('.posting-categories .location, .sort-by-location');
        const linkEl  = p.querySelector('a.posting-btn-submit, a.posting-title');
        if (titleEl) {
            jobs.push({
                title:    titleEl.textContent.trim(),
                url:      linkEl ? linkEl.href : '',
                location: locEl  ? locEl.textContent.trim() : '',
                company:  '""" + company["company_name"] + """',
            });
        }
    }
    return jobs;
}""",
            "proxyConfiguration": {"useApifyProxy": True},
            "maxConcurrency": 1,
        }
    }


def workday_config(company):
    board_url = company["apify_entrypoint_urls"][0]
    return {
        "actor": ACTORS["puppeteer"],
        "input": {
            "startUrls": [{"url": board_url}],
            "pageFunction": """
async function pageFunction(context) {
    const { page } = context;
    await page.waitForSelector(
        '[data-automation-id="jobTitle"], .css-19uc56f, .WDAY-formWidget',
        { timeout: 15000 }
    ).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
    const jobs = await page.evaluate((co) => {
        const results = [];
        const cards = document.querySelectorAll(
            '[data-automation-id="jobTitle"], .css-19uc56f a, a[data-automation-id="jobTitle"]'
        );
        cards.forEach(card => {
            const title  = card.textContent.trim();
            const url    = card.href || card.closest('a')?.href || '';
            const parent = card.closest('li, tr, [role="listitem"], .css-1q2dra3');
            const locEl  = parent?.querySelector('[data-automation-id="locations"], .css-129m7dg, dd');
            results.push({ title, url, location: locEl ? locEl.textContent.trim() : '', company: co });
        });
        return results;
    }, '""" + company["company_name"] + """');
    return jobs;
}""",
            "proxyConfiguration": {"useApifyProxy": True},
            "maxConcurrency": 1,
            "preNavigationHooks": '[async ({ page }) => { await page.setViewport({ width: 1280, height: 800 }); }]',
        }
    }


def google_jobs_config_for_company(company):
    queries = [f"{kw} {company['company_name']}" for kw in
               ["Manufacturing Engineer", "Process Engineer", "Composites Engineer"][:2]]
    return {
        "actor": ACTORS["google_jobs"],
        "input": {"queries": queries, "maxItems": 10, "countryCode": "us"},
    }


def google_jobs_config_open(queries):
    """Open search: broad keyword queries, no company filter."""
    return {
        "actor": ACTORS["google_jobs"],
        "input": {"queries": queries, "maxItems": 15, "countryCode": "us"},
    }


def get_scrape_config(company):
    platform = company.get("ats_platform", "Unknown")
    strategy = company.get("apify_strategy", "search-then-verify")
    if strategy == "ATS-native":
        if platform == "Greenhouse":
            return greenhouse_config(company)
        elif platform == "Lever":
            return lever_config(company)
        elif platform in ("Workday", "iCIMS", "Taleo", "SuccessFactors"):
            return workday_config(company)
    return google_jobs_config_for_company(company)


# ─── RUN ACTOR ────────────────────────────────────────────────────────────────
def run_actor(client, actor_id, run_input, label):
    try:
        log.info(f"  Running {actor_id} for {label}...")
        run = client.actor(actor_id).call(run_input=run_input, timeout_secs=120)
        if not run:
            return []
        dataset_id = run.get("defaultDatasetId")
        if not dataset_id:
            return []
        items = list(client.dataset(dataset_id).iterate_items())
        log.info(f"  {len(items)} raw results")
        return items
    except Exception as e:
        log.error(f"  Actor failed for {label}: {e}")
        return []


# ─── NORMALISE ────────────────────────────────────────────────────────────────
def normalize_job(raw_job, company_name, tier, h1b, itar_co,
                  industry, source_actor, source_tag):
    """Convert raw actor output to pipeline schema. Returns None if filtered."""
    if source_actor == ACTORS["google_jobs"]:
        # apify/google-jobs-scraper official output fields
        title    = (raw_job.get("title") or raw_job.get("job_title") or "")
        location = (raw_job.get("location") or raw_job.get("job_location") or "")
        link     = (raw_job.get("applyLink") or raw_job.get("jobUrl") or
                    raw_job.get("link") or raw_job.get("job_apply_link") or
                    raw_job.get("url") or "")
        desc     = (raw_job.get("description") or raw_job.get("job_description") or "")
        posted   = (raw_job.get("publishedAt") or raw_job.get("date") or
                    raw_job.get("detected_extensions", {}).get("posted_at", "") or "")
    else:
        title    = raw_job.get("title", "")
        location = raw_job.get("location", "")
        link     = raw_job.get("url", "")
        desc     = raw_job.get("description", "")
        posted   = ""

    # BUG FIX: apply title filter (was missing — caused 236 wrong-role Shield AI jobs)
    if not passes_title_filter(title):
        return None

    itar_flags = [kw for kw in ITAR_KEYWORDS if kw in (desc or "").lower()]
    itar_hit   = len(itar_flags) > 0

    score = 0 if itar_hit else (
        90 if tier == "Tier 1" and h1b == "YES" else
        85 if tier == "Tier 1"                  else
        82 if tier == "Tier 2" and h1b == "YES" else
        78 if tier == "Tier 2"                  else
        72 if tier == "Tier 3"                  else 60
    )
    verdict = "RED" if itar_hit else ("GREEN" if tier == "Tier 1" else "YELLOW")

    return {
        "id":             f"{company_name.replace(' ','-')}-apify-{hash(title+location) % 10000}",
        "role":           title,
        "company":        company_name,
        "location":       location,
        "type":           "Full-time",
        "link":           link,
        "posted":         posted,
        "itar_flag":      itar_hit,
        "itar_detail":    ", ".join(itar_flags) if itar_flags else "",
        "tier":           tier,
        "h1b":            h1b,
        "itar_company":   itar_co,
        "industry":       industry,
        "domain_verified": False,
        "source":         source_tag,
        "reason":         f"Scraped via {source_actor.split('/')[-1]}",
        "match":          score,
        "verdict":        verdict,
    }


# ─── BATCH ROTATION ───────────────────────────────────────────────────────────
def get_today_batch(companies, batch_size):
    day       = datetime.now().timetuple().tm_yday
    total     = len(companies)
    n_batches = (total + batch_size - 1) // batch_size
    idx       = day % n_batches
    start     = idx * batch_size
    return companies[start: min(start + batch_size, total)], idx, n_batches


# ─── WRITE OUTPUT ─────────────────────────────────────────────────────────────
def write_output(jobs, label, extra=None):
    today = datetime.now().strftime("%Y-%m-%d")
    out = {
        "generated_utc":    datetime.utcnow().isoformat() + "Z",
        "scraper":          label,
        "total_jobs_found": len(jobs),
        "eligible_jobs":    len([j for j in jobs if not j["itar_flag"]]),
        "itar_flagged":     len([j for j in jobs if j["itar_flag"]]),
        "jobs":             jobs,
    }
    if extra:
        out.update(extra)
    for path in [OUTPUT_DIR / f"jobs_{label}_{today}.json",
                 OUTPUT_DIR / f"jobs_{label}_latest.json"]:
        with open(path, "w") as f:
            json.dump(out, f, indent=2)
    log.info(f"Saved {len(jobs)} jobs → jobs_{label}_{today}.json")


def write_empty(label, reason):
    out = {"generated_utc": datetime.utcnow().isoformat() + "Z",
           "scraper": label, "error": reason,
           "total_jobs_found": 0, "eligible_jobs": 0, "itar_flagged": 0, "jobs": []}
    today = datetime.now().strftime("%Y-%m-%d")
    for path in [OUTPUT_DIR / f"jobs_{label}_{today}.json",
                 OUTPUT_DIR / f"jobs_{label}_latest.json"]:
        with open(path, "w") as f:
            json.dump(out, f, indent=2)


def generate_configs_only(companies):
    configs = []
    for c in companies:
        sc = get_scrape_config(c)
        configs.append({
            "company_id":    c["company_id"],
            "company_name":  c["company_name"],
            "ats_platform":  c["ats_platform"],
            "strategy":      c["apify_strategy"],
            "actor":         sc["actor"],
        })
    out = OUTPUT_DIR / "apify_run_configs.json"
    with open(out, "w") as f:
        json.dump(configs, f, indent=2)
    log.info(f"Generated {len(configs)} configs → {out}. Use --run to execute.")


# ─── MAIN ─────────────────────────────────────────────────────────────────────
def main():
    log.info("=" * 65)
    log.info("M628 Apify Scraper  —  Targeted + Open Search")
    log.info("=" * 65)

    run_mode = "--run" in sys.argv

    config        = load_config()
    all_companies = config["companies"]

    if not run_mode:
        log.info("DRY RUN — generating configs only. Pass --run to execute.")
        generate_configs_only(all_companies)
        return

    if not APIFY_TOKEN:
        log.error("APIFY_TOKEN not set.")
        write_empty("apify_targeted", "No APIFY_TOKEN")
        write_empty("apify_open",     "No APIFY_TOKEN")
        sys.exit(0)

    if ApifyClient is None:
        log.error("apify-client not installed: pip install apify-client")
        sys.exit(1)

    client = ApifyClient(APIFY_TOKEN)

    # Enrich companies with tier/h1b from master
    master = load_master_lookup()
    for c in all_companies:
        m = master.get(c["company_id"], {})
        c["tier"]                    = m.get("tier", "Tier 2")
        c["h1b"]                     = m.get("h1b", "LIKELY")
        c["itar"]                    = m.get("itar", "NO")
        c["primary_industry_category"] = m.get("primary_industry_category", "")

    # Greenhouse/Lever first (cheapest actors)
    all_companies.sort(key=lambda c: (
        0 if c["ats_platform"] in ("Greenhouse", "Lever") else
        1 if c["ats_platform"] == "Workday" else 2
    ))

    # ── MODE 1: TARGETED ──────────────────────────────────────────────────────
    batch, batch_idx, n_batches = get_today_batch(all_companies, BATCH_SIZE)
    log.info(f"Targeted: batch {batch_idx+1}/{n_batches} ({len(batch)} companies)")

    known_companies = {c["company_name"].lower() for c in all_companies}
    targeted_jobs   = []

    for i, company in enumerate(batch):
        log.info(f"  [{i+1}/{len(batch)}] {company['company_name']} "
                 f"({company['ats_platform']}, {company['apify_strategy']})")
        sc      = get_scrape_config(company)
        results = run_actor(client, sc["actor"], sc["input"], company["company_name"])

        for raw in results:
            items = raw if isinstance(raw, list) else [raw]
            for item in items:
                job = normalize_job(
                    item,
                    company_name = company["company_name"],
                    tier         = company["tier"],
                    h1b          = company["h1b"],
                    itar_co      = company["itar"],
                    industry     = company["primary_industry_category"],
                    source_actor = sc["actor"],
                    source_tag   = "apify_targeted",
                )
                if job:
                    targeted_jobs.append(job)
        time.sleep(2)

    # Dedup
    seen, unique_t = set(), []
    for j in targeted_jobs:
        k = (j["company"], j["role"], j["location"])
        if k not in seen:
            seen.add(k)
            unique_t.append(j)
    unique_t.sort(key=lambda j: ({"GREEN":0,"YELLOW":1,"RED":2}.get(j["verdict"],9), -j["match"]))

    write_output(unique_t, "apify_targeted", {
        "batch": batch_idx + 1, "total_batches": n_batches,
        "companies_scraped": len(batch),
    })
    log.info(f"Targeted: {len(unique_t)} relevant jobs")

    # ── MODE 2: OPEN SEARCH ───────────────────────────────────────────────────
    if OPEN_SEARCH_QUERIES_N == 0:
        log.info("Open search disabled (OPEN_SEARCH_QUERIES_N=0)")
        write_empty("apify_open", "Disabled")
    else:
        day    = datetime.now().timetuple().tm_yday
        total  = len(OPEN_SEARCH_QUERY_POOL)
        start  = (day * OPEN_SEARCH_QUERIES_N) % total
        today_queries = [OPEN_SEARCH_QUERY_POOL[(start + i) % total]
                         for i in range(OPEN_SEARCH_QUERIES_N)]

        log.info(f"Open search: {today_queries}")
        sc      = google_jobs_config_open(today_queries)
        results = run_actor(client, sc["actor"], sc["input"], "OPEN_SEARCH")

        open_jobs = []
        seen_open = set()
        for raw in results:
            items = raw if isinstance(raw, list) else [raw]
            for item in items:
                raw_company = (item.get("companyName") or item.get("company") or item.get("employer_name") or "Unknown")

                # Skip M628 companies — already covered by targeted
                if raw_company.lower() in known_companies:
                    continue

                job = normalize_job(
                    item,
                    company_name = raw_company,
                    tier         = "Tier 2",
                    h1b          = "LIKELY",
                    itar_co      = "Unknown",
                    industry     = "",
                    source_actor = sc["actor"],
                    source_tag   = "apify_open",
                )
                if job:
                    k = (job["company"], job["role"], job["location"])
                    if k not in seen_open:
                        seen_open.add(k)
                        job["verdict"] = "YELLOW"
                        job["match"]   = min(job["match"], 70)
                        open_jobs.append(job)
                        log.info(f"  + {raw_company}: {job['role']}")

        open_jobs.sort(key=lambda j: -j["match"])
        write_output(open_jobs, "apify_open", {
            "queries": today_queries,
            "note": "Open search — companies outside M628. Vet before applying.",
        })
        log.info(f"Open search: {len(open_jobs)} relevant jobs")

    log.info("=" * 65)
    log.info("DONE")
    log.info("=" * 65)


if __name__ == "__main__":
    main()
