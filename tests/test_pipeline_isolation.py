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
