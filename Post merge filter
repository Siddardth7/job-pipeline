#!/usr/bin/env python3
"""
M628 Post-Merge Filter  —  The Final Gate Before the Artifact
=============================================================

Runs AFTER merge_pipeline.py. Applies every hard filter defined in the
Master Instruction Sheets (IS-1: Find Jobs, IS-2: Analyse JD) so that
ONLY clean, eligible, relevant jobs reach the JobAgent artifact.

Pipeline order:
  jsearch_scraper.py  ─┐
  apify_scraper.py    ─┼─► merge_pipeline.py ──► post_merge_filter.py ──► jobs_clean.json
                       ┘                          (this file)

FILTERS APPLIED (in order):
  1.  Blacklist gate         — BLACKLISTED companies never pass (IS-1 §10, IS-2 §5)
  2.  ITAR company gate      — itar = YES in M628 → hard reject (IS-1 §4 criteria)
  3.  ITAR JD keyword scan   — citizenship language in description → RED flag (IS-1/2)
  4.  Aggregator URL gate    — linkedin.com, indeed.com, etc. → reject (IS-1 §4.3)
  5.  Role title whitelist   — must match Track 1 or Track 2 titles (IS-1 §4 criteria)
  6.  Seniority ceiling      — Senior/Lead/Principal/5+ yrs = flag YELLOW (IS-2 §5.3)
  7.  Industry alignment     — must be relevant industry (IS-1 §4 criteria)
  8.  Match score threshold  — score < 60 → reject (IS-1 §4 criteria)
  9.  Job age gate           — older than 7 days → reject (IS-1 §5 — 3 days strict,
                               relaxed to 7 for scraper lag tolerance)
  10. Verdict recalculation  — recomputes GREEN/YELLOW/RED from IS-1 §6.1 table
  11. Priority sort          — IS-1 §6.2: clean first, tier 1 first, h1b YES first

OUTPUT:
  output/jobs_clean_YYYY-MM-DD.json
  output/jobs_clean_latest.json       ← consumed by JobAgent artifact
"""

import json, re
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
OUTPUT_DIR = SCRIPT_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

# ═══════════════════════════════════════════════════════════════════════════════
# HARD FILTER CONSTANTS  (exact values from JobAgent_v6.jsx / Instruction Sheets)
# ═══════════════════════════════════════════════════════════════════════════════

# IS-1 §10 / IS-2 §5 Stage 1 — BLACKLISTED companies (hard reject, no exceptions)
BLACKLISTED = [
    "lockheed martin", "northrop grumman", "general dynamics",
    "raytheon", "rtx", "l3harris", "bae systems", "anduril", "saronic",
]

# IS-1 §4 / IS-2 §5 Stage 1 — ITAR keywords in job description text
ITAR_KW = [
    "security clearance",
    "us person",
    "itar",
    "export controlled",
    "classified",
    "us citizen or permanent resident",
    "must be authorized to work without sponsorship",
    "u.s. citizen",
    "u.s. national",
    "person lawfully admitted for permanent residence",
]

# IS-1 §4.3 — Aggregator domains to reject
REJECT_DOMAINS = [
    "indeed.com", "glassdoor.com", "ziprecruiter.com", "simplyhired.com",
    "monster.com", "careerbuilder.com", "linkedin.com", "bandana.com",
    "talent.com", "salary.com", "jooble.org", "joblist.com",
]

