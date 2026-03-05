#!/usr/bin/env python3
"""
M628 Pipeline Merger — Combines all four scraper outputs into one feed.

Sources merged (in priority order):
  1. jsearch_targeted  — JSearch API, M628 companies, keyword queries
  2. apify_targeted    — Apify actors, M628 companies, ATS-native scraping
  3. jsearch_open      — JSearch API, open keyword search, new companies
  4. apify_open        — Apify Google Jobs, open keyword search, new companies

Priority order matters for dedup: if the same job appears in targeted AND open,
the targeted version (with richer tier/h1b metadata) wins.

OUTPUT:
  output/jobs_merged_YYYY-MM-DD.json
  output/jobs_latest.json             <- consumed by JobAgent artifact
"""

import json
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
OUTPUT_DIR = SCRIPT_DIR / "output"


def load_json(path):
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return {"jobs": [], "error": f"File not found: {path.name}"}


def norm_title(t):
    return (t or "").lower().strip().replace("  ", " ")


def main():
    # Load all 4 sources — targeted first so they win dedup
    sources = {
        "jsearch_targeted": load_json(OUTPUT_DIR / "jobs_jsearch_targeted_latest.json"),
        "apify_targeted":   load_json(OUTPUT_DIR / "jobs_apify_targeted_latest.json"),
        "jsearch_open":     load_json(OUTPUT_DIR / "jobs_jsearch_open_latest.json"),
        "apify_open":       load_json(OUTPUT_DIR / "jobs_apify_open_latest.json"),
    }

    # Collect counts before merge
    source_counts = {k: len(v.get("jobs", [])) for k, v in sources.items()}
    source_errors = {k: v.get("error", "") for k, v in sources.items() if v.get("error")}

    # Merge — targeted sources first so they win deduplication
    all_jobs = []
    for key in ["jsearch_targeted", "apify_targeted", "jsearch_open", "apify_open"]:
        all_jobs.extend(sources[key].get("jobs", []))

    # Deduplicate by (company_lower, normalised_title, location_lower)
    # First occurrence wins (targeted > open, as ordered above)
    seen   = set()
    unique = []
    for j in all_jobs:
        key = (
            j.get("company", "").lower(),
            norm_title(j.get("role", "")),
            j.get("location", "").lower(),
        )
        if key not in seen:
            seen.add(key)
            unique.append(j)

    dupes_removed = len(all_jobs) - len(unique)

    # Sort: M628 targeted first, then open; within each group GREEN > YELLOW > RED
    def sort_key(j):
        is_open    = 1 if "_open" in j.get("source", "") else 0
        verdict_n  = {"GREEN": 0, "YELLOW": 1, "RED": 2}.get(j.get("verdict", "YELLOW"), 9)
        return (is_open, verdict_n, -j.get("match", 0))

    unique.sort(key=sort_key)

    # Build summary
    targeted_jobs = [j for j in unique if "_targeted" in j.get("source", "")]
    open_jobs     = [j for j in unique if "_open"     in j.get("source", "")]

    today  = datetime.now().strftime("%Y-%m-%d")
    output = {
        "generated_utc": datetime.utcnow().isoformat() + "Z",
        "sources": {
            "jsearch_targeted": source_counts["jsearch_targeted"],
            "apify_targeted":   source_counts["apify_targeted"],
            "jsearch_open":     source_counts["jsearch_open"],
            "apify_open":       source_counts["apify_open"],
            "merged_unique":    len(unique),
            "duplicates_removed": dupes_removed,
        },
        "errors": source_errors,
        "summary": {
            "total":        len(unique),
            "targeted":     len(targeted_jobs),
            "open_search":  len(open_jobs),
            "green":        sum(1 for j in unique if j.get("verdict") == "GREEN"),
            "yellow":       sum(1 for j in unique if j.get("verdict") == "YELLOW"),
            "red_itar":     sum(1 for j in unique if j.get("verdict") == "RED"),
            "tier1":        sum(1 for j in unique if j.get("tier") == "Tier 1"),
            "tier2":        sum(1 for j in unique if j.get("tier") == "Tier 2"),
            "h1b_yes":      sum(1 for j in unique if j.get("h1b") == "YES"),
            "new_companies": len(open_jobs),   # open = companies not in M628
        },
        "jobs": unique,
    }

    out_file = OUTPUT_DIR / f"jobs_merged_{today}.json"
    latest   = OUTPUT_DIR / "jobs_latest.json"
    for path in [out_file, latest]:
        with open(path, "w") as f:
            json.dump(output, f, indent=2)

    print(f"Sources:  {output['sources']}")
    print(f"Summary:  {output['summary']}")
    if source_errors:
        print(f"Errors:   {source_errors}")
    print(f"Saved:    {out_file}")
    print(f"          {latest}")


if __name__ == "__main__":
    main()
