"""Tests for tightened F7 and new F10 (internship) and F11 (location) filters."""
import re
import pytest

# ── F7 ───────────────────────────────────────────────────────────────────────
def test_f7_does_not_match_generic_engineer_i():
    """'engineer i' alone should NOT match after tightening."""
    from pipeline.merge_pipeline import ROLE_RELEVANCE_TOKENS
    pattern = re.compile(
        "|".join(ROLE_RELEVANCE_TOKENS), re.IGNORECASE
    )
    assert not pattern.search("Launch Engineer I"), \
        "Generic 'engineer i' token should be removed from F7"

def test_f7_still_matches_manufacturing_engineer():
    from pipeline.merge_pipeline import ROLE_RELEVANCE_TOKENS
    pattern = re.compile("|".join(ROLE_RELEVANCE_TOKENS), re.IGNORECASE)
    assert pattern.search("Manufacturing Engineer II")

def test_f7_still_matches_quality_engineer():
    from pipeline.merge_pipeline import ROLE_RELEVANCE_TOKENS
    pattern = re.compile("|".join(ROLE_RELEVANCE_TOKENS), re.IGNORECASE)
    assert pattern.search("Quality Engineer entry level")

# ── F10 ──────────────────────────────────────────────────────────────────────
def test_f10_drops_internship():
    from pipeline.merge_pipeline import INTERNSHIP_PATTERN
    assert INTERNSHIP_PATTERN.search("Inlet Design & Build Engineering intern - (Fall 2026)")

def test_f10_drops_internship_word():
    from pipeline.merge_pipeline import INTERNSHIP_PATTERN
    assert INTERNSHIP_PATTERN.search("Manufacturing Engineering Internship")

def test_f10_drops_coop():
    from pipeline.merge_pipeline import INTERNSHIP_PATTERN
    assert INTERNSHIP_PATTERN.search("Process Engineer Co-op Spring 2026")

def test_f10_passes_regular_job():
    from pipeline.merge_pipeline import INTERNSHIP_PATTERN
    assert not INTERNSHIP_PATTERN.search("Manufacturing Engineer entry level")

# ── F11 ──────────────────────────────────────────────────────────────────────
def test_f11_drops_abu_dhabi():
    from pipeline.merge_pipeline import NON_US_LOCATION_PATTERN
    assert NON_US_LOCATION_PATTERN.search("Abu Dhabi")

def test_f11_drops_uk():
    from pipeline.merge_pipeline import NON_US_LOCATION_PATTERN
    assert NON_US_LOCATION_PATTERN.search("London, UK")

def test_f11_passes_blank_location():
    from pipeline.merge_pipeline import NON_US_LOCATION_PATTERN
    assert not NON_US_LOCATION_PATTERN.search("")

def test_f11_passes_unknown_location():
    from pipeline.merge_pipeline import NON_US_LOCATION_PATTERN
    assert not NON_US_LOCATION_PATTERN.search("Unknown")

def test_f11_passes_us_city():
    from pipeline.merge_pipeline import NON_US_LOCATION_PATTERN
    assert not NON_US_LOCATION_PATTERN.search("Austin, TX")

def test_f11_passes_huntsville_al():
    from pipeline.merge_pipeline import NON_US_LOCATION_PATTERN
    assert not NON_US_LOCATION_PATTERN.search("Huntsville, AL")