# IS-1 §4 criteria — Track 1 (full-time) acceptable role title keywords
TRACK1_TITLE_KW = [
    # Core targets
    "manufacturing engineer",
    "process engineer",
    "composites engineer",
    "composite engineer",
    "materials engineer",
    "quality engineer",
    "production engineer",
    # Broader acceptable variants
    "advanced manufacturing",
    "manufacturing process",
    "composite manufacturing",
    "composites manufacturing",
    "manufacturing technology",
    "process development engineer",
    "quality systems engineer",
    "npi engineer",
    "new product introduction",
    "manufacturing integration",
    "propulsion manufacturing",
    "structural manufacturing",
    "additive manufacturing engineer",
    "r&d manufacturing",
    "industrialization engineer",
    "lean manufacturing engineer",
    "industrial engineer",         # acceptable at mfg companies
    "manufacturing science",
    "process improvement engineer",
    "equipment engineer",          # Resume D
    "tooling engineer",            # Resume D
    "validation engineer",         # medical/mfg context
    "manufacturing quality",
    "quality assurance engineer",
    "quality control engineer",
    "manufacturing operations engineer",
]

# IS-1 §4 criteria — Track 2 (internship / co-op) acceptable titles
TRACK2_TITLE_KW = [
    "manufacturing intern",
    "manufacturing co-op",
    "process engineer intern",
    "process intern",
    "composites intern",
    "materials intern",
    "quality intern",
    "engineering intern",
    "engineering co-op",
    "production intern",
    "manufacturing coop",
    "process coop",
    "aerospace intern",
    "r&d intern",
    "r&d co-op",
]

# IS-1 §4 criteria + IS-2 §5.3 seniority — roles to always REJECT
HARD_REJECT_TITLE_KW = [
    # Wrong discipline
    "software engineer", "software developer", "firmware engineer",
    "embedded engineer", "electrical engineer", "electronics engineer",
    "rf engineer", "avionics engineer", "systems engineer",
    "data scientist", "machine learning", "ai engineer", "ml engineer",
    "cloud engineer", "devops", "cybersecurity", "network engineer",
    "computer science",
    # Business / non-engineering
    "marketing", "business development", "sales engineer", "account manager",
    "accountant", "finance", "financial analyst", "legal", "attorney",
    "hr ", " hr,", "hrbp", "recruiter", "talent acquisition",
    "program manager", "product manager", "project manager",
    "contracts manager", "procurement", "logistics",
    "communications", "public relations",
    # Too junior / non-engineering
    "technician", "operator", "assembler", "inspector",
    "machinist", "welder", "material handler",
    # Too senior (IS-2 §5.3 seniority rule)
    "director", "vice president", "vp ", " vp,", " vp-",
    "chief ", "c.t.o", "cto", "coo", "ceo",
    "head of", "svp", "evp",
    "principal engineer",      # usually 8+ yrs
    "distinguished engineer",
    "fellow",
    # Staffing / contract noise
    "staffing", "c2c", "corp-to-corp", "1099", "third party",
    "contract to hire",
]

# IS-2 §5.3 — seniority flag (YELLOW, not hard reject, unless combined with ≥5 yrs req)
SENIORITY_FLAG_KW = [
    "senior engineer", "senior manufacturing", "senior process",
    "senior quality", "senior materials", "senior composites",
    "lead engineer", "lead manufacturing", "lead process",
    "staff engineer", "staff manufacturing",
    "sr. ", "sr ", "lead ",
]

# IS-1 §4 criteria — relevant industries (case-insensitive substring match)
RELEVANT_INDUSTRIES = [
    "aerospace", "composites", "automotive", "manufacturing",
    "materials", "energy", "medical device", "medical devices",
    "evtol", "space", "defense", "semiconductor", "research",
    "chemical", "industrial",
]

# IS-1 §4 criteria — explicitly irrelevant industries (hard reject)
IRRELEVANT_INDUSTRIES = [
    "retail", "hospitality", "food service", "restaurant",
    "real estate", "insurance", "banking", "finance",
    "media", "entertainment", "sports", "gaming",
    "education administration", "social work",
]

