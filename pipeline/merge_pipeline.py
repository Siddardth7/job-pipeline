#!/usr/bin/env python3
"""
pipeline/merge_pipeline.py — JobAgent v4 Merge & Hard Filter Pipeline

Reads all temp/jobs_*.json files, normalises fields, then runs every
job through the nine mandatory hard filters in strict order.

Hard Filter Stack (all nine must pass before Company Intelligence):
  F1  Schema Completeness     — job_title, company_name, job_url required
  F2  URL Validity            — must be http/https with valid domain
  F3  Aggregator Rejection    — rejects known aggregator domains
  F4  Job Age                 — must be posted within 72 hours
  F5  Deduplication           — URL-key + composite key (cross-scraper)
  F6  Seniority Title         — rejects senior/staff/principal/manager etc.
  F7  Role Relevance          — title must match a target role cluster
  F8  ITAR / Export Control   — HARD DROP — any ITAR flag → reject immediately
  F9  Blacklisted Companies   — named defence/weapons contractors → reject

A job that fails ANY filter is permanently dropped and never reaches
Company Intelligence.

Outputs:
    temp/jobs_clean_intermediate.json
"""

import json
import logging
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from urllib.parse import urlparse

ROOT = Path(__file__).parent.parent  # pipeline/ subdir → parent.parent = repo root
TEMP_DIR    = ROOT / "temp"
OUTPUT_PATH = TEMP_DIR / "jobs_clean_intermediate.json"

# Explicit whitelist of temp files produced by live scrapers.
# NEVER load jobs_clean_intermediate.json or old disabled-source files here.
WHITELISTED_SOURCE_FILES = [
    "jobs_ats.json",
    "jobs_jsearch.json",
    "jobs_apify.json",
    "jobs_serpapi.json",
    "jobs_adzuna.json",
]


def _load_whitelisted_sources(temp_dir: Path = None) -> Tuple[List[Dict], Dict[str, int]]:
    """Load only from whitelisted scraper output files — never intermediate or stale."""
    if temp_dir is None:
        temp_dir = TEMP_DIR
    jobs: List[Dict] = []
    scraper_counts: Dict[str, int] = {}
    for filename in WHITELISTED_SOURCE_FILES:
        path = temp_dir / filename
        if not path.exists():
            source_name = filename.replace("jobs_", "").replace(".json", "")
            scraper_counts[source_name] = 0
            log.info(f"  {filename}: not present (scraper may have been skipped)")
            continue
        try:
            data = json.loads(path.read_text())
            batch = data.get("jobs", [])
            source_name = data.get("source", path.stem.replace("jobs_", ""))
            scraper_counts[source_name] = len(batch)
            log.info(f"  Loaded {filename}: {len(batch)} jobs")
            jobs.extend(batch)
        except Exception as e:
            log.error(f"Failed to load {filename}: {e}")
            source_name = filename.replace("jobs_", "").replace(".json", "")
            scraper_counts[source_name] = 0
    return jobs, scraper_counts


sys.path.insert(0, str(ROOT))

log = logging.getLogger("merge_pipeline")

# ── Constants ─────────────────────────────────────────────────────────────────

MAX_AGE_HOURS = 72

# ── ITAR keywords loaded from shared data file ────────────────────────────────
# data/itar_keywords.json is the single source of truth for all scrapers and
# the pipeline. Bare "classified" was removed to prevent false positives
# (FLSA classification, pay grades, pharma regulatory uses).
try:
    ITAR_REJECT_KEYWORDS: List[str] = json.loads(
        (ROOT / "data" / "itar_keywords.json").read_text()
    )
except Exception:
    # Fallback in case the file is missing — keeps pipeline running
    log.error("Could not load data/itar_keywords.json — using fallback ITAR keyword list")
    ITAR_REJECT_KEYWORDS = [
        "itar", "us person", "u.s. person", "export controlled", "security clearance",
        "classified information", "u.s. citizen", "u.s. national",
    ]

