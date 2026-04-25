"""Tests for Apify location normalization."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))


def test_location_from_dict_with_city_country():
    from scrapers.apify_scraper import _extract_location
    raw = {"city": "Austin", "country": "United States"}
    assert _extract_location(raw) == "Austin, United States"


def test_location_from_string():
    from scrapers.apify_scraper import _extract_location
    assert _extract_location("San Jose, CA") == "San Jose, CA"


def test_location_from_none_returns_unknown():
    from scrapers.apify_scraper import _extract_location
    assert _extract_location(None) == "Unknown"


def test_location_from_empty_dict_returns_unknown():
    from scrapers.apify_scraper import _extract_location
    assert _extract_location({}) == "Unknown"


def test_location_from_dict_with_only_country():
    from scrapers.apify_scraper import _extract_location
    raw = {"city": "", "country": "United States"}
    assert _extract_location(raw) == "United States"


def test_location_from_harvestapi_name_key():
    """harvestapi actor returns location as {"name": "Austin, TX, United States"}."""
    from scrapers.apify_scraper import _extract_location
    raw = {"name": "Austin, TX, United States"}
    assert _extract_location(raw) == "Austin, TX, United States"


def test_location_from_dict_city_takes_precedence_over_name():
    """Structured city/state/country wins over name key when both present."""
    from scrapers.apify_scraper import _extract_location
    raw = {"city": "Austin", "state": "TX", "name": "Austin, TX, United States"}
    assert _extract_location(raw) == "Austin, TX"
