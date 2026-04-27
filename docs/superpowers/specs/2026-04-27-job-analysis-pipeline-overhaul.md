# Job Analysis + Pipeline Overhaul — Design Spec
**Date:** 2026-04-27
**Status:** Approved — ready for implementation planning

---

## 1. Problem Statement

The Job Analysis pipeline has drifted into two disconnected resume worlds: a structured Resume module (Supabase `resumes` table) and a separate static-variant Job Analysis system with hardcoded candidate facts. The system is single-user by accident, not by design. Pipeline state semantics are broken. AI output is unreliable. Resume output violates the intended section ordering strategy.

This spec defines a full overhaul that makes the system:
- **Truly multi-user** — any user's uploaded resume powers Job Analysis, not hardcoded data
- **Dynamically structured** — respects each user's resume layout (Education position, summary presence, skill categories)
- **Reliable** — schema-enforced AI output, strict validation, no silent fallbacks
- **Correct** — pipeline lifecycle bugs fixed, resume section ordering fixed

---

## 2. Chosen Approach

**Approach 2 — Python LaTeX parser in GCR + dynamic Jinja2 compiler template**

- `.tex` uploads: parsed deterministically by Python regex in the GCR compiler service (`/parse` endpoint) — no AI cost, no hallucination risk
- PDF uploads: parsed by Groq via a new Vercel function (`/api/parse-resume`) — fallback only
- Parsed data stored in `resumes.structured_sections` (existing schema, no DB migration needed)
- Job Analysis reads from DB instead of hardcoded candidate block
- GCR compiler uses one dynamic Jinja2 template instead of 4 static `.tex` files
- Groq stays as the JD analysis engine — only its input changes (real user data vs hardcoded)

---

## 3. Architecture

```
ONBOARDING (one-time)
  Step 4: Upload .tex or PDF (optional, skippable)
       │
       ├── .tex → POST /parse (GCR) → Python regex → structured_sections JSON
       └── PDF  → POST /api/parse-resume (Vercel) → Groq → structured_sections JSON
                                    │
                                    ▼
                       Supabase: resumes.structured_sections
                       {
                         schema_version: 1,
                         summary: "text" | null,
                         section_order: ["skills","experience","education"],
                         skills: [{ category, items: string[] }],
                         experience: [{ company, role, date_range, bullets: string[] }],
                         education: [{ school, degree, date_range }],
                         certifications: string[],
                         contact: { email, phone, linkedin, location }
                       }
                       NOTE: contact is populated from user_profiles table,
                       NOT from the resume parse step.

JOB ANALYSIS (every run)
  1. fetchPrimaryResume() → structured_sections
  2. buildCandidateContext(structured_sections) → dynamic text block for Groq
  3. buildSkillLinesPrompt(structured_sections.skills) → user's real categories
  4. POST /api/groq → Groq JD analysis (reorder, keywords, ATS, insights)
  5. Strict output validation — throw on schema failure, no silent fallback
  6. If summary toggle ON → _generateSummary() second call
  7. Show results + enable download

RESUME DOWNLOAD
  POST /compile (GCR)
  Payload: { structured_sections, groq_output, include_summary, candidate_name, contact }
       │
       └── resume_dynamic.tex (Jinja2) renders in section_order:
           ├── Header (always first)
           ├── Summary (only if include_summary=true AND summary exists)
           ├── Skills (Groq-reordered user categories)
           ├── Experience (user bullets, locked — no AI rewrite)
           └── Education (wherever section_order specifies)

PIPELINE FIXES
  - Completed jobs excluded from Find Jobs feed
  - removePipeline() = soft delete (status='removed'), not row deletion
  - fetchJobs() fetches pipeline items without 14-day cap
  - Debounce counter fixed
  - Resume analysis UI schema drift fixed
  - (Learning) tags removed from prompts
  - /api/groq locked: model allowlist + max_tokens cap
```

---

## 4. Component Design

### 4.1 Onboarding (`src/components/Onboarding.jsx`)

- Add Step 4: "Upload Resume" — accepts `.tex` or `.pdf`
- Step indicator expands: `['Profile', 'Target Roles', 'API Keys', 'Resume']`
- Both file types optional — "Skip for now" link present
- On finish: if file provided, parse → upsert as primary resume
- **Critical:** onboarding must never fail due to resume parsing. Parse errors show a non-blocking toast; onboarding completes regardless.

### 4.2 Resume Parser — Python (`resume-compiler/app.py`)

