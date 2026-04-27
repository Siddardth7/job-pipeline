import os
import re
import uuid
import json
import hmac
import hashlib
import base64
import subprocess
import shutil
from io import BytesIO
from functools import wraps
from flask import Flask, request, send_file, jsonify

SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")


def _verify_supabase_jwt(token: str) -> bool:
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return False
        header_b64, payload_b64, sig_b64 = parts
        def pad(s): return s + '=' * (-len(s) % 4)
        message = f"{header_b64}.{payload_b64}".encode()
        sig = base64.urlsafe_b64decode(pad(sig_b64))
        expected = hmac.new(SUPABASE_JWT_SECRET.encode(), message, hashlib.sha256).digest()
        return hmac.compare_digest(sig, expected)
    except Exception:
        return False


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not SUPABASE_JWT_SECRET:
            return f(*args, **kwargs)
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return jsonify(error='Unauthorized'), 401
        token = auth[7:]
        if not _verify_supabase_jwt(token):
            return jsonify(error='Unauthorized'), 401
        return f(*args, **kwargs)
    return decorated


app = Flask(__name__)

TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")
VALID_VARIANTS = {"A", "B", "C", "D"}
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")

# Characters that break LaTeX if not escaped.
# Applied ONLY to plain-text inputs (summary, company, role).
# NOT applied to skills_latex — that's already valid LaTeX.
_LATEX_SPECIAL = re.compile(r'[\\&%$#_{}^~]')

_LATEX_REPLACEMENTS = {
    '\\': r'\textbackslash{}',
    '&':  r'\&',
    '%':  r'\%',
    '$':  r'\$',
    '#':  r'\#',
    '_':  r'\_',
    '{':  r'\{',
    '}':  r'\}',
    '^':  r'\^{}',
    '~':  r'\~{}',
}

def sanitize_latex(text: str) -> str:
    """Escape LaTeX special characters in plain text before injection.
    Uses a single-pass regex so replacements are never re-processed."""
    if not text:
        return ""
    return _LATEX_SPECIAL.sub(lambda m: _LATEX_REPLACEMENTS[m.group(0)], text)


_CERTIFICATIONS_LINE = re.compile(
    r"\\skillline\{Certifications:[^}]*\}\{[^}]*\}\s*\n?",
    re.IGNORECASE,
)


def strip_locked_skills(skills_latex: str) -> str:
    """Remove skill lines that are hardcoded in the template outside the block.
    Prevents duplicates when the AI also emits those lines inside skills_latex."""
    return _CERTIFICATIONS_LINE.sub("", skills_latex)


def inject_placeholders(tex: str, summary: str, skills_latex: str) -> str:
    """
    Replace sentinel markers in a .tex template string.

    Markers expected in template:
      %%SUMMARY%%            — inside \\textbf{%%SUMMARY%%}
      %%SKILLS_BLOCK_START%% — begins the skills section
      %%SKILLS_BLOCK_END%%   — ends the skills section
    """
    tex = tex.replace("%%SUMMARY%%", summary)
    tex = re.sub(
        r"%%SKILLS_BLOCK_START%%.*?%%SKILLS_BLOCK_END%%",
        lambda _: skills_latex,
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
    Write tex_content to a temp dir, compile with tectonic, return PDF bytes.
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
                "tectonic",
                "--outdir", tmpdir,
                tex_path,
            ],
            capture_output=True,
            timeout=60,
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


def _startup_validate():
    for v in VALID_VARIANTS:
        path = os.path.join(TEMPLATES_DIR, f"resume_{v}.tex")
        if not os.path.exists(path):
            print(f"[WARN] Template not found: resume_{v}.tex — /generate will fail for variant {v}")
            continue
        with open(path, "r") as f:
            content = f.read()
        try:
            _validate_template_markers(content, v)
            print(f"[OK] Template resume_{v}.tex — markers validated")
        except ValueError as e:
            print(f"[ERROR] {e}")


@app.after_request
def add_cors(response):
    response.headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN
    response.headers["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Expose-Headers"] = "Content-Disposition"
    return response


@app.route("/generate", methods=["OPTIONS"])
def generate_preflight():
    return "", 204


@app.route("/generate-cover-letter", methods=["OPTIONS"])
def cl_preflight():
    return "", 204


@app.route("/health")
def health():
    return "ok", 200


@app.route("/parse", methods=["OPTIONS"])
def parse_preflight():
    return "", 204


@app.route("/parse", methods=["POST"])
@require_auth
def parse_resume():
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


@app.route("/compile", methods=["OPTIONS"])
def compile_preflight():
    return "", 204


@app.route("/compile", methods=["POST"])
@require_auth
def compile_resume():
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
        autoescape=select_autoescape([]),
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


@app.route("/generate", methods=["POST"])
def generate():
    data = request.get_json(silent=True) or {}

    variant = data.get("variant", "").upper()
    summary = data.get("summary", "").strip()
    skills_latex = data.get("skills_latex", "").strip()

    if not variant:
        return jsonify(error="variant is required (A, B, C, or D)"), 400
    if variant not in VALID_VARIANTS:
        return jsonify(error=f"Invalid variant '{variant}'. Must be A, B, C, or D"), 400
    if not skills_latex:
        return jsonify(error="skills_latex is required"), 400

    if len(skills_latex) > 50_000:
        return jsonify(error="skills_latex exceeds maximum allowed length"), 400
    if len(summary) > 5_000:
        return jsonify(error="summary exceeds maximum allowed length"), 400

    try:
        base_tex = _load_template(variant)
        _validate_template_markers(base_tex, variant)
    except FileNotFoundError as e:
        return jsonify(error=str(e)), 500
    except ValueError as e:
        return jsonify(error=str(e)), 500

    patched_tex = inject_placeholders(
        base_tex,
        summary=summary,          # already valid LaTeX (\textbf{} etc.) — do NOT sanitize
        skills_latex=strip_locked_skills(skills_latex),
    )

    try:
        pdf_bytes = _compile_tex(patched_tex)
    except subprocess.TimeoutExpired:
        return jsonify(error="Compilation timed out (60s)."), 504
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
    summary       = data.get("summary", "").strip()
    primary_cat   = sanitize_latex(data.get("primary_category", "Engineering").strip())
    if not summary:
        summary = (
            f"As a {primary_cat}-focused Aerospace Engineering graduate from the University "
            f"of Illinois Urbana-Champaign, I am confident that my technical background and "
            f"hands-on experience make me a strong candidate for this role."
        )

    if not company or not role:
        return jsonify(error="company and role are required"), 400

    if len(summary) > 5_000:
        return jsonify(error="summary exceeds maximum allowed length"), 400
    if len(variant_focus) > 500:
        return jsonify(error="variant_focus exceeds maximum allowed length"), 400

    cl_path = os.path.join(TEMPLATES_DIR, "cover_letter.tex")
    if not os.path.exists(cl_path):
        return jsonify(error="cover_letter.tex template not found"), 500

    with open(cl_path, "r", encoding="utf-8") as f:
        cl_tex = f.read()

    cl_markers = ["%%COMPANY%%", "%%ROLE%%", "%%VARIANT_FOCUS%%", "%%SUMMARY_SENTENCE%%"]
    missing_cl = [m for m in cl_markers if m not in cl_tex]
    if missing_cl:
        return jsonify(error=f"cover_letter.tex is missing markers: {missing_cl}"), 500

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
    app.run(host="0.0.0.0", port=8080, debug=True)


# Run validation when loaded by gunicorn (not during tests)
if not os.environ.get("FLASK_TESTING"):
    with app.app_context():
        _startup_validate()
