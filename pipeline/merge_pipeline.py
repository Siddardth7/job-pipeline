#!/usr/bin/env python3
"""
pipeline/merge_pipeline.py — JobAgent v2 Merge & Filtering Pipeline

Reads all temp/jobs_*.json files, normalizes fields, removes duplicates,
applies relevance filters, and scores jobs.

Outputs:
    temp/jobs_clean_intermediate.json
"""

import json
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Dict, Optional
from urllib.parse import urlparse

ROOT = Path(__file__).parent.parent
TEMP_DIR = ROOT / "temp"
OUTPUT_PATH = TEMP_DIR / "jobs_clean_intermediate.json"

sys.path.insert(0, str(ROOT))

log = logging.getLogger("merge_pipeline")

# ── Config ────────────────────────────────────────────────────────────────────

MAX_AGE_HOURS = 72

REJECT_TITLE_TOKENS = [
    "senior", "staff", "principal", "manager", "director",
    "sr.", "sr ", "lead engineer", "vp ", "vice president",
    "chief", "head of"
]

BOOST_TITLE_TOKENS = [
    "entry level", "associate", "engineer i", "engineer ii",
    "early career", "new grad", "junior", "level i", "level ii"
]

REJECT_DESCRIPTION_TOKENS = [
    "senior", "staff", "principal", "manager", "director",
    "10+ years", "8+ years", "7+ years"
]

RELEVANCE_KEYWORDS = [
    "manufacturing", "process", "production", "quality", "composites",
    "materials", "industrial", "lean", "tooling", "inspection",
    "metrology", "aerospace", "automotive", "assembly", "fabrication",
    "cnc", "gd&t", "cad", "solidworks", "catia", "npi", "scale-up",
    "six sigma", "kaizen", "dmaic", "fmea", "apqp", "ppap"
]

# ── Entry point ───────────────────────────────────────────────────────────────

def run():
    log.info("=" * 60)
    log.info("Merge Pipeline — Starting")
    log.info("=" * 60)

    # 1. Load all temp sources
    raw_jobs = _load_all_sources()
    log.info(f"Loaded {len(raw_jobs)} raw jobs from all sources")

    # 2. Normalize
    normalized = [_normalize(j) for j in raw_jobs]
    normalized = [j for j in normalized if j is not None]
    log.info(f"Normalized: {len(normalized)} jobs")

    # 3. Deduplicate
    deduped, dupe_count = _deduplicate(normalized)
    log.info(f"Deduplication: removed {dupe_count}, kept {len(deduped)}")

    # 4. Validate URLs
    url_valid = [j for j in deduped if _valid_url(j.get("job_url", ""))]
    log.info(f"URL validated: {len(url_valid)} passed")

    # 5. Age filter
    fresh = [j for j in url_valid if _is_fresh(j.get("posted_date", ""))]
    log.info(f"Age filter (≤{MAX_AGE_HOURS}h): {len(fresh)} passed")

    # 6. Title filter
    title_passed = [j for j in fresh if not _reject_title(j.get("job_title", ""))]
    log.info(f"Title filter: {len(title_passed)} passed "
             f"({len(fresh) - len(title_passed)} rejected)")

    # 7. Score
    scored = [_score(j) for j in title_passed]
    scored.sort(key=lambda j: -j["relevance_score"])

    # 8. Write output
    OUTPUT_PATH.write_text(json.dumps({
        "generated_utc": datetime.utcnow().isoformat() + "Z",
        "stats": {
            "total_raw": len(raw_jobs),
            "after_normalize": len(normalized),
            "duplicates_removed": dupe_count,
            "url_invalid": len(deduped) - len(url_valid),
            "age_filtered": len(url_valid) - len(fresh),
            "title_filtered": len(fresh) - len(title_passed),
            "final_count": len(scored),
        },
        "jobs": scored
    }, indent=2))

    log.info(f"Output: {len(scored)} clean jobs → {OUTPUT_PATH}")
    log.info("=" * 60)
    return scored


