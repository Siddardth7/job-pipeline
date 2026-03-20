# Resume Output Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual copy-paste-into-Overleaf workflow with a single "Download Resume PDF" button that compiles a polished, ATS-ready PDF on demand — plus an optional cover letter download.

**Architecture:** A Python Flask microservice with pdflatex installed (deployed on Railway) receives `{variant, summary, skills_latex}`, injects those into a base `.tex` template file, compiles it, and returns raw PDF bytes. The React frontend adds a download button that POSTs to this service and triggers a browser file download. No intermediate storage for MVP — bytes return directly.

**Tech Stack:** Python 3.11, Flask, pdflatex (TeX Live), Docker, Railway.app for hosting, React (existing Vite app), Supabase (existing).

---

## Materials Required From You (User)

Before Phase 1 Step 3 can begin, you must provide:

1. **The 4 base `.tex` resume source files** — export from Overleaf:
   - `resume_A.tex` (Manufacturing & Plant Ops)
   - `resume_B.tex` (Process & CI)
   - `resume_C.tex` (Quality & Materials)
   - `resume_D.tex` (Equipment & NPI)
   - Place them at: `resume-compiler/templates/` in this repo
   - Needed to: identify exact placeholder locations for summary and skilllines

2. **A Railway account** — free tier works (railway.app, sign up with GitHub)
   - Needed for: deploying the compilation microservice

Everything in Phase 0 (frontend scaffold + service scaffold) can be built without these. Phase 1 template preparation requires the `.tex` files.

---

## File Map

### New files (compilation microservice)
| File | Responsibility |
|---|---|
| `resume-compiler/app.py` | Flask server: receives request, injects placeholders, compiles, returns PDF |
| `resume-compiler/Dockerfile` | Docker image with Python + TeX Live + app |
| `resume-compiler/requirements.txt` | Flask, gunicorn |
| `resume-compiler/railway.json` | Railway deployment config |
| `resume-compiler/templates/resume_A.tex` | Base LaTeX template for variant A (user-provided + modified) |
| `resume-compiler/templates/resume_B.tex` | Base LaTeX template for variant B (user-provided + modified) |
| `resume-compiler/templates/resume_C.tex` | Base LaTeX template for variant C (user-provided + modified) |
| `resume-compiler/templates/resume_D.tex` | Base LaTeX template for variant D (user-provided + modified) |
| `resume-compiler/templates/cover_letter.tex` | Cover letter LaTeX template |
| `resume-compiler/tests/test_app.py` | Unit tests for sanitizer + placeholder injection |

### Modified files (frontend)
| File | Change |
|---|---|
| `src/components/JobAnalysis.jsx` | Add `downloadResume()`, `downloadCoverLetter()`, two new buttons, loading states |
| `src/lib/coverLetter.js` | NEW: helper that builds cover letter variables from analysis result |
| `.env.local` | NEW: `VITE_COMPILER_URL=http://localhost:8080` for local dev |
| `.gitignore` | Add `.env.local` if not already present |

---

## Phase 0 — Service Scaffold (no `.tex` files needed)

**Subagent: general-purpose**

### Task 0.1: Create the microservice directory structure

**Files:**
- Create: `resume-compiler/app.py`
- Create: `resume-compiler/requirements.txt`
- Create: `resume-compiler/Dockerfile`
- Create: `resume-compiler/railway.json`
- Create: `resume-compiler/tests/__init__.py`
- Create: `resume-compiler/tests/test_app.py`
- Create: `resume-compiler/templates/.gitkeep`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p resume-compiler/templates
mkdir -p resume-compiler/tests
touch resume-compiler/templates/.gitkeep
touch resume-compiler/tests/__init__.py
```

- [ ] **Step 2: Create `resume-compiler/requirements.txt`**

```
flask==3.0.3
gunicorn==22.0.0
```

- [ ] **Step 3: Create `resume-compiler/railway.json`**

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "startCommand": "gunicorn -w 2 -b 0.0.0.0:8080 --timeout 60 app:app",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 300
  }
}
```

- [ ] **Step 4: Create `resume-compiler/Dockerfile`**

```dockerfile
FROM python:3.11-slim

# Install TeX Live (core + fonts + extra for common packages)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      texlive-latex-base \
      texlive-fonts-recommended \
      texlive-latex-extra \
      texlive-fonts-extra && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Verify pdflatex is available at build time
RUN pdflatex --version

EXPOSE 8080

CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:8080", "--timeout", "60", "app:app"]
```

Note: This Docker image will be ~1.5-2GB due to TeX Live. That is expected and acceptable.

- [ ] **Step 5: Write the failing tests first** — create `resume-compiler/tests/test_app.py`

```python
import pytest
import sys
import os
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
    # Normal sentence should pass through cleanly
    result = sanitize_latex("Process engineer with 3 years experience")
    assert result == "Process engineer with 3 years experience"

def test_sanitize_backslash_becomes_textbackslash():
    # A literal backslash in summary should become \textbackslash\{\}
    # Note: after the backslash is replaced with \textbackslash{}, the { and }
    # in that replacement are themselves escaped to \{ and \}, giving \textbackslash\{\}
    result = sanitize_latex("path\\to\\file")
    assert r"\textbackslash\{\}" in result

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
```