# IS-1 §6.1 — Verdict scoring table (exact values from instruction sheet)
SCORE_TABLE = {
    # (tier, h1b, itar_clean)  →  (verdict, score)
    ("1", "YES",    True):  ("GREEN",  90),
    ("1", "LIKELY", True):  ("GREEN",  85),
    ("2", "YES",    True):  ("GREEN",  82),
    ("2", "LIKELY", True):  ("GREEN",  82),
    ("3", "YES",    True):  ("YELLOW", 78),
    ("3", "LIKELY", True):  ("YELLOW", 78),
    ("4", "YES",    True):  ("YELLOW", 72),
    ("4", "LIKELY", True):  ("YELLOW", 72),
    ("5", "YES",    True):  ("YELLOW", 70),
    ("5", "LIKELY", True):  ("YELLOW", 70),
    ("6", "YES",    True):  ("YELLOW", 65),
    ("6", "LIKELY", True):  ("YELLOW", 65),
}

# ═══════════════════════════════════════════════════════════════════════════════
# FILTER FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

def is_blacklisted(company: str) -> str | None:
    """IS-1 §10 / IS-2 §5 Stage 1. Returns matched blacklist name or None."""
    co = company.lower()
    for b in BLACKLISTED:
        if b in co:
            return b
    return None


def check_itar_jd(description: str) -> list[str]:
    """IS-1 §4 / IS-2 §5 Stage 1. Returns list of ITAR keywords found in JD."""
    if not description:
        return []
    lower = description.lower()
    return [kw for kw in ITAR_KW if kw in lower]


def is_aggregator_url(url: str) -> bool:
    """IS-1 §4.3. Returns True if URL is an aggregator domain."""
    if not url:
        return True   # no URL = treat as aggregator
    lower = url.lower()
    return any(d in lower for d in REJECT_DOMAINS)


def passes_title_filter(title: str) -> tuple[bool, str, str]:
    """
    IS-1 §4 criteria (role title match, Track 1 or Track 2).
    Returns (passes, track, reason).
    """
    if not title:
        return False, "", "empty title"
    lower = title.lower()

    # Hard reject check first
    for kw in HARD_REJECT_TITLE_KW:
        if kw in lower:
            return False, "", f"hard-reject keyword: '{kw}'"

    # Track 1 check
    for kw in TRACK1_TITLE_KW:
        if kw in lower:
            return True, "Track1", f"matches '{kw}'"

    # Track 2 check
    for kw in TRACK2_TITLE_KW:
        if kw in lower:
            return True, "Track2", f"matches intern/co-op '{kw}'"

    return False, "", "no target role keyword matched"


def check_seniority(title: str) -> bool:
    """IS-2 §5.3. Returns True if title suggests overly senior role (flag only)."""
    lower = (title or "").lower()
    return any(kw in lower for kw in SENIORITY_FLAG_KW)


def passes_industry(industry: str) -> bool:
    """IS-1 §4 criteria (industry alignment)."""
    if not industry:
        return True   # unknown industry — pass through (open search companies)
    lower = industry.lower()
    # Hard fail on obviously irrelevant
    if any(bad in lower for bad in IRRELEVANT_INDUSTRIES):
        return False
    # Soft pass if relevant industry found
    if any(good in lower for good in RELEVANT_INDUSTRIES):
        return True
    # Unknown industry: pass through with YELLOW
    return True


def parse_days_ago(posted: str) -> int | None:
    """
    IS-1 §5 (job age). Parse the posted string into days-old integer.
    Returns None if cannot determine.
    """
    if not posted:
        return None
    lower = posted.lower().strip()
    if lower in ("today", "just posted", "0d ago"):
        return 0
    m = re.match(r"(\d+)d ago", lower)
    if m:
        return int(m.group(1))
    # Try "X days ago"
    m = re.match(r"(\d+)\s+day", lower)
    if m:
        return int(m.group(1))
    # Try "X weeks ago"
    m = re.match(r"(\d+)\s+week", lower)
    if m:
        return int(m.group(1)) * 7
    # Try "X hours ago"
    m = re.match(r"(\d+)\s+hour", lower)
    if m:
        return 0
    return None


