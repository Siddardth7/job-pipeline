"""Test USA Jobs scraper structure and output normalization."""
import pytest
from unittest.mock import patch, MagicMock
from scrapers.usajobs_scraper import USAJobsScraper, _normalize_job

SAMPLE_JOB = {
    "MatchedObjectId": "123456",
    "MatchedObjectDescriptor": {
        "PositionTitle": "Manufacturing Engineer",
        "OrganizationName": "NASA",
        "PositionLocationDisplay": "Huntsville, AL",
        "ApplyURI": ["https://www.usajobs.gov/job/123456"],
        "PublicationStartDate": "2026-04-23",
        "PositionEndDate": "2026-04-30",
        "PositionRemuneration": [{"MinimumRange": "70000", "MaximumRange": "90000", "RateIntervalCode": "PA"}],
        "JobCategory": [{"Name": "Engineering"}],
    }
}

def test_normalize_job_basic_fields():
    job = _normalize_job(SAMPLE_JOB, cluster="manufacturing")
    assert job["job_title"] == "Manufacturing Engineer"
    assert job["company_name"] == "NASA"
    assert job["location"] == "Huntsville, AL"
    assert job["source"] == "usajobs"
    assert job["employment_type"] == "Full-time"
    assert "usajobs.gov" in job["job_url"]

def test_normalize_job_cluster_tag():
    job = _normalize_job(SAMPLE_JOB, cluster="manufacturing")
    assert job["cluster"] == "manufacturing"

def test_scraper_run_returns_list():
    scraper = USAJobsScraper()
    with patch.object(scraper, "_search_cluster", return_value=[]):
        result = scraper.run(queries=[{"cluster": "manufacturing", "query": "Manufacturing Engineer"}])
        assert isinstance(result, list)

def test_scraper_deduplicates_by_url():
    scraper = USAJobsScraper()
    job = _normalize_job(SAMPLE_JOB, cluster="manufacturing")
    with patch.object(scraper, "_search_cluster", return_value=[job, job]):
        result = scraper.run(queries=[{"cluster": "manufacturing", "query": "Manufacturing Engineer"}])
        assert len(result) == 1