- [ ] **Step 6: Run tests to verify they all FAIL (app.py doesn't exist yet)**

```bash
cd resume-compiler && pip install flask pytest && python -m pytest tests/test_app.py -v 2>&1 | head -30
```

Expected: `ModuleNotFoundError: No module named 'app'` or similar import failures.

- [ ] **Step 7: Create `resume-compiler/app.py`**

```python
import os
import re
import uuid
import subprocess
import shutil
from io import BytesIO
from flask import Flask, request, send_file, jsonify

app = Flask(__name__)

TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")

VALID_VARIANTS = {"A", "B", "C", "D"}

# Characters that break LaTeX if not escaped.
# Applied ONLY to plain-text inputs (summary, company, role).
# NOT applied to skills_latex — that's already valid LaTeX.
_LATEX_ESCAPES = [
    ("\\", r"\textbackslash{}"),   # must be first to avoid double-escaping
    ("&",  r"\&"),
    ("%",  r"\%"),
    ("$",  r"\$"),
    ("#",  r"\#"),
    ("_",  r"\_"),
    ("{",  r"\{"),
    ("}",  r"\}"),
    ("^",  r"\^{}"),
    ("~",  r"\~{}"),
]


def sanitize_latex(text: str) -> str:
    """Escape LaTeX special characters in plain text before injection."""
    if not text:
        return ""
    for old, new in _LATEX_ESCAPES:
        text = text.replace(old, new)
    return text


def inject_placeholders(tex: str, summary: str, skills_latex: str) -> str:
    """
    Replace sentinel markers in a .tex template string.

    Markers expected in template:
      %%SUMMARY%%            — inside \\textbf{%%SUMMARY%%}
      %%SKILLS_BLOCK_START%% — begins the skills section
      %%SKILLS_BLOCK_END%%   — ends the skills section
    """
    # Inject summary (plain text — must be sanitized before this call)
    tex = tex.replace("%%SUMMARY%%", summary)

    # Inject skills block (already valid LaTeX — inject verbatim)
    tex = re.sub(
        r"%%SKILLS_BLOCK_START%%.*?%%SKILLS_BLOCK_END%%",
        skills_latex,
        tex,
        flags=re.DOTALL,
    )
    return tex


def _safe_filename_part(s: str, max_len: int = 25) -> str:
    """Strip chars unsafe in filenames and truncate."""
    safe = re.sub(r"[^\w\-]", "_", s or "")
    return safe[:max_len].strip("_")


def _compile_tex(tex_content: str) -> bytes:
    """
    Write tex_content to a temp dir, compile with pdflatex, return PDF bytes.
    Raises RuntimeError with last 2000 chars of log on failure.
    Cleans up temp dir on exit.
    """
    tmpdir = f"/tmp/{uuid.uuid4()}"
    os.makedirs(tmpdir, exist_ok=True)
    try:
        tex_path = os.path.join(tmpdir, "resume.tex")
        with open(tex_path, "w", encoding="utf-8") as f:
            f.write(tex_content)

        result = subprocess.run(
            [
                "pdflatex",
                "-interaction=nonstopmode",
                f"-output-directory={tmpdir}",
                tex_path,
            ],
            capture_output=True,
            timeout=30,
            cwd=tmpdir,
        )

        pdf_path = os.path.join(tmpdir, "resume.pdf")
        if not os.path.exists(pdf_path):
            log = result.stdout.decode("utf-8", errors="replace")
            raise RuntimeError(log[-2000:])

        with open(pdf_path, "rb") as f:
            return f.read()
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _load_template(variant: str) -> str:
    path = os.path.join(TEMPLATES_DIR, f"resume_{variant}.tex")
    if not os.path.exists(path):
        raise FileNotFoundError(f"Template not found: resume_{variant}.tex")
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _validate_template_markers(tex: str, variant: str) -> None:
    """Raise if required sentinels are missing from the template."""
    required = ["%%SUMMARY%%", "%%SKILLS_BLOCK_START%%", "%%SKILLS_BLOCK_END%%"]
    missing = [m for m in required if m not in tex]
    if missing:
        raise ValueError(
            f"Template resume_{variant}.tex is missing markers: {missing}. "
            "Add them before deploying."
        )


# ──────────────────────────────────────────────
# Startup validation — fail fast if templates broken
# ──────────────────────────────────────────────

def _startup_validate():
    for v in VALID_VARIANTS:
        path = os.path.join(TEMPLATES_DIR, f"resume_{v}.tex")
        if not os.path.exists(path):
            # Templates are provided by user — warn but don't crash on startup
            print(f"[WARN] Template not found: resume_{v}.tex — /generate will fail for variant {v}")
            continue
        with open(path, "r") as f:
            content = f.read()
        try:
            _validate_template_markers(content, v)
            print(f"[OK] Template resume_{v}.tex — markers validated")
        except ValueError as e:
            print(f"[ERROR] {e}")


# ──────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────

@app.route("/health")
def health():
    return "ok", 200


@app.route("/generate", methods=["POST"])
def generate():
    data = request.get_json(silent=True) or {}

    variant = data.get("variant", "").upper()
    summary = data.get("summary", "").strip()
    skills_latex = data.get("skills_latex", "").strip()

    # Validation
    if not variant:
        return jsonify(error="variant is required (A, B, C, or D)"), 400
    if variant not in VALID_VARIANTS:
        return jsonify(error=f"Invalid variant '{variant}'. Must be A, B, C, or D"), 400
    if not summary:
        return jsonify(error="summary is required"), 400
    if not skills_latex:
        return jsonify(error="skills_latex is required"), 400

    try:
        base_tex = _load_template(variant)
        _validate_template_markers(base_tex, variant)
    except FileNotFoundError as e:
        return jsonify(error=str(e)), 500
    except ValueError as e:
        return jsonify(error=str(e)), 500

    # Inject — sanitize summary (plain text), inject skills verbatim (already LaTeX)
    patched_tex = inject_placeholders(
        base_tex,
        summary=sanitize_latex(summary),
        skills_latex=skills_latex,
    )

    try:
        pdf_bytes = _compile_tex(patched_tex)
    except subprocess.TimeoutExpired:
        return jsonify(error="Compilation timed out (30s). Check template for infinite loops."), 504
    except RuntimeError as e:
        return jsonify(error="LaTeX compilation failed", log=str(e)), 500

    company = _safe_filename_part(data.get("company", "Company"))
    role = _safe_filename_part(data.get("role", "Role"))
    filename = f"Resume_{variant}_{company}_{role}.pdf"

    return send_file(
        BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=True,
        download_name=filename,
    )


@app.route("/generate-cover-letter", methods=["POST"])
def generate_cover_letter():
    data = request.get_json(silent=True) or {}

    company = data.get("company", "").strip()
    role = data.get("role", "").strip()
    variant_focus = data.get("variant_focus", "").strip()
    summary = data.get("summary", "").strip()

    if not company or not role:
        return jsonify(error="company and role are required"), 400

    cl_path = os.path.join(TEMPLATES_DIR, "cover_letter.tex")
    if not os.path.exists(cl_path):
        return jsonify(error="cover_letter.tex template not found"), 500

    with open(cl_path, "r", encoding="utf-8") as f:
        cl_tex = f.read()

    # All plain text injections — sanitize everything
    cl_tex = cl_tex.replace("%%COMPANY%%", sanitize_latex(company))
    cl_tex = cl_tex.replace("%%ROLE%%", sanitize_latex(role))
    cl_tex = cl_tex.replace("%%VARIANT_FOCUS%%", sanitize_latex(variant_focus))
    cl_tex = cl_tex.replace("%%SUMMARY_SENTENCE%%", sanitize_latex(summary))

    try:
        pdf_bytes = _compile_tex(cl_tex)
    except subprocess.TimeoutExpired:
        return jsonify(error="Compilation timed out"), 504
    except RuntimeError as e:
        return jsonify(error="LaTeX compilation failed", log=str(e)), 500

    co_safe = _safe_filename_part(company)
    role_safe = _safe_filename_part(role)
    filename = f"CoverLetter_{co_safe}_{role_safe}.pdf"

    return send_file(
        BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=True,
        download_name=filename,
    )


if __name__ == "__main__":
    _startup_validate()
    app.run(host="0.0.0.0", port=8080, debug=True)
```

Call `_startup_validate()` also at module load when run via gunicorn:

Add this at the bottom of the file, outside `if __name__`. Guard it so pytest imports don't fire it:
```python
# Run validation when loaded by gunicorn (not during tests)
import os as _os
if not _os.environ.get("FLASK_TESTING"):
    with app.app_context():
        _startup_validate()
```

And at the top of `tests/test_app.py`, before importing app, set the guard:
```python
import os
os.environ["FLASK_TESTING"] = "1"  # prevent startup validation during test import
```

- [ ] **Step 8: Run tests again — all should now pass except the Flask endpoint integration tests (which need a real template)**

```bash
cd resume-compiler && python -m pytest tests/test_app.py -v
```

Expected output: All `test_sanitize_*`, `test_inject_*`, `test_health_endpoint` pass.
`test_generate_missing_variant`, `test_generate_invalid_variant`, `test_generate_missing_summary` should pass.

- [ ] **Step 9: Commit the service scaffold**

```bash
git add resume-compiler/
git commit -m "feat: add resume compilation microservice scaffold (Flask + pdflatex)"
```

---

## Phase 1 — Template Preparation (REQUIRES `.tex` files from user)

**Subagent: general-purpose**

> **BLOCKED until user provides the 4 `.tex` files.**
> User must copy `resume_A.tex`, `resume_B.tex`, `resume_C.tex`, `resume_D.tex` from Overleaf into `resume-compiler/templates/`.

### Task 1.1: Identify placeholder locations in each `.tex` file

- [ ] **Step 1: Open `resume_A.tex` and find the summary section**

Look for the line containing the summary text. It will look something like:
```latex
\textbf{Manufacturing engineer with expertise in GD\&T...}
```
The exact summary text is in `src/lib/scoring.js` → `TEMPLATE_SUMMARIES.A`.

- [ ] **Step 2: Replace the summary text with the placeholder sentinel**

Change:
```latex
\textbf{Manufacturing engineer with expertise in GD\&T, CMM inspection, and fixture design. Reduced defect rates from 15\% to 3\% through SPC implementation at Tata Boeing. STEM OPT — 3 years, no sponsorship cost.}
```
To:
```latex
\textbf{%%SUMMARY%%}
```

- [ ] **Step 3: Find the skilllines block in `resume_A.tex`**

Look for lines matching `\skillline{...}{...}`. They will look like:
```latex
\skillline{Manufacturing \& Quality:}{GD\&T, CMM Inspection, ...}
\skillline{Process \& Tooling:}{Fixtures \& Jigs, ...}
...
```

- [ ] **Step 4: Wrap the entire skilllines block with sentinels**

```latex
%%SKILLS_BLOCK_START%%
\skillline{Manufacturing \& Quality:}{GD\&T, CMM Inspection, First Article Inspection, PPAP, AS9100, SPC, Dimensional Inspection}
\skillline{Process \& Tooling:}{Fixtures \& Jigs, Metrology, Tolerance Analysis, NADCAP, Production Planning, Shop Floor}
\skillline{Engineering Tools:}{SolidWorks, CATIA, MATLAB, Python}
\skillline{Manufacturing Processes:}{Machining, Assembly, Stamping, Casting, Forging, Welding, CNC}
\skillline{Project Management:}{Cross-Functional Collaboration, Continuous Improvement, Lean Methodologies}
%%SKILLS_BLOCK_END%%
```

The sentinels must be on their own lines, no trailing spaces.

- [ ] **Step 5: Repeat Steps 1-4 for `resume_B.tex`, `resume_C.tex`, `resume_D.tex`**

Use the corresponding entries in `TEMPLATE_SUMMARIES` and `TEMPLATE_SKILLS` from `src/lib/scoring.js` to identify the exact text to replace.

- [ ] **Step 6: Verify each modified template still compiles in Overleaf**

Upload the modified `.tex` back to Overleaf and compile.

**Expected behavior with sentinels in place:**
- `%%SUMMARY%%` inside `\textbf{%%SUMMARY%%}`: In LaTeX, `%` starts a comment. So `%%SUMMARY%%` is parsed as `%` (comment, rest of line ignored until `%%`) — actually both `%` characters start line comments. The result is that LaTeX sees `\textbf{}` with essentially empty or partial content. The PDF will show a blank or partial line where the summary was. **This is expected and correct** — the template is now meant for automated injection, not direct Overleaf compilation.

- `%%SKILLS_BLOCK_START%%` and `%%SKILLS_BLOCK_END%%` on their own lines: LaTeX will comment them out (they start with `%`). The original `\skillline` rows between them will still compile. The Overleaf PDF will look normal in the skills section.

What to verify: The PDF compiles without errors (no red compile failures in Overleaf). A blank summary line is acceptable — the Overleaf copy is now the template source, not the final output. The automated service produces the final PDFs going forward.

- [ ] **Step 7: Commit the template files**

```bash
git add resume-compiler/templates/
git commit -m "feat: add base .tex templates with injection sentinels"
```

### Task 1.2: Create the cover letter LaTeX template

- [ ] **Step 1: Create `resume-compiler/templates/cover_letter.tex`**

```latex
\documentclass[11pt,letterpaper]{article}
\usepackage[margin=1in]{geometry}
\usepackage{parskip}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\usepackage{hyperref}
\hypersetup{colorlinks=true, urlcolor=black}

\pagestyle{empty}

\begin{document}

\today

Dear Hiring Manager,

I am writing to apply for the \textbf{%%ROLE%%} position at \textbf{%%COMPANY%%}.
As an MS Aerospace Engineering graduate from the University of Illinois Urbana-Champaign
(December 2025), I bring hands-on experience in %%VARIANT_FOCUS%%.

%%SUMMARY_SENTENCE%%

At Tata Boeing Aerospace, I reduced defect rates from 15\% to 3\% through SPC and 8D
methodology. At SAMPE, I led the fabrication of a 24-inch composite fuselage achieving
2\% void content via autoclave cure at 275\textdegree F/40 psi.

I am available on STEM OPT for 3 years with zero sponsorship cost to the employer, and
I am excited about the opportunity to contribute to %%COMPANY%%.

\bigskip

Sincerely,

\bigskip\bigskip

Siddardth Pathipaka

\end{document}
```

- [ ] **Step 2: Test cover letter compiles standalone**

```bash
cd resume-compiler/templates
pdflatex -interaction=nonstopmode cover_letter.tex
# Expected: cover_letter.pdf created with literal %%PLACEHOLDER%% text visible
```

If pdflatex not installed locally, skip to deployment stage — the Docker image will have it.

- [ ] **Step 3: Commit**

```bash
git add resume-compiler/templates/cover_letter.tex
git commit -m "feat: add cover letter LaTeX template"
```

---

## Phase 2 — Local Compilation Test

**Subagent: general-purpose**

### Task 2.1: Test the service locally with real templates

- [ ] **Step 1: Build the Docker image locally**

```bash
cd resume-compiler
docker build -t resume-compiler:local .
```

Expected: Build completes, last line shows pdflatex version.
Note: This will take 3-5 minutes on first build — downloading TeX Live.

- [ ] **Step 2: Run the container locally**

```bash
docker run -p 8080:8080 resume-compiler:local
```

Expected: gunicorn starts on port 8080. Should see `[OK] Template resume_A.tex — markers validated` x4 in startup logs.

- [ ] **Step 3: Test health endpoint**

```bash
curl http://localhost:8080/health
```

Expected: `ok`

- [ ] **Step 4: Test PDF generation with variant A**

```bash
curl -X POST http://localhost:8080/generate \
  -H "Content-Type: application/json" \
  -d '{
    "variant": "A",
    "summary": "Manufacturing engineer with expertise in GD&T, CMM inspection, and fixture design. Reduced defect rates from 15% to 3% through SPC implementation at Tata Boeing. STEM OPT — 3 years, no sponsorship cost.",
    "skills_latex": "\\\\skillline{Manufacturing \\\\& Quality:}{GD\\\\&T, CMM Inspection, PPAP, AS9100}\n\\\\skillline{Engineering Tools:}{SolidWorks, CATIA, MATLAB, Python}",
    "company": "Acme Corp",
    "role": "Manufacturing Engineer"
  }' \
  --output test_resume_A.pdf

open test_resume_A.pdf
```

Expected: A PDF file opens. It should look identical to your Overleaf output with the injected summary and skills.

- [ ] **Step 5: If compilation fails, read the error**

```bash
curl -X POST http://localhost:8080/generate \
  -H "Content-Type: application/json" \
  -d '{"variant": "A", "summary": "test", "skills_latex": "\\\\skillline{X:}{y}"}' | python3 -m json.tool
```

The `log` field in the error JSON shows the last 2000 characters of the pdflatex log. Common issues:
- Missing LaTeX package → add to Dockerfile `apt-get install texlive-*` line
- Unescaped character in summary → check sanitizer
- Sentinel not found → verify exact string match in template

- [ ] **Step 6: Test all 4 variants**

```bash
for v in A B C D; do
  curl -s -X POST http://localhost:8080/generate \
    -H "Content-Type: application/json" \
    -d "{\"variant\": \"$v\", \"summary\": \"Test summary.\", \"skills_latex\": \"\\\\\\\\skillline{Test:}{skills}\"}" \
    --output /dev/null \
    -w "Variant $v: HTTP %{http_code}\n"
done
```

Expected: All 4 return HTTP 200.

- [ ] **Step 7: Test cover letter endpoint**

```bash
curl -X POST http://localhost:8080/generate-cover-letter \
  -H "Content-Type: application/json" \
  -d '{
    "company": "Boeing",
    "role": "Process Engineer",
    "variant_focus": "Process & CI",
    "summary": "Process engineer with lean manufacturing expertise."
  }' \
  --output test_cl.pdf

open test_cl.pdf
```

- [ ] **Step 8: Commit any fixes found during local testing**

```bash
git add resume-compiler/
git commit -m "fix: resolve local compilation issues"
```

---

## Phase 3 — Deploy to Railway

**Subagent: general-purpose**

### Task 3.1: Deploy the microservice

- [ ] **Step 1: Install Railway CLI**

```bash
npm install -g @railway/cli
```

- [ ] **Step 2: Login to Railway**

```bash
railway login
```

This opens a browser. Login with GitHub.

- [ ] **Step 3: Initialize Railway project**

```bash
cd resume-compiler
railway init
```

When prompted:
- Project name: `resume-compiler`
- Starting from: `Empty Project`

- [ ] **Step 4: Deploy**

```bash
railway up
```

This uploads the directory and builds the Docker image on Railway's servers.
First build will take 5-10 minutes (TeX Live download).

- [ ] **Step 5: Get the deployment URL**

```bash
railway domain
```

Or in the Railway dashboard → Settings → Domains → Generate Domain.
Note the URL — it will look like `https://resume-compiler-production-xxxx.up.railway.app`

- [ ] **Step 6: Verify deployment**

```bash
curl https://YOUR_RAILWAY_URL/health
```

Expected: `ok`

- [ ] **Step 7: Set CORS environment variable on Railway**

In Railway dashboard → Variables, add:
```
ALLOWED_ORIGIN=https://your-vercel-app-url.vercel.app
```

Or for development, set `ALLOWED_ORIGIN=*` temporarily.

Update `app.py` to read this and add CORS headers:

```python
from flask import Flask, request, send_file, jsonify, make_response

# After app = Flask(__name__)
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")

@app.after_request
def add_cors(response):
    response.headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN
    response.headers["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    # Expose Content-Disposition so the frontend can read the filename cross-origin
    response.headers["Access-Control-Expose-Headers"] = "Content-Disposition"
    return response

@app.route("/generate", methods=["OPTIONS"])
def generate_preflight():
    return "", 204

@app.route("/generate-cover-letter", methods=["OPTIONS"])
def cl_preflight():
    return "", 204
```

- [ ] **Step 8: Redeploy after CORS fix**

```bash
railway up
```

- [ ] **Step 9: Test deployed endpoint from terminal**

```bash
curl -X POST https://YOUR_RAILWAY_URL/generate \
  -H "Content-Type: application/json" \
  -d '{"variant": "B", "summary": "Process engineer.", "skills_latex": "\\\\skillline{CI:}{Lean, FMEA}", "company": "Boeing", "role": "Process Eng"}' \
  --output deployed_test.pdf

open deployed_test.pdf
```

Expected: PDF downloads and looks correct.

- [ ] **Step 10: Save the Railway URL to `.env.local`**

```bash
# In jobagent-web root:
echo "VITE_COMPILER_URL=https://YOUR_RAILWAY_URL" >> .env.local
```

Make sure `.env.local` is in `.gitignore`:

```bash
grep -q ".env.local" .gitignore || echo ".env.local" >> .gitignore
```

- [ ] **Step 11: Commit**

```bash
cd ..  # back to jobagent-web root
git add .gitignore resume-compiler/app.py
git commit -m "feat: add CORS support and Railway deployment config"
```

---

## Phase 4 — Frontend Integration

**Subagent: general-purpose**

### Task 4.1: Create the cover letter helper module

**Files:**
- Create: `src/lib/coverLetter.js`

- [ ] **Step 1: Create `src/lib/coverLetter.js`**

This extracts the cover letter variables from the analysis result. Keep it simple and rule-based.

```javascript
import { VARIANT_KEYWORDS } from './scoring.js';

/**
 * Build the payload for the /generate-cover-letter endpoint
 * from the analysis result and job fields.
 */
export function buildCoverLetterPayload({ result, company, role }) {
  const variantFocus = VARIANT_KEYWORDS[result.recommendedResume]?.name ?? "";

  return {
    company,
    role,
    variant_focus: variantFocus,
    // Use the full summary — service will inject it into the template
    summary: result.mod1_summary,
  };
}
```

- [ ] **Step 2: Verify the import works**

```bash
cd /Users/jashwanth/jobagent-web
node -e "import('./src/lib/coverLetter.js').then(m => console.log(Object.keys(m)))" --input-type=module 2>&1
```

Expected: `[ 'buildCoverLetterPayload' ]`

### Task 4.2: Add download functionality to JobAnalysis.jsx

**Files:**
- Modify: `src/components/JobAnalysis.jsx`

This is the core frontend change. Read the file before modifying.

- [ ] **Step 1: Add the compiler URL constant near the top of `JobAnalysis.jsx`**

After the `RESUMES` constant (around line 10), add:

```javascript
const COMPILER_URL = import.meta.env.VITE_COMPILER_URL ?? "http://localhost:8080";
```

- [ ] **Step 2: Add import for `buildCoverLetterPayload`**

At the top of the file, after the existing imports:

```javascript
import { buildCoverLetterPayload } from '../lib/coverLetter.js';
```

- [ ] **Step 3: Add download state variables inside the component**

Inside `JobAnalysis` component, after the existing `useState` declarations (around line 73):

```javascript
const [genLoading, setGenLoading] = useState(null); // null | "resume" | "coverletter"
const [genError, setGenError] = useState(null);
```

- [ ] **Step 4: Add the `downloadResume` function inside the component**

After the `copyText` function (around line 129):

```javascript
const downloadFile = async (endpoint, payload, fallbackFilename) => {
  setGenLoading(endpoint === "/generate" ? "resume" : "coverletter");
  setGenError(null);
  try {
    const res = await fetch(`${COMPILER_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // Use filename from Content-Disposition header if available
    const cd = res.headers.get("Content-Disposition") ?? "";
    const nameMatch = cd.match(/filename="?([^";\n]+)"?/);
    a.download = nameMatch ? nameMatch[1] : fallbackFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    setGenError(err.message);
  } finally {
    setGenLoading(null);
  }
};

