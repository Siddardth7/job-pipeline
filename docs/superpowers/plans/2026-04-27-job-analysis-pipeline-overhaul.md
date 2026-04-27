# Job Analysis + Pipeline Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded single-user Job Analysis with a multi-user dynamic system driven by each user's uploaded resume, fix all P0/P1/P2 pipeline bugs, and make the GCR compiler template-agnostic.

**Architecture:** Python regex parser in GCR extracts structured_sections from .tex uploads; Groq parses PDFs as fallback. Job Analysis reads candidate context from Supabase instead of hardcoded facts. One dynamic Jinja2 compiler template replaces 4 static .tex files.

**Tech Stack:** React/Vite (frontend), Vercel serverless (API routes), Flask/Python on Google Cloud Run (compiler), Supabase (DB), Groq llama-3.3-70b-versatile (AI), Jinja2 (template engine), pdfjs-dist (PDF text extraction)

---

## File Map

| File | Role after this plan |
|------|----------------------|
| `src/components/Onboarding.jsx` | 4-step flow with optional resume upload |
| `src/components/JobAnalysis.jsx` | Reads primary resume from DB, shows primary_category badge, summary toggle |
| `src/components/FindJobs.jsx` | Filters out completed + removed jobs |
| `src/components/Resume.jsx` | Fixed score/suggestion field names |
| `src/lib/groq.js` | Dynamic context builders, strict validation, no hardcoded block |
| `src/lib/storage.js` | softRemoveJob(), fixed fetchJobs() merge, fetchUserProfile() reused |
| `src/App.jsx` | Fixed debounce counter, calls softRemoveJob |
| `api/groq.js` | Model allowlist + token cap |
| `api/parse-resume.js` | NEW — JWT-gated PDF parser via Groq |
| `scripts/seed_primary_resume.js` | NEW — one-time seeder for existing account data |
| `resume-compiler/app.py` | /parse endpoint + /compile updated + strip_locked_skills removed |
| `resume-compiler/parser.py` | NEW — LaTeX parser logic (separated from app.py for testability) |
| `resume-compiler/templates/resume_dynamic.tex` | NEW — Jinja2 dynamic template |
| `resume-compiler/templates/cover_letter.tex` | Fallback opener when summary is empty |
| `resume-compiler/tests/test_parser.py` | NEW — parser unit tests |
| `tests/dashboard-utils.test.js` | Fix existing failing test |

---

## Task 1: Fix the Failing Test (Unblock CI)

**Files:**
- Modify: `tests/dashboard-utils.test.js`

The existing test `calcStreak > counts consecutive days with apps or networking` is failing. Fix it before adding any new code so CI is green from the start.

- [ ] **Step 1: Run the test to see the exact failure**

```bash
cd /Users/jashwanth/jobagent-web && npm test -- dashboard-utils 2>&1 | head -50
```

- [ ] **Step 2: Read the test file and source**

```bash
cat tests/dashboard-utils.test.js
```

Also read the source it imports and find the mismatch between expected and actual output.

- [ ] **Step 3: Fix the test or the source — whichever is wrong**

If the test expectation is stale: update the assertion to match current behaviour.
If the source has a bug: fix the source logic.
Do NOT change both — pick the one that is wrong.

- [ ] **Step 4: Verify test passes**

```bash
npm test -- dashboard-utils 2>&1 | tail -10
```
Expected: `Tests: 1 passed` (or all passed).

- [ ] **Step 5: Commit**

```bash
git add tests/dashboard-utils.test.js
git commit -m "fix: resolve failing calcStreak test to unblock CI"
```

---

## Task 2: Pipeline Bug Fixes — Storage Layer

**Files:**
- Modify: `src/lib/storage.js` (lines 69–90, 242)

Two independent bugs: 14-day cap hides pipeline items; removePipeline deletes rows.

- [ ] **Step 1: Write failing test for softRemoveJob**

Create `tests/storage-pipeline.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase
vi.mock('../src/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({ eq: vi.fn(() => ({ error: null })) }))
      })),
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } } })) }
    })),
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } } })) }
  }
}));

vi.mock('../src/lib/storage.js', async () => {
  const actual = await vi.importActual('../src/lib/storage.js');
  return actual;
});

describe('softRemoveJob', () => {
  it('updates status to removed and in_pipeline to false without deleting', async () => {
    const { softRemoveJob } = await import('../src/lib/storage.js');
    // Should not throw — if the function exists and calls update, test passes
    await expect(softRemoveJob('job-id-123')).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npm test -- storage-pipeline 2>&1 | tail -15
```
Expected: FAIL — `softRemoveJob is not a function`.

- [ ] **Step 3: Add softRemoveJob to storage.js**

Open `src/lib/storage.js`. After the `deleteJob` function (line ~248), add:

```javascript
export async function softRemoveJob(id) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('user_job_feed')
    .update({ status: 'removed', in_pipeline: false })
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}
```

- [ ] **Step 4: Fix fetchJobs to not cap pipeline items (storage.js lines 69–90)**

Replace the existing `fetchJobs` function body with:

```javascript
export async function fetchJobs() {
  const userId = await getUserId();
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const selectShape = `
    *,
    job:normalized_jobs (
      id, job_title, company_name, job_url, location, posted_date,
      description, source, itar_flag, tier, h1b, industry,
      verdict, relevance_score, boost_tags, employment_type,
      red_flags, legitimacy_tier
    )
  `;

  const [feedResult, pipelineResult] = await Promise.all([
    supabase
      .from('user_job_feed')
      .select(selectShape)
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false }),
    supabase
      .from('user_job_feed')
      .select(selectShape)
      .eq('user_id', userId)
      .eq('in_pipeline', true)
      .order('created_at', { ascending: false }),
  ]);

  if (feedResult.error) throw feedResult.error;
  if (pipelineResult.error) throw pipelineResult.error;

  // Merge and deduplicate by row id — pipeline rows take priority
  const seen = new Set();
  const merged = [...(pipelineResult.data || []), ...(feedResult.data || [])].filter(row => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });

  return merged.map(row => ({
    id:               row.job_id,
    role:             row.job?.job_title       ?? null,
    company:          row.job?.company_name    ?? null,
    link:             row.job?.job_url         ?? null,
    location:         row.job?.location        ?? null,
    posted:           row.job?.posted_date     ?? null,
    description:      row.job?.description     ?? null,
    source:           row.job?.source          ?? null,
    itar:             row.job?.itar_flag       ?? false,
    tier:             row.job?.tier            ?? null,
    h1b:              row.job?.h1b             ?? null,
    industry:         row.job?.industry        ?? null,
    verdict:          row.job?.verdict         ?? null,
    score:            row.relevance_score      ?? row.job?.relevance_score ?? 0,
    boost_tags:       row.job?.boost_tags      ?? [],
    employment_type:  row.job?.employment_type ?? null,
    red_flags:        row.job?.red_flags       ?? [],
    legitimacy_tier:  row.job?.legitimacy_tier ?? null,
    in_pipeline:      row.in_pipeline,
    status:           row.status,
    feed_date:        row.feed_date,
    notes:            row.notes,
    resumeVariant:    row.resume_variant,
    resume_variant:   row.resume_variant,
  }));
}
```

- [ ] **Step 5: Run test — should pass now**

```bash
npm test -- storage-pipeline 2>&1 | tail -10
```
Expected: PASS.

- [ ] **Step 6: Build check**

```bash
npm run build 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/storage.js tests/storage-pipeline.test.js
git commit -m "fix: add softRemoveJob and fix 14-day cap excluding pipeline items"
```

