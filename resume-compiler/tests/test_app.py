import os
os.environ["FLASK_TESTING"] = "1"  # prevent startup validation during test import

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app import sanitize_latex, inject_placeholders, app

# ──────────────────────────────────────────────
# sanitize_latex tests
# ──────────────────────────────────────────────

def test_sanitize_ampersand():
    assert sanitize_latex("R&D") == r"R\&D"

def test_sanitize_percent():
    assert sanitize_latex("50% reduction") == r"50\% reduction"

def test_sanitize_dollar():
    assert sanitize_latex("$100k salary") == r"\$100k salary"

def test_sanitize_underscore():
    assert sanitize_latex("first_name") == r"first\_name"

def test_sanitize_hash():
    assert sanitize_latex("#1 ranked") == r"\#1 ranked"

def test_sanitize_plain_text_unchanged():
    result = sanitize_latex("Process engineer with 3 years experience")
    assert result == "Process engineer with 3 years experience"

def test_sanitize_backslash_becomes_textbackslash():
    # Single-pass regex: backslash becomes \textbackslash{} — braces NOT re-escaped
    result = sanitize_latex("path\\to\\file")
    assert result == r"path\textbackslash{}to\textbackslash{}file"

# ──────────────────────────────────────────────
# inject_placeholders tests
# ──────────────────────────────────────────────

def test_inject_summary():
    base = r"Some text \textbf{%%SUMMARY%%} more text"
    result = inject_placeholders(
        base,
        summary="Great engineer",
        skills_latex=""
    )
    assert "Great engineer" in result
    assert "%%SUMMARY%%" not in result

def test_inject_skills_block():
    base = (
        "before\n"
        "%%SKILLS_BLOCK_START%%\n"
        r"\skillline{Old:}{old skills}" + "\n"
        "%%SKILLS_BLOCK_END%%\n"
        "after"
    )
    new_skills = r"\skillline{New:}{new skills}"
    result = inject_placeholders(base, summary="x", skills_latex=new_skills)
    assert r"\skillline{New:}{new skills}" in result
    assert r"\skillline{Old:}{old skills}" not in result
    assert "%%SKILLS_BLOCK_START%%" not in result
    assert "%%SKILLS_BLOCK_END%%" not in result

def test_inject_preserves_rest_of_template():
    base = (
        r"\documentclass{article}" + "\n"
        r"\begin{document}" + "\n"
        r"\textbf{%%SUMMARY%%}" + "\n"
        "%%SKILLS_BLOCK_START%%\n"
        "old\n"
        "%%SKILLS_BLOCK_END%%\n"
        r"\end{document}"
    )
    result = inject_placeholders(base, summary="s", skills_latex="new")
    assert r"\documentclass{article}" in result
    assert r"\begin{document}" in result
    assert r"\end{document}" in result

# ──────────────────────────────────────────────
# Flask endpoint tests (no pdflatex needed)
# ──────────────────────────────────────────────

import pytest

@pytest.fixture
def client():
    app.config['TESTING'] = True
    with app.test_client() as c:
        yield c

def test_health_endpoint(client):
    response = client.get('/health')
    assert response.status_code == 200
    assert response.data == b'ok'

def test_generate_missing_variant(client):
    response = client.post('/generate', json={
        'summary': 'test',
        'skills_latex': r'\skillline{X:}{y}'
    })
    assert response.status_code == 400

def test_generate_invalid_variant(client):
    response = client.post('/generate', json={
        'variant': 'Z',
        'summary': 'test',
        'skills_latex': r'\skillline{X:}{y}'
    })
    assert response.status_code == 400

def test_generate_missing_summary(client):
    response = client.post('/generate', json={
        'variant': 'A',
        'skills_latex': r'\skillline{X:}{y}'
    })
    assert response.status_code == 400

def test_generate_missing_skills(client):
    response = client.post('/generate', json={
        'variant': 'A',
        'summary': 'test summary',
    })
    assert response.status_code == 400

def test_cover_letter_missing_company(client):
    response = client.post('/generate-cover-letter', json={
        'role': 'Engineer',
        'variant_focus': 'Process & CI',
        'summary': 'test'
    })
    assert response.status_code == 400

def test_cover_letter_missing_role(client):
    response = client.post('/generate-cover-letter', json={
        'company': 'Acme',
        'variant_focus': 'Process & CI',
        'summary': 'test'
    })
    assert response.status_code == 400