# F3 — Aggregator domains (applied post-merge to catch all scrapers)
AGGREGATOR_DOMAINS = [
    # Job board aggregators
    "indeed.com",
    "glassdoor.com",
    "ziprecruiter.com",
    "simplyhired.com",
    "monster.com",
    "careerbuilder.com",
    "linkedin.com",
    # Adzuna redirect/land URLs (Adzuna source files have direct apply URLs stripped)
    "adzuna.com/land/",
    "adzuna.co.uk/land/",
    # Redirect/tracking aggregators
    "appcast.io",
    "click.appcast.io",
    "apply.workable.com/j/",   # Workable apply redirects (not direct postings)
    "dice.com",
    "careersite.com",
    "talentify.io",
    "lensa.com",
    "nexxt.com",
    "jooble.org",
    "recruiter.com",
    "talent.com",
    "getwork.com",
]

# F6 — Seniority reject tokens
# Tokens without regex syntax are word-boundary matched automatically.
SENIORITY_REJECT_TOKENS = [
    "senior", r"sr\.", r"sr\b", "staff", "principal",
    r"\blead\b", "manager", "director",
    r"\bvp\b", "vice president", "chief", "head of",
]

# F7 — Role relevance: title must contain at least one token
ROLE_RELEVANCE_TOKENS = [
    # Manufacturing
    "manufacturing engineer", "production engineer",
    "manufacturing process", "manufacturing systems",
    "manufacturing operations",
    # Process
    "process engineer", "process development",
    # Materials
    "materials engineer", r"m&p engineer",
    # Composites
    "composites", "composite",
    # Quality
    "quality engineer", "supplier quality", "supplier assurance",
    "mrb engineer", "nonconformance",
    # Industrial
    "industrial engineer", "operations engineer",
    "lean manufacturing", "continuous improvement", "value stream",
    # Tooling / Inspection
    "tooling engineer", "metrology engineer", "inspection engineer",
    # Startup / NPI
    "build engineer", "npi engineer", "scale-up engineer",
    "prototype engineer",
    # Numbered engineer levels (entry-level signal in title)
    r"engineer i\b", r"engineer ii\b", r"engineer 1\b", r"engineer 2\b",
    # Explicit entry-level modifier in title
    "associate engineer", "entry level engineer", "entry-level engineer",
    "junior engineer", "early career engineer",
]

# F8 — ITAR / export control keywords (hard drop — no exceptions)
# Loaded from data/itar_keywords.json (see block above).
# Note: bare "classified" was intentionally removed from the keyword list
# to avoid false positives on job descriptions using "classified" in
# non-ITAR contexts (FLSA pay classification, pharmaceutical compliance, etc.).
# Specific phrases like "classified information", "classified program", and
# "classified access" are used instead.

# F9 — Blacklisted company names (substring match, case-insensitive)
BLACKLISTED_COMPANIES = [
    # Tier-1 prime defense contractors
    "lockheed martin",
    "northrop grumman",
    "general dynamics",
    "raytheon",
    "rtx",
    "l3harris",
    "bae systems",
    "anduril",
    "saronic",
    # Defense-primary companies commonly returned by Adzuna
    "leidos",
    "saic",
    "booz allen",
    "curtiss-wright",
    "mercury systems",
    "moog inc",
    "triumph group",
    "ducommun",
    "kaman aerospace",
    "drs technologies",
    "standardaero",
    "draper laboratory",
    "mitre corporation",
    "aerospace corporation",
]

# Scoring helpers (post-filter only — never used to bypass filters)
BOOST_TITLE_TOKENS = [
    "entry level", "entry-level", "associate", "engineer i", "engineer ii",
    "engineer 1", "engineer 2", "early career", "new grad", "junior",
    "level i", "level ii",
]

