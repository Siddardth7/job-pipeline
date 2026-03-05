#!/usr/bin/env python3
"""
M628 JSearch Scraper — Two modes in one script:

  MODE 1 — TARGETED (default):
    Queries "Manufacturing Engineer at Boeing" for each M628 company.
    Batch-rotates through 303 companies to stay under the API rate limit.

  MODE 2 — OPEN SEARCH:
    Broad keyword + location queries with NO company filter.
    e.g. "Composites Engineer California" — surfaces companies NOT in M628.
    Shares the same daily API budget. Runs after targeted mode.

  Both write separate output files. merge_pipeline.py combines all four
  sources (jsearch_targeted, jsearch_open, apify_targeted, apify_open).

SETUP:
  pip install requests python-dotenv
  .env: JSEARCH_API_KEY=your_key_here

FREE TIER MATH (200 req/month):
  Targeted:    3 companies x 2 keywords = 6 calls/day  (~180/month)
  Open search: 3 queries/day                            (~90/month)
  TOTAL:       ~270/month  -- slightly over free tier.
  FIX: Set OPEN_SEARCH_CALLS_PER_RUN=0 to stay free, or upgrade to
  Basic plan ($10/mo = 1,500 req/month) to run both comfortably.
"""

import os, sys, json, time, logging
from datetime import datetime
from pathlib import Path

try:
    import requests
except ImportError:
    print("Install requests: pip install requests")
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ─── CONFIG ───────────────────────────────────────────────────────────────────
JSEARCH_API_KEY  = os.environ.get("JSEARCH_API_KEY", "")
JSEARCH_HOST     = "jsearch.p.rapidapi.com"
JSEARCH_URL      = "https://jsearch.p.rapidapi.com/search"

SCRIPT_DIR  = Path(__file__).parent
CONFIG_PATH = SCRIPT_DIR / "M628_JSEARCH_CONFIG.json"
OUTPUT_DIR  = SCRIPT_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

# Rate limits
REQUEST_DELAY             = 1.5
MAX_REQUESTS_PER_RUN      = 9     # targeted + open combined
TARGETED_CALLS_PER_RUN    = 6     # 3 companies x 2 keywords
OPEN_SEARCH_CALLS_PER_RUN = 3     # set to 0 on free tier to be safe
BATCH_SIZE                = 3
KEYWORDS_PER_COMPANY      = 2

# BUG FIX 1: linkedin.com and other aggregators were missing
REJECT_DOMAINS = [
    "indeed.com", "glassdoor.com", "ziprecruiter.com", "simplyhired.com",
    "monster.com", "careerbuilder.com", "linkedin.com", "bandana.com",
    "talent.com", "salary.com", "jooble.org", "joblist.com",
]

# BUG FIX 2: title filter was missing entirely — caused 96% irrelevant jobs
TARGET_TITLE_KW = [
    "manufacturing engineer", "process engineer", "composites engineer",
    "composite engineer", "materials engineer", "quality engineer",
    "manufacturing process", "advanced manufacturing", "composite manufacturing",
    "structural manufacturing", "propulsion manufacturing", "production engineer",
    "quality systems engineer", "manufacturing technology", "r&d manufacturing",
    "npi engineer", "new product introduction", "process development engineer",
]

# Roles to reject even if they superficially match above
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
    "lawfully admitted for permanent residence",
]

DESC_EXCLUSIONS = [
    "no sponsorship", "must be a us citizen", "security clearance required",
    "ts/sci", "must be authorized to work", "staffing", "c2c",
    "corp-to-corp", "1099", "third party",
]

