"""Tests for Apify key rotation logic."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import importlib
import scrapers.apify_scraper as mod


def _reload_with_env(monkeypatch, value):
    monkeypatch.setenv("APIFY_TOKENS", value)
    monkeypatch.delenv("APIFY_TOKEN", raising=False)
    importlib.reload(mod)
    return mod


def test_single_token_parsed(monkeypatch):
    m = _reload_with_env(monkeypatch, "tok_aaa")
    assert m.APIFY_TOKENS == ["tok_aaa"]


def test_three_tokens_parsed(monkeypatch):
    m = _reload_with_env(monkeypatch, "tok_aaa,tok_bbb,tok_ccc")
    assert m.APIFY_TOKENS == ["tok_aaa", "tok_bbb", "tok_ccc"]


def test_tokens_with_spaces_stripped(monkeypatch):
    m = _reload_with_env(monkeypatch, " tok_aaa , tok_bbb ")
    assert m.APIFY_TOKENS == ["tok_aaa", "tok_bbb"]


def test_old_apify_token_fallback(monkeypatch):
    monkeypatch.delenv("APIFY_TOKENS", raising=False)
    monkeypatch.setenv("APIFY_TOKEN", "legacy_tok")
    importlib.reload(mod)
    assert mod.APIFY_TOKENS == ["legacy_tok"]


def test_empty_env_gives_empty_list(monkeypatch):
    monkeypatch.delenv("APIFY_TOKENS", raising=False)
    monkeypatch.delenv("APIFY_TOKEN", raising=False)
    importlib.reload(mod)
    assert mod.APIFY_TOKENS == []


def test_is_apify_quota_error_detects_hard_limit():
    assert mod._is_apify_quota_error("Monthly usage hard limit exceeded")


def test_is_apify_quota_error_detects_402():
    assert mod._is_apify_quota_error("Error 402: payment required")


def test_is_apify_quota_error_ignores_network_error():
    assert not mod._is_apify_quota_error("Connection timeout")


def test_run_skips_if_no_tokens(monkeypatch):
    monkeypatch.delenv("APIFY_TOKENS", raising=False)
    monkeypatch.delenv("APIFY_TOKEN", raising=False)
    importlib.reload(mod)
    scraper = mod.ApifyScraper()
    assert scraper.run([]) == []