def recalculate_verdict(job: dict, itar_flags: list[str], seniority_flagged: bool) -> tuple[str, int]:
    """
    IS-1 §6.1 — Recalculate verdict and match score from the official scoring table.
    Any ITAR keyword hit → RED / 0.
    Seniority flag → downgrade by 1 step.
    """
    if itar_flags:
        return "RED", 0

    tier     = str(job.get("tier", "2")).replace("Tier ", "").strip()
    h1b      = job.get("h1b", "LIKELY")
    itar_co  = (job.get("itar_company") or job.get("itar_co") or "NO").strip()

    # Company-level ITAR = YES → RED
    if itar_co.upper() == "YES":
        return "RED", 0

    # Company-level ITAR = Partial → YELLOW / 60 (must inspect JD)
    if itar_co.lower() == "partial":
        verdict, score = "YELLOW", 60
    else:
        # Look up in scoring table
        key = (tier, h1b, True)
        verdict, score = SCORE_TABLE.get(key, ("YELLOW", 60))

    # IS-2 §5.3 — seniority flag: downgrade GREEN→YELLOW, reduce score by 10
    if seniority_flagged:
        if verdict == "GREEN":
            verdict = "YELLOW"
        score = max(0, score - 10)

    return verdict, score


# ═══════════════════════════════════════════════════════════════════════════════
# REJECTION LOG HELPER
# ═══════════════════════════════════════════════════════════════════════════════

class FilterStats:
    def __init__(self):
        self.total_in          = 0
        self.passed            = 0
        self.rejected          = 0
        self.by_reason: dict[str, int] = {}

    def reject(self, reason: str):
        self.rejected += 1
        self.by_reason[reason] = self.by_reason.get(reason, 0) + 1

    def report(self) -> dict:
        return {
            "total_in":   self.total_in,
            "passed":     self.passed,
            "rejected":   self.rejected,
            "pass_rate":  f"{100*self.passed/max(self.total_in,1):.1f}%",
            "by_reason":  dict(sorted(self.by_reason.items(),
                                      key=lambda x: -x[1])),
        }


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN FILTER PASS
# ═══════════════════════════════════════════════════════════════════════════════

MAX_JOB_AGE_DAYS = 7   # IS-1 §5 says 3 days strict; we allow 7 for scraper lag