# ── Loaders ───────────────────────────────────────────────────────────────────

def _load_all_sources() -> List[Dict]:
    jobs = []
    source_files = list(TEMP_DIR.glob("jobs_*.json"))
    if not source_files:
        log.warning("No temp source files found.")
        return jobs
    for path in source_files:
        try:
            data = json.loads(path.read_text())
            batch = data.get("jobs", [])
            log.info(f"  {path.name}: {len(batch)} jobs")
            jobs.extend(batch)
        except Exception as e:
            log.error(f"Failed to load {path.name}: {e}")
    return jobs


# ── Normalize ─────────────────────────────────────────────────────────────────

def _normalize(job: Dict) -> Optional[Dict]:
    """Coerce all jobs to standard schema."""
    title = str(job.get("job_title", "") or "").strip()
    company = str(job.get("company_name", "") or "").strip()
    url = str(job.get("job_url", "") or "").strip()
    location = str(job.get("location", "") or "").strip()
    posted = str(job.get("posted_date", "") or "").strip()
    desc = str(job.get("description", "") or "").strip()
    source = str(job.get("source", "unknown") or "unknown")
    cluster = str(job.get("cluster", "") or "")
    itar_flag = bool(job.get("itar_flag", False))
    itar_detail = str(job.get("itar_detail", "") or "")

    if not title or not company or not url:
        return None

    return {
        "job_title": title,
        "company_name": company,
        "job_url": url,
        "location": location,
        "posted_date": posted,
        "description": desc,
        "source": source,
        "cluster": cluster,
        "itar_flag": itar_flag,
        "itar_detail": itar_detail,
        "relevance_score": 0,
        "boost_tags": [],
    }


# ── Deduplication ─────────────────────────────────────────────────────────────

def _deduplicate(jobs: List[Dict]):
    seen_urls: set = set()
    seen_composite: set = set()
    out = []
    dupes = 0
    for j in jobs:
        url = j["job_url"].lower().split("?")[0]  # strip query params
        composite = (
            j["company_name"].lower(),
            j["job_title"].lower()[:40],
            j["location"].lower()[:20]
        )
        if url in seen_urls or composite in seen_composite:
            dupes += 1
            continue
        seen_urls.add(url)
        seen_composite.add(composite)
        out.append(j)
    return out, dupes


# ── Filters ───────────────────────────────────────────────────────────────────

def _valid_url(url: str) -> bool:
    try:
        r = urlparse(url)
        return bool(r.scheme in ("http", "https") and r.netloc)
    except Exception:
        return False


def _is_fresh(posted_date: str) -> bool:
    """Allow jobs posted within MAX_AGE_HOURS. Empty date → assume fresh."""
    if not posted_date:
        return True
    try:
        dt = datetime.strptime(posted_date[:10], "%Y-%m-%d")
        cutoff = datetime.utcnow() - timedelta(hours=MAX_AGE_HOURS)
        return dt >= cutoff
    except Exception:
        return True


def _reject_title(title: str) -> bool:
    lower = title.lower()
    return any(tok in lower for tok in REJECT_TITLE_TOKENS)


# ── Scoring ───────────────────────────────────────────────────────────────────

def _score(job: Dict) -> Dict:
    score = 50  # baseline
    boost_tags = []

    title_lower = job["job_title"].lower()
    desc_lower = job["description"].lower()

    # Boost for entry-level indicators in title
    for tok in BOOST_TITLE_TOKENS:
        if tok in title_lower:
            score += 15
            boost_tags.append(tok)
            break  # one boost per job

    # Boost for relevant keywords in description
    kw_hits = sum(1 for kw in RELEVANCE_KEYWORDS if kw in desc_lower)
    score += min(kw_hits * 2, 20)

    # Penalize if ITAR flagged
    if job.get("itar_flag"):
        score -= 10

    job["relevance_score"] = min(score, 100)
    job["boost_tags"] = boost_tags
    return job


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s")
    result = run()
    print(f"\n✓ Merge pipeline complete. {len(result)} jobs ready for classification.")