# Source priority — lower number = higher quality. ATS direct > company apply > clean API > aggregator
SOURCE_PRIORITY: Dict[str, int] = {
    "ats_greenhouse":  1,
    "ats_lever":       1,
    "jsearch":         3,
    "apify":           4,
    "serpapi":         4,
    "adzuna":          5,
    "unknown":         9,
}
RELEVANCE_KEYWORDS = [
    "manufacturing", "process", "production", "quality", "composites",
    "materials", "industrial", "lean", "tooling", "inspection",
    "metrology", "aerospace", "automotive", "assembly", "fabrication",
    "cnc", "gd&t", "cad", "solidworks", "catia", "npi", "scale-up",
    "six sigma", "kaizen", "dmaic", "fmea", "apqp", "ppap",
]


# ── Entry point ───────────────────────────────────────────────────────────────

def run():
    log.info("=" * 60)
    log.info("Merge Pipeline + Hard Filter Stack — Starting")
    log.info("=" * 60)

    # Step 1 — Load all scraper outputs
    raw_jobs, scraper_counts = _load_whitelisted_sources()
    _print_scraper_health(scraper_counts, raw_jobs)
    total_raw = len(raw_jobs)

    # Step 2 — F1: Normalise + schema completeness check
    normalized = [_normalize(j) for j in raw_jobs]
    normalized = [j for j in normalized if j is not None]
    schema_rejected = total_raw - len(normalized)

    # Steps 3-9 — Hard Filter Stack F2 through F9
    # Filters run in strict sequence. Each returns (passed, rejected_count).
    after_f3, f3_rejected = _filter_aggregators(normalized)     # F2 + F3
    after_f4, f4_rejected = _filter_age(after_f3)              # F4
    after_f5, f5_rejected = _filter_duplicates_priority(after_f4)  # F5 — priority dedupe
    after_f6, f6_rejected = _filter_seniority(after_f5)        # F6
    after_f7, f7_rejected = _filter_role_relevance(after_f6)   # F7
    after_f8, f8_rejected = _filter_itar(after_f7)             # F8 — HARD DROP
    after_f9, f9_rejected = _filter_blacklist(after_f8)        # F9

    # Step 10 — Score surviving jobs
    scored = [_score(j) for j in after_f9]
    scored.sort(key=lambda j: -j["relevance_score"])

    # Step 11 — Print filter report
    _print_filter_report(
        total_raw=total_raw,
        schema_rejected=schema_rejected,
        f3_rejected=f3_rejected,
        f4_rejected=f4_rejected,
        f5_rejected=len(f5_rejected),
        f6_rejected=f6_rejected,
        f7_rejected=f7_rejected,
        f8_rejected=f8_rejected,
        f9_rejected=f9_rejected,
        final_passed=len(scored),
    )

    # Step 12 — Write intermediate output
    OUTPUT_PATH.write_text(json.dumps({
        "generated_utc": datetime.utcnow().isoformat() + "Z",
        "stats": {
            "total_raw":       total_raw,
            "schema_rejected": schema_rejected,
            "f3_aggregator":   f3_rejected,
            "f4_age":          f4_rejected,
            "f5_duplicates":   len(f5_rejected),
            "f6_seniority":    f6_rejected,
            "f7_role":         f7_rejected,
            "f8_itar":         f8_rejected,
            "f9_blacklist":    f9_rejected,
            "final_count":     len(scored),
        },
        "jobs": scored,
    }, indent=2))

    log.info(f"Output: {len(scored)} hard-filter-approved jobs → {OUTPUT_PATH}")
    log.info("=" * 60)
    return scored


# ── Source loader ─────────────────────────────────────────────────────────────