def filter_job(job: dict, stats: FilterStats) -> dict | None:
    """
    Run all hard filters on a single job. Returns cleaned job dict or None.
    None = rejected (do not pass to artifact).
    """
    title   = (job.get("role")    or "").strip()
    company = (job.get("company") or "").strip()
    url     = (job.get("link")    or "").strip()
    desc    = (job.get("itar_detail") or "")   # we use itar_detail as proxy for desc snippets
    posted  = (job.get("posted")  or "").strip()
    industry = (job.get("industry") or "").strip()

    # ── FILTER 1: Blacklist gate (IS-1 §10) ───────────────────────────────────
    bl = is_blacklisted(company)
    if bl:
        stats.reject(f"blacklisted:{bl}")
        return None

    # ── FILTER 2: ITAR company field = YES (IS-1 §4) ──────────────────────────
    itar_co = (job.get("itar_company") or job.get("itar_co") or "NO").strip()
    if itar_co.upper() == "YES":
        stats.reject("itar_company_YES")
        return None

    # ── FILTER 3: Aggregator URL gate (IS-1 §4.3) ─────────────────────────────
    if is_aggregator_url(url):
        stats.reject("aggregator_url")
        return None

    # ── FILTER 4: Role title whitelist (IS-1 §4 criteria, Track 1/2) ──────────
    ok, track, title_reason = passes_title_filter(title)
    if not ok:
        stats.reject(f"title_filter:{title_reason[:60]}")
        return None

    # ── FILTER 5: Industry alignment (IS-1 §4 criteria) ───────────────────────
    if not passes_industry(industry):
        stats.reject(f"industry_irrelevant:{industry}")
        return None

    # ── FILTER 6: Job age (IS-1 §5) ───────────────────────────────────────────
    days_old = parse_days_ago(posted)
    age_flag = ""
    if days_old is not None and days_old > MAX_JOB_AGE_DAYS:
        stats.reject(f"too_old:{days_old}d")
        return None
    if days_old is None:
        age_flag = "UNVERIFIED_AGE"   # pass through with warning flag

    # ── FILTER 7: ITAR JD keyword scan (IS-1 §4 / IS-2 §5 Stage 1) ───────────
    # Use both itar_detail (already detected) and any stored description
    itar_already = job.get("itar_flag", False)
    itar_flags   = check_itar_jd(desc)
    if itar_already:
        itar_flags = itar_flags or ["(flagged by scraper)"]

    # ── FILTER 8: Seniority ceiling (IS-2 §5.3) ───────────────────────────────
    seniority_flagged = check_seniority(title)

    # ── FILTER 9: Verdict recalculation (IS-1 §6.1) ───────────────────────────
    verdict, score = recalculate_verdict(job, itar_flags, seniority_flagged)

    # ── FILTER 10: Match score threshold ≥ 60 (IS-1 §4 criteria) ─────────────
    if score < 60:
        stats.reject(f"score_below_60:{score}")
        return None

    # ── PASSED ────────────────────────────────────────────────────────────────
    stats.passed += 1

    # Build clean job record — preserve all original fields, update computed ones
    clean = dict(job)
    clean["verdict"]           = verdict
    clean["match"]             = score
    clean["itar_flag"]         = bool(itar_flags)
    clean["itar_detail"]       = ", ".join(itar_flags) if itar_flags else ""
    clean["track"]             = track
    clean["seniority_flagged"] = seniority_flagged
    clean["age_flag"]          = age_flag
    clean["filter_note"]       = _build_note(verdict, itar_flags, seniority_flagged,
                                              itar_co, age_flag)
    return clean


def _build_note(verdict, itar_flags, seniority_flagged, itar_co, age_flag) -> str:
    notes = []
    if itar_flags:
        notes.append(f"ITAR: {', '.join(itar_flags)}")
    if itar_co.lower() == "partial":
        notes.append("Company ITAR=Partial — inspect JD carefully")
    if seniority_flagged:
        notes.append("Seniority flag — verify experience requirement")
    if age_flag:
        notes.append("Posting date unverified")
    return " | ".join(notes) if notes else ""


# ═══════════════════════════════════════════════════════════════════════════════
# PRIORITY SORT  (IS-1 §6.2)
# ═══════════════════════════════════════════════════════════════════════════════

