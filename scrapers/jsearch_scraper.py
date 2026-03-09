#!/usr/bin/env python3
"""
M628 JSearch Scraper — Queries RapidAPI JSearch API for job postings
across all 303 cleaned companies. Outputs pipeline-ready JSON for JobAgent.

SETUP:
  1. Get free API key: https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
     Free tier: 200 requests/month (enough for daily runs of ~60 companies)
  2. pip install requests python-dotenv
  3. Create .env file with: JSEARCH_API_KEY=your_key_here
  4. Run: python jsearch_scraper.py

OUTPUT: jobs_jsearch_YYYY-MM-DD.json (pipeline-ready)

SCHEDULING (GitHub Actions / cron):
  Run daily: 0 8 * * * cd /path/to/scraper && python jsearch_scraper.py
"""

import os, sys, json, time, re, logging, signal
from datetime import datetime, timedelta
from pathlib import Path

try:
    import requests
except ImportError:
    print("Install requests: pip install requests --break-system-packages")
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # .env optional if key is in environment

# ─── CONFIG ───────────────────────────────────────────────────────────────────
JSEARCH_API_KEY = os.environ.get("JSEARCH_API_KEY", "")
JSEARCH_HOST = "jsearch.p.rapidapi.com"
JSEARCH_URL = "https://jsearch.p.rapidapi.com/search"

SCRIPT_DIR = Path(__file__).parent
CONFIG_PATH = SCRIPT_DIR / "M628_JSEARCH_CONFIG.json"
OUTPUT_DIR = SCRIPT_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

# Rate limiting
REQUEST_DELAY = 1.5        # seconds between API calls
# FREE TIER MATH: 200 requests/month ÷ 30 days = 6 req/day budget
# 3 companies × 2 keywords = 6 calls/day = ~180/month (safe under 200)
# Full 303-company cycle completes in ~101 days
MAX_REQUESTS_PER_RUN = 6   # hard cap: 6/day × 30 = 180/month under free tier
BATCH_SIZE = 3             # 3 companies × 2 keywords = 6 calls/day  [Option C: was higher]
KEYWORDS_PER_COMPANY = 2   # use top 2 keywords only (was 4)
MAX_RESULTS_PER_QUERY = 10

# ── Hard timeout (Option B) ────────────────────────────────────────────────
# If the entire JSearch run hasn't finished within this window, abort cleanly
# and let the fallback scraper (5th scraper) handle the run.
# 3 queries × worst-case 6 min each = 18 min theoretical max.
# We cap at 8 minutes so the pipeline still has time to run inside 30-min job.
JSEARCH_HARD_TIMEOUT_SECONDS = 8 * 60   # 8 minutes total wall-clock budget
# Per single API call: abort retry loop if one call has waited this long
JSEARCH_PER_QUERY_TIMEOUT_SECONDS = 90  # 90s max per single query (was unlimited)

# ITAR keywords to flag in job descriptions
ITAR_KEYWORDS = [
    "security clearance", "us person", "itar", "export controlled",
    "classified", "us citizen or permanent resident",
    "must be authorized to work without sponsorship",
    "u.s. citizen", "u.s. national", "permanent resident only",
    "lawfully admitted for permanent residence"
]

# Aggregator domains to reject
REJECT_DOMAINS = ["indeed.com", "glassdoor.com", "ziprecruiter.com",
                  "simplyhired.com", "monster.com", "careerbuilder.com"]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(SCRIPT_DIR / "jsearch.log"),
        logging.StreamHandler()
    ]
)
log = logging.getLogger("jsearch")

class QuotaExceededError(Exception):
    pass

class JSearchTimeoutError(Exception):
    """Raised when JSearch exceeds the hard wall-clock timeout.
    The workflow will detect this via exit code 2 and trigger the fallback scraper."""
    pass

def _timeout_handler(signum, frame):
    raise JSearchTimeoutError("JSearch hard timeout reached")


# ─── LOAD CONFIG ──────────────────────────────────────────────────────────────
def load_config():
    with open(CONFIG_PATH) as f:
        return json.load(f)


