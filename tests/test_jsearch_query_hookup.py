"""Test that JSearchScraper uses queries from caller, not TITLE_QUERIES."""
import pytest
from scrapers.jsearch_scraper import JSearchScraper

def test_no_title_queries_constant():
    """TITLE_QUERIES should no longer exist after the fix."""
    assert not hasattr(JSearchScraper, "TITLE_QUERIES"), (
        "TITLE_QUERIES hardcode still present — not removed yet"
    )

def test_monthly_limit_is_180():
    """MONTHLY_LIMIT must be 180 (200 free tier - 20 buffer)."""
    assert JSearchScraper.MONTHLY_LIMIT == 180