def sort_key(job: dict):
    """
    IS-1 §6.2 priority order:
    1. ITAR clean first (itar_flag=False before True)
    2. Tier ascending (Tier 1 first)
    3. h1b YES before LIKELY
    4. Verdict GREEN > YELLOW > RED
    5. Match score descending
    6. Source: targeted before open
    """
    itar_first   = 1 if job.get("itar_flag") else 0
    tier_val     = int(str(job.get("tier", 9)).replace("Tier ", "")) \
                   if str(job.get("tier", "9")).replace("Tier ", "").isdigit() else 9
    h1b_order    = 0 if job.get("h1b") == "YES" else 1
    verdict_ord  = {"GREEN": 0, "YELLOW": 1, "RED": 2}.get(job.get("verdict", "YELLOW"), 9)
    score_ord    = -(job.get("match", 0))
    open_last    = 1 if "_open" in (job.get("source") or "") else 0

    return (itar_first, tier_val, h1b_order, verdict_ord, score_ord, open_last)


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    print("=" * 65)
    print("M628 Post-Merge Filter  —  Applying Instruction Sheet Hard Gates")
    print("=" * 65)

    # Load merged feed
    merged_path = OUTPUT_DIR / "jobs_latest.json"
    if not merged_path.exists():
        print(f"ERROR: {merged_path} not found. Run merge_pipeline.py first.")
        return

    with open(merged_path) as f:
        merged = json.load(f)

    raw_jobs = merged.get("jobs", [])
    print(f"Input:  {len(raw_jobs)} jobs from merger")

    stats = FilterStats()
    stats.total_in = len(raw_jobs)
    clean_jobs = []

    for job in raw_jobs:
        result = filter_job(job, stats)
        if result is not None:
            clean_jobs.append(result)

    # Sort by IS-1 §6.2 priority
    clean_jobs.sort(key=sort_key)

    # ── Build output ─────────────────────────────────────────────────────────
    today    = datetime.now().strftime("%Y-%m-%d")
    filter_report = stats.report()

    output = {
        "generated_utc":  datetime.utcnow().isoformat() + "Z",
        "stage":          "post_merge_filter",
        "filter_report":  filter_report,
        "sources_in":     merged.get("sources", {}),
        "summary": {
            "total":        len(clean_jobs),
            "green":        sum(1 for j in clean_jobs if j.get("verdict") == "GREEN"),
            "yellow":       sum(1 for j in clean_jobs if j.get("verdict") == "YELLOW"),
            "red_itar":     sum(1 for j in clean_jobs if j.get("verdict") == "RED"),
            "track1":       sum(1 for j in clean_jobs if j.get("track") == "Track1"),
            "track2":       sum(1 for j in clean_jobs if j.get("track") == "Track2"),
            "tier1":        sum(1 for j in clean_jobs if str(j.get("tier","")) == "1"),
            "tier2":        sum(1 for j in clean_jobs if str(j.get("tier","")) == "2"),
            "h1b_yes":      sum(1 for j in clean_jobs if j.get("h1b") == "YES"),
            "seniority_flagged": sum(1 for j in clean_jobs if j.get("seniority_flagged")),
            "age_unverified": sum(1 for j in clean_jobs if j.get("age_flag")),
            "open_search":  sum(1 for j in clean_jobs if "_open" in (j.get("source") or "")),
        },
        "jobs": clean_jobs,
    }

    # Write dated + latest
    dated_out  = OUTPUT_DIR / f"jobs_clean_{today}.json"
    latest_out = OUTPUT_DIR / "jobs_clean_latest.json"
    for path in [dated_out, latest_out]:
        with open(path, "w") as f:
            json.dump(output, f, indent=2)

    # ── Summary report ───────────────────────────────────────────────────────
    print(f"\nFILTER RESULTS:")
    print(f"  Input:    {filter_report['total_in']} jobs")
    print(f"  Passed:   {filter_report['passed']}  ({filter_report['pass_rate']})")
    print(f"  Rejected: {filter_report['rejected']}")
    print(f"\nREJECTION BREAKDOWN:")
    for reason, count in filter_report["by_reason"].items():
        print(f"  {count:3d}  {reason}")
    print(f"\nCLEAN FEED SUMMARY:")
    s = output["summary"]
    print(f"  Total jobs:         {s['total']}")
    print(f"  GREEN:              {s['green']}")
    print(f"  YELLOW:             {s['yellow']}")
    print(f"  RED (ITAR):         {s['red_itar']}")
    print(f"  Track 1 (FT):       {s['track1']}")
    print(f"  Track 2 (Intern):   {s['track2']}")
    print(f"  Tier 1 companies:   {s['tier1']}")
    print(f"  H1B confirmed:      {s['h1b_yes']}")
    print(f"  Seniority flagged:  {s['seniority_flagged']}  (YELLOW — verify reqs)")
    print(f"  Open-search finds:  {s['open_search']}  (new companies, vet before apply)")
    print(f"\nSaved: {dated_out.name}")
    print(f"       {latest_out.name}  ← update artifact to read this file")
    print("=" * 65)


if __name__ == "__main__":
    main()