# ─── JSEARCH API CALL ─────────────────────────────────────────────────────────
def search_jobs(query, page=1, num_pages=1, date_posted="3days", _retry_wait=0):
    """Call JSearch API. Returns list of job objects or empty list on error.
    _retry_wait tracks cumulative wait so far for this query — if it exceeds
    JSEARCH_PER_QUERY_TIMEOUT_SECONDS we skip this query rather than block forever."""
    if not JSEARCH_API_KEY:
        log.error("No JSEARCH_API_KEY set. Get one from RapidAPI.")
        return []

    # Per-query timeout guard: if we've already waited too long for this one
    # query, skip it and move on rather than blocking the whole pipeline.
    if _retry_wait >= JSEARCH_PER_QUERY_TIMEOUT_SECONDS:
        log.warning(f"[jsearch] Per-query timeout ({JSEARCH_PER_QUERY_TIMEOUT_SECONDS}s) "
                    f"exceeded for: {query[:60]}... — skipping this query.")
        return []

    headers = {
        "X-RapidAPI-Key": JSEARCH_API_KEY,
        "X-RapidAPI-Host": JSEARCH_HOST
    }
    params = {
        "query": query,
        "page": str(page),
        "num_pages": str(num_pages),
        "date_posted": date_posted,
        "country": "us",
        "language": "en",
    }

    try:
        r = requests.get(JSEARCH_URL, headers=headers, params=params, timeout=15)
        if r.status_code == 429:
            wait = 60
            log.warning(f"[jsearch] Rate limited — waiting {wait}s "
                        f"(cumulative wait for this query: {_retry_wait + wait}s / "
                        f"{JSEARCH_PER_QUERY_TIMEOUT_SECONDS}s limit) ...")
            time.sleep(wait)
            return search_jobs(query, page, num_pages, date_posted,
                               _retry_wait=_retry_wait + wait)
        if r.status_code == 403:
            log.error("API key invalid or monthly quota exceeded (200 req/month free tier).")
            log.error("Check usage at: https://rapidapi.com/developer/dashboard")
            raise QuotaExceededError("JSearch quota exceeded")
        if r.status_code != 200:
            log.warning(f"API returned {r.status_code} for query: {query}")
            return []

        data = r.json()
        return data.get("data", [])
    except (QuotaExceededError, JSearchTimeoutError):
        raise
    except Exception as e:
        log.error(f"Request failed for '{query}': {e}")
        return []


# ─── ITAR CHECK ───────────────────────────────────────────────────────────────
def check_itar(text):
    """Returns list of matched ITAR keywords found in text."""
    if not text:
        return []
    lower = text.lower()
    return [kw for kw in ITAR_KEYWORDS if kw in lower]


# ─── URL VALIDATION ───────────────────────────────────────────────────────────
def is_aggregator(url):
    """Check if URL points to a job aggregator (reject these)."""
    if not url:
        return True
    lower = url.lower()
    return any(d in lower for d in REJECT_DOMAINS)


def url_matches_domain(url, company_domain):
    """Check if job URL matches the company's known domain."""
    if not url or not company_domain:
        return False
    return company_domain.lower() in url.lower()


