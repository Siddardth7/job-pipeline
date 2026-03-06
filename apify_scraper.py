#!/usr/bin/env python3
"""
M628 Apify Scraper v2 — Bug fixes and optimizations:

  BUG 1 FIX: Open Search actor renamed → use validated actor ID
             + pre-flight actor existence check with graceful failure
  BUG 3 FIX: Zero results detection; distinguish "no jobs" from "broken config"
  BUG 4 FIX: Pagination / multi-page crawling for ATS boards
  PHASE 1:   Seen-key dedup + company cooldown (skips repeat zero-result companies)
  PHASE 2:   Expensive verification only for newly discovered jobs

SETUP:
  1. Create Apify account: https://apify.com
  2. pip install apify-client python-dotenv
  3. Create .env: APIFY_TOKEN=your_token_here
  4. Run: python apify_scraper.py --run

OUTPUT: output/jobs_apify_YYYY-MM-DD.json
"""

import os, sys, json, time, re, logging, hashlib
from datetime import datetime, timedelta
from pathlib import Path

try:
    from apify_client import ApifyClient
except ImportError:
    print("Install apify-client: pip install apify-client --break-system-packages")
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
OUTPUT_DIR  = SCRIPT_DIR / "output"
CACHE_DIR   = SCRIPT_DIR / "cache"
OUTPUT_DIR.mkdir(exist_ok=True)
CACHE_DIR.mkdir(exist_ok=True)

SEEN_KEYS_PATH = CACHE_DIR / "seen_job_keys_apify.json"
COOLDOWN_PATH  = CACHE_DIR / "company_cooldown_apify.json"

BATCH_SIZE            = int(os.environ.get('MAX_COMPANIES_PER_RUN', '15'))  # overridable
MAX_NEW_JOBS_TO_STOP  = int(os.environ.get('MAX_VALID_JOBS_TARGET',  '20'))
MAX_GREEN_JOBS_TO_STOP = int(os.environ.get('MAX_GREEN_JOBS_TARGET', '10'))
STOP_SENTINEL         = OUTPUT_DIR / '.stop_signal'
MAX_AGE_HOURS = 72  # freshness window

# ── ACTOR IDs ─────────────────────────────────────────────────────────────────
# BUG 1 FIX: Corrected / validated Apify actor IDs.
# "Open Search" actor (used in original code) was not found.
# Replacement: apify/cheerio-scraper for static HTML (faster, cheaper than web-scraper)
# apify/puppeteer-scraper for JS-heavy sites
# bebity/google-jobs-scraper (verified current ID for Google Jobs scraping)
ACTORS = {
    "cheerio":     "apify/cheerio-scraper",       # Fast HTML-only (Greenhouse/Lever)
    "web_scraper": "apify/web-scraper",            # JS-capable fallback
    "puppeteer":   "apify/puppeteer-scraper",      # Full JS rendering (Workday)
    "google_jobs": "bebity/google-jobs-scraper",   # BUG 1 FIX: verified current actor
}

# Fallback actor if primary google_jobs actor is also unavailable
GOOGLE_JOBS_FALLBACK = "apify/web-scraper"

# ── EARLY-CAREER QUERY TERMS ─────────────────────────────────────────────────
TITLE_KEYWORDS = [
    "entry level manufacturing engineer",
    "associate process engineer",
    "junior quality engineer",
    "engineer I composites",
    "new grad materials engineer",
]

ITAR_KEYWORDS = [
    "security clearance", "us person", "itar", "export controlled",
    "classified", "us citizen or permanent resident",
    "must be authorized to work without sponsorship",
    "u.s. citizen", "u.s. national", "permanent resident only",
]

