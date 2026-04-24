"""Test Apify has full cluster coverage and returns Unknown for missing locations."""
from scrapers.apify_scraper import ApifyScraper, _extract_location

def test_industrial_operations_cluster_present():
    assert "industrial_operations" in ApifyScraper.CLUSTER_TO_TITLE

def test_mechanical_thermal_cluster_present():
    assert "mechanical_thermal" in ApifyScraper.CLUSTER_TO_TITLE

def test_extract_location_returns_unknown_for_none():
    assert _extract_location(None) == "Unknown"

def test_extract_location_returns_unknown_for_empty_string():
    assert _extract_location("") == "Unknown"

def test_extract_location_returns_unknown_for_empty_dict():
    assert _extract_location({}) == "Unknown"

def test_extract_location_returns_value_for_valid_string():
    assert _extract_location("Austin, TX") == "Austin, TX"

def test_extract_location_returns_value_for_dict_with_name():
    assert _extract_location({"name": "Austin, TX, United States"}) == "Austin, TX, United States"