# ─── PROCESS ONE COMPANY ─────────────────────────────────────────────────────
def scrape_company(company, title_keywords, config):
    """Query JSearch for a single company across all title keywords.
    Returns list of cleaned, deduplicated job objects."""

    company_name = company["company_name"]
    domain = company.get("company_domain", "")
    tier = company.get("tier", "Tier 2")
    h1b = company.get("h1b", "LIKELY")
    itar = company.get("itar", "NO")
    queries_used = company.get("jsearch_company_query", [company_name])

    all_jobs = []
    seen_ids = set()

    # Build queries: "Manufacturing Engineer at Boeing"
    # Use top KEYWORDS_PER_COMPANY keywords to stay within rate limits
    priority_keywords = title_keywords[:KEYWORDS_PER_COMPANY]

    for kw in priority_keywords:
        for qname in queries_used[:1]:  # Use primary name only
            query = f"{kw} at {qname}"
            time.sleep(REQUEST_DELAY)

            results = search_jobs(query, page=1, num_pages=1,
                                  date_posted=f"{config['defaults']['max_age_days']}days"
                                  if config['defaults']['max_age_days'] <= 3 else "week")

            for job in results:
                job_id = job.get("job_id", "")
                if job_id in seen_ids:
                    continue
                seen_ids.add(job_id)

                apply_link = job.get("job_apply_link", "")
                # Reject aggregator URLs
                if is_aggregator(apply_link):
                    # Try the Google redirect link as fallback
                    apply_link = job.get("job_google_link", apply_link)
                    if is_aggregator(apply_link):
                        continue

                # Extract description for ITAR check
                desc = job.get("job_description", "")
                itar_flags = check_itar(desc)

                # Check exclusion keywords
                desc_lower = desc.lower() if desc else ""
                title_lower = (job.get("job_title", "") or "").lower()
                excluded = any(ex.lower() in desc_lower or ex.lower() in title_lower
                               for ex in config["defaults"]["exclusion_keywords"])
                if excluded:
                    continue

                # Parse posted date
                posted_ts = job.get("job_posted_at_datetime_utc", "")
                posted_str = ""
                if posted_ts:
                    try:
                        dt = datetime.fromisoformat(posted_ts.replace("Z", "+00:00"))
                        days_ago = (datetime.now(dt.tzinfo) - dt).days
                        posted_str = f"{days_ago}d ago" if days_ago > 0 else "today"
                    except:
                        posted_str = posted_ts[:10]

                # Determine location
                city = job.get("job_city", "")
                state = job.get("job_state", "")
                location = f"{city}, {state}" if city and state else (city or state or "Remote/Unknown")

                # Employment type
                emp_type = job.get("job_employment_type", "FULLTIME")
                type_map = {"FULLTIME": "Full-time", "PARTTIME": "Part-time",
                            "INTERN": "Internship", "CONTRACTOR": "Contract"}
                job_type = type_map.get(emp_type, emp_type)

                # Domain match score
                domain_match = url_matches_domain(apply_link, domain)

                all_jobs.append({
                    "id": f"{company_name.replace(' ', '-')}-{len(all_jobs)}",
                    "role": job.get("job_title", "Unknown"),
                    "company": company_name,
                    "location": location,
                    "type": job_type,
                    "link": apply_link,
                    "posted": posted_str,
                    "itar_flag": len(itar_flags) > 0,
                    "itar_detail": ", ".join(itar_flags) if itar_flags else "",
                    "tier": tier,
                    "h1b": h1b,
                    "itar_company": itar,
                    "industry": company.get("primary_industry_category", ""),
                    "domain_verified": domain_match,
                    "source": "jsearch",
                    "reason": f"Matched '{kw}' at {company_name}",
                    # Scoring (same logic as JobAgent_v4)
                    "match": 0 if len(itar_flags) > 0 else (
                        90 if tier == "Tier 1" and h1b == "YES" else
                        85 if tier == "Tier 1" else
                        82 if tier == "Tier 2" and h1b == "YES" else
                        78 if tier == "Tier 2" else
                        72 if tier == "Tier 3" else 65
                    ),
                    "verdict": "RED" if len(itar_flags) > 0 else (
                        "GREEN" if tier == "Tier 1" else "YELLOW"
                    ),
                })

    return all_jobs


# ─── BATCH ROTATION ───────────────────────────────────────────────────────────
def get_today_batch(companies, batch_size):
    """Rotate through companies daily. Day 1: companies 0-19, Day 2: 20-39, etc."""
    day_of_year = datetime.now().timetuple().tm_yday
    total = len(companies)
    num_batches = (total + batch_size - 1) // batch_size
    batch_idx = day_of_year % num_batches
    start = batch_idx * batch_size
    end = min(start + batch_size, total)
    return companies[start:end], batch_idx, num_batches


def _write_empty_output(reason=""):
    """Write an empty-but-valid output file so merge_pipeline.py runs cleanly."""
    today = datetime.now().strftime("%Y-%m-%d")
    output = {
        "generated_utc": datetime.utcnow().isoformat() + "Z",
        "scraper": "jsearch",
        "error": reason,
        "companies_searched": 0,
        "api_calls_used": 0,
        "total_jobs_found": 0,
        "eligible_jobs": 0,
        "itar_flagged": 0,
        "jobs": [],
    }
    for path in [OUTPUT_DIR / f"jobs_jsearch_{today}.json", OUTPUT_DIR / "jobs_jsearch_latest.json"]:
        with open(path, "w") as f:
            json.dump(output, f, indent=2)
    log.warning(f"Wrote empty output. Reason: {reason}")