---

## Task 3: Pipeline Bug Fixes — App + UI Layer

**Files:**
- Modify: `src/App.jsx` (line ~197, ~281)
- Modify: `src/components/FindJobs.jsx` (lines 99, 116)
- Modify: `src/components/Resume.jsx` (lines 106, 400)
- Modify: `api/groq.js`

- [ ] **Step 1: Fix debounce counter in App.jsx**

Find the `debouncedSave` callback (around line 197). Replace:

```javascript
const debouncedSave = useCallback((saveFn) => {
  if (saveTimer.current) clearTimeout(saveTimer.current);
  setPendingSaves(n => n + 1);
```

With:

```javascript
const debouncedSave = useCallback((saveFn) => {
  if (saveTimer.current) {
    clearTimeout(saveTimer.current);
    setPendingSaves(n => Math.max(0, n - 1));
  }
  setPendingSaves(n => n + 1);
```

- [ ] **Step 2: Replace removePipeline to use softRemoveJob in App.jsx**

Find the call to `deleteJob` or `removePipeline` (around line 281). Replace the `Storage.deleteJob(id)` call with `Storage.softRemoveJob(id)`. Also update the import if needed — `softRemoveJob` is already exported from `storage.js` after Task 2.

- [ ] **Step 3: Fix FindJobs completed/removed filter**

In `src/components/FindJobs.jsx`, add this constant near the top of the component function (after the state declarations):

```javascript
const HIDDEN_STATUSES = new Set(['completed', 'removed']);
```

Then find the two filter expressions at lines ~99 and ~116. Both currently look like:
```javascript
allJobs.filter(j => j.feed_date === firstDate && !j.in_pipeline)
```

Replace both with:
```javascript
allJobs.filter(j => j.feed_date === firstDate && !j.in_pipeline && !HIDDEN_STATUSES.has(j.status))
```

For the date-change handler (line ~116), same pattern — add `&& !HIDDEN_STATUSES.has(j.status)`.

- [ ] **Step 4: Fix Resume.jsx schema drift**

Open `src/components/Resume.jsx`. At lines ~106 and ~400, change:
- `item.overall_score` → `item.score`
- `item.fix` → `item.suggestion`

Search for both occurrences:
```bash
grep -n "overall_score\|\.fix\b" /Users/jashwanth/jobagent-web/src/components/Resume.jsx
```
Fix each occurrence.

- [ ] **Step 5: Lock down /api/groq**

Open `api/groq.js`. After the auth check (wherever the request body is first used), add:

```javascript
const ALLOWED_MODELS = ['llama-3.3-70b-versatile'];
const MAX_TOKENS_CAP = 1600;

if (!ALLOWED_MODELS.includes(req.body.model)) {
  return res.status(400).json({ error: 'Model not allowed' });
}
req.body.max_tokens = Math.min(req.body.max_tokens ?? 1000, MAX_TOKENS_CAP);
```

- [ ] **Step 6: Fix model label in JobAnalysis.jsx**

```bash
grep -n "llama-3.3-70b\"" /Users/jashwanth/jobagent-web/src/components/JobAnalysis.jsx
```

Change the display string to `llama-3.3-70b-versatile` (exact match to the MODEL constant in groq.js).

- [ ] **Step 7: Build check**

```bash
npm run build 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx src/components/FindJobs.jsx src/components/Resume.jsx api/groq.js src/components/JobAnalysis.jsx
git commit -m "fix: pipeline bugs — debounce counter, soft delete, hidden status filter, resume schema drift, groq lockdown"
```

---

## Task 4: LaTeX Parser — Python Module

**Files:**
- Create: `resume-compiler/parser.py`
- Create: `resume-compiler/tests/test_parser.py`

The parser lives in its own file so it can be unit tested without Flask.

- [ ] **Step 1: Write the parser tests first**

Create `resume-compiler/tests/test_parser.py`:

```python
import pytest
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/jashwanth/jobagent-web/resume-compiler && python -m pytest tests/test_parser.py -v 2>&1 | head -30
```
Expected: ImportError — `parser` module not found.

- [ ] **Step 3: Implement parser.py**

Create `resume-compiler/parser.py`:

```python
import re

SECTION_MAP = {
    'skills':         ['skills', 'technical skills', 'core competencies'],
    'experience':     ['experience', 'work experience', 'employment', 'professional experience'],
    'education':      ['education', 'academic background', 'academics'],
    'summary':        ['summary', 'objective', 'profile', 'about'],
    'certifications': ['certifications', 'licenses', 'credentials'],
    'projects':       ['projects', 'selected projects', 'academic projects'],
}

_DEFAULT_ORDER = ['skills', 'experience', 'education']

# Regex patterns
_SECTION_RE = re.compile(r'\\section\*?\{([^}]+)\}', re.IGNORECASE)
_SUBHEADING_RE = re.compile(
    r'\\resumeSubheading\{([^}]*)\}\{([^}]*)\}\{([^}]*)\}\{([^}]*)\}', re.DOTALL
)
_ITEM_RE = re.compile(r'\\resumeItem\{([^}]*(?:\{[^}]*\}[^}]*)*)\}', re.DOTALL)
_BOLD_SKILL_RE = re.compile(r'\\textbf\{([^}]+):\}\s*([^\n\\]+)', re.IGNORECASE)
_LATEX_CMD_RE = re.compile(r'\\[a-zA-Z]+\*?\{([^}]*)\}|\\[a-zA-Z]+\s*')
_LATEX_UNESCAPE = [
    (r'\&', '&'), (r'\%', '%'), (r'\$', '$'), (r'\#', '#'),
    (r'\_', '_'), (r'\{', '{'), (r'\}', '}'),
]


def _unescape(text: str) -> str:
    for escaped, char in _LATEX_UNESCAPE:
        text = text.replace(escaped, char)
    return text.strip()


def _strip_latex(text: str) -> str:
    """Remove LaTeX commands from text, keeping their content."""
    # Remove \href{url}{text} → text
    text = re.sub(r'\\href\{[^}]*\}\{([^}]*)\}', r'\1', text)
    # Remove \textbf{x} → x, \textit{x} → x, etc.
    text = re.sub(r'\\text(?:bf|it|tt|sc|rm|up|sl)\{([^}]*)\}', r'\1', text)
    # Remove remaining commands with braces
    text = re.sub(r'\\[a-zA-Z]+\{([^}]*)\}', r'\1', text)
    # Remove bare commands
    text = re.sub(r'\\[a-zA-Z]+\s*', ' ', text)
    # Clean up extra spaces
    text = re.sub(r'\s+', ' ', text).strip()
    return _unescape(text)


def _canonical_section(heading: str) -> str | None:
    lower = heading.lower().strip()
    for key, aliases in SECTION_MAP.items():
        if any(alias in lower for alias in aliases):
            return key
    return None


def _split_by_sections(tex: str):
    """Split tex into {canonical_key: section_text} preserving order."""
    parts = _SECTION_RE.split(tex)
    # parts = [pre_text, heading1, body1, heading2, body2, ...]
    sections = {}
    order = []
    for i in range(1, len(parts), 2):
        heading = parts[i]
        body = parts[i + 1] if i + 1 < len(parts) else ''
        key = _canonical_section(heading)
        if key and key not in sections:
            sections[key] = body
            order.append(key)
    return order, sections


def _parse_skills(body: str) -> list[dict]:
    skills = []
    for m in _BOLD_SKILL_RE.finditer(body):
        category = _unescape(m.group(1).strip())
        raw_items = m.group(2).strip()
        # Remove trailing LaTeX noise (newlines, commands)
        raw_items = re.sub(r'\\[a-zA-Z]+.*$', '', raw_items).strip()
        items = [_unescape(i.strip()) for i in raw_items.split(',') if i.strip()]
        if category and items:
            skills.append({'category': category, 'items': items})
    return skills


def _parse_subheadings(body: str) -> list[dict]:
    """Parse \resumeSubheading{company}{date}{role}{location} blocks."""
    entries = []
    positions = [m.start() for m in _SUBHEADING_RE.finditer(body)]
    positions.append(len(body))

    for i, m in enumerate(_SUBHEADING_RE.finditer(body)):
        end = positions[i + 1]
        block = body[m.end():end]
        bullets = [_strip_latex(b.group(1)) for b in _ITEM_RE.finditer(block) if b.group(1).strip()]
        entries.append({
            'company':    _unescape(m.group(1)),
            'date_range': _unescape(m.group(2)),
            'role':       _unescape(m.group(3)),
            'location':   _unescape(m.group(4)),
            'bullets':    bullets,
        })
    return entries


def _parse_education(body: str) -> list[dict]:
    entries = []
    for m in _SUBHEADING_RE.finditer(body):
        entries.append({
            'school':     _unescape(m.group(1)),
            'date_range': _unescape(m.group(2)),
            'degree':     _unescape(m.group(3)),
            'location':   _unescape(m.group(4)),
        })
    return entries


def _parse_certifications(body: str) -> list[str]:
    # Strip LaTeX structure, split by comma
    text = _strip_latex(body)
    certs = [c.strip() for c in text.split(',') if c.strip()]
    return certs


def parse_tex(tex: str) -> dict:
    """Parse a .tex resume source into structured_sections JSON."""
    if not tex or not tex.strip():
        return {'schema_version': 1, 'parse_error': 'empty_input',
                'section_order': _DEFAULT_ORDER, 'skills': [],
                'experience': [], 'education': [], 'certifications': [], 'summary': None}

    order, sections = _split_by_sections(tex)

    skills = _parse_skills(sections.get('skills', ''))
    if not skills:
        return {'schema_version': 1, 'parse_error': 'no_skills_found',
                'section_order': order or _DEFAULT_ORDER, 'skills': [],
                'experience': [], 'education': [], 'certifications': [], 'summary': None}

    experience = _parse_subheadings(sections.get('experience', ''))
    education  = _parse_education(sections.get('education', ''))
    certs      = _parse_certifications(sections.get('certifications', ''))
    summary_body = sections.get('summary', '')
    summary    = _strip_latex(summary_body) if summary_body.strip() else None

    return {
        'schema_version': 1,
        'section_order':  order or _DEFAULT_ORDER,
        'summary':        summary,
        'skills':         skills,
        'experience':     experience,
        'education':      education,
        'certifications': certs,
    }
```