def _load_all_sources() -> Tuple[List[Dict], Dict[str, int]]:
    jobs: List[Dict] = []
    scraper_counts: Dict[str, int] = {}
    source_files = sorted(TEMP_DIR.glob("jobs_*.json"))

    if not source_files:
        log.warning("No temp source files found in temp/")
        return jobs, scraper_counts

    for path in source_files:
        try:
            data = json.loads(path.read_text())
            batch = data.get("jobs", [])
            source_name = data.get("source", path.stem.replace("jobs_", ""))
            scraper_counts[source_name] = len(batch)
            log.info(f"  Loaded {path.name}: {len(batch)} jobs")
            jobs.extend(batch)
        except Exception as e:
            log.error(f"Failed to load {path.name}: {e}")
            source_name = path.stem.replace("jobs_", "")
            scraper_counts[source_name] = 0

    return jobs, scraper_counts


# ── Scraper health report ─────────────────────────────────────────────────────

def _print_scraper_health(counts: Dict[str, int], all_jobs: List[Dict]):
    log.info("")
    log.info("SCRAPER HEALTH")
    log.info("-" * 40)
    for name, count in counts.items():
        if count == 0:
            log.warning(f"  {name:<12}: {count:>4} jobs  ⚠ WARNING: returned no jobs")
        else:
            log.info(f"  {name:<12}: {count:>4} jobs")
    log.info(f"  {'TOTAL':<12}: {len(all_jobs):>4} jobs")
    log.info("-" * 40)
    silent = [n for n, c in counts.items() if c == 0]
    if len(silent) >= 2:
        log.warning(
            f"  ⚠ WARNING: {len(silent)} scrapers returned no results "
            f"({', '.join(silent)}). Check API keys and quotas."
        )
    log.info("")


# ── F1 — Normalise (schema completeness) ─────────────────────────────────────

def _normalize(job: Dict) -> Optional[Dict]:
    title   = str(job.get("job_title",    "") or "").strip()
    company = str(job.get("company_name", "") or "").strip()
    url     = str(job.get("job_url",      "") or "").strip()

    if not title or not company or not url:
        return None  # F1 fail — drop

    source = str(job.get("source", "unknown"))
    raw_id = str(job.get("raw_id", "") or "")

    # Stable job ID: prefer source:raw_id, fall back to URL-based key
    if raw_id:
        stable_id = f"{source}:{raw_id}"
    else:
        stable_id = url.lower().split("?")[0].rstrip("/")[:120]

    # Track whether location was provided — blank location poisons dedupe
    location_raw = str(job.get("location", "") or "").strip()
    location_confidence = "known" if location_raw else "unknown"

    return {
        "job_title":            title,
        "company_name":         company,
        "job_url":              url,
        "location":             location_raw,
        "location_confidence":  location_confidence,
        "posted_date":          str(job.get("posted_date", "") or "").strip(),
        "date_confidence": str(job.get("date_confidence", "actual") or "actual"),
        "description":     str(job.get("description", "") or "").strip(),
        "source":          source,
        "cluster":         str(job.get("cluster",     "")),
        "itar_flag":       bool(job.get("itar_flag",  False)),
        "itar_detail":     str(job.get("itar_detail", "") or ""),
        "relevance_score": 0,
        "boost_tags":      [],
        # Metadata carried through end-to-end
        "raw_id":          raw_id,
        "ats_tier":        str(job.get("ats_tier", "") or ""),
        "h1b":             str(job.get("h1b", "") or ""),
        "salary":          str(job.get("salary", "") or ""),
        "stable_id":       stable_id,
    }


# ── F2 helper ─────────────────────────────────────────────────────────────────

def _valid_url(url: str) -> bool:
    try:
        r = urlparse(url)
        return bool(r.scheme in ("http", "https") and r.netloc)
    except Exception:
        return False


# ── F2 + F3 — URL validity + aggregator rejection ────────────────────────────