# ─── ORCHESTRATOR-COMPATIBLE CLASS ────────────────────────────────────────
class JSearchScraper:
    """
    Wrapper class that adapts the JSearch company-config-driven scraper
    to the orchestrator's query-driven interface: ScraperClass().run(queries).

    The orchestrator passes queries generated by QueryEngine, but JSearch
    works by searching "{keyword} at {company_name}" using the M628 config.
    This class uses the existing company batch rotation + scrape_company()
    logic internally.
    """

    def run(self, queries=None):
        """Run JSearch scraper using company config batch rotation.

        Args:
            queries: List[Dict] from QueryEngine (not used by JSearch).
        Returns:
            List[Dict] of jobs in merge-pipeline-compatible schema.
        """
        if not JSEARCH_API_KEY:
            log.warning("[jsearch] JSEARCH_API_KEY not set — skipping")
            return []

        try:
            config = load_config()
        except FileNotFoundError:
            log.error(f"[jsearch] Config not found at {CONFIG_PATH}")
            return []

        all_companies = config["companies"]
        title_keywords = config["defaults"]["title_keywords"]
        all_companies.sort(key=lambda c: c.get("tier", "Tier 3"))

        batch, batch_idx, num_batches = get_today_batch(all_companies, BATCH_SIZE)
        log.info(f"[jsearch] Batch {batch_idx + 1}/{num_batches}: {len(batch)} companies")

        raw_jobs = []
        api_calls = 0

        for i, company in enumerate(batch):
            if api_calls >= MAX_REQUESTS_PER_RUN:
                log.warning(f"[jsearch] Hit request limit ({MAX_REQUESTS_PER_RUN}). Stopping.")
                break

            log.info(f"[jsearch] [{i+1}/{len(batch)}] {company['company_name']}")
            try:
                jobs = scrape_company(company, title_keywords, config)
            except QuotaExceededError:
                log.error("[jsearch] Quota exceeded mid-run.")
                break
            api_calls += KEYWORDS_PER_COMPANY

            if jobs:
                raw_jobs.extend(jobs)
                log.info(f"[jsearch]   Found {len(jobs)} jobs")

        # Deduplicate
        seen = set()
        unique = []
        for job in raw_jobs:
            key = (job.get("company", ""), job.get("role", ""), job.get("location", ""))
            if key not in seen:
                seen.add(key)
                unique.append(job)

        # Map to merge-pipeline schema
        normalized = []
        for j in unique:
            normalized.append({
                "job_title":     j.get("role", ""),
                "company_name":  j.get("company", ""),
                "job_url":       j.get("link", ""),
                "location":      j.get("location", ""),
                "posted_date":   j.get("posted", ""),
                "description":   j.get("description", ""),
                "source":        "jsearch",
                "cluster":       "",
                "itar_flag":     j.get("itar_flag", False),
                "itar_detail":   j.get("itar_detail", ""),
            })

        log.info(f"[jsearch] Done. {len(normalized)} unique jobs returned to orchestrator.")
        return normalized