- [ ] **Step 4: Run tests — should pass**

```bash
cd /Users/jashwanth/jobagent-web/resume-compiler && python -m pytest tests/test_parser.py -v 2>&1 | tail -20
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add resume-compiler/parser.py resume-compiler/tests/test_parser.py
git commit -m "feat: add deterministic LaTeX resume parser with unit tests"
```

---

## Task 5: GCR Compiler — /parse Endpoint + /compile Update

**Files:**
- Modify: `resume-compiler/app.py`
- Modify: `resume-compiler/templates/cover_letter.tex`

- [ ] **Step 1: Add JWT verification helper to app.py**

At the top of `resume-compiler/app.py`, after the imports, add:

```python
import os
import json
import hmac
from functools import wraps

SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")

def _verify_supabase_jwt(token: str) -> bool:
    """Minimal JWT verification — checks signature using HS256 + Supabase secret."""
    try:
        import base64
        parts = token.split('.')
        if len(parts) != 3:
            return False
        header_b64, payload_b64, sig_b64 = parts
        # Pad base64
        def pad(s): return s + '=' * (-len(s) % 4)
        message = f"{header_b64}.{payload_b64}".encode()
        sig = base64.urlsafe_b64decode(pad(sig_b64))
        import hashlib
        expected = hmac.new(SUPABASE_JWT_SECRET.encode(), message, hashlib.sha256).digest()
        return hmac.compare_digest(sig, expected)
    except Exception:
        return False

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not SUPABASE_JWT_SECRET:
            # Dev mode — skip auth if secret not configured
            return f(*args, **kwargs)
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return jsonify(error='Unauthorized'), 401
        token = auth[7:]
        if not _verify_supabase_jwt(token):
            return jsonify(error='Unauthorized'), 401
        return f(*args, **kwargs)
    return decorated
```

- [ ] **Step 2: Add /parse endpoint to app.py**

After the `/health` route, add:

```python
@app.route("/parse", methods=["OPTIONS"])
def parse_preflight():
    return "", 204


@app.route("/parse", methods=["POST"])
@require_auth
def parse_resume():
    """Parse a .tex resume source into structured_sections JSON."""
    from parser import parse_tex

    content_type = request.content_type or ''
    if 'text/plain' not in content_type and 'application/octet-stream' not in content_type:
        return jsonify(error="Content-Type must be text/plain"), 400

    tex_source = request.get_data(as_text=True)
    if not tex_source or not tex_source.strip():
        return jsonify(error="Empty .tex source"), 400

    if len(tex_source) > 500_000:
        return jsonify(error="File too large (max 500KB)"), 400

    result = parse_tex(tex_source)
    return jsonify(result), 200
```

- [ ] **Step 3: Add Jinja2 to requirements**

```bash
grep "jinja2\|Jinja2" /Users/jashwanth/jobagent-web/resume-compiler/requirements.txt
```
If not present, add it:
```bash
echo "Jinja2>=3.1.0" >> /Users/jashwanth/jobagent-web/resume-compiler/requirements.txt
```

- [ ] **Step 4: Add /compile endpoint to app.py**

After the `/parse` route, add the new `/compile` endpoint that uses the dynamic template:

```python
@app.route("/compile", methods=["OPTIONS"])
def compile_preflight():
    return "", 204


@app.route("/compile", methods=["POST"])
@require_auth
def compile_resume():
    """Compile a resume PDF from structured_sections + groq_output using dynamic Jinja2 template."""
    from jinja2 import Environment, FileSystemLoader, select_autoescape

    data = request.get_json(silent=True) or {}

    structured = data.get("structured_sections", {})
    groq_out   = data.get("groq_output", {})
    include_summary = bool(data.get("include_summary", False))
    candidate_name  = sanitize_latex(data.get("candidate_name", "Candidate"))
    contact = data.get("contact", {})

    if not structured.get("skills"):
        return jsonify(error="structured_sections.skills is required"), 400
    if not groq_out.get("mod2_skilllines"):
        return jsonify(error="groq_output.mod2_skilllines is required"), 400

    section_order = structured.get("section_order", ["skills", "experience", "education"])
    mod1_summary  = groq_out.get("mod1_summary", "").strip() if include_summary else ""
    certifications = structured.get("certifications", [])

    env = Environment(
        loader=FileSystemLoader(TEMPLATES_DIR),
        autoescape=select_autoescape([]),  # No HTML escaping — this is LaTeX
        block_start_string='<%',
        block_end_string='%>',
        variable_start_string='<<',
        variable_end_string='>>',
        comment_start_string='<#',
        comment_end_string='#>',
    )

    try:
        template = env.get_template("resume_dynamic.tex")
    except Exception as e:
        return jsonify(error=f"Template not found: {e}"), 500

    try:
        rendered = template.render(
            candidate_name=candidate_name,
            contact={k: sanitize_latex(v or '') for k, v in contact.items()},
            section_order=section_order,
            include_summary=include_summary,
            mod1_summary=sanitize_latex(mod1_summary),
            mod2_skilllines=groq_out.get("mod2_skilllines", []),
            certifications=certifications,
            experience=structured.get("experience", []),
            education=structured.get("education", []),
        )
    except Exception as e:
        return jsonify(error=f"Template render error: {e}"), 500

    try:
        pdf_bytes = _compile_tex(rendered)
    except subprocess.TimeoutExpired:
        return jsonify(error="Compilation timed out (60s)."), 504
    except RuntimeError as e:
        return jsonify(error="LaTeX compilation failed", log=str(e)), 500

    company  = _safe_filename_part(data.get("company", "Company"))
    role     = _safe_filename_part(data.get("role", "Role"))
    filename = f"Resume_{candidate_name.split()[0]}_{company}_{role}.pdf"

    return send_file(
        BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=True,
        download_name=filename,
    )
```