def _filter_aggregators(jobs: List[Dict]) -> Tuple[List[Dict], int]:
    passed, rejected = [], 0
    for j in jobs:
        url_lower = j["job_url"].lower()
        if not _valid_url(j["job_url"]):
            rejected += 1
            log.debug(f"  [F2 DROP] Invalid URL — {j['job_title']!r} @ {j['company_name']}")
            continue
        if any(d in url_lower for d in AGGREGATOR_DOMAINS):
            rejected += 1
            log.debug(f"  [F3 DROP] Aggregator — {j['job_url']} — {j['job_title']!r} @ {j['company_name']}")
            continue
        passed.append(j)
    return passed, rejected


# ── F4 — Job age ──────────────────────────────────────────────────────────────

def _filter_age(jobs: List[Dict]) -> Tuple[List[Dict], int]:
    passed, rejected = [], 0
    cutoff = datetime.utcnow() - timedelta(hours=MAX_AGE_HOURS)
    for j in jobs:
        if _is_fresh(j, cutoff):
            passed.append(j)
        else:
            rejected += 1
            log.debug(
                f"  [F4 DROP] Age/unknown-date — {j.get('posted_date')!r} "
                f"(confidence={j.get('date_confidence','actual')}) "
                f"— {j['job_title']!r} @ {j['company_name']}"
            )
    return passed, rejected


def _is_fresh(job: Dict, cutoff: datetime) -> bool:
    """
    Returns True if the job is within the freshness window.
    - ATS sources (ats_greenhouse, ats_lever): unknown dates are accepted as fresh
      because these are live open postings polled directly from employer ATS.
    - All other sources: unknown dates are DROPPED — faking freshness overstates the feed.
    """
    posted_date     = job.get("posted_date", "")
    date_confidence = job.get("date_confidence", "actual")
    source          = job.get("source", "")

    if not posted_date or date_confidence == "unknown":
        # ATS direct sources: open postings are definitionally current
        if source in ("ats_greenhouse", "ats_lever"):
            return True
        # All other sources: unknown date = drop
        return False

    try:
        dt = datetime.strptime(posted_date[:10], "%Y-%m-%d")
        return dt >= cutoff
    except Exception:
        return source in ("ats_greenhouse", "ats_lever")


# ── F5 — Deduplication ────────────────────────────────────────────────────────

def _filter_duplicates(jobs: List[Dict]) -> Tuple[List[Dict], int]:
    seen_urls:      set = set()
    seen_composite: set = set()
    passed, rejected = [], 0
    for j in jobs:
        url_key  = j["job_url"].lower().split("?")[0].rstrip("/")
        comp_key = (
            j["company_name"].lower(),
            j["job_title"].lower()[:40],
            j["location"].lower()[:20],
        )
        if url_key in seen_urls or comp_key in seen_composite:
            rejected += 1
            continue
        seen_urls.add(url_key)
        seen_composite.add(comp_key)
        passed.append(j)
    return passed, rejected


def _filter_duplicates_priority(jobs: List[Dict]) -> Tuple[List[Dict], List[Dict]]:
    """
    Deduplicate keeping the highest-priority source record.
    Composite key: (company_lower, title_lower[:40], location_lower[:20])
    URL key also checked to catch same-URL duplicates.
    Returns (passed_jobs, rejected_jobs).
    """
    # Index: composite_key → best job so far
    best_by_comp: Dict[tuple, Dict] = {}
    best_by_url:  Dict[str,  Dict] = {}
    rejected: List[Dict] = []

    for j in jobs:
        url_key  = j["job_url"].lower().split("?")[0].rstrip("/")
        comp_key = (
            j["company_name"].lower(),
            j["job_title"].lower()[:40],
            j["location"].lower()[:20],
        )
        priority = SOURCE_PRIORITY.get(j.get("source", "unknown"), 9)

        existing_url  = best_by_url.get(url_key)
        existing_comp = best_by_comp.get(comp_key)

        # URL-based dedup
        if existing_url:
            existing_priority = SOURCE_PRIORITY.get(existing_url.get("source", "unknown"), 9)
            if priority < existing_priority:
                rejected.append(existing_url)
                best_by_url[url_key] = j
            else:
                rejected.append(j)
            continue  # already seen this URL

        # Composite-key dedup
        if existing_comp:
            existing_priority = SOURCE_PRIORITY.get(existing_comp.get("source", "unknown"), 9)
            if priority < existing_priority:
                # Evict the old record: remove its URL entry so it doesn't leak into passed
                old_url_key = existing_comp["job_url"].lower().split("?")[0].rstrip("/")
                best_by_url.pop(old_url_key, None)
                rejected.append(existing_comp)
                best_by_comp[comp_key] = j
                best_by_url[url_key]   = j
            else:
                rejected.append(j)
        else:
            best_by_comp[comp_key] = j
            best_by_url[url_key]   = j

    passed = list(best_by_url.values())
    return passed, rejected