# Open search query pool — rotated daily (3 per day = full cycle ~7 days)
OPEN_SEARCH_QUERIES = [
    ("Composites Manufacturing Engineer",      "California"),
    ("Composites Manufacturing Engineer",      "Washington"),
    ("Composites Manufacturing Engineer",      "Texas"),
    ("Composites Manufacturing Engineer",      "Michigan"),
    ("Composites Manufacturing Engineer",      "Florida"),
    ("Process Engineer composites aerospace",  "United States"),
    ("Materials Process Engineer aerospace",   "United States"),
    ("Manufacturing Engineer composites",      "United States"),
    ("Advanced Manufacturing Engineer",        "California"),
    ("Advanced Manufacturing Engineer",        "Washington"),
    ("Advanced Manufacturing Engineer",        "Michigan"),
    ("Quality Engineer aerospace composites",  "United States"),
    ("Quality Systems Engineer manufacturing", "United States"),
    ("NPI Engineer manufacturing",             "United States"),
    ("Manufacturing Engineer eVTOL",           "United States"),
    ("Manufacturing Engineer space launch",    "California"),
    ("Composites Engineer space",              "California"),
    ("Process Engineer aerospace",             "Arizona"),
    ("Manufacturing Engineer defense",         "United States"),
    ("Composites Manufacturing Engineer",      "Colorado"),
]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(SCRIPT_DIR / "jsearch.log"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("jsearch")


class QuotaExceededError(Exception):
    pass


# ─── HELPERS ──────────────────────────────────────────────────────────────────
def load_config():
    with open(CONFIG_PATH) as f:
        return json.load(f)


def api_search(query, location=None, date_posted="3days"):
    """Single JSearch API call. Raises QuotaExceededError on 403."""
    if not JSEARCH_API_KEY:
        return []
    full_q = f"{query} in {location}" if location else query
    headers = {"X-RapidAPI-Key": JSEARCH_API_KEY, "X-RapidAPI-Host": JSEARCH_HOST}
    params  = {"query": full_q, "page": "1", "num_pages": "1",
               "date_posted": date_posted, "country": "us", "language": "en"}
    try:
        r = requests.get(JSEARCH_URL, headers=headers, params=params, timeout=15)
        if r.status_code == 429:
            log.warning("Rate limited — waiting 60s")
            time.sleep(60)
            return api_search(query, location, date_posted)
        if r.status_code == 403:
            raise QuotaExceededError("403 — quota exceeded or invalid key")
        if r.status_code != 200:
            log.warning(f"HTTP {r.status_code} for: {full_q}")
            return []
        return r.json().get("data", [])
    except QuotaExceededError:
        raise
    except Exception as e:
        log.error(f"Request error '{full_q}': {e}")
        return []


def check_itar(text):
    if not text:
        return []
    lower = text.lower()
    return [kw for kw in ITAR_KEYWORDS if kw in lower]


def is_aggregator(url):
    if not url:
        return True
    lower = url.lower()
    return any(d in lower for d in REJECT_DOMAINS)


def passes_title_filter(title):
    """BUG FIX: enforce target role whitelist + exclusion blacklist."""
    if not title:
        return False
    lower = title.lower()
    if not any(kw in lower for kw in TARGET_TITLE_KW):
        return False
    if any(ex in lower for ex in EXCLUDE_TITLE_KW):
        return False
    return True


def build_job(raw, company_name, tier, h1b, itar_co, industry,
              domain, reason, source_tag):
    """Normalise a raw JSearch result. Returns job dict or None if filtered."""
    title = raw.get("job_title", "Unknown")

    # Title filter first (cheap)
    if not passes_title_filter(title):
        return None

    apply_link = raw.get("job_apply_link", "")
    if is_aggregator(apply_link):
        apply_link = raw.get("job_google_link", apply_link)
        if is_aggregator(apply_link):
            return None

    desc       = raw.get("job_description", "")
    itar_flags = check_itar(desc)

    desc_lower = (desc or "").lower()
    if any(ex in desc_lower for ex in DESC_EXCLUSIONS):
        return None

    # Posted date
    posted_str = ""
    posted_ts  = raw.get("job_posted_at_datetime_utc", "")
    if posted_ts:
        try:
            dt = datetime.fromisoformat(posted_ts.replace("Z", "+00:00"))
            days_ago = (datetime.now(dt.tzinfo) - dt).days
            posted_str = f"{days_ago}d ago" if days_ago > 0 else "today"
        except Exception:
            posted_str = posted_ts[:10]

    city  = raw.get("job_city", "")
    state = raw.get("job_state", "")
    loc   = f"{city}, {state}" if city and state else (city or state or "Remote/Unknown")

    emp_type = raw.get("job_employment_type", "FULLTIME")
    job_type = {"FULLTIME": "Full-time", "PARTTIME": "Part-time",
                "INTERN": "Internship", "CONTRACTOR": "Contract"}.get(emp_type, emp_type)

    itar_hit = len(itar_flags) > 0
    score    = 0 if itar_hit else (
        90 if tier == "Tier 1" and h1b == "YES" else
        85 if tier == "Tier 1"                  else
        82 if tier == "Tier 2" and h1b == "YES" else
        78 if tier == "Tier 2"                  else
        72 if tier == "Tier 3"                  else 60
    )
    verdict = "RED" if itar_hit else ("GREEN" if tier == "Tier 1" else "YELLOW")

    return {
        "id":             f"{company_name.replace(' ','-')}-{hash(title+loc) % 99999}",
        "role":           title,
        "company":        company_name,
        "location":       loc,
        "type":           job_type,
        "link":           apply_link,
        "posted":         posted_str,
        "itar_flag":      itar_hit,
        "itar_detail":    ", ".join(itar_flags) if itar_flags else "",
        "tier":           tier,
        "h1b":            h1b,
        "itar_company":   itar_co,
        "industry":       industry,
        "domain_verified": bool(domain and domain in (apply_link or "")),
        "source":         source_tag,
        "reason":         reason,
        "match":          score,
        "verdict":        verdict,
    }


# ─── MODE 1: TARGETED ─────────────────────────────────────────────────────────
def scrape_company(company, title_keywords):
    name   = company["company_name"]
    domain = company.get("company_domain", "")
    tier   = company.get("tier", "Tier 2")
    h1b    = company.get("h1b", "LIKELY")
    itar   = company.get("itar", "NO")
    indust = company.get("primary_industry_category", "")
    qnames = company.get("jsearch_company_query", [name])

    jobs     = []
    seen_ids = set()

    for kw in title_keywords[:KEYWORDS_PER_COMPANY]:
        time.sleep(REQUEST_DELAY)
        results = api_search(f"{kw} at {qnames[0]}", date_posted="3days")
        for raw in results:
            jid = raw.get("job_id", "")
            if jid in seen_ids:
                continue
            seen_ids.add(jid)
            job = build_job(raw, name, tier, h1b, itar, indust, domain,
                            f"Targeted: '{kw}' at {name}", "jsearch_targeted")
            if job:
                jobs.append(job)
    return jobs


# ─── MODE 2: OPEN SEARCH ──────────────────────────────────────────────────────
def run_open_search(known_companies, calls_so_far):
    if OPEN_SEARCH_CALLS_PER_RUN == 0:
        log.info("Open search disabled (OPEN_SEARCH_CALLS_PER_RUN=0)")
        return [], 0

    day     = datetime.now().timetuple().tm_yday
    total_q = len(OPEN_SEARCH_QUERIES)
    start   = (day * OPEN_SEARCH_CALLS_PER_RUN) % total_q
    queries = [OPEN_SEARCH_QUERIES[(start + i) % total_q]
               for i in range(OPEN_SEARCH_CALLS_PER_RUN)]

    log.info(f"Open search — {len(queries)} queries today:")
    for q, loc in queries:
        log.info(f"  '{q}' in {loc}")

    jobs       = []
    calls_used = 0
    seen_ids   = set()

    for query_text, location in queries:
        if calls_so_far + calls_used >= MAX_REQUESTS_PER_RUN:
            log.warning("MAX_REQUESTS_PER_RUN reached — stopping open search")
            break

        time.sleep(REQUEST_DELAY)
        results = api_search(query_text, location=location, date_posted="week")
        calls_used += 1

        for raw in results:
            jid = raw.get("job_id", "")
            if jid in seen_ids:
                continue
            seen_ids.add(jid)

            raw_company = raw.get("employer_name", "Unknown Company")

            # Skip M628 companies — targeted mode already covers them
            if raw_company.lower() in known_companies:
                continue

            job = build_job(
                raw,
                company_name = raw_company,
                tier         = "Tier 2",    # conservative — unknown company
                h1b          = "LIKELY",
                itar_co      = "Unknown",
                industry     = "",
                domain       = "",
                reason       = f"Open: '{query_text}' in {location}",
                source_tag   = "jsearch_open",
            )
            if job:
                # Cap score — needs manual vetting before applying
                job["verdict"] = "YELLOW"
                job["match"]   = min(job["match"], 70)
                jobs.append(job)
                log.info(f"    + {raw_company}: {job['role']} ({job['location']})")

    log.info(f"Open search: {len(jobs)} jobs in {calls_used} calls")
    return jobs, calls_used


# ─── BATCH ROTATION ───────────────────────────────────────────────────────────
def get_today_batch(companies):
    day       = datetime.now().timetuple().tm_yday
    total     = len(companies)
    n_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE
    idx       = day % n_batches
    start     = idx * BATCH_SIZE
    return companies[start: min(start + BATCH_SIZE, total)], idx, n_batches


def write_output(jobs, label, extra=None):
    today = datetime.now().strftime("%Y-%m-%d")
    out = {
        "generated_utc":   datetime.utcnow().isoformat() + "Z",
        "scraper":         label,
        "total_jobs_found": len(jobs),
        "eligible_jobs":   len([j for j in jobs if not j["itar_flag"]]),
        "itar_flagged":    len([j for j in jobs if j["itar_flag"]]),
        "jobs":            jobs,
    }
    if extra:
        out.update(extra)
    for path in [OUTPUT_DIR / f"jobs_{label}_{today}.json",
                 OUTPUT_DIR / f"jobs_{label}_latest.json"]:
        with open(path, "w") as f:
            json.dump(out, f, indent=2)
    log.info(f"  Saved {len(jobs)} jobs → jobs_{label}_{today}.json")


def write_empty(label, reason):
    out = {"generated_utc": datetime.utcnow().isoformat() + "Z",
           "scraper": label, "error": reason,
           "total_jobs_found": 0, "eligible_jobs": 0, "itar_flagged": 0, "jobs": []}
    today = datetime.now().strftime("%Y-%m-%d")
    for path in [OUTPUT_DIR / f"jobs_{label}_{today}.json",
                 OUTPUT_DIR / f"jobs_{label}_latest.json"]:
        with open(path, "w") as f:
            json.dump(out, f, indent=2)


# ─── MAIN ─────────────────────────────────────────────────────────────────────
def main():
    log.info("=" * 65)
    log.info("M628 JSearch Scraper  —  Targeted + Open Search")
    log.info("=" * 65)

    if not JSEARCH_API_KEY:
        log.error("JSEARCH_API_KEY not set.")
        write_empty("jsearch_targeted", "No API key")
        write_empty("jsearch_open",     "No API key")
        sys.exit(0)

    config        = load_config()
    all_companies = config["companies"]
    keywords      = config["defaults"]["title_keywords"]
    known_cos     = {c["company_name"].lower() for c in all_companies}

    # Tier 1 first
    all_companies.sort(key=lambda c: c.get("tier", "Tier 3"))

    # ── MODE 1 ────────────────────────────────────────────────────────────────
    batch, batch_idx, n_batches = get_today_batch(all_companies)
    log.info(f"Targeted: batch {batch_idx+1}/{n_batches} "
             f"({len(batch)} companies of {len(all_companies)})")

    targeted_jobs = []
    api_calls     = 0

    for i, co in enumerate(batch):
        if api_calls >= TARGETED_CALLS_PER_RUN:
            break
        log.info(f"  [{i+1}/{len(batch)}] {co['company_name']} "
                 f"({co.get('tier','?')}, H1B:{co.get('h1b','?')})")
        try:
            jobs = scrape_company(co, keywords)
        except QuotaExceededError:
            log.error("Quota exceeded — saving partial results")
            write_empty("jsearch_open", "Quota exceeded before open search")
            break
        api_calls += KEYWORDS_PER_COMPANY
        targeted_jobs.extend(jobs)
        log.info(f"    → {len(jobs)} relevant jobs")

    # Dedup
    seen, unique_t = set(), []
    for j in targeted_jobs:
        k = (j["company"], j["role"], j["location"])
        if k not in seen:
            seen.add(k)
            unique_t.append(j)
    unique_t.sort(key=lambda j: ({"GREEN":0,"YELLOW":1,"RED":2}.get(j["verdict"],9), -j["match"]))

    write_output(unique_t, "jsearch_targeted", {
        "batch": batch_idx + 1, "total_batches": n_batches,
        "companies_searched": len(batch), "api_calls_used": api_calls,
    })

    # ── MODE 2 ────────────────────────────────────────────────────────────────
    try:
        open_jobs, open_calls = run_open_search(known_cos, api_calls)
    except QuotaExceededError:
        log.error("Quota exceeded during open search")
        write_empty("jsearch_open", "Quota exceeded")
        open_jobs, open_calls = [], 0

    # Dedup
    seen2, unique_o = set(), []
    for j in open_jobs:
        k = (j["company"], j["role"], j["location"])
        if k not in seen2:
            seen2.add(k)
            unique_o.append(j)
    unique_o.sort(key=lambda j: ({"GREEN":0,"YELLOW":1,"RED":2}.get(j["verdict"],9), -j["match"]))

    write_output(unique_o, "jsearch_open", {
        "api_calls_used": open_calls,
        "note": "Open search — companies outside M628. Vet before applying.",
    })

    # ── SUMMARY ───────────────────────────────────────────────────────────────
    total_calls = api_calls + open_calls
    log.info("=" * 65)
    log.info(f"DONE | Targeted: {len(unique_t)} jobs | "
             f"Open: {len(unique_o)} jobs | "
             f"API calls: {total_calls}/{MAX_REQUESTS_PER_RUN}")
    log.info("=" * 65)


if __name__ == "__main__":
    main()
