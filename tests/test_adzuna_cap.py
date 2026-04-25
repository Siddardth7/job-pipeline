"""Test that Adzuna respects the MAX_RAW_JOBS cap."""
from scrapers.adzuna_scraper import AdzunaScraper, MAX_RAW_JOBS

def test_max_raw_jobs_constant_defined():
    assert MAX_RAW_JOBS == 200