const downloadResume = () => {
  if (!result) return;
  downloadFile(
    "/generate",
    {
      variant: result.recommendedResume,
      summary: result.mod1_summary,
      skills_latex: result.mod2_skills,
      company: co,
      role: role,
    },
    `Resume_${result.recommendedResume}_${co || "Company"}.pdf`
  );
};

const downloadCoverLetter = () => {
  if (!result) return;
  const payload = buildCoverLetterPayload({ result, company: co, role });
  downloadFile(
    "/generate-cover-letter",
    payload,
    `CoverLetter_${co || "Company"}.pdf`
  );
};
```

- [ ] **Step 5: Add the download buttons and error display to the JSX**

Find the action buttons section (around line 359 — the `div` with "Find Contacts", "Complete & Log", "Re-Analyze"):

**Before the existing action buttons div**, add an error display:
```jsx
{genError && (
  <div style={{
    background: t.redL,
    border: `1px solid ${t.redBd}`,
    borderRadius: 8,
    padding: "10px 16px",
    marginBottom: 12,
    fontSize: 12.5,
    color: t.red,
    fontWeight: 600
  }}>
    Generation failed: {genError}. Check that the compilation service is running.
  </div>
)}
```

**Add a new download buttons row** between the existing red "CRITICAL" warning and the mod cards grid:

Find this block (around line 244):
```jsx
<div style={{background:t.redL,border:`1px solid ${t.redBd}`...}}>
  CRITICAL: Only TWO modifications...
