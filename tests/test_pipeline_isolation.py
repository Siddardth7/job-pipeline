"""Tests for pipeline isolation — stale contamination prevention."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


def test_load_sources_rejects_intermediate_file(tmp_path):
    """merge_pipeline must NOT load jobs_clean_intermediate.json as a source."""
    # Write a fake intermediate file that looks like stale output
    intermediate = tmp_path / "jobs_clean_intermediate.json"
    intermediate.write_text(json.dumps({"source": "intermediate", "jobs": [
        {"job_title": "Stale Job", "company_name": "OldCo", "job_url": "https://example.com/1"}
    ]}))
    # Write one real scraper file
    ats = tmp_path / "jobs_ats.json"
    ats.write_text(json.dumps({"source": "ats_greenhouse", "jobs": [
        {"job_title": "Real Job", "company_name": "RealCo", "job_url": "https://example.com/2"}
    ]}))

    from pipeline.merge_pipeline import _load_whitelisted_sources
    jobs, counts = _load_whitelisted_sources(tmp_path)
    titles = [j["job_title"] for j in jobs]
    assert "Stale Job" not in titles
    assert "Real Job" in titles


def test_load_sources_rejects_theirstack_file(tmp_path):
    """merge_pipeline must NOT load jobs_theirstack.json."""
    ts = tmp_path / "jobs_theirstack.json"
    ts.write_text(json.dumps({"source": "theirstack", "jobs": [
        {"job_title": "TheirStack Job", "company_name": "TSCo", "job_url": "https://ts.com/1"}
    ]}))
    from pipeline.merge_pipeline import _load_whitelisted_sources
    jobs, counts = _load_whitelisted_sources(tmp_path)
    assert not any(j["job_title"] == "TheirStack Job" for j in jobs)


def test_normalize_carries_h1b_and_ats_tier(tmp_path):
    """_normalize must carry h1b and ats_tier fields."""
    from pipeline.merge_pipeline import _normalize
    job = {
        "job_title": "Manufacturing Engineer",
        "company_name": "Acme",
        "job_url": "https://boards.greenhouse.io/acme/jobs/1",
        "location": "Austin, TX",
        "posted_date": "2026-04-03",
        "description": "Full long description here",
        "source": "ats_greenhouse",
        "cluster": "manufacturing",
        "itar_flag": False,
        "itar_detail": "",
        "h1b": "YES",
        "ats_tier": "tier1",
        "raw_id": "gh-12345",
    }
    result = _normalize(job)
    assert result is not None
    assert result["h1b"] == "YES"
    assert result["ats_tier"] == "tier1"
    assert result["raw_id"] == "gh-12345"


def test_normalize_stable_id_prefers_raw_id(tmp_path):
    """Stable ID should be source:raw_id when raw_id exists."""
    from pipeline.merge_pipeline import _normalize
    job = {
        "job_title": "Process Engineer",
        "company_name": "Acme",
        "job_url": "https://boards.greenhouse.io/acme/jobs/99",
        "source": "ats_greenhouse",
        "raw_id": "99",
    }
    result = _normalize(job)
    assert result["stable_id"] == "ats_greenhouse:99"


def test_itar_reject_reason_catches_title():
    """F8 must reject jobs with ITAR keywords in the title, not just description."""
    from pipeline.merge_pipeline import _itar_reject_reason
    job = {
        "job_title": "Manufacturing Engineer with Security Clearance",
        "company_name": "PlanIT Group LLC",
        "itar_flag": False,
        "itar_detail": "",
        "description": "You will work on manufacturing processes.",
    }
    reason = _itar_reject_reason(job)
    assert reason is not None, "Should reject title containing 'security clearance'"


def test_itar_reject_reason_clean_job_passes():
    from pipeline.merge_pipeline import _itar_reject_reason
    job = {
        "job_title": "Manufacturing Engineer",
        "company_name": "Joby Aviation",
        "itar_flag": False,
        "itar_detail": "",
        "description": "Work on composite manufacturing processes.",
    }
    assert _itar_reject_reason(job) is None


def test_dedupe_prefers_ats_over_aggregator():
    """When the same job appears in ATS and an aggregator, keep the ATS record."""
    from pipeline.merge_pipeline import _filter_duplicates_priority

    jobs = [
        {
            "job_title": "Manufacturing Engineer",
            "company_name": "Joby Aviation",
            "job_url": "https://adzuna.com/land/ad/12345",
            "location": "Santa Cruz, CA",
            "posted_date": "2026-04-03",
            "description": "...",
            "source": "adzuna",
            "cluster": "manufacturing",
            "itar_flag": False,
            "itar_detail": "",
            "relevance_score": 0,
            "boost_tags": [],
            "raw_id": "az-12345",
            "ats_tier": "",
            "h1b": "",
            "salary": "",
            "stable_id": "adzuna:az-12345",
            "date_confidence": "actual",
        },
        {
            "job_title": "Manufacturing Engineer",
            "company_name": "Joby Aviation",
            "job_url": "https://boards.greenhouse.io/joby/jobs/999",
            "location": "Santa Cruz, CA",
            "posted_date": "2026-04-03",
            "description": "...",
            "source": "ats_greenhouse",
            "cluster": "manufacturing",
            "itar_flag": False,
            "itar_detail": "",
            "relevance_score": 0,
            "boost_tags": [],
            "raw_id": "999",
            "ats_tier": "tier1",
            "h1b": "YES",
            "salary": "",
            "stable_id": "ats_greenhouse:999",
            "date_confidence": "actual",
        },
    ]

    passed, rejected = _filter_duplicates_priority(jobs)
    assert len(passed) == 1
    assert len(rejected) == 1
    assert passed[0]["source"] == "ats_greenhouse"
    assert passed[0]["job_url"] == "https://boards.greenhouse.io/joby/jobs/999"


def test_f4_drops_unknown_date_non_ats():
    """Non-ATS jobs with date_confidence=unknown must be dropped by F4."""
    from pipeline.merge_pipeline import _filter_age
    from datetime import datetime, timedelta

    cutoff = datetime.utcnow() - timedelta(hours=72)
    jobs = [
        {
            "job_title": "Process Engineer",
            "company_name": "SomeCo",
            "job_url": "https://example.com/job1",
            "posted_date": "",
            "date_confidence": "unknown",
            "source": "adzuna",
        },
        {
            "job_title": "Process Engineer",
            "company_name": "SomeCo",
            "job_url": "https://example.com/job2",
            "posted_date": "",
            "date_confidence": "unknown",
            "source": "ats_lever",  # Lever exception — ATS = accept unknown
        },
    ]
    passed, rejected = _filter_age(jobs)
    assert len(passed) == 1
    assert passed[0]["source"] == "ats_lever"
    assert rejected == 1


def test_f3_rejects_adzuna_land_url():
    from pipeline.merge_pipeline import _filter_aggregators
    jobs = [{
        "job_title": "Manufacturing Engineer",
        "company_name": "Acme",
        "job_url": "https://www.adzuna.com/land/ad/4701290876",
        "location": "Austin, TX",
        "posted_date": "2026-04-03",
        "description": "",
        "source": "adzuna",
        "cluster": "manufacturing",
        "itar_flag": False, "itar_detail": "",
        "relevance_score": 0, "boost_tags": [],
        "raw_id": "", "ats_tier": "", "h1b": "", "salary": "",
        "stable_id": "x", "date_confidence": "actual", "location_confidence": "known",
    }]
    passed, rejected = _filter_aggregators(jobs)
    assert len(passed) == 0
    assert rejected == 1


def test_f3_rejects_appcast_redirect():
    from pipeline.merge_pipeline import _filter_aggregators
    jobs = [{
        "job_title": "Process Engineer",
        "company_name": "SomeCo",
        "job_url": "https://click.appcast.io/track/xyz?jobId=123",
        "location": "Austin, TX",
        "posted_date": "2026-04-03",
        "description": "",
        "source": "serpapi",
        "cluster": "process",
        "itar_flag": False, "itar_detail": "",
        "relevance_score": 0, "boost_tags": [],
        "raw_id": "", "ats_tier": "", "h1b": "", "salary": "",
        "stable_id": "y", "date_confidence": "actual", "location_confidence": "known",
    }]
    passed, rejected = _filter_aggregators(jobs)
    assert len(passed) == 0
    assert rejected == 1
