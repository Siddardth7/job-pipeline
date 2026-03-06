#!/usr/bin/env python3
"""
M628 JSearch Scraper v2 — Optimized with:
  - Role-family query redesign (Bug 5 + 6)
  - Aggressive seniority filtering (Bug 2)
  - Persistent seen_job_keys cache (Phase 1 optimization)
  - Company cooldown tracking (Phase 1 optimization)
  - Industry-priority company ordering
  - Budget caps per run
  - 24–72h freshness enforcement

SETUP:
  1. Get free API key: https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
  2. pip install requests python-dotenv
  3. Create .env: JSEARCH_API_KEY=your_key_here
  4. Run: python jsearch_scraper.py

OUTPUT: output/jobs_jsearch_YYYY-MM-DD.json
"""

import os, sys, json, time, re, logging, hashlib
from datetime import datetime, timedelta, timezone
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
    pass

# ─── CONFIG ───────────────────────────────────────────────────────────────────
JSEARCH_API_KEY = os.environ.get("JSEARCH_API_KEY", "")
JSEARCH_HOST    = "jsearch.p.rapidapi.com"
JSEARCH_URL     = "https://jsearch.p.rapidapi.com/search"

SCRIPT_DIR  = Path(__file__).parent
CONFIG_PATH = SCRIPT_DIR / "M628_JSEARCH_CONFIG.json"
OUTPUT_DIR  = SCRIPT_DIR / "output"
CACHE_DIR   = SCRIPT_DIR / "cache"
OUTPUT_DIR.mkdir(exist_ok=True)
CACHE_DIR.mkdir(exist_ok=True)

# Cache files (Phase 1 optimization)
SEEN_KEYS_PATH   = CACHE_DIR / "seen_job_keys.json"
COOLDOWN_PATH    = CACHE_DIR / "company_cooldown.json"

# Rate / budget limits
REQUEST_DELAY       = 1.5   # seconds between API calls
MAX_REQUESTS_PER_RUN = 10   # hard cap per execution (≈5 companies × 2 queries)
BATCH_SIZE          = 5     # companies per run (was 3; safe for free tier)
KEYWORDS_PER_COMPANY = 2    # role-family queries per company
MAX_RESULTS_PER_QUERY = 10
MAX_NEW_JOBS_TO_STOP  = 20  # stop early if we already found enough new jobs

# Freshness window: 24–72 hours
MAX_AGE_HOURS = 72
MIN_AGE_HOURS = 0   # accept even brand-new postings

# ── SENIORITY REJECTION ────────────────────────────────────────────────────────
# These must NOT appear in the job title
SENIOR_TITLE_REJECTS = [
    "senior", "sr.", "sr ", "staff", "principal", "lead ", "tech lead",
    "manager", "director", "vp ", "vice president", "head of", "architect",
    "distinguished", "fellow", "chief", "supervisor", "superintendent",
    "specialist iii", "specialist iv", "engineer iii", "engineer iv",
    "engineer v", "level iii", "level iv", "level v", "iii", "iv",
]

# These in the description indicate 5+ years requirement
SENIOR_DESC_REJECTS = [
    "7+ years", "8+ years", "9+ years", "10+ years",
    "minimum 7 years", "minimum 8 years", "at least 7 years",
    "7 or more years", "8 or more years",
]

# ── EARLY-CAREER POSITIVE SIGNALS ─────────────────────────────────────────────
EARLY_CAREER_SIGNALS = [
    "entry level", "entry-level", "associate", "junior", "new grad",
    "recent graduate", "0-3 years", "0 to 3 years", "1-3 years",
    "early career", "engineer i", "engineer 1", "engineer ii", "engineer 2",
    "level i", "level 1", "level ii", "level 2",
]

