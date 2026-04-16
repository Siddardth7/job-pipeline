# System Audit Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all open items from the 2026-04-16 second-brain + system audit: fix stale/dangerous memory files, add missing workflow documentation, re-run graphify with a pruned corpus, verify all code-level bugs are resolved, and document security posture.

**Architecture:** Two parallel tracks — (A) Memory/docs work (no code changes, pure file ops) and (B) Code verification (read-only checks with targeted fixes if anything is found broken). Tracks are independent and can run in parallel.

**Tech Stack:** Claude memory files (Markdown), Graphify skill (knowledge graph), Python (pipeline), React/Vite (frontend), Supabase (DB), Railway (resume compiler), Vercel (frontend hosting).

---

## SECTION BREAKDOWN — Priority Map

| Section | Tasks | P0 | P1 | P2 | P3 |
|---------|-------|----|----|----|----|
| Memory System | MEM-1 → MEM-5 | 1 | 2 | 1 | 1 |
| Graphify Optimization | GRAPH-1 → GRAPH-2 | 0 | 2 | 0 | 0 |
| Bug Verification | VER-1 → VER-5 | 0 | 2 | 2 | 1 |
| Security Baseline | SEC-1 | 0 | 1 | 0 | 0 |

---

## MASTER PRIORITY LIST

### P0 — Critical (memory contradictions cause wrong deploys)
- **MEM-1:** Delete/archive `project_jobagent.md` and `project_resume_pdf_pipeline.md` — both describe a deprecated Netlify/monorepo setup and will cause a future Claude session to deploy to the wrong platform

### P1 — High (missing knowledge causes re-reading source files every session)
- **MEM-2:** Update `project_architecture.md` — remove Netlify references, add current networking/DM feature status, add RLS note
- **MEM-3:** Create `bugs_open.md` — single source of truth for bug status (audit found many; code review confirmed most are fixed)
- **GRAPH-1:** Re-run graphify with filtered corpus — current graph has 99 isolated nodes (46%), low cohesion on top clusters
- **VER-1:** Verify networking overhaul bugs F4/F5/F6 are fully live in production (plan exists, code exists, confirm it deployed)
- **VER-2:** Verify LinkedIn DM tab is wired end-to-end (UI tab exists; confirm Supabase data flows through)

### P2 — Medium (inefficiency or future risk)
- **MEM-4:** Create `workflow_resume_generation.md` — sentinel logic, 4 variants, Railway endpoint; prevents ~5K token re-read per session
- **MEM-5:** Create `workflow_job_feed.md` — FindJobs filter logic, raw GitHub feed URL, scoring.js variant selection
- **SEC-1:** Create `security_status.md` — document RLS posture ("permissive anon, single-user"), flag what must change before multi-user launch
- **VER-3:** Verify stale JD bug (F1) is fully resolved across page navigation and refresh
- **VER-4:** Verify completed jobs (F2) do not return after refresh under all edge cases

### P3 — Low (optimization, nice-to-have)
- **GRAPH-2:** Add content summaries to top-5 god nodes in graphify obsidian vault
- **VER-5:** Verify Apify location fallback handles edge cases (blank location detection downstream)

---

## IMPLEMENTATION ROADMAP

```
PHASE 1 (immediate, no dependencies):
  MEM-1 → delete stale memory files                [~5 min]
  
PHASE 2 (after MEM-1, parallel):
  MEM-2 → update project_architecture.md           [~10 min]
  MEM-3 → create bugs_open.md                      [~10 min]
  MEM-4 → create workflow_resume_generation.md     [~10 min]
  MEM-5 → create workflow_job_feed.md              [~10 min]
  SEC-1 → create security_status.md               [~10 min]

PHASE 3 (after PHASE 2, parallel):
  GRAPH-1 → re-run graphify (filtered corpus)      [~15 min]
  VER-1 → verify networking overhaul deployed      [~10 min]
  VER-2 → verify LinkedIn DM end-to-end            [~10 min]
  VER-3 → verify stale JD fix                      [~10 min]
  VER-4 → verify completed jobs fix                [~10 min]

PHASE 4 (cleanup, no blockers):
  GRAPH-2 → add content to god nodes              [~15 min]
  VER-5 → verify Apify location edge cases         [~5 min]
```

**Dependencies:**
- MEM-1 must run before MEM-2 (MEM-2 replaces content that was in the deleted files)
- GRAPH-1 must run after all MEM tasks (graphify reads the memory dir; want clean files before indexing)
- All VER tasks are independent of memory work — can run in parallel with Phase 2

---

## TASK DETAIL

---

### Task 1: Delete Stale Memory Files (MEM-1) — P0

**Files:**
- Delete: `/Users/jashwanth/.claude/projects/-Users-jashwanth-jobagent-web/memory/project_jobagent.md`
- Delete: `/Users/jashwanth/.claude/projects/-Users-jashwanth-jobagent-web/memory/project_resume_pdf_pipeline.md`
- Modify: `/Users/jashwanth/.claude/projects/-Users-jashwanth-jobagent-web/memory/MEMORY.md`