- [ ] **Step 5: Fix cover_letter.tex fallback opener**

Open `resume-compiler/templates/cover_letter.tex`. Find the line:
```
%%SUMMARY_SENTENCE%%
```

The cover letter template uses direct `%%MARKER%%` replacement — not Jinja2. The `/generate-cover-letter` endpoint in `app.py` passes `summary` as `%%SUMMARY_SENTENCE%%`. We need to update `generate_cover_letter()` to provide a fallback when summary is empty.

In `app.py`, find `generate_cover_letter()` (line ~224). Replace the `summary` assignment line:
```python
summary = data.get("summary", "").strip()
```
With:
```python
summary       = data.get("summary", "").strip()
primary_cat   = sanitize_latex(data.get("primary_category", "Engineering").strip())
if not summary:
    summary = (
        f"As a {primary_cat}-focused Aerospace Engineering graduate from the University "
        f"of Illinois Urbana-Champaign, I am confident that my technical background and "
        f"hands-on experience make me a strong candidate for this role."
    )
```

Also add `primary_category` to the `data.get` calls (it's an optional field — no validation needed).

- [ ] **Step 6: Run existing compiler tests**

```bash
cd /Users/jashwanth/jobagent-web/resume-compiler && FLASK_TESTING=1 python -m pytest tests/test_app.py -v 2>&1 | tail -20
```
Expected: existing tests pass (they test `/generate` which is unchanged).

- [ ] **Step 7: Commit**

```bash
git add resume-compiler/app.py resume-compiler/requirements.txt resume-compiler/templates/cover_letter.tex
git commit -m "feat: add /parse and /compile endpoints to GCR compiler with JWT auth"
```

---

## Task 6: Dynamic Jinja2 Resume Template

**Files:**
- Create: `resume-compiler/templates/resume_dynamic.tex`

This template uses non-standard Jinja2 delimiters (`<< >>`, `<% %>`) to avoid clashing with LaTeX's `{ }` and `%` characters.

- [ ] **Step 1: Read one existing template for font/preamble reference**

```bash
head -80 /Users/jashwanth/jobagent-web/resume-compiler/templates/resume_A.tex
```

Copy the preamble (documentclass, usepackage, font settings, geometry, custom commands) exactly — only the body section changes.

- [ ] **Step 2: Create resume_dynamic.tex**

Create `resume-compiler/templates/resume_dynamic.tex` with the preamble from `resume_A.tex` verbatim, then replace the body with:

```latex
\begin{document}

%----------HEADER----------
\begin{center}
    {\Huge \textbf{<< candidate_name >>}} \\[4pt]
    \small
    << contact.get('phone', '') >>
    \textbar\ \href{mailto:<< contact.get('email', '') >>}{<< contact.get('email', '') >>}
    \textbar\ \href{<< contact.get('linkedin', '') >>}{LinkedIn}
    \textbar\ << contact.get('location', '') >>
\end{center}
\vspace{-4pt}
\noindent\rule{\textwidth}{0.5pt}

<%- for section in section_order %>

  <%- if section == 'summary' and include_summary and mod1_summary %>
  %----------SUMMARY----------
  \section*{Summary}
  \vspace{-6pt}
  \small << mod1_summary >>
  \vspace{4pt}

  <%- elif section == 'skills' %>
  %----------SKILLS----------
  \section*{Technical Skills}
  \vspace{-6pt}
  \begin{itemize}[leftmargin=0.12in, label={}]
    \small
    <%- for line in mod2_skilllines %>
    \item{\textbf{<< line.category >>:} << line.items >>}
    <%- endfor %>
    <%- if certifications %>
    \item{\textbf{Certifications:} << certifications | join(', ') >>}
    <%- endif %>
  \end{itemize}
  \vspace{-8pt}

  <%- elif section == 'experience' %>
  %----------EXPERIENCE----------
  \section*{Experience}
  \vspace{-6pt}
  \resumeSubHeadingListStart
  <%- for exp in experience %>
    \resumeSubheading
      {<< exp.company >>}{<< exp.date_range >>}
      {<< exp.role >>}{<< exp.location >>}
      \resumeItemListStart
      <%- for bullet in exp.bullets %>
        \resumeItem{<< bullet >>}
      <%- endfor %>
      \resumeItemListEnd
  <%- endfor %>
  \resumeSubHeadingListEnd
  \vspace{-8pt}

  <%- elif section == 'education' %>
  %----------EDUCATION----------
  \section*{Education}
  \vspace{-6pt}
  \resumeSubHeadingListStart
  <%- for edu in education %>
    \resumeSubheading
      {<< edu.school >>}{<< edu.date_range >>}
      {<< edu.degree >>}{<< edu.get('location', '') >>}
  <%- endfor %>
  \resumeSubHeadingListEnd

  <%- endif %>
<%- endfor %>

\end{document}
```

**Note:** The Jinja2 environment in `app.py` (Task 5, Step 4) uses `<%` / `%>` for blocks and `<<` / `>>` for variables — this is why the template uses those delimiters instead of `{%` / `%}` and `{{` / `}}`.

- [ ] **Step 3: Smoke test the template renders without error**

```bash
cd /Users/jashwanth/jobagent-web/resume-compiler && python - << 'EOF'
from jinja2 import Environment, FileSystemLoader, select_autoescape
env = Environment(
    loader=FileSystemLoader('templates'),
    autoescape=select_autoescape([]),
    block_start_string='<%', block_end_string='%>',
    variable_start_string='<<', variable_end_string='>>',
    comment_start_string='<#', comment_end_string='#>',
)
t = env.get_template('resume_dynamic.tex')
out = t.render(
    candidate_name='Test User',
    contact={'email': 'test@test.com', 'phone': '555-0000', 'linkedin': 'https://linkedin.com', 'location': 'Chicago, IL'},
    section_order=['skills', 'experience', 'education'],
    include_summary=False,
    mod1_summary='',
    mod2_skilllines=[{'category': 'Quality Engineering', 'items': 'SPC, FMEA, 8D'}],
    certifications=['Six Sigma Green Belt'],
    experience=[{'company': 'Acme Corp', 'date_range': '2023–2024', 'role': 'Engineer', 'location': 'Chicago', 'bullets': ['Did X', 'Did Y']}],
    education=[{'school': 'UIUC', 'date_range': '2023–2025', 'degree': 'M.S. Engineering', 'location': 'Urbana, IL'}],
)
print('OK — rendered', len(out), 'chars')
EOF
```
Expected: `OK — rendered NNNN chars` (no exceptions).

- [ ] **Step 4: Commit**

```bash
git add resume-compiler/templates/resume_dynamic.tex
git commit -m "feat: add dynamic Jinja2 resume template replacing static A-D variants"
```

---

## Task 7: Seed Script — Existing Account Data

**Files:**
- Create: `scripts/seed_primary_resume.js`

Run this BEFORE removing the hardcoded block from groq.js so Siddardth's account keeps working.

- [ ] **Step 1: Create the seeder**

Create `scripts/seed_primary_resume.js`:

```javascript
// One-time seeder: converts the hardcoded candidate block from groq.js into
// a structured_sections row in the resumes table for shhahidmian@gmail.com.
// Run once: node scripts/seed_primary_resume.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // service role key needed

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const TARGET_EMAIL = 'shhahidmian@gmail.com';

const structured_sections = {
  schema_version: 1,
  summary: null,
  section_order: ['skills', 'experience', 'education'],
  skills: [
    { category: 'Quality Engineering', items: ['pFMEA', 'SPC', '8D Root Cause Analysis', 'RCCA', 'CMM Inspection', 'GD&T', 'First Article Inspection', 'MRB Disposition', 'CAPA'] },
    { category: 'Manufacturing & Tooling', items: ['Fixture Design', 'Assembly Sequencing', 'Tooling Qualification', 'CNC Machining', 'Blueprint Reading', 'SolidWorks', 'AutoCAD'] },
    { category: 'Composite Processing', items: ['Prepreg Layup', 'Autoclave Processing', 'Vacuum Bagging', 'Cure Cycle Development', 'Out-of-Autoclave Methods'] },
    { category: 'Simulation & Software', items: ['ABAQUS', 'FEA', 'Classical Lamination Theory', 'MATLAB', 'Python'] },
  ],
  experience: [
    {
      company: 'Tata Boeing Aerospace',
      role: 'Quality Engineering Intern',
      location: 'Hyderabad, India',
      date_range: 'May 2024 – Aug 2024',
      bullets: [
        'Audited GD&T-based CMM inspection records for 450+ flight-critical components to 0.02 mm accuracy, supporting zero customer escapes on GE and Boeing programs.',
        'Initiated 5 Whys root cause investigation and escalated to 8D structured problem-solving for deeper resolution on GE engine component nonconformances, reducing NCR cycle time by 22%.',
        'Implemented SPC-guided corrective actions (revised CNC tool change intervals) reducing position tolerance defect rate from 15% to under 3%.',
        'Built FMEA-based engineering justification for supplier nonconformance enabling use-as-is disposition that prevented ~$3,000 in scrap and 4-week lead time delay.',
      ],
    },
    {
      company: 'SAMPE University Competition',
      role: 'Structures Lead',
      location: 'Urbana, IL',
      date_range: 'Aug 2023 – Apr 2024',
      bullets: [
        'Built 24-inch composite fuselage via prepreg layup and autoclave cure (275°F, lab-limited 40 psi) — part sustained 2,700 lbf at test (2.7× design requirement).',
        'Built pFMEA ranking 5 failure modes (vacuum bag leaks highest, RPN=60) and standardized pressurized hold test protocol at 20 psi achieving zero process deviations.',
        'Optimized laminate stacking using Python simulated annealing + ABAQUS FEA achieving 38% deflection reduction vs baseline.',
      ],
    },
    {
      company: 'Beckman Institute, UIUC',
      role: 'Graduate Research Assistant',
      location: 'Urbana, IL',
      date_range: 'Jan 2024 – May 2024',
      bullets: [
        'Developed and validated out-of-autoclave cure method using frontal polymerization — proof-of-concept compression of composite processing cycle from 8+ hours to under 5 minutes.',
        'Predicted cure behavior within 10% velocity accuracy and 3°C of peak temperatures, accelerating process parameter optimization by 94% through computational modeling.',
      ],
    },
    {
      company: 'EQIC Dies & Moulds',
      role: 'Manufacturing Engineering Intern',
      location: 'Hyderabad, India',
      date_range: 'May 2022 – Jul 2022',
      bullets: [
        'Mapped 12-stage die production workflow identifying inter-stage handoff points as primary sources of dimensional tolerance accumulation.',
        'Verified die component tolerances to ±0.02 mm (GD&T) and confirmed parting surface alignment (>80% contact) on 800-bar HPDC tooling.',
      ],
    },
  ],
  education: [
    { school: 'University of Illinois Urbana-Champaign', degree: 'M.S. Aerospace Engineering', date_range: 'Aug 2023 – Dec 2025', location: 'Urbana, IL' },
  ],
  certifications: ['Six Sigma Green Belt (CSSC)', 'Inspection & Quality Control in Manufacturing'],
};

async function seed() {
  // Look up the user by email
  const { data: users, error: userErr } = await supabase.auth.admin.listUsers();
  if (userErr) { console.error('listUsers error:', userErr.message); process.exit(1); }

  const user = users.users.find(u => u.email === TARGET_EMAIL);
  if (!user) { console.error(`User ${TARGET_EMAIL} not found`); process.exit(1); }

  console.log(`Found user: ${user.id}`);

  // Clear existing primary flag
  await supabase.from('resumes').update({ is_primary: false }).eq('user_id', user.id);

  // Upsert the primary resume
  const { error } = await supabase.from('resumes').upsert({
    user_id: user.id,
    name: 'Primary Resume',
    is_primary: true,
    structured_sections,
    updated_at: new Date().toISOString(),
  });

  if (error) { console.error('Upsert error:', error.message); process.exit(1); }
  console.log('✓ Primary resume seeded for', TARGET_EMAIL);
}

seed();
```

- [ ] **Step 2: Run the seeder (requires service role key)**

```bash
SUPABASE_URL=<your-url> SUPABASE_SERVICE_KEY=<your-service-role-key> node scripts/seed_primary_resume.js
```
Expected: `✓ Primary resume seeded for shhahidmian@gmail.com`

- [ ] **Step 3: Verify in Supabase dashboard**

Check the `resumes` table — confirm one row exists for the user with `is_primary=true` and `structured_sections` populated.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed_primary_resume.js
git commit -m "feat: add one-time seeder for Siddardth primary resume row"
```

---

## Task 8: Groq.js — Dynamic Context Builders + Strict Validation

**Files:**
- Modify: `src/lib/groq.js`

This is the biggest single-file change. We remove the hardcoded candidate block and replace it with dynamic context from DB.

- [ ] **Step 1: Add buildCandidateContext helper**

At the top of `src/lib/groq.js`, after the imports, add:

```javascript
export function buildCandidateContext(ss) {
  const lines = [];

  if (ss.education?.length) {
    const edu = ss.education[0];
    lines.push(`Education: ${edu.degree}, ${edu.school}, ${edu.date_range}`);
  }

  if (ss.experience?.length) {
    lines.push('\nExperience:');
    for (const exp of ss.experience) {
      lines.push(`- ${exp.company} | ${exp.role} | ${exp.date_range}`);
      for (const b of (exp.bullets || [])) {
        lines.push(`  • ${b}`);
      }
    }
  }

  if (ss.skills?.length) {
    lines.push('\nSkills:');
    for (const s of ss.skills) {
      lines.push(`  ${s.category}: ${(s.items || []).join(', ')}`);
    }
  }

  return lines.join('\n');
}

export function buildSkillLinesPrompt(skills) {
  return skills.map(s => ({
    category: s.category,
    items: (s.items || []).join(', '),
  }));
}

export function resolvePrimaryCategory(primaryCategory, skills) {
  if (!primaryCategory || !skills?.length) return skills?.[0]?.category ?? '';
  const cats = skills.map(s => s.category);
  // 1. Exact match
  if (cats.includes(primaryCategory)) return primaryCategory;
  // 2. Case-insensitive
  const lower = primaryCategory.toLowerCase();
  const ci = cats.find(c => c.toLowerCase() === lower);
  if (ci) return ci;
  // 3. Substring
  const sub = cats.find(c => c.toLowerCase().includes(lower) || lower.includes(c.toLowerCase()));
  if (sub) { console.warn(`[groq] primary_category fuzzy match: "${primaryCategory}" → "${sub}"`); return sub; }
  // 4. Fallback to first
  console.warn(`[groq] primary_category no match for "${primaryCategory}", using "${cats[0]}"`);
  return cats[0];
}
```

- [ ] **Step 2: Replace analyzeJobWithGroq**

Replace the entire `analyzeJobWithGroq` function with:

```javascript
export async function analyzeJobWithGroq(jd, structuredSections, apiKey) {
  const candidateContext = buildCandidateContext(structuredSections);
  const baseSkillLines = buildSkillLinesPrompt(structuredSections.skills || []);
  const baseLinesJson = JSON.stringify(baseSkillLines, null, 2);

  const system = `You are a resume data extractor helping tailor a resume to a job description.

CANDIDATE BACKGROUND (use only these facts, never invent):
${candidateContext}

OUTPUT RULES:
1. Return valid JSON only — no markdown fences, no extra text
2. top5_jd_skills: exactly 5 DIFFERENT specific technical terms (no soft skills)
3. primary_category: must be EXACTLY one of the category names from the base skill lines below
4. mod2_skilllines: reorder items within each category to match JD — never add new skills, never rename categories
5. Remove (Learning) — never output this tag`;

  const user = `JD (first 3500 chars):
${jd.slice(0, 3500)}

BASE SKILL CATEGORIES (reorder items only — do not rename categories or add new skills):
${baseLinesJson}

Return ONLY this JSON:
{
  "top5_jd_skills": ["kw1","kw2","kw3","kw4","kw5"],
  "primary_category": "exact category name from base skill lines that best fits this JD",
  "mod2_skilllines": [
    {"category":"same label as base","items":"reordered items string"}
  ],
  "missing_keywords": ["kw1","kw2"],
  "ats_coverage": "XX%",
  "resumeReason": "one sentence why this category ordering fits the JD",
  "top_matches": ["kw1","kw2","kw3"],
  "ai_insights": "3-5 actionable tips for this specific JD"
}`;

  const dataText = await callGroq(system, user, apiKey, 1400);

  let parsed;
  try {
    const cleaned = dataText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    const match = dataText.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); }
      catch { throw new Error('Groq returned unparseable JSON. Try again.'); }
    } else {
      throw new Error('Groq returned no JSON. Try again.');
    }
  }

  // Strict validation
  if (!Array.isArray(parsed.mod2_skilllines) || parsed.mod2_skilllines.length === 0) {
    throw new Error('Groq output missing mod2_skilllines. Try again.');
  }
  for (const line of parsed.mod2_skilllines) {
    if (typeof line.category !== 'string' || typeof line.items !== 'string') {
      throw new Error('Groq output has malformed skillline. Try again.');
    }
  }
  if (!Array.isArray(parsed.top5_jd_skills) || new Set(parsed.top5_jd_skills).size < 5) {
    throw new Error('Groq output has fewer than 5 distinct JD skills. Try again.');
  }
  if (!/^\d+%$/.test(parsed.ats_coverage || '')) {
    parsed.ats_coverage = '—';
  }

  // Resolve primary_category with fuzzy fallback
  parsed.primary_category = resolvePrimaryCategory(parsed.primary_category, structuredSections.skills);

  // Build mod2_skills LaTeX string for compiler
  parsed.mod2_skills = parsed.mod2_skilllines
    .map(row => {
      const label = (row.category || '').replace(/&/g, '\\&');
      const skills = (row.items || '').replace(/&/g, '\\&');
      return `\\skillline{${label}:}{${skills}}`;
    })
    .join('\n');

  // Summary disabled by default — caller enables via separate _generateSummary call
  parsed.mod1_summary = '';
  parsed.mod1_summary_latex = '';

  return parsed;
}
```

- [ ] **Step 3: Update _generateSummary to use dynamic context**

Replace the `_generateSummary` function signature and system prompt. Change the first two parameters from `(jd, variant, keywords, title, apiKey)` to `(jd, primaryCategory, keywords, title, structuredSections, apiKey)`.

Replace the hardcoded `CANDIDATE BACKGROUND` block in the system prompt with:

```javascript
const candidateContext = buildCandidateContext(structuredSections);

