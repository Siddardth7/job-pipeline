"""Tests for Adzuna key rotation logic."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import importlib
import scrapers.adzuna_scraper as mod


def _reload(monkeypatch, ids, keys):
    monkeypatch.setenv("ADZUNA_APP_IDS",  ids)
    monkeypatch.setenv("ADZUNA_APP_KEYS", keys)
    monkeypatch.delenv("ADZUNA_APP_ID",  raising=False)
    monkeypatch.delenv("ADZUNA_APP_KEY", raising=False)
    importlib.reload(mod)
    return mod


def test_single_pair_parsed(monkeypatch):
    m = _reload(monkeypatch, "id1", "key1")
    assert m.ADZUNA_PAIRS == [("id1", "key1")]


def test_three_pairs_parsed(monkeypatch):
    m = _reload(monkeypatch, "id1,id2,id3", "key1,key2,key3")
    assert m.ADZUNA_PAIRS == [("id1", "key1"), ("id2", "key2"), ("id3", "key3")]


def test_pairs_with_spaces_stripped(monkeypatch):
    m = _reload(monkeypatch, " id1 , id2 ", " key1 , key2 ")
    assert m.ADZUNA_PAIRS == [("id1", "key1"), ("id2", "key2")]


def test_old_single_env_vars_fallback(monkeypatch):
    monkeypatch.delenv("ADZUNA_APP_IDS",  raising=False)
    monkeypatch.delenv("ADZUNA_APP_KEYS", raising=False)
    monkeypatch.setenv("ADZUNA_APP_ID",  "legacy_id")
    monkeypatch.setenv("ADZUNA_APP_KEY", "legacy_key")
    importlib.reload(mod)
    assert mod.ADZUNA_PAIRS == [("legacy_id", "legacy_key")]


def test_empty_env_gives_empty_list(monkeypatch):
    monkeypatch.delenv("ADZUNA_APP_IDS",  raising=False)
    monkeypatch.delenv("ADZUNA_APP_KEYS", raising=False)
    monkeypatch.delenv("ADZUNA_APP_ID",  raising=False)
    monkeypatch.delenv("ADZUNA_APP_KEY", raising=False)
    importlib.reload(mod)
    assert mod.ADZUNA_PAIRS == []


def test_run_skips_if_no_pairs(monkeypatch):
    monkeypatch.delenv("ADZUNA_APP_IDS",  raising=False)
    monkeypatch.delenv("ADZUNA_APP_KEYS", raising=False)
    monkeypatch.delenv("ADZUNA_APP_ID",  raising=False)
    monkeypatch.delenv("ADZUNA_APP_KEY", raising=False)
    importlib.reload(mod)
    scraper = mod.AdzunaScraper()
    assert scraper.run([]) == []