</div>
```

After that div, insert:
```jsx
{/* Download Buttons */}
<div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
  <Btn
    onClick={downloadResume}
    disabled={genLoading !== null}
    t={t}
    style={{background: t.pri}}
  >
    {genLoading === "resume" ? "Compiling PDF…" : "⬇ Download Resume PDF"}
  </Btn>
  <Btn
    onClick={downloadCoverLetter}
    disabled={genLoading !== null}
    variant="secondary"
    t={t}
  >
    {genLoading === "coverletter" ? "Generating…" : "⬇ Download Cover Letter"}
  </Btn>
  {genLoading && (
    <span style={{fontSize:12,color:t.muted,fontStyle:"italic"}}>
      First generation may take a few seconds if the service just started…
    </span>
  )}
</div>
```

- [ ] **Step 6: Start the dev server and verify no import errors**

```bash
cd /Users/jashwanth/jobagent-web
npm run dev
```

Open `http://localhost:5173`. Navigate to a job in Pipeline → Job Analysis. Run the analysis. Verify:
- The download buttons appear below the "CRITICAL" warning
- Clicking "Download Resume PDF" shows "Compiling PDF…" loading state
- The request goes to `http://localhost:8080/generate` (visible in Network tab)

- [ ] **Step 7: End-to-end test with the local Docker container running**

