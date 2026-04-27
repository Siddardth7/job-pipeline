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

_SECTION_RE = re.compile(r'\\section\*?\{([^}]+)\}', re.IGNORECASE)
_SUBHEADING_RE = re.compile(
    r'\\resumeSubheading\{([^}]*)\}\{([^}]*)\}\{([^}]*)\}\{([^}]*)\}', re.DOTALL
)
_ITEM_RE = re.compile(r'\\resumeItem\{([^}]*(?:\{[^}]*\}[^}]*)*)\}', re.DOTALL)
_BOLD_SKILL_RE = re.compile(r'\\textbf\{([^}]+):\}\s*([^\n\\]+)', re.IGNORECASE)
_LATEX_UNESCAPE = [
    (r'\&', '&'), (r'\%', '%'), (r'\$', '$'), (r'\#', '#'),
    (r'\_', '_'), (r'\{', '{'), (r'\}', '}'),
]


def _unescape(text: str) -> str:
    for escaped, char in _LATEX_UNESCAPE:
        text = text.replace(escaped, char)
    return text.strip()


def _strip_latex(text: str) -> str:
    text = re.sub(r'\\href\{[^}]*\}\{([^}]*)\}', r'\1', text)
    text = re.sub(r'\\text(?:bf|it|tt|sc|rm|up|sl)\{([^}]*)\}', r'\1', text)
    text = re.sub(r'\\[a-zA-Z]+\{([^}]*)\}', r'\1', text)
    text = re.sub(r'\\[a-zA-Z]+\s*', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return _unescape(text)


def _canonical_section(heading: str):
    lower = heading.lower().strip()
    for key, aliases in SECTION_MAP.items():
        if any(alias in lower for alias in aliases):
            return key
    return None


def _split_by_sections(tex: str):
    parts = _SECTION_RE.split(tex)
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


def _parse_skills(body: str) -> list:
    skills = []
    for m in _BOLD_SKILL_RE.finditer(body):
        category = _unescape(m.group(1).strip())
        raw_items = m.group(2).strip()
        raw_items = re.sub(r'\\[a-zA-Z]+.*$', '', raw_items).strip()
        items = [_unescape(i.strip()) for i in raw_items.split(',') if i.strip()]
        if category and items:
            skills.append({'category': category, 'items': items})
    return skills


def _parse_subheadings(body: str) -> list:
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


def _parse_education(body: str) -> list:
    entries = []
    for m in _SUBHEADING_RE.finditer(body):
        entries.append({
            'school':     _unescape(m.group(1)),
            'date_range': _unescape(m.group(2)),
            'degree':     _unescape(m.group(3)),
            'location':   _unescape(m.group(4)),
        })
    return entries


def _parse_certifications(body: str) -> list:
    text = _strip_latex(body)
    certs = [c.strip() for c in text.split(',') if c.strip()]
    return certs


def parse_tex(tex: str) -> dict:
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
