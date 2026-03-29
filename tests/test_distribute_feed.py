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


def test_empty_job_field_passes_through():
    applied = {("acme corp", "austin, tx", "software engineer")}
    job = {"company_name": "Acme Corp", "location": "", "job_title": "Software Engineer"}
    assert is_applied(job, applied) is False


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