In a separate terminal:
```bash
cd resume-compiler && docker run -p 8080:8080 resume-compiler:local
```

Then in the app, paste a real JD, run analysis, click "Download Resume PDF".

Expected: PDF downloads after 3-8 seconds. Open it and verify it looks correct.

- [ ] **Step 8: Update the `VITE_COMPILER_URL` to the Railway deployment URL**

```bash
# Edit .env.local
# Change: VITE_COMPILER_URL=http://localhost:8080
# To:     VITE_COMPILER_URL=https://YOUR_RAILWAY_URL
```

Restart the dev server. Test the download again against the deployed service.

- [ ] **Step 9: Commit frontend changes**

```bash
# Do NOT add .env.local — it is in .gitignore and contains private service URLs
git add src/components/JobAnalysis.jsx src/lib/coverLetter.js
git commit -m "feat: add resume and cover letter PDF download to Job Analysis"
```

---

## Phase 5 — Production Wiring + Keep-Alive

**Subagent: general-purpose**

### Task 5.1: Wire the Railway URL into the Vercel deployment

The `VITE_COMPILER_URL` env var must be set on Vercel so the deployed frontend knows where the compiler is. This is not in `.env.local` (that's local only) — it must be set as a Vercel environment variable.

- [ ] **Step 1: Set the env var in Vercel**

Option A — Vercel Dashboard:
- Go to vercel.com → Your project → Settings → Environment Variables
- Add: `VITE_COMPILER_URL` = `https://YOUR_RAILWAY_URL`
- Apply to: Production, Preview, Development

Option B — Vercel CLI:
```bash
npx vercel env add VITE_COMPILER_URL
# Paste the Railway URL when prompted
# Select: Production, Preview, Development
```

- [ ] **Step 2: Redeploy Vercel**

```bash
git push origin main
```

Vercel auto-deploys on push. Or trigger manually in the dashboard.

- [ ] **Step 3: Test the production URL**

Open your Vercel deployment URL → Job Analysis → run analysis → click Download Resume PDF.

Expected: PDF downloads from the production Railway service.

### Task 5.2: Keep-alive for Railway free tier (prevents cold starts)

Railway's free tier (and Render's) spins down containers after ~15 minutes of inactivity. First request after spin-down takes 20-30 seconds. This is bad UX. Solve it with a scheduled ping.