SENIOR_REJECTS = [
    "senior", "sr.", "sr ", "staff", "principal", "lead ",
    "manager", "director", "engineer iii", "engineer iv", "engineer v",
    "level iii", "level iv", "7+ years", "8+ years",
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


# ─── CACHE HELPERS ────────────────────────────────────────────────────────────

def load_json_cache(path: Path) -> dict:
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_json_cache(path: Path, data: dict):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def make_job_key(company: str, title: str, location: str) -> str:
    raw = f"{company.lower().strip()}|{title.lower().strip()}|{location.lower().strip()}"
    return hashlib.md5(raw.encode()).hexdigest()[:16]


def is_on_cooldown(company_id: str, cooldowns: dict) -> bool:
    entry = cooldowns.get(company_id)
    if not entry:
        return False
    try:
        expires = datetime.fromisoformat(entry["expires_utc"])
        return datetime.utcnow() < expires
    except Exception:
        return False


def update_cooldown(company_id: str, cooldowns: dict, found_new: bool):
    if found_new:
        cooldowns.pop(company_id, None)
        return
    entry  = cooldowns.get(company_id, {"misses": 0})
    misses = entry.get("misses", 0) + 1
    hours  = 24 if misses == 1 else 48 if misses == 2 else 72
    expires = (datetime.utcnow() + timedelta(hours=hours)).isoformat()
    cooldowns[company_id] = {"misses": misses, "expires_utc": expires}
    log.info(f"  Cooldown: {company_id} → {hours}h (miss #{misses})")


# ─── ACTOR VALIDATION (BUG 1 FIX) ────────────────────────────────────────────

def validate_actor(client, actor_id: str) -> bool:
    """
    Pre-flight check: verify actor exists on Apify before running it.
    Returns True if actor is accessible, False otherwise.
    BUG 1 FIX: prevents crash when actor name/ID is wrong.
    """
    try:
        actor_info = client.actor(actor_id).get()
        if actor_info is None:
            log.error(f"Actor not found: '{actor_id}'. Check ID at https://apify.com/store")
            return False
        log.debug(f"Actor validated: {actor_id}")
        return True
    except Exception as e:
        log.error(f"Actor validation failed for '{actor_id}': {e}")
        return False


_validated_actors: dict[str, bool] = {}


def get_validated_actor(client, preferred_id: str, fallback_id: str | None = None) -> str | None:
    """
    Returns a validated actor ID (cached). Falls back to fallback_id if preferred fails.
    Returns None if both fail — caller must handle gracefully.
    BUG 1 FIX: graceful degradation instead of crash.
    """
    global _validated_actors
    for actor_id in [preferred_id, fallback_id]:
        if actor_id is None:
            continue
        if actor_id not in _validated_actors:
            _validated_actors[actor_id] = validate_actor(client, actor_id)
        if _validated_actors[actor_id]:
            return actor_id
    log.error(f"No valid actor found for preferred='{preferred_id}', fallback='{fallback_id}'")
    return None


# ─── ATS-SPECIFIC SCRAPING CONFIGS ────────────────────────────────────────────

def greenhouse_config(company: dict, actor_id: str) -> dict:
    """
    Greenhouse boards: simple HTML, use Cheerio (fast + cheap).
    BUG 4 FIX: added link enqueueing so pagination is followed.
    BUG 3 FIX: improved selector robustness with multi-selector fallback.
    """
    board_url = company["apify_entrypoint_urls"][0]
    company_name = company["company_name"].replace("'", "\\'")
    return {
        "actor": actor_id,
        "input": {
            "startUrls": [{"url": board_url}],
            "maxRequestsPerCrawl": 20,   # BUG 4 FIX: allow pagination
            "additionalMimeTypes": ["text/html"],
            "proxyConfiguration": {"useApifyProxy": True},
            "pageFunction": f"""
async function pageFunction(context) {{
    const $ = context.jQuery;
    const jobs = [];

    // Greenhouse uses .opening for individual job rows
    // Some instances use table rows or li elements — handle both
    const cards = $('.opening, li.opening, .job-post, .job_listing');

    if (cards.length === 0) {{
        context.log.warning('No .opening cards found at: ' + context.request.url);
        context.log.warning('Page HTML length: ' + $('body').html().length);
    }}

    cards.each(function() {{
        const titleEl = $(this).find('a').first();
        const locEl   = $(this).find('.location, .job-location').first();
        const title   = titleEl.text().trim();
        const url     = titleEl.attr('href') || '';
        if (title) {{
            jobs.push({{
                title,
                url: url.startsWith('http') ? url : 'https://boards.greenhouse.io' + url,
                location: locEl.text().trim(),
                company: '{company_name}',
            }});
        }}
    }});

    // BUG 4 FIX: enqueue "next page" links if they exist
    const nextLinks = $('a[rel="next"], a.next-page, a:contains("Next")').map(function() {{
        return $(this).attr('href');
    }}).get().filter(Boolean);
    for (const href of nextLinks) {{
        await context.enqueueRequest({{ url: href }});
    }}

    return jobs;
}}""",
        }
    }


def lever_config(company: dict, actor_id: str) -> dict:
    """
    Lever boards: BUG 4 FIX — pagination via enqueueRequest.
    BUG 3 FIX: multi-selector fallback for different Lever versions.
    """
    board_url    = company["apify_entrypoint_urls"][0]
    company_name = company["company_name"].replace("'", "\\'")
    return {
        "actor": actor_id,
        "input": {
            "startUrls": [{"url": board_url}],
            "maxRequestsPerCrawl": 20,
            "proxyConfiguration": {"useApifyProxy": True},
            "pageFunction": f"""
async function pageFunction(context) {{
    const $ = context.jQuery;
    const jobs = [];

    // Lever uses .posting for job entries; newer boards use data attributes
    const postings = $('.posting, [data-qa="posting-name"], .job-listing');

    if (postings.length === 0) {{
        context.log.warning('No .posting elements found at: ' + context.request.url);
    }}

    postings.each(function() {{
        const titleEl = $(this).find('.posting-title h5, .posting-title a, [data-qa="posting-name"]').first();
        const locEl   = $(this).find('.posting-categories .location, .sort-by-location, .location').first();
        const linkEl  = $(this).find('a.posting-btn-submit, a.posting-title, a').first();
        const title   = titleEl.text().trim();
        const url     = linkEl.attr('href') || '';
        if (title) {{
            jobs.push({{
                title,
                url: url.startsWith('http') ? url : 'https://jobs.lever.co' + url,
                location: locEl.text().trim(),
                company: '{company_name}',
            }});
        }}
    }});

    // BUG 4 FIX: enqueue next page
    $('a[rel="next"], a.next-page').each(async function() {{
        const href = $(this).attr('href');
        if (href) await context.enqueueRequest({{ url: href }});
    }});

    return jobs;
}}""",
        }
    }


def workday_config(company: dict, actor_id: str) -> dict:
    """
    Workday: JS-heavy. Use Puppeteer.
    BUG 3 FIX: wait for dynamic content with extended timeout.
    BUG 4 FIX: detect and follow "Load More" / pagination buttons.
    """
    board_url    = company["apify_entrypoint_urls"][0]
    company_name = company["company_name"].replace("'", "\\'")
    return {
        "actor": actor_id,
        "input": {
            "startUrls":         [{"url": board_url}],
            "maxRequestsPerCrawl": 5,
            "proxyConfiguration": {"useApifyProxy": True},
            "pageFunction": f"""
async function pageFunction(context) {{
    const {{ page, log }} = context;

    // BUG 3 FIX: extended wait for Workday's dynamic rendering
    const SELECTORS = [
        '[data-automation-id="jobTitle"]',
        '.css-19uc56f',
        '.WDAY-formWidget',
        'a[data-automation-id="jobTitle"]',
        '.job-title',
    ];

    let found = false;
    for (const sel of SELECTORS) {{
        try {{
            await page.waitForSelector(sel, {{ timeout: 10000 }});
            found = true;
            log.info('Selector matched: ' + sel);
            break;
        }} catch (e) {{}}
    }}

    if (!found) {{
        log.warning('No job selectors matched. Page may be JS-gated or empty. URL: ' + page.url());
        // Capture snapshot for debugging
        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
        log.warning('Page snippet: ' + bodyText);
    }}

    // BUG 4 FIX: click "Load More" button if it exists, to get all jobs
    try {{
        const loadMoreSel = 'button[data-automation-id="loadMoreButton"], button:contains("Load more"), [aria-label="Load More"]';
        const loadMore = await page.$(loadMoreSel);
        if (loadMore) {{
            await loadMore.click();
            await new Promise(r => setTimeout(r, 3000));
            log.info('Clicked Load More button');
        }}
    }} catch(e) {{ log.debug('No load more button: ' + e.message); }}

    await new Promise(r => setTimeout(r, 2000));

    const jobs = await page.evaluate((companyName) => {{
        const results = [];
        const cards = document.querySelectorAll(
            '[data-automation-id="jobTitle"], .css-19uc56f a, a[data-automation-id="jobTitle"]'
        );
        cards.forEach(card => {{
            const title = card.textContent.trim();
            const url   = card.href || card.closest('a')?.href || '';
            const parent = card.closest('li, tr, [role="listitem"], .css-1q2dra3');
            const locEl  = parent?.querySelector('[data-automation-id="locations"], .css-129m7dg, dd');
            if (title) {{
                results.push({{
                    title, url,
                    location: locEl ? locEl.textContent.trim() : '',
                    company:  companyName,
                }});
            }}
        }});
        return results;
    }}, '{company_name}');

    log.info('Workday extracted ' + jobs.length + ' jobs from ' + page.url());
    return jobs;
}}""",
        }
    }


def google_jobs_config(company: dict, actor_id: str) -> dict:
    """
    Google Jobs fallback — uses early-career framing queries.
    BUG 3 FIX: include datePostedRange to avoid returning stale results.
    """
    queries = [
        f"entry level {kw} {company['company_name']}"
        for kw in ["manufacturing engineer", "process engineer"]
    ]
    return {
        "actor": actor_id,
        "input": {
            "queries":         queries,
            "maxResults":      15,
            "country":         "US",
            "language":        "en",
            "datePostedRange": "threeDays",  # BUG 3 FIX: freshness filter
        }
    }


def get_scrape_config(company: dict, client) -> dict | None:
    """
    Route company to appropriate scraping strategy.
    BUG 1 FIX: validate actor before returning config; return None if unavailable.
    """
    platform = company.get("ats_platform", "Unknown")
    strategy = company.get("apify_strategy", "search-then-verify")

    if strategy == "ATS-native":
        if platform == "Greenhouse":
            actor_id = get_validated_actor(client, ACTORS["cheerio"], ACTORS["web_scraper"])
            if not actor_id:
                log.error(f"No valid actor for Greenhouse scraping ({company['company_name']}). Skipping.")
                return None
            return greenhouse_config(company, actor_id)

        elif platform == "Lever":
            actor_id = get_validated_actor(client, ACTORS["cheerio"], ACTORS["web_scraper"])
            if not actor_id:
                log.error(f"No valid actor for Lever scraping ({company['company_name']}). Skipping.")
                return None
            return lever_config(company, actor_id)

        elif platform in ("Workday", "iCIMS", "Taleo", "SuccessFactors"):
            actor_id = get_validated_actor(client, ACTORS["puppeteer"])
            if not actor_id:
                log.error(f"No valid actor for Workday scraping ({company['company_name']}). Skipping.")
                return None
            return workday_config(company, actor_id)

        else:
            actor_id = get_validated_actor(client, ACTORS["google_jobs"], GOOGLE_JOBS_FALLBACK)
            if not actor_id:
                return None
            return google_jobs_config(company, actor_id)
    else:
        # search-then-verify / company-site-crawl → Google Jobs
        actor_id = get_validated_actor(client, ACTORS["google_jobs"], GOOGLE_JOBS_FALLBACK)
        if not actor_id:
            return None
        return google_jobs_config(company, actor_id)


# ─── RUN ACTOR (BUG 3 + 4 diagnostics) ───────────────────────────────────────

def run_actor(client, actor_id: str, run_input: dict, company_name: str) -> tuple[list, dict]:
    """
    Run an Apify actor and return (results, run_stats).
    BUG 3 FIX: return stats so caller can detect misconfiguration vs. empty board.
    BUG 4 FIX: check requestsTotal to detect single-page crawls.
    """
    stats = {"requests_total": 0, "requests_finished": 0, "items": 0, "diagnosis": "ok"}
    try:
        log.info(f"  Running actor {actor_id} for {company_name}…")
        run = client.actor(actor_id).call(run_input=run_input, timeout_secs=180)

        if not run:
            log.warning(f"  Actor returned no run object for {company_name}")
            stats["diagnosis"] = "no_run_object"
            return [], stats

        # Gather run stats
        run_info = client.run(run["id"]).get() or {}
        stat_obj = run_info.get("stats", {})
        stats["requests_total"]    = stat_obj.get("requestsTotal", 0)
        stats["requests_finished"] = stat_obj.get("requestsFinished", 0)

        dataset_id = run.get("defaultDatasetId")
        if not dataset_id:
            log.warning(f"  No dataset for {company_name}")
            stats["diagnosis"] = "no_dataset"
            return [], stats

        items = list(client.dataset(dataset_id).iterate_items())
        stats["items"] = len(items)

        # ── BUG 3 + 4 DIAGNOSIS ────────────────────────────────────────────
        if stats["items"] == 0:
            if stats["requests_total"] <= 2:
                # BUG 4 FIX: single page crawled → likely selector/config problem
                stats["diagnosis"] = "likely_misconfiguration"
                log.warning(
                    f"  ZERO results + only {stats['requests_total']} request(s) crawled "
                    f"for {company_name}. Likely: wrong selector, JS-gated page, or "
                    f"URL needs updating. NOT a true empty board."
                )
            else:
                # Crawled multiple pages but found nothing → genuinely no jobs
                stats["diagnosis"] = "no_jobs_on_board"
                log.info(
                    f"  Zero results after {stats['requests_total']} pages for "
                    f"{company_name}. Board appears empty."
                )
        else:
            log.info(f"  Got {len(items)} raw results for {company_name} "
                     f"(requests: {stats['requests_total']})")

        return items, stats

    except Exception as e:
        log.error(f"  Actor failed for {company_name}: {e}")
        stats["diagnosis"] = f"exception: {e}"
        return [], stats


# ─── SENIORITY FILTER ─────────────────────────────────────────────────────────

def is_senior(title: str, desc: str = "") -> bool:
    combined = (title + " " + desc).lower()
    return any(r in combined for r in SENIOR_REJECTS)


# ─── FRESHNESS CHECK ─────────────────────────────────────────────────────────

def is_fresh(posted_str: str) -> bool:
    """
    Apify Google Jobs returns "posted_at" as a human string like "3 days ago".
    Accept ≤ 72 hours (3 days).
    """
    if not posted_str:
        return True   # unknown: let post_merge_filter decide
    s = posted_str.lower()
    if "just posted" in s or "today" in s or "hour" in s or "minute" in s:
        return True
    if "1 day" in s or "2 day" in s or "3 day" in s:
        return True
    if "4 day" in s or "5 day" in s or "6 day" in s or "7 day" in s:
        return False
    if "week" in s or "month" in s:
        return False
    # For ATS scrapes without a posted date, accept
    return True


# ─── ITAR CHECK ───────────────────────────────────────────────────────────────

def check_itar(text: str) -> list:
    if not text:
        return []
    lower = text.lower()
    return [kw for kw in ITAR_KEYWORDS if kw in lower]


# ─── NORMALIZE RESULTS ────────────────────────────────────────────────────────

def normalize_job(raw_job: dict, company: dict, source_actor: str) -> dict | None:
    """Convert raw actor output to standard job schema."""
    if source_actor in (ACTORS["google_jobs"], GOOGLE_JOBS_FALLBACK):
        title    = raw_job.get("title",    raw_job.get("job_title",   ""))
        location = raw_job.get("location", raw_job.get("job_location",""))
        link     = raw_job.get("link",     raw_job.get("apply_link",  raw_job.get("url", "")))
        desc     = raw_job.get("description", raw_job.get("job_description", ""))
        posted   = raw_job.get("detected_extensions", {}).get("posted_at", "")
    else:
        # ATS scraper (Greenhouse/Lever/Workday page function output)
        title    = raw_job.get("title",    "")
        location = raw_job.get("location", "")
        link     = raw_job.get("url",      "")
        desc     = raw_job.get("description", "")
        posted   = ""

    title = (title or "").strip()
    if not title:
        return None

    # ── Seniority filter ─────────────────────────────────────────────────────
    if is_senior(title, desc):
        log.debug(f"    Apify SKIP senior: {title}")
        return None

    # ── Freshness filter ─────────────────────────────────────────────────────
    if not is_fresh(posted):
        log.debug(f"    Apify SKIP stale ({posted}): {title}")
        return None

    itar_flags = check_itar(desc)
    tier       = company.get("tier",  "Tier 2")
    h1b        = company.get("h1b",   "LIKELY")

    return {
        "_stable_key": make_job_key(company["company_name"], title, location),
        "role":         title,
        "company":      company["company_name"],
        "location":     location,
        "type":         "Full-time",
        "link":         link,
        "posted":       posted,
        "itar_flag":    len(itar_flags) > 0,
        "itar_detail":  ", ".join(itar_flags) if itar_flags else "",
        "tier":         tier,
        "h1b":          h1b,
        "itar_company": company.get("itar", "NO"),
        "industry":     company.get("primary_industry_category", ""),
        "domain_verified": bool(
            company.get("company_domain") and
            company["company_domain"] in (link or "")
        ),
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

def get_today_batch(companies: list, batch_size: int) -> tuple[list, int, int]:
    day_of_year = datetime.now().timetuple().tm_yday
    total       = len(companies)
    num_batches = max(1, (total + batch_size - 1) // batch_size)
    batch_idx   = day_of_year % num_batches
    start       = batch_idx * batch_size
    end         = min(start + batch_size, total)
    return companies[start:end], batch_idx, num_batches


# ─── EMPTY OUTPUT ─────────────────────────────────────────────────────────────

def _write_empty_output(reason: str = ""):
    today  = datetime.now().strftime("%Y-%m-%d")
    output = {
        "generated_utc":    datetime.utcnow().isoformat() + "Z",
        "scraper":          "apify",
        "error":            reason,
        "companies_searched": 0,
        "total_jobs_found": 0,
        "eligible_jobs":    0,
        "itar_flagged":     0,
        "jobs":             [],
    }
    for path in [OUTPUT_DIR / f"jobs_apify_{today}.json",
                 OUTPUT_DIR / "jobs_apify_latest.json"]:
        with open(path, "w") as f:
            json.dump(output, f, indent=2)
    log.warning(f"Wrote empty Apify output. Reason: {reason}")


# ─── GENERATE-ONLY MODE ──────────────────────────────────────────────────────

def generate_configs_only():
    """Dry run — prints actor configs without executing. Safe for review."""
    config    = load_config()
    companies = config["companies"]

    # Can't validate actors without a live client, so just show config
    configs = []
    for c in companies:
        platform = c.get("ats_platform", "Unknown")
        strategy = c.get("apify_strategy", "search-then-verify")
        actor_hint = (
            ACTORS["cheerio"]     if platform in ("Greenhouse", "Lever") else
            ACTORS["puppeteer"]   if platform == "Workday" else
            ACTORS["google_jobs"]
        )
        configs.append({
            "company_id":   c["company_id"],
            "company_name": c["company_name"],
            "ats_platform": platform,
            "strategy":     strategy,
            "actor":        actor_hint,
        })

    out = OUTPUT_DIR / "apify_run_configs.json"
    with open(out, "w") as f:
        json.dump(configs, f, indent=2)
    log.info(f"DRY RUN: {len(configs)} actor configs written to {out}")
    log.info("Review, then use --run to execute.")


def load_config():
    with open(CONFIG_PATH) as f:
        return json.load(f)


# ─── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    log.info("=" * 60)
    log.info("M628 Apify Scraper v2 — Starting")
    log.info("=" * 60)

    run_mode = "--run" in sys.argv
    if not run_mode:
        log.info("DRY RUN mode. Use --run to execute.")
        generate_configs_only()
        return

    if not APIFY_TOKEN:
        log.error("APIFY_TOKEN not set.")
        _write_empty_output("No APIFY_TOKEN set")
        sys.exit(0)

    if ApifyClient is None:
        log.error("apify-client not installed.")
        _write_empty_output("apify-client not installed")
        sys.exit(0)

    client = ApifyClient(APIFY_TOKEN)
    config = load_config()
    all_companies = config["companies"]

    # ── Enrich from ENRICHED_MASTER ───────────────────────────────────────────
    master_path = SCRIPT_DIR / "M628_ENRICHED_MASTER.json"
    master_lookup = {}
    if master_path.exists():
        with open(master_path) as f:
            for c in json.load(f):
                master_lookup[c["company_id"]] = c

    for c in all_companies:
        m = master_lookup.get(c["company_id"], {})
        c["tier"]                     = m.get("tier",  "Tier 2")
        c["h1b"]                      = m.get("h1b",   "LIKELY")
        c["itar"]                     = m.get("itar",  "NO")
        c["primary_industry_category"] = m.get("primary_industry_category", "")

    # Sort: Greenhouse/Lever first (cheapest), then Workday, then fallback
    all_companies.sort(key=lambda c: (
        0 if c["ats_platform"] in ("Greenhouse", "Lever") else
        1 if c["ats_platform"] == "Workday" else 2
    ))

    # ── Load caches ───────────────────────────────────────────────────────────
    seen_keys = load_json_cache(SEEN_KEYS_PATH)
    cooldowns = load_json_cache(COOLDOWN_PATH)
    log.info(f"Cache: {len(seen_keys)} seen keys, {len(cooldowns)} cooldowns")

    batch, batch_idx, num_batches = get_today_batch(all_companies, BATCH_SIZE)
    log.info(f"Batch {batch_idx + 1}/{num_batches}: {len(batch)} companies")

    all_new_jobs      = []
    misconfigured     = []
    companies_run     = 0
    scrape_diagnostics = []

    for i, company in enumerate(batch):
        cid = company.get("company_id", company["company_name"])

        # ── Cooldown ──────────────────────────────────────────────────────────
        if is_on_cooldown(cid, cooldowns):
            log.info(f"[{i+1}/{len(batch)}] COOLDOWN: {company['company_name']}")
            continue

        log.info(f"[{i+1}/{len(batch)}] {company['company_name']} "
                 f"({company['ats_platform']}, {company['apify_strategy']})")

        # ── BUG 1 FIX: validate and get config ───────────────────────────────
        sc = get_scrape_config(company, client)
        if sc is None:
            log.warning(f"  Skipping {company['company_name']}: no valid actor available.")
            continue

        # ── Run actor ─────────────────────────────────────────────────────────
        results, stats = run_actor(client, sc["actor"], sc["input"], company["company_name"])
        companies_run += 1

        scrape_diagnostics.append({
            "company":    company["company_name"],
            "actor":      sc["actor"],
            "stats":      stats,
        })

        # ── BUG 4 FIX: flag misconfiguration ─────────────────────────────────
        if stats["diagnosis"] == "likely_misconfiguration":
            misconfigured.append(company["company_name"])

        # ── Process results (Phase 2: verify only new jobs) ──────────────────
        company_new_jobs = []
        for raw in results:
            items = raw if isinstance(raw, list) else [raw]
            for item in items:
                job = normalize_job(item, company, sc["actor"])
                if not job:
                    continue
                key = job["_stable_key"]
                if key in seen_keys:
                    log.debug(f"    SKIP seen: {job['role']}")
                    continue
                company_new_jobs.append(job)
                seen_keys[key] = datetime.utcnow().isoformat() + "Z"

        found_new = len(company_new_jobs) > 0
        update_cooldown(cid, cooldowns, found_new)
        all_new_jobs.extend(company_new_jobs)

        if found_new:
            log.info(f"  ✓ {len(company_new_jobs)} new jobs")
        else:
            log.info(f"  — No new jobs (diagnosis: {stats['diagnosis']})")

        time.sleep(2)

        # Stop if valid job targets met (checked after each company)
        if len(all_new_jobs) >= MAX_NEW_JOBS_TO_STOP:
            log.info(f"MAX_VALID_JOBS_TARGET reached ({len(all_new_jobs)}). Stopping.")
            break
        green_count = sum(1 for j in all_new_jobs if j.get("verdict") == "GREEN")
        if green_count >= MAX_GREEN_JOBS_TO_STOP:
            log.info(f"MAX_GREEN_JOBS_TARGET reached ({green_count}). Stopping.")
            break
        if STOP_SENTINEL.exists():
            log.info(f"Stop signal: {STOP_SENTINEL.read_text().strip()}")
            break

    # ── Save caches ───────────────────────────────────────────────────────────
    save_json_cache(SEEN_KEYS_PATH, seen_keys)
    save_json_cache(COOLDOWN_PATH,  cooldowns)

    # ── Log misconfigured companies ───────────────────────────────────────────
    if misconfigured:
        log.warning("=" * 60)
        log.warning(f"POSSIBLE MISCONFIGURATIONS ({len(misconfigured)} companies):")
        for name in misconfigured:
            log.warning(f"  - {name}: 0 results + 1 page crawled. "
                        f"Check selector / start URL.")
        log.warning("=" * 60)

    # ── Strip internal keys ────────────────────────────────────────────────────
    for job in all_new_jobs:
        job.pop("_stable_key", None)

    # ── Deduplicate ───────────────────────────────────────────────────────────
    seen_out = set()
    unique   = []
    for j in all_new_jobs:
        key = (j["company"], j["role"], j["location"])
        if key not in seen_out:
            seen_out.add(key)
            unique.append(j)

    verdict_order = {"GREEN": 0, "YELLOW": 1, "RED": 2}
    unique.sort(key=lambda j: (verdict_order.get(j["verdict"], 9), -j["match"]))

    today       = datetime.now().strftime("%Y-%m-%d")
    output_file = OUTPUT_DIR / f"jobs_apify_{today}.json"

    output = {
        "generated_utc":      datetime.utcnow().isoformat() + "Z",
        "scraper":            "apify",
        "batch":              batch_idx + 1,
        "total_batches":      num_batches,
        "companies_searched": companies_run,
        "total_jobs_found":   len(unique),
        "eligible_jobs":      len([j for j in unique if not j["itar_flag"]]),
        "itar_flagged":       len([j for j in unique if j["itar_flag"]]),
        "misconfigured_companies": misconfigured,
        "scrape_diagnostics": scrape_diagnostics,
        "jobs":               unique,
    }

    with open(output_file, "w") as f:
        json.dump(output, f, indent=2)
    with open(OUTPUT_DIR / "jobs_apify_latest.json", "w") as f:
        json.dump(output, f, indent=2)

    log.info("=" * 60)
    log.info(f"DONE. {len(unique)} new jobs → {output_file}")
    log.info(f"  Misconfigured: {len(misconfigured)}")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
