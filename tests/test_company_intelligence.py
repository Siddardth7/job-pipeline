"""Tests for company intelligence — no auto-promotion, metadata passthrough."""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))


def test_recruiter_not_auto_promoted(tmp_path):
    """A company appearing 5 times in the feed must NOT be auto-promoted to GREEN."""
    from pipeline.company_intelligence import _check_promotions
    db = {
        "green": [],
        "promotion_tracking": {
            "Motion Recruitment": ["2026-04-01", "2026-04-01", "2026-04-01", "2026-04-02", "2026-04-03"]
        },
        "reject_keywords": ["recruitment", "staffing", "recruiting"],
        "rejected_companies": [],
        "industry_keywords": [],
    }
    promoted = _check_promotions(db)
    assert promoted == [], f"Expected no promotions, got {promoted}"
    assert not any(e["name"] == "Motion Recruitment" for e in db["green"])


def test_h1b_field_passes_through_to_output():
    """Jobs with h1b=YES must have that field in the company_intelligence output."""
    from pipeline.company_intelligence import _classify
    db = {
        "green": [{"name": "Joby Aviation", "domain": "", "industry": "Aerospace"}],
        "reject_keywords": [],
        "rejected_companies": [],
        "industry_keywords": ["manufacturing"],
    }
    verdict = _classify("Joby Aviation", "manufacturing", db)
    assert verdict == "GREEN"
    # The field passthrough is in _write_output — verified via integration below


def test_tier_field_preserved_in_output(tmp_path):
    """ats_tier must appear in output/jobs_clean_latest.json after a run."""
    # Build a minimal intermediate file with ats_tier set
    intermediate = {
        "generated_utc": "2026-04-03T00:00:00Z",
        "stats": {},
        "jobs": [{
            "job_title": "Manufacturing Engineer",
            "company_name": "Joby Aviation",
            "job_url": "https://boards.greenhouse.io/joby/jobs/1",
            "location": "Santa Cruz, CA",
            "posted_date": "2026-04-03",
            "date_confidence": "actual",
            "description": "composite manufacturing processes",
            "source": "ats_greenhouse",
            "cluster": "manufacturing",
            "itar_flag": False,
            "itar_detail": "",
            "relevance_score": 70,
            "boost_tags": [],
            "raw_id": "1",
            "ats_tier": "tier1",
            "h1b": "YES",
            "salary": "",
            "stable_id": "ats_greenhouse:1",
            "location_confidence": "known",
        }]
    }
    (tmp_path / "jobs_clean_intermediate.json").write_text(json.dumps(intermediate))

    import pipeline.company_intelligence as ci
    # Patch paths to use tmp_path
    orig_intermediate = ci.INTERMEDIATE_PATH
    orig_output = ci.FINAL_OUTPUT_PATH
    orig_db = ci.COMPANY_DB_PATH

    ci.INTERMEDIATE_PATH = tmp_path / "jobs_clean_intermediate.json"
    ci.FINAL_OUTPUT_PATH = tmp_path / "jobs_clean_latest.json"
    ci.COMPANY_DB_PATH = Path(__file__).parent.parent / "data" / "company_database.json"

    try:
        ci.run()
        output = json.loads((tmp_path / "jobs_clean_latest.json").read_text())
        all_jobs = output.get("green_jobs", []) + output.get("yellow_jobs", [])
        assert len(all_jobs) == 1
        assert all_jobs[0]["ats_tier"] == "tier1"
        assert all_jobs[0]["h1b"] == "YES"
    finally:
        ci.INTERMEDIATE_PATH = orig_intermediate
        ci.FINAL_OUTPUT_PATH = orig_output
        ci.COMPANY_DB_PATH = orig_db