- [ ] **Step 1: Create a Supabase Edge Function as a cron pinger**

In the Supabase dashboard → Edge Functions → Create Function → name it `keep-compiler-alive`:

```typescript
// supabase/functions/keep-compiler-alive/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(async () => {
  const url = Deno.env.get("COMPILER_URL") + "/health"
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    const body = await res.text()
    console.log(`Ping result: ${res.status} — ${body}`)
    return new Response(`Pinged: ${res.status}`, { status: 200 })
  } catch (e) {
    console.error(`Ping failed: ${e.message}`)
    return new Response(`Ping failed: ${e.message}`, { status: 500 })
  }
})
```

- [ ] **Step 2: Set COMPILER_URL secret in Supabase**

```bash
npx supabase secrets set COMPILER_URL=https://YOUR_RAILWAY_URL
```

- [ ] **Step 3: Schedule the ping every 10 minutes**

In Supabase Dashboard → Database → Extensions → enable `pg_cron`.

Then in SQL Editor:
```sql
select cron.schedule(
  'ping-compiler',
  '*/10 * * * *',  -- every 10 minutes
  $$
  select net.http_post(
    url := 'https://YOUR_SUPABASE_PROJECT.supabase.co/functions/v1/keep-compiler-alive',
    headers := '{"Authorization": "Bearer YOUR_SUPABASE_ANON_KEY"}'::jsonb
  )
  $$
);
```