**Why these are dangerous:** `project_jobagent.md` says repo is `Siddardth7/job-agent-master` (deprecated), frontend is at `jobagentweb.netlify.app` (out of credits), and "RLS disabled on all tables". `project_resume_pdf_pipeline.md` says deploy via `netlify deploy --build --prod` (wrong platform). Any future Claude session loading these will attempt to deploy to Netlify and reference a dead repo.

- [ ] **Step 1: Delete the stale files**

```bash
rm /Users/jashwanth/.claude/projects/-Users-jashwanth-jobagent-web/memory/project_jobagent.md
rm /Users/jashwanth/.claude/projects/-Users-jashwanth-jobagent-web/memory/project_resume_pdf_pipeline.md
```

- [ ] **Step 2: Remove their entries from MEMORY.md**

Open `/Users/jashwanth/.claude/projects/-Users-jashwanth-jobagent-web/memory/MEMORY.md` and remove these two lines:
```
- [project_resume_pdf_pipeline.md](project_resume_pdf_pipeline.md) — Resume/cover letter PDF pipeline status
```
(The `project_jobagent.md` file was NOT listed in MEMORY.md index — confirm it's absent, no edit needed for that one.)

- [ ] **Step 3: Verify**

```bash
ls /Users/jashwanth/.claude/projects/-Users-jashwanth-jobagent-web/memory/
```

Expected output: `MEMORY.md  feedback_vercel.md  project_architecture.md  project_deployment.md  project_h1b_enrichment.md  project_networking_overhaul.md`

- [ ] **Step 4: Commit (memory files are outside the repo — no git commit needed)**

Note in `MEMORY.md` that both files were deleted on 2026-04-16 due to stale platform references.

---

### Task 2: Update project_architecture.md (MEM-2) — P1

**Files:**
- Modify: `/Users/jashwanth/.claude/projects/-Users-jashwanth-jobagent-web/memory/project_architecture.md`

- [ ] **Step 1: Read the current file**

Read `/Users/jashwanth/.claude/projects/-Users-jashwanth-jobagent-web/memory/project_architecture.md` fully.

- [ ] **Step 2: Replace with updated content**

Write the following complete content:

```markdown
---
name: JobAgent Architecture
description: Full system architecture, repo structure, and tech stack for JobAgent — current as of 2026-04-16
type: project
---

## What It Is
AI-powered job application assistant for Siddardth Pathipaka (aerospace/manufacturing engineer).

## Repo
Single monorepo: `Siddardth7/jobagent-web` at https://github.com/Siddardth7/jobagent-web
**Not** job-agent-master (deprecated). All changes go here.

## Repo Structure
```
jobagent-web/
├── src/                        # React + Vite frontend
│   ├── components/
│   │   ├── JobAnalysis.jsx     # AI job analysis + PDF download
│   │   ├── Networking.jsx      # CRM: find contacts, log, DMs, follow-ups, POC list (5 tabs)
│   │   ├── CompanyIntel.jsx    # Company research + H1B filter (reads ats_companies.json)
│   │   ├── FindJobs.jsx        # Job feed + filters
│   │   ├── Pipeline.jsx        # Active job tracker (status=active only)
│   │   ├── Applied.jsx         # Application tracker with status dropdown
│   │   ├── Dashboard.jsx       # Analytics
│   │   ├── Resume.jsx          # Resume editor/viewer
│   │   └── Settings.jsx        # API keys (Groq, Serper)
│   ├── lib/
│   │   ├── groq.js             # Groq AI (job analysis, message drafting, cover letter, follow-up)
│   │   ├── scoring.js          # Local resume scoring + variant selection (A/B/C/D)
│   │   ├── storage.js          # Supabase read/write helpers (sanitizeJobFeedUpdate, batch ops)
│   │   └── coverLetter.js      # Cover letter payload builder
│   ├── App.jsx                 # Root: auth, data load, routing, callbacks
│   └── supabase.js
├── resume-compiler/            # Flask microservice (PDF compilation)
│   ├── app.py                  # /generate, /generate-cover-letter; strip_locked_skills(), inject_placeholders()
│   ├── Dockerfile              # Python 3.11 + Tectonic LaTeX engine
│   └── templates/              # resume_{A,B,C,D}.tex + cover_letter.tex
├── scrapers/                   # Python job scrapers (ATS/Greenhouse/Lever, JSearch, Apify, SerpAPI, Adzuna)
├── pipeline/
│   ├── merge_pipeline.py       # 9-stage filter (F1-F9: schema, URL, aggregator, age, dedupe, seniority, role, ITAR, blacklist)
│   ├── company_intelligence.py # GREEN/YELLOW/RED tier classifier (auto-promotion DISABLED)
│   ├── distribute_feed.py      # Batch upsert to Supabase normalized_jobs + user_job_feed
│   └── batch_upsert.py         # Chunked upsert helper (100 rows/batch)
├── engine/
│   └── scraper_orchestrator.py # Runs all scrapers sequentially; quota management per source
├── output/                     # Daily job JSON (jobs_clean_latest.json — read by frontend via GitHub API)
├── data/                       # itar_keywords.json, ats_companies.json (26 Greenhouse + 6 Lever)
├── api/
│   └── find-contacts.js        # Vercel API route: hybrid Serper strategy, PERSONA_MAP, location-first
└── .github/workflows/
    └── daily_scrape.yml        # Concurrency-guarded, clears temp/ before each run
```

## Tech Stack
- Frontend: React 18 + Vite, hosted on Vercel (auto-deploy via git push to main)
- AI: Groq API (llama-3.3-70b-versatile) — stored in Supabase integrations table per user
- Job search: Serper API — stored in Supabase integrations table per user
- Database: Supabase (normalized_jobs, user_job_feed, netlog, applications, settings, integrations)
- PDF: Flask + Tectonic LaTeX on Railway (`https://resume-compiler-production.up.railway.app`)
- Scrapers: Python, GitHub Actions (daily at 13:00 UTC, concurrency-guarded)

## Resume Variants
- A: Manufacturing & Plant Ops
- B: Process & Continuous Improvement
- C: Quality & Materials
- D: Equipment & NPI
Variant selected by `scoring.js` based on job keywords. Injected via sentinel markers `%%SUMMARY%%`, `%%SKILLS_BLOCK_START%%`, `%%SKILLS_BLOCK_END%%` in LaTeX templates.

## Networking Module (5 tabs as of 2026-04-09)
- Find Contacts: hybrid Serper strategy, persona multiselect (Recruiter/Hiring Manager/Peer Engineer/UIUC Alumni/etc.)
- Log: contact CRM with status model Sent→Accepted→Replied→Coffee Chat→Referral Secured→Cold
- LinkedIn DMs: AI-categorized LinkedIn DM conversations from CSV import
- Follow-ups: Accepted/Replied contacts ≥7 days since statusChangedAt, inline AI draft button
- POC List: Referral Secured contacts grouped by company

## Key Data Flow
1. GitHub Actions runs scrapers daily → pushes output/jobs_clean_latest.json to repo
2. Frontend fetches jobs_clean_latest.json from raw.githubusercontent.com
3. User opens job → Groq analyzes → generates summary + skills_latex per variant
4. User clicks Download PDF → POST to Railway /generate → Tectonic compiles → PDF returned

## Security Posture (as of 2026-04-16)
- RLS enabled on resumes + user_preferences tables (supabase_schema_v3.sql)
- Other tables use permissive anon policies (single-user app, no auth enforcement)
- Supabase service key used only in pipeline (server-side); anon key in frontend
- NOT multi-user safe yet — see security_status.md before enabling multi-user access

## H1B Filter Note
- `CompanyIntel.jsx` H1B filter reads from `data/ats_companies.json` (291 companies, 106 H1B verified)
- The live job feed (`jobs_clean_latest.json`) DOES carry h1b field through pipeline (preserved at merge_pipeline.py:464-466)
- `company_intelligence.py` tier/H1B enrichment uses M628 database lookup
```

- [ ] **Step 3: Verify it saved cleanly**

```bash
wc -l /Users/jashwanth/.claude/projects/-Users-jashwanth-jobagent-web/memory/project_architecture.md
```

Expected: 80+ lines.

---

### Task 3: Create bugs_open.md (MEM-3) — P1

**Files:**
- Create: `/Users/jashwanth/.claude/projects/-Users-jashwanth-jobagent-web/memory/bugs_open.md`
- Modify: `/Users/jashwanth/.claude/projects/-Users-jashwanth-jobagent-web/memory/MEMORY.md`

- [ ] **Step 1: Write the bug status file**

```markdown
---
name: Bug Status Log
description: Current state of all bugs identified in 2026-04-16 system audit — confirmed-open vs resolved
type: project
---

## RESOLVED (verified in code, 2026-04-16)

### Pipeline Bugs (all resolved since audit)
- **P1 Stale temp/ data** — FIXED: daily_scrape.yml clears temp/ before each run; merge_pipeline.py uses WHITELISTED_SOURCE_FILES
- **P2 ITAR title-skip** — FIXED: `_itar_reject_reason()` scans title + itar_detail + full description via combined string
- **P3 First-win alphabetical dedupe** — FIXED: SOURCE_PRIORITY dict (ats=1, jsearch=3, apify/serpapi=4, adzuna=5); `_filter_duplicates_priority()` keeps best-source record
- **P4 Fake freshness dates** — FIXED: scrapers use `date_confidence` field; Lever jobs marked "unknown" (acceptable for direct ATS)
- **P5 Metadata dropped (h1b/tier/salary)** — FIXED: merge_pipeline.py preserves h1b, ats_tier, salary at line ~464-466
- **P6 Auto-promotion whitelist pollution** — FIXED: `_update_promotions` disabled, GREEN list is manual only (company_intelligence.py line 103)
- **P7 Apify blank location (149/149)** — FIXED: `_extract_location()` handles dict/string/null shapes in apify_scraper.py

### Data/Schema Bugs
- **D1 distribute_feed import-time exit** — FIXED: `_get_supabase_client()` called at runtime inside `run()`, not at import
- **D2 JSearch quota deduction wrong** — FIXED: uses `scraper.calls_made` (actual calls fired), not estimate
- **D3 No workflow concurrency guard** — FIXED: `concurrency:` block present in daily_scrape.yml

### Frontend Bugs
- **F1 Stale JD bug** — FIXED: `useEffect` in JobAnalysis.jsx depends on `currentJob?.id`; resets all fields when job changes
- **F2 Completed jobs return after refresh** — FIXED: `completePipeline` sets `in_pipeline:false, status:"completed"`; load filter `j.in_pipeline && j.status !== 'completed'` excludes them
- **F3 LinkedIn DM invisible** — FIXED: "LinkedIn DMs" tab implemented in Networking.jsx (`tab === 'dms'`), loads on tab activation

### Networking Overhaul (all 3 bugs + 2 features implemented as of 2026-04-09)
- **F4 Location filter not applied** — FIXED: `api/find-contacts.js` uses location-first Serper query with fallback
- **F5 All contacts returned as Recruiter** — FIXED: `classifyPersona()` + `PERSONA_MAP` + fill-in strategy, `personaSlot` field set per contact
- **F6 Follow-up missing draft button** — FIXED: `FollowUpCard` component with inline "Draft Follow-up" button calling `draftMessageWithGroq(..., 'followup')`
- **New status model** — FIXED: `STATUS_OPTS = ['Sent', 'Accepted', 'Replied', 'Coffee Chat', 'Referral Secured', 'Cold']`, `migrateStatus()` for backwards compat
- **POC List tab** — FIXED: 5th tab `tab === 'poc'` shows Referral Secured contacts grouped by company

### Performance
- **Row-by-row Supabase upserts** — FIXED: `batch_upsert.py` in chunks of 100 rows; used for both normalized_jobs and user_job_feed

---

## OPEN ITEMS

### Memory System (active work in this plan)
- **MEM-1** Missing workflow files for resume generation and job feed — creates ~5K token re-read per session [P2]
- **MEM-2** Graphify graph stale (last run 2026-04-13, pre-networking-overhaul commits) [P1]
- **MEM-3** Graphify has 99 isolated nodes (46%) — low-cohesion community detection [P1]

### Security
- **SEC-1** RLS permissive anon policies on most tables — acceptable for single-user; MUST fix before multi-user access [P1]

---

**Why:** Single source of truth so future sessions don't re-investigate already-resolved bugs.

**How to apply:** Check this file first when a bug is reported. If listed as RESOLVED, verify the fix is still in place before re-investigating. Update OPEN items when resolved.
```

- [ ] **Step 2: Add to MEMORY.md index**

Append this line to `MEMORY.md`:
```
- [bugs_open.md](bugs_open.md) — All bugs from 2026-04-16 audit: resolved vs open, with fix details
```

- [ ] **Step 3: Verify**

```bash
cat /Users/jashwanth/.claude/projects/-Users-jashwanth-jobagent-web/memory/MEMORY.md
```

Expected: 7 entries total (6 existing + bugs_open.md).

---

### Task 4: Create workflow_resume_generation.md (MEM-4) — P2

**Files:**
- Create: `/Users/jashwanth/.claude/projects/-Users-jashwanth-jobagent-web/memory/workflow_resume_generation.md`
- Modify: `/Users/jashwanth/.claude/projects/-Users-jashwanth-jobagent-web/memory/MEMORY.md`

- [ ] **Step 1: Write the workflow file**

```markdown
---
name: Resume Generation Workflow
description: End-to-end resume PDF generation: 4 variants, sentinel injection, Railway endpoint, certifications strip — prevents re-reading source files each session
type: project
---

## Railway Endpoint
`https://resume-compiler-production.up.railway.app`
- `POST /generate` — body: `{summary, skills_latex, variant, company, role}`
- `POST /generate-cover-letter` — body: `{company, role, variant_focus, summary, skills_latex, tone}`
- `GET /health` — returns `{"status": "ok"}`

## 4 Resume Variants
| Variant | Focus | LaTeX template |
|---------|-------|----------------|
| A | Manufacturing & Plant Ops | `resume-compiler/templates/resume_A.tex` |
| B | Process & Continuous Improvement | `resume-compiler/templates/resume_B.tex` |
| C | Quality & Materials | `resume-compiler/templates/resume_C.tex` |
| D | Equipment & NPI | `resume-compiler/templates/resume_D.tex` |

Variant selected client-side by `scoring.js` based on job keywords. User can override in JobAnalysis UI.

## Sentinel Markers (in all 4 templates)
```latex
%%SUMMARY%%                   ← replaced with Groq-generated summary text
%%SKILLS_BLOCK_START%%        ← marks start of AI-injected skills block
  ... existing template skills content ...
%%SKILLS_BLOCK_END%%          ← marks end of AI-injected skills block
```

`inject_placeholders()` in `resume-compiler/app.py`:
1. Replaces `%%SUMMARY%%` with escaped `summary` string
2. Replaces content between `%%SKILLS_BLOCK_START%%` and `%%SKILLS_BLOCK_END%%` with `skills_latex`
3. Before injection: `strip_locked_skills(skills_latex)` removes `\skillline{Certifications:...}` lines from AI output to prevent duplicates with hardcoded template skills

## Groq → LaTeX Pipeline
1. `JobAnalysis.jsx` sends job description + variant to Groq
2. Groq returns `{summary: string, skills_latex: string}` — skills_latex is ready LaTeX `\skillline{}{}` macros
3. Frontend POSTs to Railway `/generate` with the 4 fields
4. Flask: `strip_locked_skills()` → `inject_placeholders()` → Tectonic compile → PDF bytes returned
5. Frontend triggers browser download

## Deploy / Redeploy
- Template change: `cd resume-compiler && railway service resume-compiler && railway up --detach`
- app.py change: same as above
- Frontend change only: `git push origin main` (Vercel auto-deploys; no Railway redeploy needed)

## Known Constraints
- Tectonic (not TeX Live) — avoids Railway OOM on free tier
- LaTeX special chars in summary must be escaped — `app.py::escape_latex()` handles this
- Max summary length enforced in `app.py::safe_latex_id()` (120 chars)

**Why:** Without this file, Claude reads app.py + all 4 templates every session (~5K tokens). This file covers 95% of resume generation decisions in ~400 tokens.
```

- [ ] **Step 2: Add to MEMORY.md index**

Append to `MEMORY.md`:
```
- [workflow_resume_generation.md](workflow_resume_generation.md) — Resume PDF generation: 4 variants, Railway endpoint, sentinel injection logic
```

---

### Task 5: Create workflow_job_feed.md (MEM-5) — P2

**Files:**
- Create: `/Users/jashwanth/.claude/projects/-Users-jashwanth-jobagent-web/memory/workflow_job_feed.md`
- Modify: `/Users/jashwanth/.claude/projects/-Users-jashwanth-jobagent-web/memory/MEMORY.md`

- [ ] **Step 1: Write the workflow file**

```markdown
---
name: Job Feed Workflow
description: How jobs flow from scraper output to FindJobs UI — fetch URL, filter logic, scoring.js variant selection
type: project
---

## Feed Source
Frontend fetches:
```
https://raw.githubusercontent.com/Siddardth7/jobagent-web/main/output/jobs_clean_latest.json
```
This is a static GitHub raw file — updated once per day by the daily GitHub Actions workflow.
There is NO live API call — the feed is always the previous day's run.

## FindJobs Component (`src/components/FindJobs.jsx`)
Filters applied client-side after fetch:
- Free-text search across title, company, location, description
- H1B toggle (reads `h1b` field from job — populated by company_intelligence.py)
- Legitimacy tier filter (high/caution/suspicious — set by `_detect_red_flags()` in merge_pipeline.py)
- Source filter (ats_greenhouse, ats_lever, jsearch, apify, serpapi, adzuna)
- Location filter (US only / remote / state-specific)
- Employment type filter (Full-time / Contract)

## Scoring / Variant Selection (`src/lib/scoring.js`)
`selectVariant(job)` returns A/B/C/D based on keyword matching:
- A: manufacturing, production, plant, lean, assembly
- B: process, continuous improvement, kaizen, six sigma, CI
- C: quality, inspection, metrology, CMM, GD&T, materials
- D: equipment, NPI, tooling, capital, installation, commissioning
Fallback: variant A if no strong match.

## Job Object Shape (key fields from jobs_clean_latest.json)
```json
{
  "id":               "ats_greenhouse:abc123",
  "job_title":        "Manufacturing Engineer",
  "company_name":     "Joby Aviation",
  "location":         "Santa Cruz, CA",
  "job_url":          "https://boards.greenhouse.io/joby/jobs/123",
  "source":           "ats_greenhouse",
  "posted_date":      "2026-04-15",
  "date_confidence":  "known",
  "h1b":              "YES",
  "ats_tier":         "greenhouse",
  "salary":           "$95,000–$130,000",
  "legitimacy_tier":  "high",
  "employment_type":  "Full-time",
  "description":      "...",
  "company_tier":     "GREEN"
}
```

## Supabase Tables (user-specific feed)
- `normalized_jobs` — shared across all users, all scraped jobs
- `user_job_feed` — per-user: `in_pipeline`, `status`, `analysis_result`, `resume_variant`, `user_relevance_score`
- Frontend joins both: `Storage.fetchJobs()` returns merged shape

## Applied Job Suppression
Jobs the user has applied to (in `applications` table) are suppressed from the feed by comparing job URLs.

**Why:** Without this file, Claude reads FindJobs.jsx + scoring.js + storage.js every session (~4K tokens). This covers 90% of job feed questions in ~300 tokens.
```

- [ ] **Step 2: Add to MEMORY.md index**

Append to `MEMORY.md`:
```
- [workflow_job_feed.md](workflow_job_feed.md) — Job feed: raw GitHub URL, FindJobs filter logic, scoring.js variant selection, job object shape
```

---

### Task 6: Create security_status.md (SEC-1) — P1

**Files:**
- Create: `/Users/jashwanth/.claude/projects/-Users-jashwanth-jobagent-web/memory/security_status.md`
- Modify: `/Users/jashwanth/.claude/projects/-Users-jashwanth-jobagent-web/memory/MEMORY.md`

- [ ] **Step 1: Verify current RLS state**

Read `supabase_schema_v3.sql` lines 53-55 to confirm RLS status:

```bash
grep -n "enable row level security\|permissive\|anon\|policy" \
  /Users/jashwanth/jobagent-web/.claude/worktrees/loving-taussig-3cefa5/supabase_schema_v3.sql | head -20
```

- [ ] **Step 2: Write the security file**

```markdown
---
name: Security Status
description: Current RLS posture, API key storage, and what must change before multi-user launch
type: project
---

## Current Security State (as of 2026-04-16)

### Authentication
- Supabase Auth is enabled — users log in via email/password or magic link
- Frontend uses anon key (safe — never exposes service key to browser)
- Pipeline uses service key (server-side only, via GitHub Actions secrets)

### Row Level Security (RLS)
- `resumes` table: RLS enabled with proper per-user policies (supabase_schema_v3.sql)
- `user_preferences` table: RLS enabled (supabase_schema_v3.sql)
- All other tables (`normalized_jobs`, `user_job_feed`, `netlog`, `applications`, `settings`, `integrations`):
  - RLS enabled but with **permissive anon policies** — any authenticated user can read all rows
  - This is intentional for the current single-user deployment

### API Key Storage
- Groq API key: stored in `integrations` table per user_id — NOT shared
- Serper API key: stored in `integrations` table per user_id — NOT shared
- Loaded via `Storage.fetchUserIntegrations()` which scopes by auth user_id

## SAFE FOR SINGLE USER: YES
Current state is acceptable for one-user production use. Siddardth is the only active user.

## NOT SAFE FOR MULTI-USER: TRUE
**Before enabling multi-user access, these must be done:**

1. Add `user_id = auth.uid()` RLS policies to:
   - `user_job_feed` (already has user_id column)
   - `netlog` (already has user_id column)
   - `applications` (add user_id column if missing)
   - `settings` (add user_id column if missing)

2. Remove any `USING (true)` permissive policies that bypass user scoping

3. Audit `Storage.fetchJobs()`, `Storage.fetchNetlog()`, `Storage.fetchApplications()` — 
   confirm each query includes `.eq('user_id', userId)` or relies on RLS to scope

4. Test: log in as user A, confirm user B's pipeline items are not visible

**Why:** Without this file, "RLS disabled on all tables" (from stale project_jobagent.md) was the only reference — dangerously wrong. This file reflects actual state.

**How to apply:** Read this before any multi-user feature work or before inviting new users.
```

- [ ] **Step 3: Add to MEMORY.md index**

Append to `MEMORY.md`:
```
- [security_status.md](security_status.md) — RLS posture, API key storage, what must change before multi-user launch
```

---

### Task 7: Re-run Graphify with Filtered Corpus (GRAPH-1) — P1

**Files:**
- Modify: Graphify exclusion config (passed as args to `/graphify` skill)

**Problem:** Current graph (2026-04-13) has 131 files, 99 isolated nodes (46%), cohesion 0.06 on largest cluster. Cause: corpus includes debug sessions, paste-cache prompts, Claude changelogs, and session tool-result artifacts — none of which represent reusable knowledge.

- [ ] **Step 1: Identify what to exclude before re-running**

Confirm the high-noise directories in the corpus:

```bash
ls /Users/jashwanth/.claude/debug/ | wc -l          # debug sessions — exclude
ls /Users/jashwanth/.claude/paste-cache/ | wc -l    # raw prompts — exclude
ls /Users/jashwanth/.claude/cache/ | wc -l          # Claude changelog — exclude
ls /Users/jashwanth/.claude/projects/-Users-jashwanth-jobagent-web/*/tool-results/ 2>/dev/null | wc -l  # session artifacts — exclude
```

- [ ] **Step 2: Run graphify via skill**

Invoke the graphify skill with focus on the knowledge-bearing directories only:

```
/graphify
```

When prompted for scope, specify: focus on `/Users/jashwanth/.claude/graphify-out/obsidian/` (the existing vault) + `/Users/jashwanth/.claude/projects/-Users-jashwanth-jobagent-web/memory/` (the updated memory files). Exclude: `debug/`, `paste-cache/`, `cache/`, `projects/*/tool-results/`.

- [ ] **Step 3: Verify the new graph**

After graphify completes, open `GRAPH_REPORT.md` and confirm:
- Isolated nodes < 30 (down from 99)
- Cohesion on "JobAgent Web" community > 0.15 (up from 0.06)
- Community count roughly same (18-25 communities expected)

```bash
grep "isolated node\|Cohesion" /Users/jashwanth/.claude/graphify-out/GRAPH_REPORT.md | head -10
```

- [ ] **Step 4: Note in MEMORY.md**

Add/update a comment in MEMORY.md:
```
<!-- Graphify last run: 2026-04-16 with filtered corpus (excludes debug/, paste-cache/, changelogs) -->
```

---

### Task 8: Verify Networking Overhaul is Live in Production (VER-1) — P1

**Files:**
- Read-only: `src/components/Networking.jsx`, `api/find-contacts.js`

**Goal:** Confirm the plan at `docs/superpowers/plans/2026-03-29-networking-overhaul.md` is fully implemented AND deployed to Vercel (not just in local code).

- [ ] **Step 1: Verify STATUS_OPTS and migrateStatus exist**

```bash
grep -n "STATUS_OPTS\|migrateStatus\|personaSlot\|FollowUpCard\|tab.*poc" \
  src/components/Networking.jsx | head -20
```

Expected: all 5 symbols found.

- [ ] **Step 2: Verify find-contacts.js has PERSONA_MAP**

```bash
grep -n "PERSONA_MAP\|location.*filter\|fill.in\|missingPersonas" api/find-contacts.js | head -10
```

Expected: PERSONA_MAP defined, fill-in logic present.

- [ ] **Step 3: Verify deployment**

```bash
git log --oneline -10
```

Confirm there is a commit after 2026-03-29 that deployed the networking overhaul (look for "networking" or "contacts" in commit messages). Verify the HEAD is deployed to Vercel by checking Vercel dashboard or running:

```bash
git log origin/main --oneline -5
```

- [ ] **Step 4: Update project_networking_overhaul.md**

Update the memory file to reflect implementation is complete:

```markdown
---
name: networking_overhaul_handoff
description: Networking overhaul — 3 bugs + 5 features. IMPLEMENTED AND DEPLOYED as of 2026-04-09.
type: project
---

## Status: COMPLETE

All 6 tasks from the plan at `docs/superpowers/plans/2026-03-29-networking-overhaul.md` are implemented and deployed to Vercel.

**What shipped:**
- `api/find-contacts.js` — hybrid Serper strategy, PERSONA_MAP, location-first with fallback, one contact per persona
- `Networking.jsx` — persona multiselect, STATUS_OPTS (Sent→Accepted→Replied→Coffee Chat→Referral Secured→Cold), migrateStatus(), FollowUpCard with inline AI draft, POC List 5th tab
```

---

### Task 9: Verify LinkedIn DM End-to-End (VER-2) — P1

**Files:**
- Read-only: `src/components/Networking.jsx`, `src/lib/storage.js`

- [ ] **Step 1: Confirm tab renders**

```bash
grep -n "tab.*dms\|dms.*tab\|fetchLinkedIn\|dmLoaded\|setDms\b" \
  src/components/Networking.jsx | head -15
```

Expected: tab conditionally renders on `tab === 'dms'`, data loaded via `fetchLinkedInContacts()`.

- [ ] **Step 2: Confirm storage function exists**

```bash
grep -n "fetchLinkedInContacts\|updateLinkedInContact\|fetchLinkedInStats" \
  src/lib/storage.js | head -10
```

Expected: all 3 functions exported.

- [ ] **Step 3: Confirm Supabase table**

```bash
grep -n "linkedin_contacts\|linkedin_dm\|netlog" \
  supabase_schema_v3.sql | head -10
```

If `linkedin_contacts` table doesn't exist in schema — that's a bug. The DM tab renders but `fetchLinkedInContacts()` will return empty with no error unless the table exists.

- [ ] **Step 4: If table is missing, flag it**

If step 3 finds no `linkedin_contacts` table, add to `bugs_open.md` OPEN section:
```markdown
- **BUG: LinkedIn DM tab renders but has no Supabase table** — `fetchLinkedInContacts()` likely returns `[]` always; need `CREATE TABLE linkedin_contacts (...)` migration [P1]
```

---

### Task 10: Verify Stale JD and Completed Jobs Fixes (VER-3 + VER-4) — P2

**Files:**
- Read-only: `src/components/JobAnalysis.jsx`, `src/App.jsx`, `src/lib/storage.js`

- [ ] **Step 1: Verify stale JD fix (F1)**

```bash
grep -n "useEffect\|currentJob.*id\|setJd\|setResult\|setRole" \
  src/components/JobAnalysis.jsx | head -20
```

Confirm the `useEffect` dependency array includes `currentJob?.id`. If it includes `currentJob` directly (without `.id`), it re-runs on every parent re-render — potential performance issue but not a stale JD bug.

- [ ] **Step 2: Verify completed jobs fix (F2)**

```bash
grep -n "completed\|in_pipeline.*false\|status.*completed\|pipelineJobs" \
  src/App.jsx | head -15
```

Confirm: `pipelineJobs = dbJobs.filter(j => j.in_pipeline && j.status !== 'completed')` — both conditions present.

Also confirm `sanitizeJobFeedUpdate` in `storage.js` does NOT override status to a non-completed value when `in_pipeline` is false:

```bash
grep -n "sanitizeJobFeedUpdate\|status.*in_pipeline\|in_pipeline.*status" \
  src/lib/storage.js | head -10
```

Expected: `status: job.in_pipeline ? 'viewed' : (job.status || 'new')` — when `in_pipeline=false`, uses the passed `job.status` value ("completed"). ✓

- [ ] **Step 3: If either check fails, add to bugs_open.md**

If step 1 shows `currentJob` (not `currentJob?.id`) in dependency: add F1 back to OPEN with the specific line.
If step 2 shows status being overwritten: add F2 back to OPEN with the specific line.

---

## EXECUTION STRATEGY

### How to Run This Without Breaking Things

1. **Start with MEM-1** — delete the two stale files. This is pure deletion, zero risk. Takes 2 minutes.

2. **Run Phase 2 tasks in parallel** — MEM-2 through SEC-1 are all file writes with no dependency on each other. Can dispatch as parallel subagents.

3. **Run GRAPH-1 after all memory tasks** — graphify will index the updated memory files. Don't run it before Phase 2 or you'll get another stale graph.

4. **Run verification tasks (VER-1 to VER-4) independently** — read-only, can run at any time. Dispatch in parallel with Phase 2.

5. **Only commit memory/doc changes if they belong in the git repo** — the `.claude/projects/.../memory/` files are outside the git repo; changes there don't need commits. Files inside `jobagent-web/` (like `docs/superpowers/plans/`) DO need commits.

### Risk Control
- All Phase 1-2 tasks are file writes only — zero code changes, zero deployment risk
- If a VER task finds a real bug: create a new targeted plan for that bug rather than patching it here
- GRAPH-1 is idempotent — re-running graphify never deletes existing code or memory files

### Checkpoints
- After Phase 1: `ls ~/.claude/projects/-Users-jashwanth-jobagent-web/memory/` → confirm 2 files gone
- After Phase 2: `cat ~/.claude/projects/-Users-jashwanth-jobagent-web/memory/MEMORY.md` → confirm 9 entries
- After Phase 3 (GRAPH-1): check GRAPH_REPORT.md cohesion scores
- After VER tasks: `bugs_open.md` is up to date with any newly discovered issues

---

## RESOLVED AUDIT ITEMS (for reference — no action needed)

The following items from the 2026-04-16 audit were **already fixed** before this plan was written. Documented here so they are not re-investigated:

| Audit Finding | Status | Where Fixed |
|---------------|--------|-------------|
| P1: Stale temp/ data in pipeline | ✅ Resolved | daily_scrape.yml line 42+ |
| P2: ITAR missing title scan | ✅ Resolved | merge_pipeline.py `_itar_reject_reason()` |
| P3: First-win alphabetical dedupe | ✅ Resolved | `SOURCE_PRIORITY` + `_filter_duplicates_priority()` |
| P4: Fake freshness dates | ✅ Resolved | `date_confidence` field across all scrapers |
| P5: h1b/tier/salary metadata dropped | ✅ Resolved | merge_pipeline.py line ~464-466 |
| P6: Auto-promotion whitelist pollution | ✅ Resolved | `_update_promotions` disabled in company_intelligence.py |
| P7: Apify blank location | ✅ Resolved | `_extract_location()` in apify_scraper.py |
| D1: distribute_feed import-time exit | ✅ Resolved | `_get_supabase_client()` called at runtime |
| D2: JSearch quota wrong | ✅ Resolved | `scraper.calls_made` actual count |
| D3: No concurrency guard | ✅ Resolved | `concurrency:` block in daily_scrape.yml |
| F1: Stale JD in JobAnalysis | ✅ Resolved | useEffect deps on `currentJob?.id` |
| F2: Completed jobs return on refresh | ✅ Resolved | `in_pipeline && status !== 'completed'` filter on load |
| F3: LinkedIn DM invisible | ✅ Resolved | `tab === 'dms'` renders in Networking.jsx |
| F4: Location filter missing in contacts | ✅ Resolved | `api/find-contacts.js` location-first Serper |
| F5: All contacts returned as Recruiter | ✅ Resolved | `classifyPersona()` + `PERSONA_MAP` |
| F6: Follow-up missing draft button | ✅ Resolved | `FollowUpCard` with `draftMessageWithGroq` |
| Row-by-row Supabase upserts | ✅ Resolved | `batch_upsert.py` in 100-row chunks |