# ─── MAIN ─────────────────────────────────────────────────────────────────────
def main():
    log.info("=" * 60)
    log.info("M628 JSearch Scraper — Starting")
    log.info("=" * 60)

    if not JSEARCH_API_KEY:
        log.error("JSEARCH_API_KEY not set. Create .env file or set environment variable.")
        log.info("Get a free key at: https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch")
        _write_empty_output("No JSEARCH_API_KEY set")
        sys.exit(0)  # exit 0 — workflow continues to Apify + merge

    # ── Arm hard wall-clock timeout (Option B) ─────────────────────────────
    # If the entire JSearch run hasn't completed in JSEARCH_HARD_TIMEOUT_SECONDS,
    # we abort and exit with code 2 so the workflow knows to run the fallback scraper.
    signal.signal(signal.SIGALRM, _timeout_handler)
    signal.alarm(JSEARCH_HARD_TIMEOUT_SECONDS)
    log.info(f"[jsearch] Hard timeout armed: {JSEARCH_HARD_TIMEOUT_SECONDS // 60} minutes")

    config = load_config()
    all_companies = config["companies"]
    title_keywords = config["defaults"]["title_keywords"]

    # Sort by tier priority (Tier 1 first)
    all_companies.sort(key=lambda c: c.get("tier", "Tier 3"))

    # Get today's batch
    batch, batch_idx, num_batches = get_today_batch(all_companies, BATCH_SIZE)
    log.info(f"Batch {batch_idx + 1}/{num_batches}: {len(batch)} companies "
             f"(of {len(all_companies)} total)")
    log.info(f"Keywords: {title_keywords[:KEYWORDS_PER_COMPANY]} (using top {KEYWORDS_PER_COMPANY})")
    log.info(f"Max API calls this run: ~{len(batch) * KEYWORDS_PER_COMPANY}")

    all_jobs = []
    api_calls = 0
    companies_searched = 0
    timed_out = False

    try:
        for i, company in enumerate(batch):
            if api_calls >= MAX_REQUESTS_PER_RUN:
                log.warning(f"Hit request limit ({MAX_REQUESTS_PER_RUN}). Stopping.")
                break

            log.info(f"[{i+1}/{len(batch)}] Searching: {company['company_name']} "
                     f"({company.get('tier', '?')}, H1B:{company.get('h1b', '?')})")

            try:
                jobs = scrape_company(company, title_keywords, config)
            except QuotaExceededError:
                log.error("Quota exceeded mid-run. Saving partial results and exiting cleanly.")
                break
            api_calls += KEYWORDS_PER_COMPANY
            companies_searched += 1

            if jobs:
                all_jobs.extend(jobs)
                log.info(f"  Found {len(jobs)} jobs "
                         f"({sum(1 for j in jobs if j['itar_flag'])} ITAR-flagged)")
            else:
                log.info(f"  No matching jobs found")

    except JSearchTimeoutError:
        timed_out = True
        log.warning("=" * 60)
        log.warning(f"[jsearch] HARD TIMEOUT hit after {JSEARCH_HARD_TIMEOUT_SECONDS // 60} min. "
                    f"Scraped {companies_searched}/{len(batch)} companies before cutoff.")
        log.warning("[jsearch] Writing partial results. Workflow will trigger fallback scraper.")
        log.warning("=" * 60)

    finally:
        signal.alarm(0)  # disarm timer

    # Deduplicate by (company, role, location)
    seen = set()
    unique_jobs = []
    for job in all_jobs:
        key = (job["company"], job["role"], job["location"])
        if key not in seen:
            seen.add(key)
            unique_jobs.append(job)

    # Sort: GREEN first, then YELLOW, then RED. Within each, by match score desc
    verdict_order = {"GREEN": 0, "YELLOW": 1, "RED": 2}
    unique_jobs.sort(key=lambda j: (verdict_order.get(j["verdict"], 9), -j["match"]))

    # Save output
    today = datetime.now().strftime("%Y-%m-%d")
    output_file = OUTPUT_DIR / f"jobs_jsearch_{today}.json"

    output = {
        "generated_utc": datetime.utcnow().isoformat() + "Z",
        "scraper": "jsearch",
        "batch": batch_idx + 1,
        "total_batches": num_batches,
        "companies_searched": companies_searched,
        "api_calls_used": api_calls,
        "total_jobs_found": len(unique_jobs),
        "eligible_jobs": len([j for j in unique_jobs if not j["itar_flag"]]),
        "itar_flagged": len([j for j in unique_jobs if j["itar_flag"]]),
        "timed_out": timed_out,
        "jobs": unique_jobs,
    }

    with open(output_file, "w") as f:
        json.dump(output, f, indent=2)

    latest = OUTPUT_DIR / "jobs_jsearch_latest.json"
    with open(latest, "w") as f:
        json.dump(output, f, indent=2)

    log.info("=" * 60)
    log.info(f"DONE. {len(unique_jobs)} unique jobs saved to {output_file}")
    log.info(f"  GREEN: {sum(1 for j in unique_jobs if j['verdict']=='GREEN')}")
    log.info(f"  YELLOW: {sum(1 for j in unique_jobs if j['verdict']=='YELLOW')}")
    log.info(f"  RED (ITAR): {sum(1 for j in unique_jobs if j['verdict']=='RED')}")
    log.info(f"  API calls used: {api_calls}")
    if timed_out:
        log.warning("  ⚠ Run was cut short by hard timeout — fallback scraper will supplement.")
    log.info("=" * 60)

    # Exit code 2 signals the workflow to run the fallback scraper
    if timed_out:
        sys.exit(2)


if __name__ == "__main__":
    main()