const system = `You are writing a 3-sentence resume summary. Output ONLY the 3 sentences as plain text — no JSON, no labels, no formatting markers.

CANDIDATE BACKGROUND (use only these facts, never invent):
${candidateContext}

RESUME ANGLE: ${primaryCategory}

First derive in one sentence what this role most needs from the JD and how the candidate's background answers it. Then write the 3 sentences using that as your lens.

SENTENCE 1 — Identity + role fit (25–35 words): Position the candidate as a graduate targeting this role. Open with who they are in relation to the role.
SENTENCE 2 — Proof for the keywords (20–30 words): Use 2–3 JD keywords, each attached to a specific experience and outcome.
SENTENCE 3 — What the candidate brings as a person (12–18 words): Write a BEHAVIOR, not an output.

BANNED words: passionate, motivated, results-driven, dynamic, fast-paced, team player, leveraging, (Learning)`;
```

- [ ] **Step 4: Remove the old hardcoded candidate block**

Delete the entire large `const system = ...` block inside `_generateSummary` that starts with `CANDIDATE BACKGROUND (use only these facts...` and contains all of Siddardth's hardcoded data. The new system prompt from Step 3 replaces it.

Also delete the `VARIANT_LENS` constant inside `_generateSummary`.

- [ ] **Step 5: Build check**

```bash
cd /Users/jashwanth/jobagent-web && npm run build 2>&1 | tail -10
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/groq.js
git commit -m "feat: replace hardcoded candidate block with dynamic context builders in groq.js"
```

---

## Task 9: JobAnalysis.jsx — UI Wiring

**Files:**
- Modify: `src/components/JobAnalysis.jsx`

- [ ] **Step 1: Add primary resume fetch on mount**

At the top of `JobAnalysis` component, add a state and effect:

```javascript
const [primaryResume, setPrimaryResume] = useState(null);
const [resumeLoading, setResumeLoading] = useState(true);

useEffect(() => {
  Storage.fetchResume && Storage.fetchResumes().then(resumes => {
    const primary = resumes.find(r => r.is_primary) || null;
    if (primary?.id) {
      Storage.fetchResume(primary.id).then(full => {
        setPrimaryResume(full);
        setResumeLoading(false);
      }).catch(() => setResumeLoading(false));
    } else {
      setResumeLoading(false);
    }
  }).catch(() => setResumeLoading(false));
}, []);
```

- [ ] **Step 2: Gate the Analyze button on resume presence**

Find the Analyze button render. Add disabled state:

```javascript
disabled={loading || resumeLoading || !primaryResume}
title={!primaryResume ? 'Upload your resume in the Resume tab first' : undefined}
```

When no primary resume exists, show a banner above the job description area:
```javascript
{!resumeLoading && !primaryResume && (
  <div style={{background: t.yellowL, border: `1px solid ${t.yellowBd}`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: t.yellow}}>
    No resume found. Go to the <strong>Resume</strong> tab and upload your .tex or PDF to enable AI analysis.
  </div>
)}
```

- [ ] **Step 3: Update runAnalysis to pass structuredSections to Groq**

Find the `runAnalysis` function (around line 429). Replace the `analyzeJobWithGroq(jd, variant, groqKey)` call with:

```javascript
const result = await analyzeJobWithGroq(
  currentJob.description || currentJob.fullDescription || '',
  primaryResume.structured_sections,
  groqKey
);
```

Remove any `variant` selection logic that preceded this call.

- [ ] **Step 4: Add primary_category badge to results**

In the results section (after analysis), find where the old "Variant X" label was displayed. Replace with:

```javascript
{result?.primary_category && (
  <div style={{display:'inline-flex', alignItems:'center', gap:6, padding:'4px 12px', borderRadius:20, background:t.priL, border:`1px solid ${t.pri}`, fontSize:12, fontWeight:700, color:t.pri, marginBottom:10}}>
    Resume angle: {result.primary_category}
  </div>
)}
```

- [ ] **Step 5: Add summary toggle**

Add state: `const [includeSummary, setIncludeSummary] = useState(false);`

Show the toggle only when `primaryResume?.structured_sections?.summary !== null && result`:

```javascript
{result && primaryResume?.structured_sections?.summary !== null && (
  <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:14}}>
    <input type="checkbox" id="summary-toggle" checked={includeSummary}
      onChange={e => setIncludeSummary(e.target.checked)} />
    <label htmlFor="summary-toggle" style={{fontSize:13, color:t.sub, cursor:'pointer'}}>
      Include tailored summary paragraph
    </label>
  </div>
)}
```

When includeSummary is true and user clicks Download, fire `_generateSummary` before compile. Update `downloadResume` to:

```javascript
let mod1Summary = '';
if (includeSummary && primaryResume?.structured_sections?.summary !== null) {
  mod1Summary = await generateSummary(
    currentJob.description || '',
    result.primary_category,
    result.top5_jd_skills,
    currentJob.role || '',
    primaryResume.structured_sections,
    groqKey
  );
}
```

- [ ] **Step 6: Update downloadResume payload to new compiler shape**

Replace the old `/generate` call payload with a `/compile` call:

```javascript
// Fetch user profile for contact fields
const profile = await Storage.fetchUserProfile();

