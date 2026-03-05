#!/usr/bin/env python3
"""
M628 Apify Scraper — Orchestrates Apify actors to scrape career pages
for companies that JSearch misses or where direct ATS scraping is needed.

SETUP:
  1. Create Apify account: https://apify.com (free tier: $5/month credits)
  2. pip install apify-client python-dotenv
  3. Create .env file with: APIFY_TOKEN=your_token_here
  4. Run: python apify_scraper.py

STRATEGY:
  - Greenhouse/Lever companies: Use Apify's Web Scraper with simple CSS selectors
  - Workday companies: Use Apify's Puppeteer Scraper (JS rendering)
  - Custom ATS companies: Use Google Jobs Scraper actor as fallback
  - Unknown ATS companies: Use Google Jobs Scraper with company name filter

OUTPUT: jobs_apify_YYYY-MM-DD.json (same schema as JSearch output)
"""

import os, sys, json, time, re, logging
from datetime import datetime, timedelta
from pathlib import Path

try:
    from apify_client import ApifyClient
except ImportError:
    print("Install apify-client: pip install apify-client --break-system-packages")
    # Don't exit — script can still generate configs without running
    ApifyClient = None

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ─── CONFIG ───────────────────────────────────────────────────────────────────
APIFY_TOKEN = os.environ.get("APIFY_TOKEN", "")
SCRIPT_DIR = Path(__file__).parent
CONFIG_PATH = SCRIPT_DIR / "M628_APIFY_CONFIG.json"
OUTPUT_DIR = SCRIPT_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

# Apify Actor IDs (from Apify Store — free to use)
ACTORS = {
    "web_scraper": "apify/web-scraper",           # For Greenhouse/Lever (static HTML)
    "puppeteer":   "apify/puppeteer-scraper",      # For Workday/iCIMS (JS-heavy)
    "google_jobs": "SpK5Fq2MBrBBaGssH",           # Google Jobs Scraper by Dušan Faltýnek
}

# Title keywords for Google Jobs queries
TITLE_KEYWORDS = [
    "Manufacturing Engineer", "Process Engineer", "Composites Engineer",
    "Quality Engineer", "Materials Engineer"
]

# ITAR check
ITAR_KEYWORDS = [
    "security clearance", "us person", "itar", "export controlled",
    "classified", "us citizen or permanent resident",
    "must be authorized to work without sponsorship",
    "u.s. citizen", "u.s. national", "permanent resident only",
]

BATCH_SIZE = 15  # companies per run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(SCRIPT_DIR / "apify.log"),
        logging.StreamHandler()
    ]
)
log = logging.getLogger("apify")


# ─── LOAD CONFIG ──────────────────────────────────────────────────────────────
def load_config():
    with open(CONFIG_PATH) as f:
        return json.load(f)


# ─── ATS-SPECIFIC SCRAPING CONFIGS ────────────────────────────────────────────

