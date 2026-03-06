#!/usr/bin/env python3
"""
M628 Merge Pipeline v2
Merges JSearch + Apify outputs into a single ranked feed.
Then calls post_merge_filter to produce the final clean output.

Usage:
  python merge_pipeline.py

Reads:
  output/jobs_jsearch_latest.json
  output/jobs_apify_latest.json

Writes:
  output/jobs_merged_latest.json        (intermediate)
  output/jobs_clean_latest.json         (final — consumed by app)
"""

import json, logging, subprocess, sys
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
OUTPUT_DIR = SCRIPT_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

JSEARCH_LATEST = OUTPUT_DIR / "jobs_jsearch_latest.json"
APIFY_LATEST   = OUTPUT_DIR / "jobs_apify_latest.json"
MERGED_OUT     = OUTPUT_DIR / "jobs_merged_latest.json"
CLEAN_OUT      = OUTPUT_DIR / "jobs_clean_latest.json"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(SCRIPT_DIR / "merge.log"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("merge")


def load_jobs(path: Path) -> list:
    if not path.exists():
        log.warning(f"File not found, skipping: {path}")
        return []
    try:
        with open(path) as f:
            data = json.load(f)
        jobs = data.get("jobs", [])
        log.info(f"  Loaded {len(jobs)} jobs from {path.name}")
        return jobs
    except Exception as e:
        log.error(f"Failed to load {path}: {e}")
        return []


def deduplicate(jobs: list) -> list:
    """Remove exact duplicates by (company, role, location) key."""
    seen = set()
    unique = []
    for j in jobs:
        key = (
            (j.get("company") or "").lower().strip(),
            (j.get("role")    or "").lower().strip(),
            (j.get("location") or "").lower().strip(),
        )
        if key not in seen:
            seen.add(key)
            unique.append(j)
    return unique


def main():
    log.info("=" * 60)
    log.info("M628 Merge Pipeline v2 — Starting")
    log.info("=" * 60)

    jsearch_jobs = load_jobs(JSEARCH_LATEST)
    apify_jobs   = load_jobs(APIFY_LATEST)

    all_jobs = jsearch_jobs + apify_jobs
    log.info(f"Total before dedup: {len(all_jobs)}")

    unique = deduplicate(all_jobs)
    log.info(f"Total after dedup: {len(unique)}")

    # Sort: verdict → match score
    verdict_order = {"GREEN": 0, "YELLOW": 1, "RED": 2}
    unique.sort(key=lambda j: (verdict_order.get(j.get("verdict","RED"), 9), -j.get("match", 0)))

    output = {
        "generated_utc":   datetime.utcnow().isoformat() + "Z",
        "jsearch_jobs":    len(jsearch_jobs),
        "apify_jobs":      len(apify_jobs),
        "total_merged":    len(unique),
        "jobs":            unique,
    }

    with open(MERGED_OUT, "w") as f:
        json.dump(output, f, indent=2)
    log.info(f"Merged feed → {MERGED_OUT}")

    # ── Run post_merge_filter ─────────────────────────────────────────────────
    filter_script = SCRIPT_DIR / "post_merge_filter.py"
    if filter_script.exists():
        log.info("Running post_merge_filter.py…")
        result = subprocess.run(
            [sys.executable, str(filter_script)],
            capture_output=False,
        )
        if result.returncode != 0:
            log.error("post_merge_filter.py returned non-zero exit code.")
    else:
        log.warning("post_merge_filter.py not found — writing merged output as final.")
        import shutil
        shutil.copy(MERGED_OUT, CLEAN_OUT)

    if CLEAN_OUT.exists():
        with open(CLEAN_OUT) as f:
            clean = json.load(f)
        log.info(f"Final clean output: {clean.get('total_kept', len(clean.get('jobs',[])))} jobs → {CLEAN_OUT}")
    log.info("=" * 60)
    log.info("Merge + filter complete.")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