New endpoint: `POST /parse`
- Input: raw `.tex` source as `text/plain`
- Output: `structured_sections` JSON
- **Auth:** requires Supabase JWT in `Authorization: Bearer <token>` header — same guard as `/api/groq`. Unauthenticated requests return 401.
- **GCR cold start:** Cloud Run service is configured with `min-instances: 1` to keep one instance warm. Onboarding must not be the first request to cold-start the service. The frontend shows a loading state ("Parsing resume…") with a 15-second timeout and a user-friendly retry prompt if exceeded.
- **`section_order` fallback:** if no recognisable `\section{}` commands are found, defaults to `["skills", "experience", "education"]`.

**Parser passes (deterministic regex):**

1. **Section order** — scan `\section{}` commands in sequence, map to canonical keys via `SECTION_MAP`
2. **Skills** — find bold category labels + comma-separated items; handle `\&` → `&` unescaping; fallback for `\begin{itemize}` style
3. **Experience** — detect `\resumeSubheading{}` (Jake's Resume) and `\textbf{}` + `\textit{}` patterns; extract company, role, location, date_range, bullet items; strip LaTeX commands from bullet text
4. **Education** — same pattern as experience from the Education section
5. **Summary** — if summary/objective section exists, extract plain text
6. **Certifications** — from Certifications section or inline in Skills

Error behaviour: never throws 500. Returns what was found. If no skills detected, returns `{ "parse_error": "no_skills_found" }`.

**`SECTION_MAP`:**
```python
SECTION_MAP = {
    'skills':         ['skills', 'technical skills', 'core competencies'],
    'experience':     ['experience', 'work experience', 'employment', 'professional experience'],
    'education':      ['education', 'academic background', 'academics'],
    'summary':        ['summary', 'objective', 'profile', 'about'],
    'certifications': ['certifications', 'licenses', 'credentials'],
    'projects':       ['projects', 'selected projects', 'academic projects'],
}
```

### 4.3 Resume Parser — Groq Fallback (`api/parse-resume.js`)

New Vercel function for PDF uploads only.
- **Client-side guard:** reject files over 5MB before upload — show "File too large. Max 5MB." error.
- **Text extraction:** PDF is not sent as raw binary. The frontend extracts text from the PDF using `pdfjs-dist` (already available via npm) before calling the API. Only the extracted text string is sent — not the binary.
- **Truncation:** extracted text is truncated to 8000 characters before sending to Groq to stay within token budget.
- Requires Supabase JWT in `Authorization` header — 401 if missing.
- Calls Groq with `response_format: { type: "json_object" }`
- Prompt instructs Groq to return exactly the `structured_sections` shape including `schema_version: 1`
- Validates output has at minimum `skills` (array, length > 0) and `experience` (array) before returning
- If validation fails, returns `{ parse_error: "incomplete_parse" }`

### 4.4 Job Analysis AI (`src/lib/groq.js`)

**`analyzeJobWithGroq(jd, apiKey)` — no longer takes `variant` parameter**

New helpers:
- `buildCandidateContext(structured_sections)` → formatted text block from DB data
- `buildSkillLinesPrompt(skills)` → JSON array of user's skill categories for Groq to reorder

**Groq output schema (strict):**
```json
{
  "top5_jd_skills": ["kw1", "kw2", "kw3", "kw4", "kw5"],
  "primary_category": "name of user's skill category that best fits JD",
  "mod2_skilllines": [
    { "category": "Quality Engineering", "items": "reordered items string" }
  ],
  "missing_keywords": ["kw1", "kw2"],
  "ats_coverage": "82%",
  "resumeReason": "one sentence why this ordering fits the JD",
  "top_matches": ["kw1", "kw2", "kw3"],
  "ai_insights": "3–5 actionable tips for this specific JD"
}
```

`primary_category` replaces `variant` — it must be one of the user's actual skill category names, not A/B/C/D.

**`primary_category` validation + fuzzy fallback:**
After receiving Groq output, validate that `primary_category` exactly matches one of the category names in `structured_sections.skills`. If it doesn't match exactly:
1. Try case-insensitive match
2. Try partial substring match (e.g. Groq returns "Process Engineering", user has "Process & CI" → match)
3. If still no match → fall back to `structured_sections.skills[0].category` (first category)
Log a warning when fallback is used so it can be monitored.

**Groq prompt constraint for skill reordering:**
The prompt explicitly states: "Reorder items within each category from the user's base list only — never add new skills not already present. Do not rename categories." This preserves the same constraint as the old `BASE_SKILLLINES` approach, now applied to user-derived categories.

**Strict output validation (replaces `applyQCBarriers`):**
- `mod2_skilllines` must be array with at least 1 entry, each having `category` (string) + `items` (string)
- `top5_jd_skills` must be array of exactly 5 distinct strings
- `ats_coverage` must match `/^\d+%$/`
- Any failure: throw with specific message — no silent fallback to local scoring

**`_generateSummary()`:** updated to receive `structured_sections` + Groq output context instead of hardcoded candidate block. The static `VARIANT_LENS` map is replaced by a Groq-derived dynamic lens:

- **Lens generation:** before writing the summary, the system prompt instructs Groq to first derive the role angle from the JD + `primary_category` + the user's top two experience roles and their strongest bullets. Groq produces a one-sentence lens ("This role needs someone who can X — anchor the summary to Y") then writes the 3-sentence summary using that lens.
- **Proof points:** the user's `structured_sections.experience` entries are passed in full so Groq selects the most relevant bullets rather than blindly using the first two.
- **Constraints unchanged:** same 3-sentence structure, same banned words list, same per-sentence word count targets as the current prompt.

**`(Learning)` tags:** instruction removed from all prompts. Never outputs this string again.

**Hardcoded candidate block:** removed entirely from `groq.js`. Siddardth's data moves to the database as a seeded resume row.

### 4.5 Job Analysis UI (`src/components/JobAnalysis.jsx`)

- Fetches primary resume from Supabase on mount
- If no primary resume found: shows "Upload your resume in the Resume tab to enable AI analysis" state — Analyze button disabled. Does not crash.
- `variant` prop and hardcoded `RESUMES` map removed
- **Primary category display:** after analysis, shows `primary_category` name (e.g. "Quality Engineering") as the active resume angle — replaces the old "Variant A / Manufacturing & Plant Ops" label. Shown as a badge: "Resume angle: [primary_category]"
- Summary toggle: visible only if `structured_sections.summary !== null`; when ON, fires `_generateSummary()` after main analysis
- Download payload updated to new compiler shape — contact fields sourced from `user_profiles` table at download time
- Model label updated to `llama-3.3-70b-versatile` (exact match to code)

### 4.6 Dynamic Compiler Template (`resume-compiler/templates/resume_dynamic.tex`)

Jinja2 template. Replaces `resume_A.tex` through `resume_D.tex`.

**Section rendering:**
```latex
{% for section in section_order %}
  {% if section == 'summary' and include_summary and mod1_summary %}
    {{ render_summary(mod1_summary) }}
  {% elif section == 'skills' %}
    {{ render_skills(mod2_skilllines, certifications) }}
  {% elif section == 'experience' %}
    {{ render_experience(experience) }}
  {% elif section == 'education' %}
    {{ render_education(education) }}
  {% endif %}
{% endfor %}
```

- Skills renders however many categories the user has — not exactly 4
- Certifications: `structured_sections.certifications` is `string[]` — each entry is one certification name. Rendered as a comma-joined line at the end of the Skills block: `\textbf{Certifications:} Six Sigma Green Belt, ...`. If the array is empty, the Certifications line is omitted entirely.
- Experience bullets locked — come from `structured_sections`, never from Groq
- Education position determined by `section_order`
- `strip_locked_skills()` function removed from `app.py`
- Old `resume_A.tex`–`resume_D.tex` kept in repo but removed from active routing

### 4.7 Compile Endpoint (`resume-compiler/app.py`)

Updated `/compile` payload shape:
```json
{
  "structured_sections": { ... },
  "groq_output": {
    "mod2_skilllines": [...],
    "primary_category": "...",
    "mod1_summary": "..."
  },
  "include_summary": true,
  "candidate_name": "...",
  "contact": { "email": "...", "phone": "...", "linkedin": "...", "location": "..." }
}
```

Uses `Jinja2` to render `resume_dynamic.tex` with the payload data instead of string injection.

**Contact fields:** at compile time, the frontend fetches the user's profile from `user_profiles` (name, email, phone, linkedin, location) and includes it in the compile payload. The `/compile` endpoint does not read from Supabase directly — contact data is always caller-supplied.

---

## 5. Pipeline & Bug Fixes

### Fix 1 — Completed jobs filter (`FindJobs.jsx:99,116`)
Combined final filter (covers both Fix 1 and Fix 2 terminal states):
```javascript
const HIDDEN_STATUSES = new Set(['completed', 'removed']);
const visible = allJobs.filter(j =>
  j.feed_date === date && !j.in_pipeline && !HIDDEN_STATUSES.has(j.status)
);
```
Applied at both line 99 (date change handler) and line 116 (date switch handler).

### Fix 2 — Soft delete on removePipeline (`storage.js`)
New `softRemoveJob(id)` function: sets `status='removed'`, `in_pipeline=false`. Does not delete the row. `deleteJob()` retained for explicit purge use only. The combined filter in Fix 1 ensures `removed` rows never surface in Find Jobs.

### Fix 3 — 14-day cap excludes active pipeline items (`storage.js:71`)
Fetch pipeline items separately with no date cap, merge and deduplicate by `id` with feed rows.

### Fix 4 — Debounce counter (`App.jsx:197`)
Cancelled timer decrements `pendingSaves` before starting the new timer:
```javascript
if (saveTimer.current) {
  clearTimeout(saveTimer.current);
  setPendingSaves(n => Math.max(0, n - 1));
}
```

### Fix 5 — Resume analysis schema drift (`Resume.jsx:106,400`)
Change `item.overall_score` → `item.score` and `item.fix` → `item.suggestion` in the Resume component.

### Fix 6 — Model label (`JobAnalysis.jsx:676`)
Update display string to `llama-3.3-70b-versatile`.

### Fix 7 — `/api/groq` lockdown (`api/groq.js`)
```javascript
const ALLOWED_MODELS = ['llama-3.3-70b-versatile'];
const MAX_TOKENS_CAP = 1600;
if (!ALLOWED_MODELS.includes(req.body.model)) return res.status(400).json({ error: 'Model not allowed' });
req.body.max_tokens = Math.min(req.body.max_tokens ?? 1000, MAX_TOKENS_CAP);
```

---

## 6. Data Migration

No DB schema changes required. `resumes.structured_sections` already exists with the correct shape (`supabase_schema_v3.sql`).

**Siddardth's existing data:** As part of implementation, a one-time seeder script (`scripts/seed_primary_resume.js`) reads the hardcoded candidate block from `groq.js`, converts it to `structured_sections` format, and upserts it as `is_primary=true` for the account `shhahidmian@gmail.com`. This runs once before the hardcoded block is removed. Job Analysis continues to work for his account with no interruption.

---

## 7. Cover Letter Fallback

`cover_letter.tex` is not redesigned. One targeted change only:

The cover letter template currently uses `mod1_summary` as its opening paragraph. When summary toggle is OFF, `mod1_summary` is an empty string — leaving the cover letter opener blank.

**Fix:** the cover letter template gets a conditional fallback opener:
- If `mod1_summary` is non-empty → use it as the intro paragraph (current behaviour)
- If `mod1_summary` is empty → render a generic opener using `primary_category` + company name: "I am writing to express my interest in the [job_title] role at [company]. As an [primary_category]-focused Aerospace Engineering graduate, I am eager to contribute to your team."

This fallback is a template-level change in `cover_letter.tex` only — no prompt or Groq change.

---

## 8. Out of Scope

- Projects section in resume — parsed and stored in `structured_sections` if present, but not yet rendered in the dynamic template (future)
- Two-stage AI (Groq extractor + Claude prose) — deferred; can layer on later
- Multi-user pipeline scraping — separate plan (`2026-03-27-multi-user-jobagent-architecture.md`)

---

## 9. Files Changed

| File | Change |
|------|--------|
| `src/components/Onboarding.jsx` | Add Step 4 resume upload (tex + PDF, skippable) |
| `src/components/JobAnalysis.jsx` | Remove variant, fetch primary resume, primary_category badge, summary toggle, contact from user_profiles |
| `src/components/Resume.jsx` | Fix schema drift (score/suggestion fields) |
| `src/components/FindJobs.jsx` | Fix completed/removed jobs filter |
| `src/lib/groq.js` | Remove hardcoded block, dynamic context builders, primary_category fuzzy match, strict validation, remove (Learning) |
| `src/lib/storage.js` | Fix 14-day cap, add softRemoveJob(), fix fetchJobs merge |
| `src/App.jsx` | Fix debounce counter, call softRemoveJob |
| `api/groq.js` | Model allowlist + token cap |
| `api/parse-resume.js` | New — PDF text extraction + Groq parser (JWT-gated, 5MB guard, 8000-char truncation) |
| `scripts/seed_primary_resume.js` | New — one-time seeder for Siddardth's existing data |
| `resume-compiler/app.py` | Add JWT-gated /parse endpoint, update /compile payload, remove strip_locked_skills, min-instances config |
| `resume-compiler/templates/resume_dynamic.tex` | New dynamic Jinja2 template |
| `resume-compiler/templates/cover_letter.tex` | Add fallback opener when mod1_summary is empty |
| `resume-compiler/templates/resume_A–D.tex` | Removed from active routing (kept for reference) |

---

## 10. Success Criteria

- Any new user can sign up, upload their `.tex` resume, and run Job Analysis against a real job description — no hardcoded data in the loop
- Siddardth's existing account works without interruption after seeder runs
- Onboarding never fails due to a parse error — always completes, parse failures are non-blocking toasts
- Completed jobs never reappear in Find Jobs
- Active pipeline items are visible regardless of when they were added
- Groq output failures surface as explicit errors — never silently fall back to local keyword scoring
- Resume PDF section order matches the user's uploaded resume layout
- `(Learning)` never appears in a generated resume
- `/parse` endpoint rejects unauthenticated requests with 401
- Cover letter has a meaningful opener even when summary toggle is OFF
- `primary_category` badge is visible in Job Analysis UI after every analysis run