def greenhouse_config(company):
    """Greenhouse boards are simple HTML. Use Web Scraper with CSS selectors."""
    board_url = company["apify_entrypoint_urls"][0]
    return {
        "actor": ACTORS["web_scraper"],
        "input": {
            "startUrls": [{"url": board_url}],
            "pageFunction": """
async function pageFunction(context) {
    const { page, request, log } = context;
    const jobs = [];
    const cards = document.querySelectorAll('.opening');
    for (const card of cards) {
        const titleEl = card.querySelector('a');
        const locEl = card.querySelector('.location');
        if (titleEl) {
            jobs.push({
                title: titleEl.textContent.trim(),
                url: titleEl.href,
                location: locEl ? locEl.textContent.trim() : '',
                company: '""" + company["company_name"] + """',
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
    """Lever boards are also relatively simple."""
    board_url = company["apify_entrypoint_urls"][0]
    return {
        "actor": ACTORS["web_scraper"],
        "input": {
            "startUrls": [{"url": board_url}],
            "pageFunction": """
async function pageFunction(context) {
    const { page, request, log } = context;
    const jobs = [];
    const postings = document.querySelectorAll('.posting');
    for (const p of postings) {
        const titleEl = p.querySelector('.posting-title h5, .posting-title a');
        const locEl = p.querySelector('.posting-categories .location, .sort-by-location');
        const linkEl = p.querySelector('a.posting-btn-submit, a.posting-title');
        if (titleEl) {
            jobs.push({
                title: titleEl.textContent.trim(),
                url: linkEl ? linkEl.href : '',
                location: locEl ? locEl.textContent.trim() : '',
                company: '""" + company["company_name"] + """',
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
    """Workday needs Puppeteer (JS rendering + wait for dynamic content)."""
    board_url = company["apify_entrypoint_urls"][0]
    return {
        "actor": ACTORS["puppeteer"],
        "input": {
            "startUrls": [{"url": board_url}],
            "pageFunction": """
async function pageFunction(context) {
    const { page, request, log } = context;
    // Wait for job list to render
    await page.waitForSelector('[data-automation-id="jobTitle"], .css-19uc56f, .WDAY-formWidget', 
        { timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
    
    const jobs = await page.evaluate((companyName) => {
        const results = [];
        // Workday uses various selectors depending on version
        const cards = document.querySelectorAll(
            '[data-automation-id="jobTitle"], .css-19uc56f a, a[data-automation-id="jobTitle"]'
        );
        cards.forEach(card => {
            const title = card.textContent.trim();
            const url = card.href || card.closest('a')?.href || '';
            // Try to find location nearby
            const parent = card.closest('li, tr, [role="listitem"], .css-1q2dra3');
            const locEl = parent?.querySelector(
                '[data-automation-id="locations"], .css-129m7dg, dd'
            );
            results.push({
                title, url,
                location: locEl ? locEl.textContent.trim() : '',
                company: companyName,
            });
        });
        return results;
    }, '""" + company["company_name"] + """');
    return jobs;
}""",
            "proxyConfiguration": {"useApifyProxy": True},
            "maxConcurrency": 1,
            "preNavigationHooks": """[
                async ({ page }) => {
                    await page.setViewport({ width: 1280, height: 800 });
                }
            ]""",
        }
    }


def google_jobs_config(company):
    """Fallback: use Google Jobs search for the company."""
    queries = [f"{kw} {company['company_name']}" for kw in TITLE_KEYWORDS[:2]]
    return {
        "actor": ACTORS["google_jobs"],
        "input": {
            "queries": queries,
            "maxResults": 10,
            "country": "US",
            "language": "en",
        }
    }


def get_scrape_config(company):
    """Route company to appropriate scraping strategy."""
    platform = company.get("ats_platform", "Unknown")
    strategy = company.get("apify_strategy", "search-then-verify")

    if strategy == "ATS-native":
        if platform == "Greenhouse":
            return greenhouse_config(company)
        elif platform == "Lever":
            return lever_config(company)
        elif platform in ("Workday", "iCIMS", "Taleo", "SuccessFactors"):
            return workday_config(company)
        else:
            return google_jobs_config(company)
    else:
        # search-then-verify and company-site-crawl both fall back to Google Jobs
        return google_jobs_config(company)


# ─── RUN ACTOR ────────────────────────────────────────────────────────────────
def run_actor(client, actor_id, run_input, company_name):
    """Run an Apify actor and return results."""
    try:
        log.info(f"  Running actor {actor_id} for {company_name}...")
        run = client.actor(actor_id).call(run_input=run_input, timeout_secs=120)

        if not run:
            log.warning(f"  Actor returned no run object for {company_name}")
            return []

        dataset_id = run.get("defaultDatasetId")
        if not dataset_id:
            log.warning(f"  No dataset for {company_name}")
            return []

        items = list(client.dataset(dataset_id).iterate_items())
        log.info(f"  Got {len(items)} raw results for {company_name}")
        return items

    except Exception as e:
        log.error(f"  Actor failed for {company_name}: {e}")
        return []


# ─── NORMALIZE RESULTS ────────────────────────────────────────────────────────
def normalize_job(raw_job, company, source_actor):
    """Convert raw actor output to standard job schema."""
    if source_actor == ACTORS["google_jobs"]:
        title = raw_job.get("title", raw_job.get("job_title", ""))
        location = raw_job.get("location", raw_job.get("job_location", ""))
        link = raw_job.get("link", raw_job.get("job_apply_link", raw_job.get("url", "")))
        desc = raw_job.get("description", raw_job.get("job_description", ""))
        posted = raw_job.get("detected_extensions", {}).get("posted_at", "")
    else:
        title = raw_job.get("title", "")
        location = raw_job.get("location", "")
        link = raw_job.get("url", "")
        desc = raw_job.get("description", "")
        posted = ""

    if not title:
        return None

    itar_flags = [kw for kw in ITAR_KEYWORDS if kw in (desc or "").lower()]
    tier = company.get("tier", "Tier 2")  # from enriched master
    h1b = company.get("h1b", "LIKELY")

    return {
        "id": f"{company['company_name'].replace(' ', '-')}-apify-{hash(title+location) % 10000}",
        "role": title,
        "company": company["company_name"],
        "location": location,
        "type": "Full-time",
        "link": link,
        "posted": posted,
        "itar_flag": len(itar_flags) > 0,
        "itar_detail": ", ".join(itar_flags) if itar_flags else "",
        "tier": tier,
        "h1b": h1b,
        "itar_company": company.get("itar", "NO"),
        "industry": company.get("primary_industry_category", ""),
        "domain_verified": bool(company.get("company_domain") and
                                company["company_domain"] in (link or "")),
        "source": "apify",
        "reason": f"Scraped via {source_actor.split('/')[-1]}",
        "match": 0 if len(itar_flags) > 0 else (
            90 if tier == "Tier 1" and h1b == "YES" else
            85 if tier == "Tier 1" else
            82 if tier == "Tier 2" and h1b == "YES" else
            78 if tier == "Tier 2" else 72
        ),
        "verdict": "RED" if len(itar_flags) > 0 else (
            "GREEN" if tier == "Tier 1" else "YELLOW"
        ),
    }


# ─── BATCH ROTATION ──────────────────────────────────────────────────────────
def get_today_batch(companies, batch_size):
    day_of_year = datetime.now().timetuple().tm_yday
    total = len(companies)
    num_batches = (total + batch_size - 1) // batch_size
    batch_idx = day_of_year % num_batches
    start = batch_idx * batch_size
    end = min(start + batch_size, total)
    return companies[start:end], batch_idx, num_batches


# ─── GENERATE-ONLY MODE ──────────────────────────────────────────────────────
def generate_configs_only():
    """Generate Apify run configs without executing them. Useful for review."""
    config = load_config()
    companies = config["companies"]

    configs = []
    for c in companies:
        sc = get_scrape_config(c)
        configs.append({
            "company_id": c["company_id"],
            "company_name": c["company_name"],
            "ats_platform": c["ats_platform"],
            "strategy": c["apify_strategy"],
            "actor": sc["actor"],
            "input_preview": {k: v for k, v in sc["input"].items() if k != "pageFunction"},
        })

    out = OUTPUT_DIR / "apify_run_configs.json"
    with open(out, "w") as f:
        json.dump(configs, f, indent=2)
    log.info(f"Generated {len(configs)} actor configs to {out}")
    log.info("Review before running. Use --run flag to execute.")
    return configs


# ─── MAIN ─────────────────────────────────────────────────────────────────────
def main():
    log.info("=" * 60)
    log.info("M628 Apify Scraper — Starting")
    log.info("=" * 60)

    run_mode = "--run" in sys.argv
    if not run_mode:
        log.info("DRY RUN mode. Generating configs only. Use --run to execute.")
        generate_configs_only()
        return

    if not APIFY_TOKEN:
        log.error("APIFY_TOKEN not set. Create .env or set environment variable.")
        sys.exit(1)

    if ApifyClient is None:
        log.error("apify-client not installed. Run: pip install apify-client")
        sys.exit(1)

    client = ApifyClient(APIFY_TOKEN)
    config = load_config()
    all_companies = config["companies"]

    # Enrich with tier/h1b from master
    master_path = SCRIPT_DIR / "M628_ENRICHED_MASTER.json"
    master_lookup = {}
    if master_path.exists():
        with open(master_path) as f:
            for c in json.load(f):
                master_lookup[c["company_id"]] = c

    for c in all_companies:
        m = master_lookup.get(c["company_id"], {})
        c["tier"] = m.get("tier", "Tier 2")
        c["h1b"] = m.get("h1b", "LIKELY")
        c["itar"] = m.get("itar", "NO")
        c["primary_industry_category"] = m.get("primary_industry_category", "")

    # Prioritize: Greenhouse/Lever first (cheapest), then Google Jobs fallback
    all_companies.sort(key=lambda c: (
        0 if c["ats_platform"] in ("Greenhouse", "Lever") else
        1 if c["ats_platform"] == "Workday" else 2
    ))

    batch, batch_idx, num_batches = get_today_batch(all_companies, BATCH_SIZE)
    log.info(f"Batch {batch_idx + 1}/{num_batches}: {len(batch)} companies")

    all_jobs = []
    for i, company in enumerate(batch):
        log.info(f"[{i+1}/{len(batch)}] {company['company_name']} "
                 f"({company['ats_platform']}, {company['apify_strategy']})")

        sc = get_scrape_config(company)
        results = run_actor(client, sc["actor"], sc["input"], company["company_name"])

        for raw in results:
            # Handle nested arrays from page functions
            if isinstance(raw, list):
                for item in raw:
                    job = normalize_job(item, company, sc["actor"])
                    if job:
                        all_jobs.append(job)
            else:
                job = normalize_job(raw, company, sc["actor"])
                if job:
                    all_jobs.append(job)

        time.sleep(2)  # Pace between companies

    # Deduplicate
    seen = set()
    unique = []
    for j in all_jobs:
        key = (j["company"], j["role"], j["location"])
        if key not in seen:
            seen.add(key)
            unique.append(j)

    verdict_order = {"GREEN": 0, "YELLOW": 1, "RED": 2}
    unique.sort(key=lambda j: (verdict_order.get(j["verdict"], 9), -j["match"]))

    today = datetime.now().strftime("%Y-%m-%d")
    output_file = OUTPUT_DIR / f"jobs_apify_{today}.json"

    output = {
        "generated_utc": datetime.utcnow().isoformat() + "Z",
        "scraper": "apify",
        "batch": batch_idx + 1,
        "total_batches": num_batches,
        "companies_searched": len(batch),
        "total_jobs_found": len(unique),
        "eligible_jobs": len([j for j in unique if not j["itar_flag"]]),
        "itar_flagged": len([j for j in unique if j["itar_flag"]]),
        "jobs": unique,
    }

    with open(output_file, "w") as f:
        json.dump(output, f, indent=2)

    latest = OUTPUT_DIR / "jobs_apify_latest.json"
    with open(latest, "w") as f:
        json.dump(output, f, indent=2)

    log.info("=" * 60)
    log.info(f"DONE. {len(unique)} jobs saved to {output_file}")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