# ── F6 — Seniority title filter ───────────────────────────────────────────────

def _filter_seniority(jobs: List[Dict]) -> Tuple[List[Dict], int]:
    passed, rejected = [], 0
    for j in jobs:
        if _is_senior_title(j["job_title"]):
            rejected += 1
            log.debug(f"  [F6 DROP] Seniority — {j['job_title']!r} @ {j['company_name']}")
        else:
            passed.append(j)
    return passed, rejected


def _is_senior_title(title: str) -> bool:
    lower = title.lower()
    for token in SENIORITY_REJECT_TOKENS:
        # Tokens that are raw regex patterns (contain \) — use as-is
        if "\\" in token:
            if re.search(token, lower):
                return True
        else:
            # Plain token — wrap in word boundaries
            if re.search(r"\b" + re.escape(token) + r"\b", lower):
                return True
    return False


# ── F7 — Role relevance filter ────────────────────────────────────────────────

def _filter_role_relevance(jobs: List[Dict]) -> Tuple[List[Dict], int]:
    passed, rejected = [], 0
    for j in jobs:
        if _is_relevant_role(j["job_title"]):
            passed.append(j)
        else:
            rejected += 1
            log.debug(f"  [F7 DROP] Role mismatch — {j['job_title']!r} @ {j['company_name']}")
    return passed, rejected


def _is_relevant_role(title: str) -> bool:
    lower = title.lower()
    for token in ROLE_RELEVANCE_TOKENS:
        if "\\" in token or "(" in token or "[" in token:
            if re.search(token, lower):
                return True
        else:
            if token in lower:
                return True
    return False


# ── F8 — ITAR / Export Control — HARD DROP ───────────────────────────────────

def _filter_itar(jobs: List[Dict]) -> Tuple[List[Dict], int]:
    """
    F8 — ABSOLUTE HARD DROP.

    Rejects any job where:
      • itar_flag == True  (set by scraper), OR
      • itar_detail contains a known ITAR keyword, OR
      • description contains a known ITAR keyword

    These jobs are permanently rejected BEFORE Company Intelligence.
    No GREEN classification, auto-promotion, or scoring can save a job
    that fails this filter. Company Intelligence will also guard against
    any job that somehow reaches it with itar_flag=True.
    """
    passed, rejected = [], 0
    for j in jobs:
        reason = _itar_reject_reason(j)
        if reason:
            rejected += 1
            log.warning(
                f"  [F8 DROP] ITAR — {j['job_title']!r} @ {j['company_name']} "
                f"| reason: {reason}"
            )
        else:
            # Explicitly clear flags on passing jobs (belt-and-suspenders)
            j["itar_flag"]   = False
            j["itar_detail"] = ""
            passed.append(j)
    return passed, rejected


def _itar_reject_reason(job: Dict) -> Optional[str]:
    # Check scraper-set flag first
    if job.get("itar_flag") is True:
        detail = (job.get("itar_detail") or "").strip()
        return f"itar_flag=True" + (f" ({detail})" if detail else "")

    # Belt-and-suspenders: re-scan title + itar_detail + full description
    combined = " ".join([
        job.get("job_title",   "") or "",
        job.get("itar_detail", "") or "",
        job.get("description", "") or "",
    ]).lower()

    for kw in ITAR_REJECT_KEYWORDS:
        if kw in combined:
            return f"keyword in title/desc: '{kw}'"

    return None