Alternatively, use a simpler external cron like cron-job.org (free) — set it to GET `https://YOUR_RAILWAY_URL/health` every 10 minutes.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/ 2>/dev/null || true
git commit -m "feat: add keep-alive cron for compilation service"
```

---

## Phase 6 — Verification Pass

**Subagent: superpowers:code-reviewer**

### Task 6.1: End-to-end smoke test of the complete workflow

- [ ] **Step 1: Full workflow test — variant A**

1. Open the app on production Vercel URL
2. Navigate to Pipeline → create or select a job
3. Paste a real manufacturing JD into Job Analysis
4. Click "Run Resume Analysis"
5. Verify: `recommendedResume` is displayed, Summary and Skills cards show content
6. Click "Download Resume PDF"
7. Verify: loading state shows, then PDF downloads
8. Open the PDF: confirm summary text matches `mod1_summary`, skills block matches `mod2_skills`

- [ ] **Step 2: Verify all 4 variants generate PDFs**

Manually test by using the variant override (A/B/C/D override buttons) and downloading once per variant.

- [ ] **Step 3: Test cover letter download**

Click "Download Cover Letter". Verify company name, role, and focus area appear correctly in the PDF.

- [ ] **Step 4: Test error handling**

Temporarily set `VITE_COMPILER_URL=http://localhost:9999` (nothing running there). Click Download. Verify the red error message appears and does not crash the page.

