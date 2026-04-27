import pytest
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from parser import parse_tex

SAMPLE_TEX = r"""
\section{Skills}
  \textbf{Quality Engineering:} SPC, FMEA, 8D Root Cause Analysis, CMM Inspection
  \textbf{Manufacturing \& Tooling:} GD\&T, CNC Machining, Fixture Design

\section{Experience}
  \resumeSubheading{Tata Boeing Aerospace}{May 2024 -- Aug 2024}{Quality Engineering Intern}{Hyderabad, India}
  \resumeItemListStart
    \resumeItem{Audited 450+ flight-critical components to 0.02 mm accuracy.}
    \resumeItem{Reduced NCR cycle time by 22\%.}
  \resumeItemListEnd

\section{Education}
  \resumeSubheading{University of Illinois Urbana-Champaign}{Aug 2023 -- Dec 2025}{M.S. Aerospace Engineering}{Urbana, IL}

\section{Certifications}
  Six Sigma Green Belt (CSSC), Inspection \& Quality Control in Manufacturing
"""

def test_section_order():
    result = parse_tex(SAMPLE_TEX)
    assert result['section_order'] == ['skills', 'experience', 'education', 'certifications']

def test_skills_extracted():
    result = parse_tex(SAMPLE_TEX)
    assert len(result['skills']) == 2
    assert result['skills'][0]['category'] == 'Quality Engineering'
    assert 'SPC' in result['skills'][0]['items']
    assert 'Manufacturing & Tooling' in result['skills'][1]['category']

def test_experience_extracted():
    result = parse_tex(SAMPLE_TEX)
    assert len(result['experience']) == 1
    exp = result['experience'][0]
    assert exp['company'] == 'Tata Boeing Aerospace'
    assert exp['role'] == 'Quality Engineering Intern'
    assert len(exp['bullets']) == 2
    assert '450+' in exp['bullets'][0]

def test_education_extracted():
    result = parse_tex(SAMPLE_TEX)
    assert len(result['education']) == 1
    assert 'Illinois' in result['education'][0]['school']

def test_certifications_extracted():
    result = parse_tex(SAMPLE_TEX)
    assert 'Six Sigma Green Belt (CSSC)' in result['certifications']

def test_section_order_fallback_when_no_sections():
    result = parse_tex("no sections here at all")
    assert result['section_order'] == ['skills', 'experience', 'education']

def test_schema_version():
    result = parse_tex(SAMPLE_TEX)
    assert result['schema_version'] == 1

def test_no_500_on_empty_input():
    result = parse_tex("")
    assert 'parse_error' in result or result.get('schema_version') == 1

def test_latex_unescaping():
    result = parse_tex(SAMPLE_TEX)
    # \& should be unescaped to & in category names and items
    cats = [s['category'] for s in result['skills']]
    assert any('&' in c for c in cats)