# ── F9 — Blacklisted companies ────────────────────────────────────────────────

def _filter_blacklist(jobs: List[Dict]) -> Tuple[List[Dict], int]:
    """
    F9 — Reject named blacklisted defence / weapons contractors.
    These companies must never appear in any output.
    """
    passed, rejected = [], 0
    for j in jobs:
        co = j["company_name"].lower()
        if any(bl in co for bl in BLACKLISTED_COMPANIES):
            rejected += 1
            log.warning(
                f"  [F9 DROP] Blacklisted — {j['company_name']!r} | {j['job_title']}"
            )
        else:
            passed.append(j)
    return passed, rejected


# ── Scoring (post-filter — never used to bypass filters) ─────────────────────

def _score(job: Dict) -> Dict:
    """Score a job that has already cleared all nine hard filters."""

    # Integrity check — should be impossible at this stage
    if job.get("itar_flag"):
        log.error(
            f"PIPELINE INTEGRITY VIOLATION: ITAR job reached scoring — "
            f"{job['job_title']!r} @ {job['company_name']}. "
            f"This must be investigated immediately."
        )
        job["relevance_score"] = 0
        job["boost_tags"]      = []
        return job

    score = 50
    boost_tags: List[str] = []
    title_lower = job["job_title"].lower()
    desc_lower  = job["description"].lower()

    for tok in BOOST_TITLE_TOKENS:
        if tok in title_lower:
            score += 15
            boost_tags.append(tok)
            break  # one boost per job

    kw_hits = sum(1 for kw in RELEVANCE_KEYWORDS if kw in desc_lower)
    score += min(kw_hits * 2, 20)

    job["relevance_score"] = min(score, 100)
    job["boost_tags"]      = boost_tags
    return job


# ── Filter report ─────────────────────────────────────────────────────────────

def _print_filter_report(**kw):
    total_dropped = kw["total_raw"] - kw["final_passed"]
    log.info("")
    log.info("FILTER REPORT")
    log.info("-" * 50)
    log.info(f"  {'Total scraped':<32}: {kw['total_raw']:>5}")
    log.info(f"  {'F1  Schema rejected':<32}: {kw['schema_rejected']:>5}")
    log.info(f"  {'F2/F3 Aggregator rejected':<32}: {kw['f3_rejected']:>5}")
    log.info(f"  {'F4  Age rejected (>72h)':<32}: {kw['f4_rejected']:>5}")
    log.info(f"  {'F5  Duplicate rejected':<32}: {kw['f5_rejected']:>5}")
    log.info(f"  {'F6  Seniority rejected':<32}: {kw['f6_rejected']:>5}")
    log.info(f"  {'F7  Role mismatch rejected':<32}: {kw['f7_rejected']:>5}")
    log.info(f"  {'F8  ITAR rejected (HARD DROP)':<32}: {kw['f8_rejected']:>5}")
    log.info(f"  {'F9  Blacklist rejected':<32}: {kw['f9_rejected']:>5}")
    log.info(f"  {'-'*38}")
    log.info(f"  {'Total dropped':<32}: {total_dropped:>5}")
    log.info(f"  {'Final passed to classifier':<32}: {kw['final_passed']:>5}")
    log.info("-" * 50)
    if kw["f8_rejected"] > 0:
        log.warning(
            f"  ⚠ {kw['f8_rejected']} ITAR-restricted job(s) were hard-dropped "
            f"and will not appear in any output."
        )
    log.info("")


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )
    result = run()
    print(
        f"\n✓ Merge + filter complete. "
        f"{len(result)} jobs passed all nine hard filters and are ready for classification."
    )
