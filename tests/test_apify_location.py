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


def test_location_from_none_returns_empty():
    from scrapers.apify_scraper import _extract_location
    assert _extract_location(None) == ""


def test_location_from_empty_dict_returns_empty():
    from scrapers.apify_scraper import _extract_location
    assert _extract_location({}) == ""


def test_location_from_dict_with_only_country():
    from scrapers.apify_scraper import _extract_location
    raw = {"city": "", "country": "United States"}
    assert _extract_location(raw) == "United States"
