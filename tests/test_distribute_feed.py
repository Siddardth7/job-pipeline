"""Tests for distribute_feed applied-list triple-match filter."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from pipeline.distribute_feed import build_applied_set, is_applied


def test_exact_match_is_filtered():
    applied = {("acme corp", "austin, tx", "software engineer")}
    job = {"company_name": "Acme Corp", "location": "Austin, TX", "job_title": "Software Engineer"}
    assert is_applied(job, applied) is True


def test_partial_match_two_of_three_passes():
    applied = {("acme corp", "austin, tx", "software engineer")}
    job = {"company_name": "Acme Corp", "location": "Austin, TX", "job_title": "Senior Engineer"}
    assert is_applied(job, applied) is False


def test_empty_job_location_matches_via_two_field_fallback():
    """Feed job with empty location should be filtered when company+title match an applied entry."""
    applied = {("acme corp", "austin, tx", "software engineer")}
    job = {"company_name": "Acme Corp", "location": "", "job_title": "Software Engineer"}
    assert is_applied(job, applied) is True


def test_empty_applied_set_passes_all():
    applied = set()
    job = {"company_name": "Acme Corp", "location": "Austin, TX", "job_title": "Software Engineer"}
    assert is_applied(job, applied) is False


def test_build_applied_set_normalizes():
    rows = [{"company": "  Acme Corp  ", "location": "Austin, TX", "role": "Software ENGINEER"}]
    result = build_applied_set(rows)
    assert ("acme corp", "austin, tx", "software engineer") in result


def test_build_applied_set_empty_input():
    assert build_applied_set([]) == set()


def test_chunk_list_splits_correctly():
    """_chunk should split a list into batches of given size."""
    from pipeline.batch_upsert import chunk
    lst = list(range(250))
    batches = list(chunk(lst, 100))
    assert len(batches) == 3
    assert len(batches[0]) == 100
    assert len(batches[1]) == 100
    assert len(batches[2]) == 50


def test_chunk_empty_list():
    from pipeline.batch_upsert import chunk
    assert list(chunk([], 100)) == []


def test_feed_job_no_location_matches_applied_with_location():
    """Job distributed with empty location should still be filtered if user applied."""
    applied = build_applied_set([{"company": "Acme Corp", "location": "Austin, TX", "role": "Software Engineer"}])
    job = {"company_name": "Acme Corp", "location": "", "job_title": "Software Engineer"}
    assert is_applied(job, applied) is True


def test_applied_no_location_matches_feed_job_with_location():
    """User applied with no location field — feed job with location should still be filtered."""
    applied = build_applied_set([{"company": "Acme Corp", "location": "", "role": "Software Engineer"}])
    job = {"company_name": "Acme Corp", "location": "Austin, TX", "job_title": "Software Engineer"}
    assert is_applied(job, applied) is True


def test_both_locations_present_different_not_filtered():
    """Two jobs at same company with different explicit locations are NOT duplicates."""
    applied = build_applied_set([{"company": "Acme Corp", "location": "New York, NY", "role": "Software Engineer"}])
    job = {"company_name": "Acme Corp", "location": "Austin, TX", "job_title": "Software Engineer"}
    assert is_applied(job, applied) is False


def test_existing_empty_location_behavior_unchanged():
    """Both location fields empty — company+title only match works."""
    applied = build_applied_set([{"company": "Acme Corp", "location": "", "role": "Software Engineer"}])
    job = {"company_name": "Acme Corp", "location": "", "job_title": "Software Engineer"}
    assert is_applied(job, applied) is True