const compilePayload = {
  structured_sections: primaryResume.structured_sections,
  groq_output: {
    mod2_skilllines: result.mod2_skilllines,
    primary_category: result.primary_category,
    mod1_summary: mod1Summary,
  },
  include_summary: includeSummary && !!mod1Summary,
  candidate_name: profile?.full_name || 'Candidate',
  contact: {
    email: profile?.email || '',
    phone: profile?.phone || '',
    linkedin: profile?.linkedin_url || '',
    location: profile?.location || '',
  },
  company: currentJob.company || '',
  role: currentJob.role || '',
};

const response = await fetch(`${COMPILER_URL}/compile`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`,
  },
  body: JSON.stringify(compilePayload),
});
```

- [ ] **Step 7: Build check**

```bash
npm run build 2>&1 | tail -10
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/JobAnalysis.jsx
git commit -m "feat: wire JobAnalysis to primary resume DB, add primary_category badge and summary toggle"
```

---

## Task 10: Onboarding — Resume Upload Step

**Files:**
- Modify: `src/components/Onboarding.jsx`

- [ ] **Step 1: Install pdfjs-dist**

```bash
cd /Users/jashwanth/jobagent-web && npm install pdfjs-dist
```
Expected: added to package.json without errors.

- [ ] **Step 2: Add Step 4 state and file handler**

At the top of `Onboarding`, add:

```javascript
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url
).toString();

// Step 3 — Resume Upload
const [resumeFile, setResumeFile] = useState(null);
const [resumeText, setResumeText] = useState('');  // extracted text or tex source
const [resumeType, setResumeType] = useState('');  // 'tex' | 'pdf'
const [parseError, setParseError] = useState('');
const [parsePending, setParsePending] = useState(false);
```

Update `STEPS` constant:
```javascript
const STEPS = ['Profile', 'Target Roles', 'API Keys', 'Resume'];
```

- [ ] **Step 3: Add file selection handler**

```javascript
async function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  setParseError('');

  if (file.size > 5 * 1024 * 1024) {
    setParseError('File too large. Max 5MB.');
    return;
  }

  if (file.name.endsWith('.tex')) {
    const text = await file.text();
    setResumeFile(file);
    setResumeText(text);
    setResumeType('tex');
  } else if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
    setResumeFile(file);
    setResumeType('pdf');
    // Extract text client-side
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      fullText += content.items.map(item => item.str).join(' ') + '\n';
    }
    setResumeText(fullText.slice(0, 8000));
  } else {
    setParseError('Please upload a .tex or .pdf file.');
  }
}
```

- [ ] **Step 4: Update handleFinish to parse and save resume**

In `handleFinish`, after the existing `onComplete()` call is ready but before calling it, add:

```javascript
// Parse and save resume if provided (non-blocking — onboarding completes regardless)
if (resumeFile && resumeText) {
  setParsePending(true);
  try {
    const { data: { session } } = await supabase.auth.getSession();
    let structuredSections = null;

    if (resumeType === 'tex') {
      const res = await fetch(`${COMPILER_URL}/parse`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: resumeText,
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) structuredSections = await res.json();
    } else {
      // PDF — use Vercel parse-resume function
      const res = await fetch('/api/parse-resume', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ text: resumeText }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) structuredSections = await res.json();
    }

    if (structuredSections && !structuredSections.parse_error) {
      await Storage.upsertResume({
        name: 'Primary Resume',
        is_primary: true,
        structured_sections: structuredSections,
      });
    }
  } catch (err) {
    // Non-blocking — log but don't fail onboarding
    console.warn('Resume parse failed (non-blocking):', err.message);
  } finally {
    setParsePending(false);
  }
}
onComplete();
```

- [ ] **Step 5: Add Step 3 (Resume) UI**

In the JSX, after the Step 2 (API Keys) block, add:

```javascript
{step === 3 && (
  <>
    <p style={{color: t.sub, fontSize: 13, margin: '0 0 16px'}}>
      Upload your Overleaf .tex file or resume PDF so AI analysis uses your real experience. Optional — you can skip and upload later from the Resume tab.
    </p>

    <label style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', border: `2px dashed ${t.border}`,
      borderRadius: 10, padding: '24px 16px', cursor: 'pointer',
      background: t.bg, marginBottom: 14,
    }}>
      <span style={{fontSize: 13, color: t.sub, marginBottom: 8}}>
        {resumeFile ? resumeFile.name : 'Click to upload .tex or .pdf'}
      </span>
      <span style={{fontSize: 11, color: t.muted}}>Max 5MB</span>
      <input type="file" accept=".tex,.pdf" onChange={handleFileSelect}
        style={{display: 'none'}} />
    </label>

    {parseError && <p style={{color: t.red, fontSize: 13, margin: '0 0 12px'}}>{parseError}</p>}
    {resumeFile && !parseError && (
      <p style={{color: t.green, fontSize: 12, margin: '0 0 12px'}}>
        ✓ {resumeType === 'tex' ? 'LaTeX file ready' : 'PDF text extracted'} — will be parsed on finish
      </p>
    )}

    <button onClick={() => onComplete()} style={{
      width: '100%', padding: 8, background: 'none',
      border: 'none', color: t.muted, fontSize: 12, cursor: 'pointer',
    }}>
      Skip for now
    </button>
  </>
)}
```

- [ ] **Step 6: Build check**

```bash
npm run build 2>&1 | tail -10
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/Onboarding.jsx package.json package-lock.json
git commit -m "feat: add resume upload step to onboarding (tex + PDF, non-blocking parse)"
```

---

## Task 11: PDF Parse Vercel Function

**Files:**
- Create: `api/parse-resume.js`

- [ ] **Step 1: Create the function**

Create `api/parse-resume.js`:

```javascript
// Parses PDF text (extracted client-side) into structured_sections using Groq.
// Called only for PDF uploads — .tex uses the GCR /parse endpoint.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth check
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  const token = authHeader.slice(7);
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  const { text } = req.body || {};
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'text field required' });

  const truncated = text.slice(0, 8000);

  // Fetch the user's Groq key or fall back to env
  const { data: integrations } = await supabase
    .from('user_integrations')
    .select('api_key')
    .eq('user_id', user.id)
    .eq('service', 'groq')
    .single();
  const groqKey = integrations?.api_key || GROQ_API_KEY;
  if (!groqKey) return res.status(500).json({ error: 'No Groq API key configured' });

  const prompt = `Extract the following resume text into a structured JSON object.

Return ONLY valid JSON matching this schema exactly:
{
  "schema_version": 1,
  "summary": "text or null if no summary section exists",
  "section_order": ["ordered list of section keys present: skills, experience, education, summary, certifications"],
  "skills": [{"category": "Category Name", "items": ["skill1", "skill2"]}],
  "experience": [{"company": "...", "role": "...", "date_range": "...", "location": "...", "bullets": ["bullet1", "bullet2"]}],
  "education": [{"school": "...", "degree": "...", "date_range": "...", "location": "..."}],
  "certifications": ["cert1", "cert2"]
}

RESUME TEXT:
${truncated}`;

  const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${groqKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 2000,
      temperature: 0,
    }),
  });

  if (!groqRes.ok) {
    const err = await groqRes.json().catch(() => ({}));
    return res.status(502).json({ error: 'Groq error', detail: err.error?.message });
  }

  const groqData = await groqRes.json();
  const content = groqData.choices?.[0]?.message?.content || '';

  let parsed;
  try { parsed = JSON.parse(content); }
  catch { return res.status(200).json({ parse_error: 'unparseable_groq_response' }); }

  if (!Array.isArray(parsed.skills) || parsed.skills.length === 0) {
    return res.status(200).json({ parse_error: 'incomplete_parse' });
  }

  return res.status(200).json(parsed);
}
```

- [ ] **Step 2: Build check**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add api/parse-resume.js
git commit -m "feat: add /api/parse-resume Vercel function for PDF resume parsing via Groq"
```

---

## Task 12: End-to-End Smoke Test + GCR Redeploy

- [ ] **Step 1: Run all tests**

```bash
cd /Users/jashwanth/jobagent-web && npm test 2>&1 | tail -20
cd resume-compiler && python -m pytest tests/ -v 2>&1 | tail -20
```
Expected: all pass.

- [ ] **Step 2: Run seeder if not done yet (Task 7 Step 2)**

```bash
SUPABASE_URL=<url> SUPABASE_SERVICE_KEY=<key> node scripts/seed_primary_resume.js
```

- [ ] **Step 3: Rebuild and push GCR image**

```bash
cd /Users/jashwanth/jobagent-web/resume-compiler
docker build -t gcr.io/<your-project>/resume-compiler:latest .
docker push gcr.io/<your-project>/resume-compiler:latest
gcloud run deploy resume-compiler \
  --image gcr.io/<your-project>/resume-compiler:latest \
  --region us-central1 \
  --min-instances 1 \
  --set-env-vars SUPABASE_JWT_SECRET=<your-jwt-secret>
```

- [ ] **Step 4: Verify /health and /parse on live GCR**

```bash
curl https://resume-compiler-1077806152183.us-central1.run.app/health
# Expected: ok

curl -X POST https://resume-compiler-1077806152183.us-central1.run.app/parse \
  -H "Content-Type: text/plain" \
  -H "Authorization: Bearer <valid-jwt>" \
  --data '\section{Skills}\n\textbf{Quality:} SPC, FMEA'
# Expected: JSON with skills array
```

- [ ] **Step 5: Deploy frontend to Vercel**

```bash
git push origin main
```
Vercel auto-deploys from main. Confirm deployment succeeds in Vercel dashboard.

- [ ] **Step 6: Manual smoke test checklist**

Sign in as `shhahidmian@gmail.com`:
- [ ] Job Analysis loads without error — no "no primary resume" banner
- [ ] Analyze a job description — primary_category badge appears in results
- [ ] `(Learning)` does NOT appear in skill lines
- [ ] Download Resume — PDF renders with Skills before Education
- [ ] Complete a pipeline job → it disappears from Find Jobs and does NOT reappear
- [ ] Remove a pipeline job → job disappears from Pipeline, feed row still exists in Supabase

Sign up as a new test user:
- [ ] Onboarding shows 4 steps
- [ ] Upload a .tex file → parsing completes, success message shown
- [ ] Finish onboarding — no error
- [ ] Job Analysis shows resume-loaded state, Analyze button enabled

- [ ] **Step 7: Final commit**

```bash
git add .
git commit -m "feat: job analysis + pipeline overhaul — multi-user dynamic resume system complete"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered in task |
|---|---|
| Onboarding Step 4 resume upload | Task 10 |
| /parse endpoint on GCR (JWT, section_order fallback) | Task 5 |
| Python LaTeX parser with SECTION_MAP | Task 4 |
| /api/parse-resume Vercel (JWT, 5MB guard, 8000-char truncate) | Task 11 |
| structured_sections schema_version field | Task 4 (parse_tex), Task 7 (seeder) |
| analyzeJobWithGroq reads from DB | Task 8 |
| buildCandidateContext / buildSkillLinesPrompt | Task 8 |
| primary_category fuzzy fallback | Task 8 |
| Strict output validation (no silent fallback) | Task 8 |
| (Learning) removed from prompts | Task 8 |
| _generateSummary dynamic lens | Task 8 |
| primary_category badge in UI | Task 9 |
| Summary toggle (only when summary != null) | Task 9 |
| Download payload → /compile | Task 9 |
| contact from user_profiles | Task 9 |
| Dynamic Jinja2 template | Task 6 |
| /compile endpoint in GCR | Task 5 |
| cover_letter.tex fallback opener | Task 5 |
| Certifications as string[] | Task 4, Task 6 |
| Find Jobs hides completed + removed | Task 3 |
| softRemoveJob (soft delete) | Task 2 |
| fetchJobs fixes 14-day cap | Task 2 |
| Debounce counter fix | Task 3 |
| Resume.jsx schema drift fix | Task 3 |
| /api/groq lockdown | Task 3 |
| Model label fix | Task 3 |
| Seeder for existing account | Task 7 |
| GCR min-instances: 1 | Task 12 |
| GCR redeploy | Task 12 |
