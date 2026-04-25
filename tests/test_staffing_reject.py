"""Test that staffing_reject companies are hard-dropped before scoring."""
import json
from pathlib import Path
from unittest.mock import patch


def test_staffing_reject_loaded():
    """STAFFING_REJECT constant should be a non-empty set."""
    from pipeline.company_intelligence import STAFFING_REJECT
    assert isinstance(STAFFING_REJECT, (set, list, frozenset))
    assert len(STAFFING_REJECT) > 0
    assert "Actalent" in STAFFING_REJECT


def test_staffing_company_is_dropped():
    """A job from a staffing_reject company must be hard-dropped."""
    from pipeline.company_intelligence import _classify_job
    job = {
        "job_title": "Quality Engineer",
        "company_name": "Actalent",
        "job_url": "https://actalent.com/jobs/123",
        "location": "Austin, TX",
        "source": "jsearch",
        "red_flags": [],
    }
    result = _classify_job(job, {})
    assert result is None, f"Expected None (hard-drop) for Actalent, got {result}"