# ── ROLE-FAMILY QUERY SETS (Bug 5 + 6 fix) ────────────────────────────────────
# Instead of one exact title per keyword, we use compact role-family strings
# that JSearch expands naturally. Two queries per company cover the family.
ROLE_FAMILY_QUERIES = [
    # Query 1: Manufacturing / Process / Production family (entry-level framing)
    "entry level manufacturing process engineer",
    # Query 2: Quality / Materials / Composites family (associate framing)
    "associate quality materials composites engineer",
    # Query 3 (bonus, used for Tier 1 companies if budget allows):
    "junior engineer manufacturing aerospace",
]

# ── INDUSTRY PRIORITY ORDER ────────────────────────────────────────────────────
INDUSTRY_PRIORITY = [
    "Aerospace", "Manufacturing", "Mechanical", "Research",
    "University", "Automotive", "Energy", "Medical Devices", "Chemical",
]

# ── ITAR KEYWORDS ──────────────────────────────────────────────────────────────
ITAR_KEYWORDS = [
    "security clearance", "us person", "itar", "export controlled",
    "classified", "us citizen or permanent resident",
    "must be authorized to work without sponsorship",
    "u.s. citizen", "u.s. national", "permanent resident only",
    "lawfully admitted for permanent residence",
]

# ── AGGREGATOR REJECT LIST ────────────────────────────────────────────────────
REJECT_DOMAINS = [
    "indeed.com", "glassdoor.com", "ziprecruiter.com",
    "simplyhired.com", "monster.com", "careerbuilder.com",
    "linkedin.com",
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


# ─── CACHE HELPERS (Phase 1 optimization) ────────────────────────────────────

def load_seen_keys() -> dict:
    """Load persistent job-key cache. Returns {stable_key: iso_timestamp}."""
    try:
        with open(SEEN_KEYS_PATH) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_seen_keys(keys: dict):
    with open(SEEN_KEYS_PATH, "w") as f:
        json.dump(keys, f)


def make_job_key(company: str, title: str, location: str, job_id: str = "") -> str:
    """Stable dedup key for a job posting."""
    raw = f"{company.lower().strip()}|{title.lower().strip()}|{location.lower().strip()}|{job_id}"
    return hashlib.md5(raw.encode()).hexdigest()[:16]


def load_cooldowns() -> dict:
    """Load company cooldown state. Returns {company_id: {expires_utc, misses}}."""
    try:
        with open(COOLDOWN_PATH) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_cooldowns(data: dict):
    with open(COOLDOWN_PATH, "w") as f:
        json.dump(data, f, indent=2)


def is_on_cooldown(company_id: str, cooldowns: dict) -> bool:
    entry = cooldowns.get(company_id)
    if not entry:
        return False
    expires = datetime.fromisoformat(entry["expires_utc"])
    return datetime.utcnow() < expires


def update_cooldown(company_id: str, cooldowns: dict, found_new: bool):
    """If no new jobs found, escalate cooldown. If found jobs, clear it."""
    if found_new:
        cooldowns.pop(company_id, None)
        return
    entry = cooldowns.get(company_id, {"misses": 0})
    misses = entry.get("misses", 0) + 1
    hours = 24 if misses == 1 else 48 if misses == 2 else 72
    expires = (datetime.utcnow() + timedelta(hours=hours)).isoformat()
    cooldowns[company_id] = {"misses": misses, "expires_utc": expires}
    log.info(f"  Cooldown set: {company_id} → {hours}h (miss #{misses})")


# ─── LOAD CONFIG ──────────────────────────────────────────────────────────────

def load_config():
    with open(CONFIG_PATH) as f:
        return json.load(f)


# ─── JSEARCH API CALL ─────────────────────────────────────────────────────────

def search_jobs(query: str, date_posted: str = "3days") -> list:
    """Call JSearch API. Returns list of raw job objects."""
    if not JSEARCH_API_KEY:
        log.error("No JSEARCH_API_KEY set.")
        return []

    headers = {
        "X-RapidAPI-Key":  JSEARCH_API_KEY,
        "X-RapidAPI-Host": JSEARCH_HOST,
    }
    params = {
        "query":      query,
        "page":       "1",
        "num_pages":  "1",
        "date_posted": date_posted,
        "country":    "us",
        "language":   "en",
        "employment_types": "FULLTIME",
    }

    try:
        r = requests.get(JSEARCH_URL, headers=headers, params=params, timeout=15)
        if r.status_code == 429:
            log.warning("Rate limited. Waiting 60s…")
            time.sleep(60)
            return search_jobs(query, date_posted)
        if r.status_code == 403:
            log.error("API key invalid or quota exceeded.")
            raise QuotaExceededError("JSearch quota exceeded")
        if r.status_code != 200:
            log.warning(f"API {r.status_code} for: {query}")
            return []
        return r.json().get("data", [])
    except QuotaExceededError:
        raise
    except Exception as e:
        log.error(f"Request failed for '{query}': {e}")
        return []


# ─── SENIORITY FILTER ─────────────────────────────────────────────────────────

def is_senior_title(title: str) -> bool:
    """Return True if title contains seniority markers → reject."""
    t = title.lower()
    return any(marker in t for marker in SENIOR_TITLE_REJECTS)


def is_senior_description(desc: str) -> bool:
    """Return True if description requires 7+ years experience."""
    if not desc:
        return False
    d = desc.lower()
    return any(marker in d for marker in SENIOR_DESC_REJECTS)


def seniority_score(title: str, desc: str) -> int:
    """
    Returns 0 if clearly entry-level, 1 if ambiguous, 2 if senior.
    Used for soft scoring within the filter.
    """
    t = (title + " " + (desc or "")).lower()
    if any(s in t for s in EARLY_CAREER_SIGNALS):
        return 0
    if is_senior_title(title) or is_senior_description(desc or ""):
        return 2
    return 1   # ambiguous — keep but penalize score


# ─── ITAR / AGGREGATOR HELPERS ────────────────────────────────────────────────

def check_itar(text: str) -> list:
    if not text:
        return []
    lower = text.lower()
    return [kw for kw in ITAR_KEYWORDS if kw in lower]


def is_aggregator(url: str) -> bool:
    if not url:
        return True
    lower = url.lower()
    return any(d in lower for d in REJECT_DOMAINS)


def url_matches_domain(url: str, domain: str) -> bool:
    if not url or not domain:
        return False
    return domain.lower() in url.lower()


# ─── FRESHNESS CHECK ─────────────────────────────────────────────────────────

def parse_age_hours(posted_ts: str) -> float | None:
    """Return age of posting in hours, or None if unparseable."""
    if not posted_ts:
        return None
    try:
        dt = datetime.fromisoformat(posted_ts.replace("Z", "+00:00"))
        now = datetime.now(dt.tzinfo)
        return (now - dt).total_seconds() / 3600
    except Exception:
        return None


def is_fresh(posted_ts: str) -> bool:
    """True if job is within MAX_AGE_HOURS."""
    age = parse_age_hours(posted_ts)
    if age is None:
        return True  # unknown age: don't reject, let post-filter decide
    return age <= MAX_AGE_HOURS


# ─── INDUSTRY SORT KEY ────────────────────────────────────────────────────────

def industry_sort_key(company: dict) -> int:
    industry = (company.get("primary_industry_category") or
                company.get("industry", "")).title()
    for i, prio in enumerate(INDUSTRY_PRIORITY):
        if prio.lower() in industry.lower():
            return i
    return len(INDUSTRY_PRIORITY)


# ─── PROCESS ONE COMPANY ─────────────────────────────────────────────────────

def scrape_company(company: dict, seen_keys: dict) -> tuple[list, int]:
    """
    Query JSearch for a single company using role-family queries.
    Returns (list_of_new_jobs, api_calls_used).
    Only returns jobs NOT already in seen_keys.
    """
    company_name = company["company_name"]
    domain       = company.get("company_domain", "")
    tier         = company.get("tier", "Tier 2")
    h1b          = company.get("h1b", "LIKELY")
    itar         = company.get("itar", "NO")
    primary_name = company.get("jsearch_company_query", [company_name])[0]

    new_jobs  = []
    seen_ids  = set()
    api_calls = 0

    # Build company-scoped queries from role-family strings
    queries_to_run = ROLE_FAMILY_QUERIES[:KEYWORDS_PER_COMPANY]

    for role_query in queries_to_run:
        # Append company name so JSearch targets it specifically
        full_query = f"{role_query} {primary_name}"
        time.sleep(REQUEST_DELAY)
        api_calls += 1

        raw_results = search_jobs(full_query, date_posted="3days")
        log.debug(f"  Query '{full_query}': {len(raw_results)} raw results")

        for job in raw_results:
            job_id    = job.get("job_id", "")
            job_title = (job.get("job_title") or "").strip()
            desc      = (job.get("job_description") or "")

            # Skip within-run duplicates
            if job_id and job_id in seen_ids:
                continue
            if job_id:
                seen_ids.add(job_id)

            # ── Freshness gate ──────────────────────────────────────────────
            posted_ts = job.get("job_posted_at_datetime_utc", "")
            if not is_fresh(posted_ts):
                log.debug(f"    SKIP stale: {job_title}")
                continue

            # ── Seniority gate ──────────────────────────────────────────────
            if is_senior_title(job_title):
                log.debug(f"    SKIP senior title: {job_title}")
                continue
            if is_senior_description(desc):
                log.debug(f"    SKIP senior desc: {job_title}")
                continue

            # ── URL quality ─────────────────────────────────────────────────
            apply_link = job.get("job_apply_link", "")
            if is_aggregator(apply_link):
                apply_link = job.get("job_google_link", apply_link)
                if is_aggregator(apply_link):
                    log.debug(f"    SKIP aggregator: {job_title}")
                    continue

            # ── Exclusion keywords (staffing, C2C, etc.) ───────────────────
            desc_lower  = desc.lower()
            title_lower = job_title.lower()
            EXCLUSIONS  = [
                "staffing", "contract ", "temp ", "agency", " c2c",
                "corp-to-corp", "third party", "1099", "no sponsorship",
                "must be a us citizen", "security clearance required", "ts/sci",
            ]
            if any(ex in desc_lower or ex in title_lower for ex in EXCLUSIONS):
                log.debug(f"    SKIP exclusion: {job_title}")
                continue

            # ── Seen-key dedup (cross-run) ─────────────────────────────────
            city     = job.get("job_city", "")
            state    = job.get("job_state", "")
            location = f"{city}, {state}".strip(", ") or "Remote/Unknown"

            stable_key = make_job_key(company_name, job_title, location, job_id)
            if stable_key in seen_keys:
                log.debug(f"    SKIP already seen: {job_title}")
                continue

            # ─── Build normalized job record ────────────────────────────────
            itar_flags   = check_itar(desc)
            emp_type     = job.get("job_employment_type", "FULLTIME")
            type_map     = {"FULLTIME": "Full-time", "PARTTIME": "Part-time",
                            "INTERN": "Internship", "CONTRACTOR": "Contract"}
            job_type     = type_map.get(emp_type, emp_type)
            domain_match = url_matches_domain(apply_link, domain)
            sen_score    = seniority_score(job_title, desc)

            age_h = parse_age_hours(posted_ts)
            if age_h is not None:
                posted_str = "today" if age_h < 24 else f"{int(age_h // 24)}d ago"
            else:
                posted_str = posted_ts[:10] if posted_ts else ""

            base_match = (
                90 if tier == "Tier 1" and h1b == "YES" else
                85 if tier == "Tier 1" else
                82 if tier == "Tier 2" and h1b == "YES" else
                78 if tier == "Tier 2" else
                72 if tier == "Tier 3" else 65
            )
            # Boost early-career signals, penalize ambiguous seniority
            match_score = (
                0         if len(itar_flags) > 0 else
                min(base_match + 5, 95) if sen_score == 0 else
                base_match              if sen_score == 1 else
                max(base_match - 15, 40)
            )

            new_jobs.append({
                "_stable_key": stable_key,
                "role":         job_title,
                "company":      company_name,
                "location":     location,
                "type":         job_type,
                "link":         apply_link,
                "posted":       posted_str,
                "posted_ts":    posted_ts,
                "itar_flag":    len(itar_flags) > 0,
                "itar_detail":  ", ".join(itar_flags) if itar_flags else "",
                "tier":         tier,
                "h1b":          h1b,
                "itar_company": itar,
                "industry":     company.get("primary_industry_category", ""),
                "domain_verified": domain_match,
                "source":       "jsearch",
                "reason":       f"Role-family query: '{role_query}' @ {company_name}",
                "match":        match_score,
                "verdict":      (
                    "RED"    if len(itar_flags) > 0 else
                    "GREEN"  if tier == "Tier 1" else
                    "YELLOW"
                ),
            })

    return new_jobs, api_calls


# ─── BATCH ROTATION ───────────────────────────────────────────────────────────

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
        "scraper":          "jsearch",
        "error":            reason,
        "companies_searched": 0,
        "api_calls_used":   0,
        "total_jobs_found": 0,
        "eligible_jobs":    0,
        "itar_flagged":     0,
        "jobs":             [],
    }
    for path in [OUTPUT_DIR / f"jobs_jsearch_{today}.json",
                 OUTPUT_DIR / "jobs_jsearch_latest.json"]:
        with open(path, "w") as f:
            json.dump(output, f, indent=2)
    log.warning(f"Wrote empty output. Reason: {reason}")


