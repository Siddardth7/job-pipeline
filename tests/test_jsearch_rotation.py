"""Tests for JSearch key rotation logic."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import importlib
import scrapers.jsearch_scraper as mod


def _reload(monkeypatch, value):
    monkeypatch.setenv("JSEARCH_API_KEYS", value)
    monkeypatch.delenv("JSEARCH_API_KEY", raising=False)
    importlib.reload(mod)
    return mod


def test_single_key_parsed(monkeypatch):
    m = _reload(monkeypatch, "key_aaa")
    assert m.JSEARCH_API_KEYS == ["key_aaa"]


def test_three_keys_parsed(monkeypatch):
    m = _reload(monkeypatch, "key_aaa,key_bbb,key_ccc")
    assert m.JSEARCH_API_KEYS == ["key_aaa", "key_bbb", "key_ccc"]


def test_old_jsearch_api_key_fallback(monkeypatch):
    monkeypatch.delenv("JSEARCH_API_KEYS", raising=False)
    monkeypatch.setenv("JSEARCH_API_KEY", "legacy_key")
    importlib.reload(mod)
    assert mod.JSEARCH_API_KEYS == ["legacy_key"]


def test_empty_env_gives_empty_list(monkeypatch):
    monkeypatch.delenv("JSEARCH_API_KEYS", raising=False)
    monkeypatch.delenv("JSEARCH_API_KEY", raising=False)
    importlib.reload(mod)
    assert mod.JSEARCH_API_KEYS == []


def test_run_skips_if_no_keys(monkeypatch):
    monkeypatch.delenv("JSEARCH_API_KEYS", raising=False)
    monkeypatch.delenv("JSEARCH_API_KEY", raising=False)
    importlib.reload(mod)
    scraper = mod.JSearchScraper()
    assert scraper.run() == []
