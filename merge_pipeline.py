#!/usr/bin/env python3
"""
M628 Pipeline Merger — Combines JSearch + Apify scraper outputs into a single
deduplicated job feed ready for the JobAgent artifact.

Run after both scrapers: python merge_pipeline.py

OUTPUT: jobs_merged_YYYY-MM-DD.json + jobs_latest.json (consumed by artifact)
"""

import json, os, sys
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
OUTPUT_DIR = SCRIPT_DIR / "output"

ITAR_KEYWORDS = [
    "security clearance", "us person", "itar", "export controlled",
    "classified", "us citizen or permanent resident",
    "must be authorized to work without sponsorship",
    "u.s. citizen", "u.s. national", "permanent resident only",
]

def load_json(path):
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return {"jobs": []}

def main():
    jsearch = load_json(OUTPUT_DIR / "jobs_jsearch_latest.json")
    apify = load_json(OUTPUT_DIR / "jobs_apify_latest.json")

    all_jobs = jsearch.get("jobs", []) + apify.get("jobs", [])

    # Deduplicate by (company, normalized_title, location)
    def norm_title(t):
        return t.lower().strip().replace("  ", " ")

    seen = set()
    unique = []
    for j in all_jobs:
        key = (j["company"].lower(), norm_title(j["role"]), j.get("location", "").lower())
        if key not in seen:
            seen.add(key)
            unique.append(j)

    # Sort: GREEN > YELLOW > RED, then by match score desc
    vord = {"GREEN": 0, "YELLOW": 1, "RED": 2}
    unique.sort(key=lambda j: (vord.get(j.get("verdict", "YELLOW"), 9), -j.get("match", 0)))

    today = datetime.now().strftime("%Y-%m-%d")
    output = {
        "generated_utc": datetime.utcnow().isoformat() + "Z",
        "sources": {
            "jsearch": len(jsearch.get("jobs", [])),
            "apify": len(apify.get("jobs", [])),
            "merged_unique": len(unique),
            "duplicates_removed": len(all_jobs) - len(unique),
        },
        "summary": {
            "total": len(unique),
            "green": sum(1 for j in unique if j.get("verdict") == "GREEN"),
            "yellow": sum(1 for j in unique if j.get("verdict") == "YELLOW"),
            "red_itar": sum(1 for j in unique if j.get("verdict") == "RED"),
            "tier1": sum(1 for j in unique if j.get("tier") == "Tier 1"),
            "tier2": sum(1 for j in unique if j.get("tier") == "Tier 2"),
            "h1b_yes": sum(1 for j in unique if j.get("h1b") == "YES"),
        },
        "jobs": unique,
    }

    out_file = OUTPUT_DIR / f"jobs_merged_{today}.json"
    with open(out_file, "w") as f:
        json.dump(output, f, indent=2)

    latest = OUTPUT_DIR / "jobs_latest.json"
    with open(latest, "w") as f:
        json.dump(output, f, indent=2)

    print(f"Merged: {output['sources']}")
    print(f"Summary: {output['summary']}")
    print(f"Saved: {out_file}")

if __name__ == "__main__":
    main()