# ─── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    log.info("=" * 60)
    log.info("M628 JSearch Scraper v2 — Starting")
    log.info("=" * 60)

    if not JSEARCH_API_KEY:
        log.error("JSEARCH_API_KEY not set.")
        _write_empty_output("No JSEARCH_API_KEY set")
        sys.exit(0)

    config        = load_config()
    all_companies = config["companies"]

    # ── Enrich from ENRICHED_MASTER if available ──────────────────────────────
    master_path = SCRIPT_DIR / "M628_ENRICHED_MASTER.json"
    if master_path.exists():
        with open(master_path) as f:
            master = {c["company_id"]: c for c in json.load(f)}
        for c in all_companies:
            m = master.get(c["company_id"], {})
            if m:
                c.setdefault("primary_industry_category",
                             m.get("primary_industry_category", ""))
                c.setdefault("tier", m.get("tier", "Tier 2"))
                c.setdefault("h1b",  m.get("h1b",  "LIKELY"))
                c.setdefault("itar", m.get("itar",  "NO"))

    # ── Sort by: industry priority → tier → h1b ───────────────────────────────
    all_companies.sort(key=lambda c: (
        industry_sort_key(c),
        int(c.get("tier", "Tier 3").replace("Tier ", "") or 3),
        0 if c.get("h1b") == "YES" else 1,
    ))

    # ── Load persistent caches ────────────────────────────────────────────────
    seen_keys = load_seen_keys()
    cooldowns = load_cooldowns()
    log.info(f"Cache: {len(seen_keys)} seen keys, {len(cooldowns)} companies on cooldown")

    # ── Get today's batch ─────────────────────────────────────────────────────
    batch, batch_idx, num_batches = get_today_batch(all_companies, BATCH_SIZE)
    log.info(f"Batch {batch_idx + 1}/{num_batches}: {len(batch)} companies")
    log.info(f"Role-family queries: {ROLE_FAMILY_QUERIES[:KEYWORDS_PER_COMPANY]}")

    all_new_jobs   = []
    total_api_calls = 0
    companies_run   = 0

    for i, company in enumerate(batch):
        cid = company.get("company_id", company["company_name"])

        # ── Cooldown check ────────────────────────────────────────────────────
        if is_on_cooldown(cid, cooldowns):
            log.info(f"[{i+1}/{len(batch)}] COOLDOWN SKIP: {company['company_name']}")
            continue

        # ── Budget cap ────────────────────────────────────────────────────────
        if total_api_calls >= MAX_REQUESTS_PER_RUN:
            log.warning(f"Hit request limit ({MAX_REQUESTS_PER_RUN}). Stopping.")
            break

        # ── Early-exit if enough new jobs found ───────────────────────────────
        if len(all_new_jobs) >= MAX_NEW_JOBS_TO_STOP:
            log.info(f"Found {len(all_new_jobs)} new jobs. Stopping early.")
            break

        log.info(f"[{i+1}/{len(batch)}] {company['company_name']} "
                 f"({company.get('tier','?')} | H1B:{company.get('h1b','?')} "
                 f"| {company.get('primary_industry_category','?')})")

        try:
            new_jobs, calls = scrape_company(company, seen_keys)
        except QuotaExceededError:
            log.error("Quota exceeded. Saving partial results.")
            break

        total_api_calls += calls
        companies_run   += 1
        found_new = len(new_jobs) > 0

        # ── Update caches ─────────────────────────────────────────────────────
        update_cooldown(cid, cooldowns, found_new)
        for job in new_jobs:
            seen_keys[job["_stable_key"]] = datetime.utcnow().isoformat() + "Z"

        all_new_jobs.extend(new_jobs)

        if found_new:
            log.info(f"  ✓ {len(new_jobs)} new jobs "
                     f"({sum(1 for j in new_jobs if j['itar_flag'])} ITAR-flagged)")
        else:
            log.info(f"  — No new jobs found")

    # ── Save persistent caches ────────────────────────────────────────────────
    save_seen_keys(seen_keys)
    save_cooldowns(cooldowns)

    # ── Strip internal cache key from final output ────────────────────────────
    for job in all_new_jobs:
        job.pop("_stable_key", None)

    # ── Deduplicate by (company, role, location) ──────────────────────────────
    seen_out = set()
    unique_jobs = []
    for job in all_new_jobs:
        key = (job["company"], job["role"], job["location"])
        if key not in seen_out:
            seen_out.add(key)
            unique_jobs.append(job)

    # ── Sort: GREEN → YELLOW → RED, then by match score ──────────────────────
    verdict_order = {"GREEN": 0, "YELLOW": 1, "RED": 2}
    unique_jobs.sort(key=lambda j: (verdict_order.get(j["verdict"], 9), -j["match"]))

    # ── Write output ──────────────────────────────────────────────────────────
    today       = datetime.now().strftime("%Y-%m-%d")
    output_file = OUTPUT_DIR / f"jobs_jsearch_{today}.json"

    output = {
        "generated_utc":      datetime.utcnow().isoformat() + "Z",
        "scraper":            "jsearch",
        "batch":              batch_idx + 1,
        "total_batches":      num_batches,
        "companies_searched": companies_run,
        "api_calls_used":     total_api_calls,
        "total_jobs_found":   len(unique_jobs),
        "eligible_jobs":      len([j for j in unique_jobs if not j["itar_flag"]]),
        "itar_flagged":       len([j for j in unique_jobs if j["itar_flag"]]),
        "jobs":               unique_jobs,
    }

    with open(output_file, "w") as f:
        json.dump(output, f, indent=2)
    with open(OUTPUT_DIR / "jobs_jsearch_latest.json", "w") as f:
        json.dump(output, f, indent=2)

    log.info("=" * 60)
    log.info(f"DONE. {len(unique_jobs)} new jobs → {output_file}")
    log.info(f"  GREEN:  {sum(1 for j in unique_jobs if j['verdict']=='GREEN')}")
    log.info(f"  YELLOW: {sum(1 for j in unique_jobs if j['verdict']=='YELLOW')}")
    log.info(f"  RED:    {sum(1 for j in unique_jobs if j['verdict']=='RED')}")
    log.info(f"  API calls this run: {total_api_calls}")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