Reset to correct URL.

- [ ] **Step 5: Test special characters in company/role name**

Set company to `Smith & Wesson` and role to `Engineer #1`. Run analysis. Download resume. Verify the PDF compiles without error (the `&` and `#` get escaped by the sanitizer).

- [ ] **Step 6: Confirm existing functionality still works**

- Copy buttons for summary and skills still work
- "Complete & Log to Tracker" still works
- "Find Contacts" navigation still works
- Pipeline view shows correct resume variant

---

## Quick Reference — Sentinel Format

When preparing the `.tex` files (Phase 1), the exact sentinel strings must match exactly:

| Sentinel | Where it goes | Notes |
|---|---|---|
| `%%SUMMARY%%` | Inside `\textbf{%%SUMMARY%%}` | Plain text injected here, pre-sanitized |
| `%%SKILLS_BLOCK_START%%` | Line before first `\skillline` | Must be on its own line |
| `%%SKILLS_BLOCK_END%%` | Line after last `\skillline` | Must be on its own line |

For cover letter:

| Sentinel | Description |
|---|---|
| `%%COMPANY%%` | Company name |
| `%%ROLE%%` | Job title |
| `%%VARIANT_FOCUS%%` | e.g. "Process & CI" |
| `%%SUMMARY_SENTENCE%%` | Full summary from mod1 |

---

## Environment Variables Reference

| Variable | Where set | Value |
|---|---|---|
| `VITE_COMPILER_URL` | `.env.local` (dev), Vercel (prod) | Railway deployment URL |
| `ALLOWED_ORIGIN` | Railway environment variable | Vercel deployment URL |
| `COMPILER_URL` | Supabase secrets | Railway deployment URL |

---

## Dependency Matrix

```
Phase 0 (scaffold)                  → no dependencies, start immediately
Phase 1 (templates)                 → BLOCKED on user providing .tex files
Phase 2 (local test)                → requires Phase 0 + Phase 1 complete
Phase 3 (deploy Railway)            → requires Phase 2 passing
Phase 4 Steps 1-7 (frontend build)  → requires Phase 0 only; test against local Docker from Phase 2
Phase 4 Step 8 (switch to prod URL) → requires Phase 3 URL available
Phase 5 (production wiring)         → requires Phase 4 complete
Phase 6 (verification)              → requires Phase 5 complete

Phase 0 and Phase 4 Steps 1-7 can run in parallel.
```

Phase 0 and Phase 1 template creation can be worked on in parallel once `.tex` files are provided.
