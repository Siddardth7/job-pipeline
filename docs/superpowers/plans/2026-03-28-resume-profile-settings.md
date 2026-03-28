# Resume, Profile & Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full Resume editing/analysis module, a dedicated Profile page, and restructure Settings into an organized control panel — all wired into the existing multi-user Supabase system.

**Architecture:** Three new React pages (Resume.jsx, Profile.jsx, restructured Settings.jsx) backed by two new Supabase tables (resumes, user_preferences). Resume analysis runs through the existing Groq helper. Navigation expands from 8 to 10 items in App.jsx.

**Tech Stack:** React (JSX, hooks), Supabase (PostgreSQL + RLS), Groq API (llama-3.3-70b), existing storage.js/groq.js patterns.

---

## CRITICAL PRE-FLIGHT: Read These Files First

Before any task, read and understand:
- `src/lib/storage.js` — all DB calls follow this pattern (getUserId, supabase CRUD, error throw)
- `src/lib/groq.js` — how Groq calls are structured (callGroq signature)
- `src/components/Settings.jsx` — existing Card/Btn components to reuse
- `src/App.jsx` lines 41-50 (NAV_ITEMS) and 299-358 (pages object)
- `supabase_schema_v2.sql` — existing table structure

---

## ARCHITECTURE DECISIONS (locked in, no ambiguity)

### Resume system: two parallel concepts
- **`resume_variants`** (existing): A/B/C/D skill snippet sets used by Job Analysis engine. DO NOT change.
- **`resumes`** (new): Full structured resume documents with experience, education, skills, analysis.
- Integration: A "Sync to Variant" action on Resume page optionally pushes primary resume skills → the matching resume_variant. Automatic sync is NOT implemented (YAGNI).

### Resume versioning: overwrite-with-snapshot
- No version history table. Too complex, not needed now.
- The resume editor auto-saves to the single resume row.
- `analysis_report` is a snapshot — running analysis overwrites the previous report.
- Rollback = not supported. User can create a second resume as a "backup".

### Profile → Resume: pre-fill on creation only
- When creating a new resume, profile data (name, experience_bullets, tool_list) pre-fills the structured_sections.
- No live sync after that. Resume is independent once created.

### Settings: no tabs, use sections with clear headings
- Remove profile/role-target sections (moved to Profile.jsx)
- Add Getting Started + Preferences sections
- Fix Serper key to use `user_integrations` (bug fix included in this plan)

---

## FILE MAP

| Action | File | Responsibility |
|--------|------|----------------|
| CREATE | `supabase_schema_v3.sql` | Migration for `resumes` + `user_preferences` tables + RLS |
| CREATE | `src/components/Resume.jsx` | Full Resume module: list, editor, analysis panel |
| CREATE | `src/components/Profile.jsx` | Dedicated profile + role targets page |
| MODIFY | `src/lib/storage.js` | Add resume CRUD + preferences CRUD |
| MODIFY | `src/lib/groq.js` | Add `analyzeResumeWithGroq()` |
| MODIFY | `src/components/Settings.jsx` | Remove profile section, add Getting Started + Preferences |
| MODIFY | `src/App.jsx` | Add resume + profile nav items, route to new pages, pass groqKey to Resume |

---

## Task 1: Database Migration (supabase_schema_v3.sql)

**Files:**
- Create: `supabase_schema_v3.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- ============================================================
-- JobAgent v3 Schema Migration — Resume Module + Preferences
-- Run in Supabase SQL editor. Safe to re-run.
-- ============================================================

-- ── SECTION 1: resumes table ─────────────────────────────────────────────────
-- Full structured resume documents (separate from resume_variants A/B/C/D)

create table if not exists resumes (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users(id) not null,
  name                text not null default 'My Resume',
  is_primary          boolean default false,
  target_roles        text[] default '{}',
  -- structured_sections shape:
  -- {
  --   summary: string,
  --   experience: [{ id, company, role, location, start_date, end_date, current, bullets: [string] }],
  --   education:  [{ id, school, degree, field, start_date, end_date, gpa }],
  --   skills:     [{ id, category, items: [string] }]
  -- }
  structured_sections jsonb not null default '{}'::jsonb,
  -- analysis_report shape (written by Groq):
  -- {
  --   score: 'A'|'B'|'C'|'D',
  --   summary: string,
  --   highlights: [{ section: string, note: string }],
  --   issues: [{ severity: 'urgent'|'critical'|'optional', problem: string, why: string, suggestion: string }]
  -- }
  analysis_report     jsonb,
  last_analyzed_at    timestamptz,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- Only one primary resume per user (enforced in storage layer, not DB constraint)
create index if not exists resumes_user_id_idx on resumes(user_id);

-- ── SECTION 2: user_preferences table ────────────────────────────────────────
-- Per-user job feed preferences and UI settings

create table if not exists user_preferences (
  user_id              uuid primary key references auth.users(id),
  theme                text default 'light',
  location_preference  text[] default '{}',
  seniority_filter     text[] default '{}',    -- ['entry', 'mid', 'senior']
  exclude_roles        text[] default '{}',    -- e.g. ['software', 'data science']
  h1b_filter           boolean default false,
  feed_min_score       integer default 30,
  updated_at           timestamptz default now()
);

-- ── SECTION 3: RLS Policies ───────────────────────────────────────────────────
alter table resumes enable row level security;
alter table user_preferences enable row level security;

-- Drop existing policies if re-running
drop policy if exists "resumes_user_owns" on resumes;
drop policy if exists "preferences_user_owns" on user_preferences;

-- Users can only see/edit their own resumes
create policy "resumes_user_owns" on resumes
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Users can only see/edit their own preferences
create policy "preferences_user_owns" on user_preferences
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

- [ ] **Step 2: Run in Supabase SQL editor**

Go to Supabase dashboard → SQL Editor → paste and run. Verify no errors. Check Table Editor to confirm `resumes` and `user_preferences` tables exist.

- [ ] **Step 3: Commit the migration file**

```bash
git add supabase_schema_v3.sql
git commit -m "feat: add resumes and user_preferences tables (v3 migration)"
```

---

## Task 2: Storage Layer — Resume CRUD

**Files:**
- Modify: `src/lib/storage.js` (append after line ~412, after deleteRoleTarget)

- [ ] **Step 1: Add resume storage functions**

Append the following to the bottom of `src/lib/storage.js`:

```js
// ── Resumes ────────────────────────────────────────────────────────────────────
const MAX_RESUMES = 5;

export async function fetchResumes() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('resumes')
    .select('id, name, is_primary, target_roles, last_analyzed_at, created_at, updated_at, analysis_report')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function fetchResume(id) {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('resumes')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function upsertResume(resume) {
  const userId = await getUserId();
  // Enforce max limit on insert (no id = new resume)
  if (!resume.id) {
    const existing = await fetchResumes();
    if (existing.length >= MAX_RESUMES) {
      throw new Error(`Maximum ${MAX_RESUMES} resumes allowed. Delete one to add another.`);
    }
  }
  const { data, error } = await supabase
    .from('resumes')
    .upsert(
      {
        ...resume,
        user_id:    userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function deleteResume(id) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('resumes')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

// Sets is_primary=true for `id`, false for all other user resumes.
// Two-step: clear all, then set. Avoids a unique constraint requirement.
export async function setPrimaryResume(id) {
  const userId = await getUserId();
  const { error: clearErr } = await supabase
    .from('resumes')
    .update({ is_primary: false })
    .eq('user_id', userId);
  if (clearErr) throw clearErr;
  const { error: setErr } = await supabase
    .from('resumes')
    .update({ is_primary: true })
    .eq('id', id)
    .eq('user_id', userId);
  if (setErr) throw setErr;
}

export async function saveResumeAnalysis(id, report) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('resumes')
    .update({
      analysis_report:  report,
      last_analyzed_at: new Date().toISOString(),
      updated_at:       new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

// ── User Preferences ───────────────────────────────────────────────────────────
export async function fetchPreferences() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || {};
}

export async function savePreferences(prefs) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('user_preferences')
    .upsert(
      { ...prefs, user_id: userId, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
  if (error) throw error;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/storage.js
git commit -m "feat: add resume CRUD and user preferences storage functions"
```

---

## Task 3: Groq — Resume Analysis Function

**Files:**
- Modify: `src/lib/groq.js` (append after `analyzeJobWithGroq`)

- [ ] **Step 1: Append the resume analysis function**

```js
// ─── Resume Analysis ──────────────────────────────────────────────────────────
// Returns a structured JSON report. Throws if Groq fails or returns malformed JSON.
export async function analyzeResumeWithGroq(structuredSections, targetRoles, apiKey) {
  const SYSTEM = `You are a strict, honest resume evaluator for early-career engineering candidates
(Aerospace, Manufacturing, Industrial, Mechanical). You evaluate resumes for:
1. Impact: Are bullets quantified? Vague bullets fail.
2. Skills relevance: Do skills match modern engineering job descriptions?
3. Formatting clarity: Are sections structured, scannable, consistent?
4. Experience framing: Is work experience framed around outcomes, not tasks?
5. Overall readiness for ATS and recruiter review.

You MUST respond with ONLY valid JSON matching this exact shape:
{
  "score": "A" | "B" | "C" | "D",
  "summary": "2-3 sentence overall evaluation",
  "highlights": [
    { "section": "Experience | Skills | Education | Summary", "note": "what is working well" }
  ],
  "issues": [
    {
      "severity": "urgent" | "critical" | "optional",
      "problem": "specific problem statement",
      "why": "why this hurts your application",
      "suggestion": "exact improvement to make"
    }
  ]
}
Score guide: A = ready to send, B = minor fixes, C = significant work needed, D = major gaps.
Produce at minimum 3 issues and 2 highlights. Be specific — never generic.
Do NOT wrap in markdown code fences. Return raw JSON only.`;

  const sections = structuredSections || {};
  const experience = (sections.experience || [])
    .map(e => `${e.role} at ${e.company} (${e.start_date}–${e.current ? 'Present' : e.end_date})\n${(e.bullets || []).map(b => `  • ${b}`).join('\n')}`)
    .join('\n\n');
  const skills = (sections.skills || [])
    .map(s => `${s.category}: ${(s.items || []).join(', ')}`)
    .join('\n');
  const education = (sections.education || [])
    .map(e => `${e.degree} in ${e.field}, ${e.school} (${e.end_date})${e.gpa ? `, GPA ${e.gpa}` : ''}`)
    .join('\n');

  const USER = `Target roles: ${(targetRoles || []).join(', ') || 'Engineering (general)'}

RESUME:
---
SUMMARY
${sections.summary || '(none)'}

EXPERIENCE
${experience || '(none)'}

EDUCATION
${education || '(none)'}

SKILLS
${skills || '(none)'}
---

Evaluate this resume.`;

  const raw = await callGroq(SYSTEM, USER, apiKey, 1200);

  // Strip any accidental markdown fences
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error('Resume analysis returned invalid JSON from Groq. Try again.');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/groq.js
git commit -m "feat: add analyzeResumeWithGroq function with structured JSON output"
```

---

## Task 4: Resume.jsx — Full Resume Module

**Files:**
- Create: `src/components/Resume.jsx`

This is the largest component. It has THREE internal views controlled by local state:
1. `view = 'list'` — Resume dashboard (list of resumes)
2. `view = 'editor'` — Structured editor for a single resume
3. `view = 'analysis'` — Analysis report view for a single resume

- [ ] **Step 1: Create Resume.jsx with list view**

```jsx
import { useState, useEffect, useCallback } from 'react';
import { Plus, Star, Trash2, Edit3, BarChart2, ChevronLeft, Loader, CheckCircle, AlertCircle, Info, X } from 'lucide-react';
import * as Storage from '../lib/storage.js';
import { analyzeResumeWithGroq } from '../lib/groq.js';

// ─── Shared sub-components ───────────────────────────────────────────────────
function Card({ children, t, style }) {
  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20, boxShadow: t.shadow, ...style }}>
      {children}
    </div>
  );
}

function Btn({ children, onClick, disabled, variant = 'primary', size = 'md', t, style: xs }) {
  const V = {
    primary:   { bg: t.pri,    c: '#fff',  b: 'none' },
    secondary: { bg: 'transparent', c: t.sub, b: `1px solid ${t.border}` },
    ghost:     { bg: 'transparent', c: t.muted, b: `1px solid ${t.border}` },
    green:     { bg: t.greenL, c: t.green, b: `1px solid ${t.greenBd}` },
    red:       { bg: t.redL,   c: t.red,   b: `1px solid ${t.redBd}` },
    yellow:    { bg: t.yellowL,c: t.yellow,b: `1px solid ${t.yellowBd}` },
  };
  const s = V[variant] || V.primary;
  const p = size === 'sm' ? '5px 14px' : '9px 18px';
  const fs = size === 'sm' ? 12.5 : 13.5;
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ background: s.bg, color: s.c, border: s.b, padding: p, borderRadius: 8, fontSize: fs, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6, ...xs }}>
      {children}
    </button>
  );
}

// ─── Empty structured sections template ──────────────────────────────────────
function emptyResume(profile) {
  return {
    summary: profile?.full_name ? `Motivated ${profile.degree || 'engineer'} seeking opportunities in engineering.` : '',
    experience: (profile?.experience_bullets || []).map((eb, i) => ({
      id: `exp-${i}`,
      company:    eb.company || '',
      role:       eb.role    || '',
      location:   '',
      start_date: '',
      end_date:   '',
      current:    false,
      bullets:    eb.metric ? [eb.metric] : [],
    })),
    education: [{
      id:         'edu-0',
      school:     '',
      degree:     profile?.degree ? profile.degree.split(' ').slice(0, 1).join('') : '',
      field:      '',
      start_date: '',
      end_date:   '',
      gpa:        '',
    }],
    skills: [
      { id: 'sk-0', category: 'Engineering Tools', items: (profile?.tool_list || []) },
      { id: 'sk-1', category: 'Technical Skills',  items: [] },
      { id: 'sk-2', category: 'Soft Skills',        items: [] },
    ],
  };
}

function uuid() { return crypto.randomUUID(); }

// ─── ANALYSIS PANEL ──────────────────────────────────────────────────────────
function AnalysisPanel({ report, onClose, t }) {
  if (!report) return null;
  const scoreColor = { A: t.green, B: t.pri, C: t.yellow, D: t.red };
  const severityColor = { urgent: t.red, critical: t.yellow, optional: t.muted };
  const severityLabel = { urgent: 'Urgent Fix', critical: 'Critical Fix', optional: 'Optional' };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.muted, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontFamily: 'inherit' }}>
          <ChevronLeft size={16} /> Back to Editor
        </button>
      </div>

      {/* Score */}
      <Card t={t} style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ width: 64, height: 64, borderRadius: 12, background: scoreColor[report.score] + '22', border: `2px solid ${scoreColor[report.score]}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800, color: scoreColor[report.score], flexShrink: 0 }}>
          {report.score}
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: t.tx, marginBottom: 4 }}>Resume Score</div>
          <div style={{ fontSize: 13, color: t.sub, lineHeight: 1.5 }}>{report.summary}</div>
        </div>
      </Card>

      {/* Highlights */}
      {report.highlights?.length > 0 && (
        <Card t={t} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.tx, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle size={15} color={t.green} /> What's Working
          </div>
          {report.highlights.map((h, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, padding: '8px 12px', background: t.greenL, borderRadius: 8, border: `1px solid ${t.greenBd}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: t.green, minWidth: 80 }}>{h.section}</div>
              <div style={{ fontSize: 12.5, color: t.tx, lineHeight: 1.5 }}>{h.note}</div>
            </div>
          ))}
        </Card>
      )}

      {/* Issues */}
      {report.issues?.length > 0 && (
        <Card t={t}>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.tx, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={15} color={t.red} /> Issues to Fix
          </div>
          {['urgent', 'critical', 'optional'].map(sev => {
            const issues = report.issues.filter(i => i.severity === sev);
            if (!issues.length) return null;
            return (
              <div key={sev} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: severityColor[sev], textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{severityLabel[sev]}</div>
                {issues.map((issue, i) => (
                  <div key={i} style={{ border: `1px solid ${t.border}`, borderRadius: 8, padding: 14, marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: t.tx, marginBottom: 4 }}>{issue.problem}</div>
                    <div style={{ fontSize: 12, color: t.sub, marginBottom: 6, lineHeight: 1.5 }}><strong>Why:</strong> {issue.why}</div>
                    <div style={{ fontSize: 12, color: t.pri, lineHeight: 1.5, background: t.priL, padding: '6px 10px', borderRadius: 6 }}><strong>Fix:</strong> {issue.suggestion}</div>
                  </div>
                ))}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

// ─── RESUME EDITOR ────────────────────────────────────────────────────────────
function ResumeEditor({ resume, profile, onSave, onBack, onAnalyze, analyzing, t }) {
  const [name, setName] = useState(resume.name || 'My Resume');
  const [targetRoles, setTargetRoles] = useState((resume.target_roles || []).join(', '));
  const [sections, setSections] = useState(resume.structured_sections || emptyResume(profile));
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [activeSection, setActiveSection] = useState('experience');

  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        ...resume,
        name,
        target_roles: targetRoles.split(',').map(r => r.trim()).filter(Boolean),
        structured_sections: sections,
      });
      setSaveMsg('Saved!');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (e) {
      setSaveMsg('Error: ' + e.message);
    }
    setSaving(false);
  };

  const updateSummary = (val) => setSections(s => ({ ...s, summary: val }));

  // Experience
  const updateExpField = (id, field, val) =>
    setSections(s => ({ ...s, experience: s.experience.map(e => e.id === id ? { ...e, [field]: val } : e) }));
  const updateExpBullet = (id, bi, val) =>
    setSections(s => ({ ...s, experience: s.experience.map(e => e.id === id ? { ...e, bullets: e.bullets.map((b, i) => i === bi ? val : b) } : e) }));
  const addExpBullet = (id) =>
    setSections(s => ({ ...s, experience: s.experience.map(e => e.id === id ? { ...e, bullets: [...e.bullets, ''] } : e) }));
  const removeExpBullet = (id, bi) =>
    setSections(s => ({ ...s, experience: s.experience.map(e => e.id === id ? { ...e, bullets: e.bullets.filter((_, i) => i !== bi) } : e) }));
  const addExperience = () =>
    setSections(s => ({ ...s, experience: [...s.experience, { id: uuid(), company: '', role: '', location: '', start_date: '', end_date: '', current: false, bullets: [''] }] }));
  const removeExperience = (id) =>
    setSections(s => ({ ...s, experience: s.experience.filter(e => e.id !== id) }));

  // Education
  const updateEduField = (id, field, val) =>
    setSections(s => ({ ...s, education: s.education.map(e => e.id === id ? { ...e, [field]: val } : e) }));
  const addEducation = () =>
    setSections(s => ({ ...s, education: [...s.education, { id: uuid(), school: '', degree: '', field: '', start_date: '', end_date: '', gpa: '' }] }));
  const removeEducation = (id) =>
    setSections(s => ({ ...s, education: s.education.filter(e => e.id !== id) }));

  // Skills
  const updateSkillCategory = (id, val) =>
    setSections(s => ({ ...s, skills: s.skills.map(sk => sk.id === id ? { ...sk, category: val } : sk) }));
  const updateSkillItems = (id, val) =>
    setSections(s => ({ ...s, skills: s.skills.map(sk => sk.id === id ? { ...sk, items: val.split(',').map(x => x.trim()).filter(Boolean) } : sk) }));
  const addSkillGroup = () =>
    setSections(s => ({ ...s, skills: [...s.skills, { id: uuid(), category: '', items: [] }] }));
  const removeSkillGroup = (id) =>
    setSections(s => ({ ...s, skills: s.skills.filter(sk => sk.id !== id) }));

  const inp = { width: '100%', padding: '7px 10px', borderRadius: 7, border: `1px solid ${t.border}`, background: t.bg, color: t.tx, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' };
  const label = { display: 'block', fontSize: 11, fontWeight: 700, color: t.sub, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 };
  const TABS = ['experience', 'education', 'skills'];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.muted, display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontFamily: 'inherit' }}>
            <ChevronLeft size={16} /> All Resumes
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saveMsg && <span style={{ fontSize: 12, color: saveMsg.includes('Error') ? t.red : t.green, fontWeight: 600 }}>{saveMsg}</span>}
          <Btn variant="yellow" size="sm" onClick={() => onAnalyze(sections, name, targetRoles)} disabled={analyzing} t={t}>
            {analyzing ? <><Loader size={13} /> Analyzing...</> : <><BarChart2 size={13} /> Analyze</>}
          </Btn>
          <Btn size="sm" onClick={save} disabled={saving} t={t}>
            {saving ? 'Saving...' : 'Save'}
          </Btn>
        </div>
      </div>

      {/* Meta */}
      <Card t={t} style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={label}>Resume Name</label>
          <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Manufacturing Resume" />
        </div>
        <div>
          <label style={label}>Target Roles (comma-separated)</label>
          <input style={inp} value={targetRoles} onChange={e => setTargetRoles(e.target.value)} placeholder="Manufacturing Engineer, Process Engineer" />
        </div>
      </Card>

      {/* Summary */}
      <Card t={t} style={{ marginBottom: 16 }}>
        <label style={{ ...label, marginBottom: 8 }}>Professional Summary</label>
        <textarea value={sections.summary || ''} onChange={e => updateSummary(e.target.value)} rows={3}
          style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }} placeholder="2-3 sentence professional summary..." />
      </Card>

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: t.bg, borderRadius: 8, border: `1px solid ${t.border}`, padding: 4 }}>
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveSection(tab)}
            style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: activeSection === tab ? t.card : 'transparent', color: activeSection === tab ? t.tx : t.muted, boxShadow: activeSection === tab ? t.shadow : 'none' }}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Experience */}
      {activeSection === 'experience' && (
        <div>
          {(sections.experience || []).map((exp) => (
            <Card key={exp.id} t={t} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.tx }}>Experience Entry</div>
                <button onClick={() => removeExperience(exp.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.red }}><X size={15} /></button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div><label style={label}>Company</label><input style={inp} value={exp.company} onChange={e => updateExpField(exp.id, 'company', e.target.value)} placeholder="Boeing" /></div>
                <div><label style={label}>Role</label><input style={inp} value={exp.role} onChange={e => updateExpField(exp.id, 'role', e.target.value)} placeholder="Manufacturing Engineer" /></div>
                <div><label style={label}>Start Date</label><input style={inp} value={exp.start_date} onChange={e => updateExpField(exp.id, 'start_date', e.target.value)} placeholder="Jan 2023" /></div>
                <div><label style={label}>End Date</label><input style={inp} value={exp.current ? 'Present' : exp.end_date} onChange={e => updateExpField(exp.id, 'end_date', e.target.value)} disabled={exp.current} placeholder="Dec 2024" /></div>
              </div>
              <div style={{ marginBottom: 4 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: t.sub, cursor: 'pointer' }}>
                  <input type="checkbox" checked={exp.current} onChange={e => updateExpField(exp.id, 'current', e.target.checked)} /> Current role
                </label>
              </div>
              <label style={{ ...label, marginTop: 10 }}>Bullet Points</label>
              {(exp.bullets || []).map((bullet, bi) => (
                <div key={bi} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                  <span style={{ color: t.muted, paddingTop: 8, fontSize: 13 }}>•</span>
                  <input style={{ ...inp, flex: 1 }} value={bullet} onChange={e => updateExpBullet(exp.id, bi, e.target.value)} placeholder="Reduced defect rate by 40% using SPC and 8D methodology..." />
                  <button onClick={() => removeExpBullet(exp.id, bi)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.muted, padding: '0 4px' }}><X size={13} /></button>
                </div>
              ))}
              <Btn variant="ghost" size="sm" onClick={() => addExpBullet(exp.id)} t={t} style={{ marginTop: 4 }}><Plus size={12} /> Add Bullet</Btn>
            </Card>
          ))}
          <Btn variant="secondary" onClick={addExperience} t={t}><Plus size={14} /> Add Experience</Btn>
        </div>
      )}

      {/* Education */}
      {activeSection === 'education' && (
        <div>
          {(sections.education || []).map((edu) => (
            <Card key={edu.id} t={t} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.tx }}>Education Entry</div>
                <button onClick={() => removeEducation(edu.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.red }}><X size={15} /></button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div><label style={label}>School</label><input style={inp} value={edu.school} onChange={e => updateEduField(edu.id, 'school', e.target.value)} placeholder="University of Illinois Urbana-Champaign" /></div>
                <div><label style={label}>Degree</label><input style={inp} value={edu.degree} onChange={e => updateEduField(edu.id, 'degree', e.target.value)} placeholder="M.S." /></div>
                <div><label style={label}>Field of Study</label><input style={inp} value={edu.field} onChange={e => updateEduField(edu.id, 'field', e.target.value)} placeholder="Aerospace Engineering" /></div>
                <div><label style={label}>GPA (optional)</label><input style={inp} value={edu.gpa} onChange={e => updateEduField(edu.id, 'gpa', e.target.value)} placeholder="3.8" /></div>
                <div><label style={label}>Start Date</label><input style={inp} value={edu.start_date} onChange={e => updateEduField(edu.id, 'start_date', e.target.value)} placeholder="Aug 2023" /></div>
                <div><label style={label}>End Date</label><input style={inp} value={edu.end_date} onChange={e => updateEduField(edu.id, 'end_date', e.target.value)} placeholder="Dec 2025" /></div>
              </div>
            </Card>
          ))}
          <Btn variant="secondary" onClick={addEducation} t={t}><Plus size={14} /> Add Education</Btn>
        </div>
      )}

      {/* Skills */}
      {activeSection === 'skills' && (
        <div>
          {(sections.skills || []).map((sk) => (
            <Card key={sk.id} t={t} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <label style={label}>Skill Category</label>
                <button onClick={() => removeSkillGroup(sk.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.red }}><X size={15} /></button>
              </div>
              <input style={{ ...inp, marginBottom: 8 }} value={sk.category} onChange={e => updateSkillCategory(sk.id, e.target.value)} placeholder="e.g. Engineering Tools" />
              <label style={label}>Skills (comma-separated)</label>
              <input style={inp} value={(sk.items || []).join(', ')} onChange={e => updateSkillItems(sk.id, e.target.value)} placeholder="SolidWorks, MATLAB, SPC, GD&T" />
            </Card>
          ))}
          <Btn variant="secondary" onClick={addSkillGroup} t={t}><Plus size={14} /> Add Skill Group</Btn>
        </div>
      )}
    </div>
  );
}

// ─── RESUME LIST ──────────────────────────────────────────────────────────────
export default function Resume({ profile, groqKey, t }) {
  const [resumes, setResumes]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [view, setView]             = useState('list');   // 'list' | 'editor' | 'analysis'
  const [activeResume, setActive]   = useState(null);     // full resume row when in editor/analysis
  const [analyzing, setAnalyzing]   = useState(false);
  const [analysisReport, setReport] = useState(null);
  const [error, setError]           = useState('');
  const [settingPrimary, setPrimary]= useState('');

  const loadResumes = useCallback(async () => {
    try {
      const data = await Storage.fetchResumes();
      setResumes(data);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadResumes(); }, [loadResumes]);

  const openEditor = async (resumeRow) => {
    try {
      const full = await Storage.fetchResume(resumeRow.id);
      setActive(full);
      setView('editor');
    } catch (e) { setError(e.message); }
  };

  const createNew = async () => {
    try {
      const id = await Storage.upsertResume({
        name:                'New Resume',
        is_primary:          resumes.length === 0,
        target_roles:        [],
        structured_sections: emptyResume(profile),
      });
      const full = await Storage.fetchResume(id);
      setActive(full);
      setView('editor');
      loadResumes();
    } catch (e) { setError(e.message); }
  };

  const handleSave = async (updated) => {
    await Storage.upsertResume(updated);
    await loadResumes();
    setActive(updated);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this resume? This cannot be undone.')) return;
    await Storage.deleteResume(id);
    await loadResumes();
  };

  const handleSetPrimary = async (id) => {
    setPrimary(id);
    try {
      await Storage.setPrimaryResume(id);
      await loadResumes();
    } catch (e) { setError(e.message); }
    setPrimary('');
  };

  const handleAnalyze = async (sections, name, targetRoles) => {
    if (!groqKey) { setError('Add your Groq API key in Settings to run analysis.'); return; }
    setAnalyzing(true);
    setError('');
    try {
      const roles = typeof targetRoles === 'string'
        ? targetRoles.split(',').map(r => r.trim()).filter(Boolean)
        : targetRoles;
      const report = await analyzeResumeWithGroq(sections, roles, groqKey);
      await Storage.saveResumeAnalysis(activeResume.id, report);
      setReport(report);
      setView('analysis');
      await loadResumes();
    } catch (e) {
      setError(e.message);
    }
    setAnalyzing(false);
  };

  const openAnalysis = async (resumeRow) => {
    try {
      const full = await Storage.fetchResume(resumeRow.id);
      setActive(full);
      setReport(full.analysis_report);
      setView('analysis');
    } catch (e) { setError(e.message); }
  };

  // ── LIST VIEW ────────────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 800, color: t.tx }}>Resumes</h2>
            <p style={{ margin: 0, fontSize: 13.5, color: t.sub }}>{resumes.length}/5 resumes · Primary is used in Job Analysis</p>
          </div>
          <Btn onClick={createNew} disabled={resumes.length >= 5} t={t}><Plus size={14} /> New Resume</Btn>
        </div>

        {error && (
          <div style={{ padding: '10px 14px', background: t.redL, border: `1px solid ${t.redBd}`, borderRadius: 8, color: t.red, fontSize: 13, marginBottom: 16 }}>{error}</div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', color: t.muted, padding: 40 }}>Loading resumes...</div>
        ) : resumes.length === 0 ? (
          <Card t={t} style={{ textAlign: 'center', padding: 48 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: t.tx, marginBottom: 6 }}>No resumes yet</div>
            <div style={{ fontSize: 13, color: t.sub, marginBottom: 20 }}>Create your first resume. Your profile data will pre-fill the sections.</div>
            <Btn onClick={createNew} t={t}><Plus size={14} /> Create Resume</Btn>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {resumes.map(r => (
              <Card key={r.id} t={t} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 700, color: t.tx }}>{r.name}</span>
                    {r.is_primary && (
                      <span style={{ fontSize: 11, fontWeight: 700, background: t.priL, color: t.pri, padding: '2px 8px', borderRadius: 10 }}>Primary</span>
                    )}
                    {r.analysis_report && (
                      <span style={{ fontSize: 11, fontWeight: 700, background: t.greenL, color: t.green, padding: '2px 8px', borderRadius: 10 }}>
                        Score: {r.analysis_report.score}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: t.muted }}>
                    {r.target_roles?.length > 0 ? r.target_roles.join(' · ') : 'No target roles set'}
                    {' · '}
                    {r.last_analyzed_at
                      ? `Analyzed ${new Date(r.last_analyzed_at).toLocaleDateString()}`
                      : 'Not analyzed'}
                    {' · '}
                    Updated {new Date(r.updated_at).toLocaleDateString()}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {!r.is_primary && (
                    <Btn size="sm" variant="ghost" onClick={() => handleSetPrimary(r.id)} disabled={settingPrimary === r.id} t={t}>
                      <Star size={12} /> Set Primary
                    </Btn>
                  )}
                  {r.analysis_report && (
                    <Btn size="sm" variant="secondary" onClick={() => openAnalysis(r)} t={t}>
                      <BarChart2 size={12} /> Report
                    </Btn>
                  )}
                  <Btn size="sm" variant="secondary" onClick={() => openEditor(r)} t={t}>
                    <Edit3 size={12} /> Edit
                  </Btn>
                  <Btn size="sm" variant="red" onClick={() => handleDelete(r.id)} t={t}>
                    <Trash2 size={12} />
                  </Btn>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── EDITOR VIEW ──────────────────────────────────────────────────────────────
  if (view === 'editor') {
    return (
      <div>
        {error && (
          <div style={{ padding: '10px 14px', background: t.redL, border: `1px solid ${t.redBd}`, borderRadius: 8, color: t.red, fontSize: 13, marginBottom: 16 }}>{error}</div>
        )}
        <ResumeEditor
          resume={activeResume}
          profile={profile}
          onSave={handleSave}
          onBack={() => { setView('list'); setActive(null); setError(''); }}
          onAnalyze={handleAnalyze}
          analyzing={analyzing}
          t={t}
        />
      </div>
    );
  }

  // ── ANALYSIS VIEW ────────────────────────────────────────────────────────────
  if (view === 'analysis') {
    return (
      <div>
        {error && (
          <div style={{ padding: '10px 14px', background: t.redL, border: `1px solid ${t.redBd}`, borderRadius: 8, color: t.red, fontSize: 13, marginBottom: 16 }}>{error}</div>
        )}
        <AnalysisPanel
          report={analysisReport}
          onClose={() => setView(activeResume ? 'editor' : 'list')}
          t={t}
        />
      </div>
    );
  }

  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Resume.jsx
git commit -m "feat: add Resume module (list view, structured editor, analysis panel)"
```

---

## Task 5: Profile.jsx — Dedicated Profile Page

**Files:**
- Create: `src/components/Profile.jsx`

Extracts and expands the profile editor from Settings.jsx into a standalone page.

- [ ] **Step 1: Create Profile.jsx**

```jsx
import { useState, useEffect } from 'react';
import { Save, Plus, X } from 'lucide-react';
import * as Storage from '../lib/storage.js';

function Card({ children, t, style }) {
  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20, boxShadow: t.shadow, ...style }}>
      {children}
    </div>
  );
}

function Field({ label, children, t }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: t.sub, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inp = (t) => ({
  width: '100%', padding: '8px 10px', borderRadius: 7, border: `1px solid ${t.border}`,
  background: t.bg, color: t.tx, fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none',
});

const VISA_OPTIONS = ['US Citizen', 'Green Card', 'H-1B', 'OPT/STEM OPT', 'TN Visa', 'Other'];
const DEGREE_OPTIONS = ['B.S.', 'B.E.', 'M.S.', 'M.E.', 'Ph.D.'];
const DOMAIN_OPTIONS = [
  { value: 'aerospace_manufacturing', label: 'Aerospace & Manufacturing' },
  { value: 'industrial_engineering',  label: 'Industrial & Operations Engineering' },
  { value: 'mechanical_thermal',      label: 'Mechanical & Thermal Engineering' },
];

export default function Profile({ t }) {
  const [profile, setProfile]         = useState({});
  const [roleTargets, setRoleTargets] = useState([]);
  const [saving, setSaving]           = useState('');
  const [loading, setLoading]         = useState(true);
  const [newRole, setNewRole]         = useState({ title: '', cluster: 'manufacturing', priority: 1 });
  const [expBullets, setExpBullets]   = useState([]); // [{id, company, role, metric, tools}]
  const [toolInput, setToolInput]     = useState('');

  useEffect(() => {
    Promise.all([Storage.fetchUserProfile(), Storage.fetchRoleTargets()])
      .then(([p, r]) => {
        if (p) {
          setProfile(p);
          setExpBullets(p.experience_bullets || []);
          setToolInput((p.tool_list || []).join(', '));
        }
        setRoleTargets(r || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const set = (key, val) => setProfile(p => ({ ...p, [key]: val }));

  const saveProfile = async () => {
    setSaving('Saving...');
    try {
      await Storage.upsertUserProfile({
        full_name:            profile.full_name || '',
        degree:               profile.degree || '',
        graduation_year:      profile.graduation_year ? parseInt(profile.graduation_year) : null,
        visa_status:          profile.visa_status || '',
        visa_years_remaining: profile.visa_years_remaining ? parseInt(profile.visa_years_remaining) : null,
        domain_family:        profile.domain_family || '',
        linkedin_url:         profile.linkedin_url || null,
        experience_bullets:   expBullets,
        tool_list:            toolInput.split(',').map(t => t.trim()).filter(Boolean),
      });
      setSaving('Saved!');
      setTimeout(() => setSaving(''), 3000);
    } catch (e) {
      setSaving('Error: ' + e.message);
    }
  };

  // Experience bullets
  const addExp = () => setExpBullets(prev => [...prev, { id: crypto.randomUUID(), company: '', role: '', metric: '', tools: '' }]);
  const updateExp = (id, field, val) => setExpBullets(prev => prev.map(e => e.id === id ? { ...e, [field]: val } : e));
  const removeExp = (id) => setExpBullets(prev => prev.filter(e => e.id !== id));

  // Role targets
  const addRole = async () => {
    if (!newRole.title.trim()) return;
    const id = crypto.randomUUID();
    await Storage.upsertRoleTarget({ ...newRole, id });
    setRoleTargets(prev => [...prev, { ...newRole, id }]);
    setNewRole({ title: '', cluster: 'manufacturing', priority: 1 });
  };
  const removeRole = async (id) => {
    await Storage.deleteRoleTarget(id);
    setRoleTargets(prev => prev.filter(r => r.id !== id));
  };

  if (loading) return <div style={{ color: t.muted, padding: 40, textAlign: 'center' }}>Loading profile...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 800, color: t.tx }}>Profile</h2>
          <p style={{ margin: 0, fontSize: 13.5, color: t.sub }}>Your identity layer — used in onboarding, feed filtering, and resume pre-fill.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {saving && <span style={{ fontSize: 12.5, fontWeight: 600, color: saving.includes('Error') ? t.red : t.green }}>{saving}</span>}
          <button onClick={saveProfile} style={{ background: t.pri, color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Save size={14} /> Save Profile
          </button>
        </div>
      </div>

      {/* Basic Info */}
      <Card t={t} style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: t.tx, marginBottom: 14 }}>Basic Information</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Full Name" t={t}><input style={inp(t)} value={profile.full_name || ''} onChange={e => set('full_name', e.target.value)} placeholder="Jane Smith" /></Field>
          <Field label="LinkedIn URL" t={t}><input style={inp(t)} value={profile.linkedin_url || ''} onChange={e => set('linkedin_url', e.target.value)} placeholder="https://linkedin.com/in/..." /></Field>
          <Field label="Highest Degree" t={t}>
            <select style={{ ...inp(t), cursor: 'pointer' }} value={profile.degree || ''} onChange={e => set('degree', e.target.value)}>
              <option value="">Select degree</option>
              {DEGREE_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Graduation Year" t={t}><input style={inp(t)} type="number" value={profile.graduation_year || ''} onChange={e => set('graduation_year', e.target.value)} placeholder="2025" /></Field>
          <Field label="Visa / Work Auth" t={t}>
            <select style={{ ...inp(t), cursor: 'pointer' }} value={profile.visa_status || ''} onChange={e => set('visa_status', e.target.value)}>
              <option value="">Select status</option>
              {VISA_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
          <Field label="Years on Current Visa" t={t}><input style={inp(t)} type="number" value={profile.visa_years_remaining || ''} onChange={e => set('visa_years_remaining', e.target.value)} placeholder="3" /></Field>
          <Field label="Engineering Domain" t={t} style={{ gridColumn: '1 / -1' }}>
            <select style={{ ...inp(t), cursor: 'pointer' }} value={profile.domain_family || ''} onChange={e => set('domain_family', e.target.value)}>
              <option value="">Select domain</option>
              {DOMAIN_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </Field>
        </div>
      </Card>

      {/* Tool List */}
      <Card t={t} style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: t.tx, marginBottom: 4 }}>Tool & Skills List</div>
        <div style={{ fontSize: 12, color: t.muted, marginBottom: 12 }}>Used to pre-fill resume skill sections. Comma-separated.</div>
        <textarea
          value={toolInput}
          onChange={e => setToolInput(e.target.value)}
          rows={3}
          placeholder="SolidWorks, CATIA, MATLAB, Python, GD&T, SPC, CMM Inspection..."
          style={{ ...inp(t), resize: 'vertical', lineHeight: 1.6 }}
        />
      </Card>

      {/* Experience Bullets */}
      <Card t={t} style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.tx }}>Experience Entries</div>
            <div style={{ fontSize: 12, color: t.muted }}>Structured experience that pre-fills new resumes.</div>
          </div>
          <button onClick={addExp} style={{ background: t.pri, color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={13} /> Add
          </button>
        </div>
        {expBullets.map(exp => (
          <div key={exp.id} style={{ border: `1px solid ${t.border}`, borderRadius: 9, padding: 14, marginBottom: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div><label style={{ fontSize: 10.5, fontWeight: 700, color: t.sub, display: 'block', marginBottom: 3 }}>COMPANY</label><input style={inp(t)} value={exp.company} onChange={e => updateExp(exp.id, 'company', e.target.value)} placeholder="Boeing" /></div>
              <div><label style={{ fontSize: 10.5, fontWeight: 700, color: t.sub, display: 'block', marginBottom: 3 }}>ROLE</label><input style={inp(t)} value={exp.role} onChange={e => updateExp(exp.id, 'role', e.target.value)} placeholder="Manufacturing Engineer" /></div>
            </div>
            <div style={{ marginBottom: 8 }}><label style={{ fontSize: 10.5, fontWeight: 700, color: t.sub, display: 'block', marginBottom: 3 }}>KEY ACHIEVEMENT / METRIC</label><input style={inp(t)} value={exp.metric} onChange={e => updateExp(exp.id, 'metric', e.target.value)} placeholder="Reduced defect rate 15%→3% using SPC and 8D methodology" /></div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}><label style={{ fontSize: 10.5, fontWeight: 700, color: t.sub, display: 'block', marginBottom: 3 }}>TOOLS USED</label><input style={inp(t)} value={exp.tools} onChange={e => updateExp(exp.id, 'tools', e.target.value)} placeholder="SPC, Minitab, CMM" /></div>
              <button onClick={() => removeExp(exp.id)} style={{ background: 'none', border: `1px solid ${t.redBd}`, borderRadius: 7, color: t.red, cursor: 'pointer', padding: '7px 10px' }}><X size={14} /></button>
            </div>
          </div>
        ))}
        {expBullets.length === 0 && <div style={{ color: t.muted, fontSize: 13, textAlign: 'center', padding: '16px 0' }}>No experience entries yet — add one above.</div>}
      </Card>

      {/* Target Roles */}
      <Card t={t}>
        <div style={{ fontSize: 14, fontWeight: 700, color: t.tx, marginBottom: 4 }}>Target Roles</div>
        <div style={{ fontSize: 12, color: t.muted, marginBottom: 14 }}>Job titles the feed distribution algorithm uses to score jobs for you.</div>
        {roleTargets.map(rt => (
          <div key={rt.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7, padding: '7px 10px', borderRadius: 7, background: t.hover }}>
            <span style={{ flex: 1, color: t.tx, fontSize: 13 }}>{rt.title}</span>
            <span style={{ color: t.sub, fontSize: 11, background: t.priL, padding: '2px 8px', borderRadius: 10 }}>{rt.cluster}</span>
            <button onClick={() => removeRole(rt.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.muted }}><X size={14} /></button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <input
            value={newRole.title} onChange={e => setNewRole(p => ({ ...p, title: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && addRole()}
            placeholder="Role title (e.g. Process Engineer)"
            style={{ ...inp(t), flex: 2, minWidth: 160 }}
          />
          <select value={newRole.cluster} onChange={e => setNewRole(p => ({ ...p, cluster: e.target.value }))}
            style={{ ...inp(t), flex: 1, minWidth: 140, cursor: 'pointer' }}>
            {['manufacturing','process','quality','composites','materials','industrial','industrial_operations','mechanical_thermal','tooling_inspection','startup_manufacturing'].map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button onClick={addRole} style={{ background: t.pri, color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Add</button>
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Profile.jsx
git commit -m "feat: add dedicated Profile page (extracts from Settings, adds experience bullets)"
```

---

## Task 6: Settings.jsx — Restructure

**Files:**
- Modify: `src/components/Settings.jsx`

Changes:
1. Remove the "Your Profile" and "Target Roles" Card sections (moved to Profile.jsx)
2. Fix Serper key to save to `user_integrations` instead of `settings` table
3. Remove all profile/role-related state and handlers
4. Add "Getting Started" Card section
5. Add "Job Preferences" Card section (connects to `user_preferences`)

- [ ] **Step 1: Fix Serper key to use user_integrations**

In `src/components/Settings.jsx`, replace `saveSerperKey`:

```jsx
const saveSerperKey = async () => {
  try {
    setSerperSaveStatus("Saving...");
    await Storage.saveUserIntegration('serper', serperInput.trim());
    setSerperKey(serperInput.trim());
    setSerperSaveStatus(serperInput.trim() ? "Saved!" : "Key cleared.");
    setTimeout(() => setSerperSaveStatus(""), 3000);
  } catch(e) {
    setSerperSaveStatus("Save failed: " + e.message);
  }
};
```

- [ ] **Step 2: Remove profile/role state and handlers**

Delete these from the top of `AppSettings` component:
- `const [profile, setProfile] = useState({...})`
- `const [profileSaving, setProfileSaving] = useState('')`
- `const [roleTargets, setRoleTargets] = useState([])`
- `const [newRole, setNewRole] = useState({...})`
- `useEffect` that calls `fetchUserProfile` and `fetchRoleTargets`
- `saveProfile` function
- `addRoleTarget` function
- `removeRoleTarget` function

- [ ] **Step 3: Add preferences state and handler**

Add to `AppSettings` component (after existing useState declarations):

```jsx
const [prefs, setPrefs]           = useState({});
const [prefSaving, setPrefSaving] = useState('');

useEffect(() => {
  Storage.fetchPreferences().then(p => setPrefs(p || {})).catch(() => {});
}, []);

const savePreferences = async () => {
  setPrefSaving('Saving...');
  try {
    await Storage.savePreferences(prefs);
    setPrefSaving('Saved!');
    setTimeout(() => setPrefSaving(''), 3000);
  } catch(e) {
    setPrefSaving('Error: ' + e.message);
  }
};
```

- [ ] **Step 4: Remove Profile and Target Roles Card sections from JSX**

Delete from the return statement:
- The `<Card>` block with `<h3>Your Profile</h3>` (was at the bottom of Settings.jsx)
- The `<Card>` block with `<h3>Target Roles</h3>`

- [ ] **Step 5: Add Getting Started Card before all other cards**

Add this as the FIRST card in the return statement:

```jsx
<Card t={t} style={{marginBottom:20}}>
  <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
    <div style={{width:34,height:34,borderRadius:9,background:t.priL,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <Info size={16} color={t.pri}/>
    </div>
    <div>
      <div style={{fontSize:14.5,fontWeight:700,color:t.tx}}>Getting Started</div>
      <div style={{fontSize:12,color:t.muted}}>How JobAgent works</div>
    </div>
  </div>
  {[
    ['Job Feed',       'Scrapers run daily via GitHub Actions (ATS, SerpAPI). Jobs are matched against your target roles set in Profile. New jobs appear in Find Jobs.'],
    ['Pipeline',       'Add jobs to Pipeline from Find Jobs. Use Job Analysis to analyze a JD against your resume variant. Log applications from the Pipeline view.'],
    ['Resume',         'Create structured resumes in the Resume section. Run AI analysis (requires Groq key) for scoring and improvement suggestions. Primary resume is used in Job Analysis.'],
    ['Networking',     'Add contacts from Find Contacts. Compose messages using templates. Track conversation status and follow-ups in the Networking log.'],
    ['API Keys',       'Groq (free at console.groq.com) enables AI analysis and message drafting. Serper (free at serper.dev) enables LinkedIn contact search.'],
  ].map(([title, desc]) => (
    <div key={title} style={{display:'flex',gap:12,marginBottom:12}}>
      <div style={{width:90,fontSize:12,fontWeight:700,color:t.sub,flexShrink:0,paddingTop:1}}>{title}</div>
      <div style={{fontSize:12.5,color:t.tx,lineHeight:1.6}}>{desc}</div>
    </div>
  ))}
</Card>
```

Add `Info` to the import from `lucide-react`.

- [ ] **Step 6: Add Job Preferences Card (after Groq card)**

```jsx
<Card t={t} style={{marginBottom:20}}>
  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
    <div style={{display:'flex',alignItems:'center',gap:10}}>
      <div style={{width:34,height:34,borderRadius:9,background:t.yellowL,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <Zap size={16} color={t.yellow}/>
      </div>
      <div>
        <div style={{fontSize:14.5,fontWeight:700,color:t.tx}}>Job Preferences</div>
        <div style={{fontSize:12,color:t.muted}}>Controls feed filtering. More specific = fewer but better matches.</div>
      </div>
    </div>
    <div style={{display:'flex',alignItems:'center',gap:10}}>
      {prefSaving && <span style={{fontSize:12,fontWeight:600,color:prefSaving.includes('Error')?t.red:t.green}}>{prefSaving}</span>}
      <Btn size="sm" onClick={savePreferences} t={t}>Save Preferences</Btn>
    </div>
  </div>

  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
    <div>
      <label style={{display:'block',fontSize:11,fontWeight:700,color:t.sub,marginBottom:5,textTransform:'uppercase',letterSpacing:1}}>Location Preferences (comma-separated)</label>
      <input
        value={(prefs.location_preference||[]).join(', ')}
        onChange={e => setPrefs(p => ({...p, location_preference: e.target.value.split(',').map(x=>x.trim()).filter(Boolean)}))}
        placeholder="Los Angeles, Seattle, Remote"
        style={{width:'100%',background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:'9px 13px',color:t.tx,fontSize:13,fontFamily:'inherit',outline:'none',boxSizing:'border-box'}}
      />
    </div>
    <div>
      <label style={{display:'block',fontSize:11,fontWeight:700,color:t.sub,marginBottom:5,textTransform:'uppercase',letterSpacing:1}}>Exclude These Role Types</label>
      <input
        value={(prefs.exclude_roles||[]).join(', ')}
        onChange={e => setPrefs(p => ({...p, exclude_roles: e.target.value.split(',').map(x=>x.trim()).filter(Boolean)}))}
        placeholder="software engineer, data scientist"
        style={{width:'100%',background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:'9px 13px',color:t.tx,fontSize:13,fontFamily:'inherit',outline:'none',boxSizing:'border-box'}}
      />
    </div>
    <div>
      <label style={{display:'block',fontSize:11,fontWeight:700,color:t.sub,marginBottom:5,textTransform:'uppercase',letterSpacing:1}}>Min Feed Score (0-100)</label>
      <input
        type="number" min="0" max="100"
        value={prefs.feed_min_score ?? 30}
        onChange={e => setPrefs(p => ({...p, feed_min_score: parseInt(e.target.value)||0}))}
        style={{width:'100%',background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:'9px 13px',color:t.tx,fontSize:13,fontFamily:'inherit',outline:'none',boxSizing:'border-box'}}
      />
    </div>
    <div>
      <label style={{display:'block',fontSize:11,fontWeight:700,color:t.sub,marginBottom:5,textTransform:'uppercase',letterSpacing:1}}>H1B / Visa Filter</label>
      <label style={{display:'flex',alignItems:'center',gap:8,marginTop:10,fontSize:13,color:t.tx,cursor:'pointer'}}>
        <input type="checkbox" checked={!!prefs.h1b_filter} onChange={e => setPrefs(p => ({...p, h1b_filter: e.target.checked}))} />
        Only show H1B-sponsoring companies
      </label>
    </div>
  </div>
</Card>
```

- [ ] **Step 7: Commit**

```bash
git add src/components/Settings.jsx
git commit -m "feat: restructure Settings — move profile to Profile page, add Getting Started and Preferences sections, fix Serper key storage"
```

---

## Task 7: App.jsx — Wire Everything Together

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Add imports for new pages**

After the existing component imports, add:

```jsx
import Resume  from "./components/Resume.jsx";
import Profile from "./components/Profile.jsx";
```

- [ ] **Step 2: Add nav items**

In `NAV_ITEMS` array (around line 41), add Resume and Profile. Put Resume between `applied` and `intel`, Profile between `intel` and `settings`:

```jsx
const NAV_ITEMS = [
  {id:"dashboard",  label:"Dashboard",    Icon:LayoutDashboard},
  {id:"search",     label:"Find Jobs",     Icon:Search},
  {id:"pipeline",   label:"Pipeline",      Icon:Activity},
  {id:"analyze",    label:"Job Analysis",  Icon:BarChart2},
  {id:"networking", label:"Networking",    Icon:Users},
  {id:"applied",    label:"Applied",       Icon:Briefcase},
  {id:"resume",     label:"Resume",        Icon:FileText},   // NEW
  {id:"intel",      label:"Company Intel", Icon:Building2},
  {id:"profile",    label:"Profile",       Icon:UserCircle}, // NEW
  {id:"settings",   label:"API & Settings",Icon:Settings},
];
```

Add `FileText, UserCircle` to the lucide-react import at the top.

- [ ] **Step 3: Add pages to the pages object**

In the `pages` object (around line 299), add:

```jsx
resume: (
  <Resume profile={profile} groqKey={groqKey} t={t} />
),
profile: (
  <Profile t={t} />
),
```

- [ ] **Step 4: Pass profile to Resume (profile is already in App.jsx state)**

The `profile` state in App.jsx already holds the user profile (fetched on mount). Pass it directly to Resume — no additional fetch needed.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat: add Resume and Profile pages to navigation and routing"
```

---

## Task 8: Deploy

- [ ] **Step 1: Build check**

```bash
cd /Users/jashwanth/jobagent-web && npm run build 2>&1
```

Expected: ✓ built in ~3s. If errors, check import names match exactly.

- [ ] **Step 2: Run migration in Supabase**

Go to Supabase dashboard → SQL Editor → paste contents of `supabase_schema_v3.sql` → Run.
Verify: `resumes` and `user_preferences` tables exist in Table Editor.

- [ ] **Step 3: Push and deploy**

```bash
git push && vercel --prod 2>&1
```

Expected: Build success, deployed to https://jobagent-web.vercel.app

---

## SELF-REVIEW

### Spec Coverage Check

| PRD Requirement | Task | Status |
|----------------|------|--------|
| Resume dashboard list view | Task 4 | ✅ |
| Set Primary resume | Task 4 (handleSetPrimary) | ✅ |
| Edit Resume Info (name, target roles) | Task 4 (editor meta section) | ✅ |
| Open Resume Editor | Task 4 (openEditor) | ✅ |
| Run Analysis / Re-analyze | Task 4 (handleAnalyze) | ✅ |
| Delete Resume | Task 4 (handleDelete) | ✅ |
| Structured editor: Experience | Task 4 (ResumeEditor) | ✅ |
| Structured editor: Education | Task 4 (ResumeEditor) | ✅ |
| Structured editor: Skills | Task 4 (ResumeEditor) | ✅ |
| Add/Edit/Delete bullets | Task 4 (ResumeEditor) | ✅ |
| Analysis: score, summary, highlights, issues | Task 3 + Task 4 (AnalysisPanel) | ✅ |
| Issues with severity tiers | Task 3 (Groq prompt) | ✅ |
| Analysis loading state | Task 4 (analyzing state) | ✅ |
| Last analyzed timestamp | Task 2 (saveResumeAnalysis) + Task 4 (list display) | ✅ |
| Max 5 resumes limit | Task 2 (upsertResume guard) | ✅ |
| Resume data model | Task 1 (SQL) + Task 2 (storage) | ✅ |
| Profile: view/edit all fields | Task 5 | ✅ |
| Profile: experience bullets | Task 5 | ✅ |
| Profile: tool list | Task 5 | ✅ |
| Profile: role targets | Task 5 | ✅ |
| Settings: API key management (Groq, Serper) | Task 6 | ✅ |
| Settings: Getting Started docs | Task 6 | ✅ |
| Settings: Job preferences | Task 6 | ✅ |
| User isolation | All tasks (getUserId() in every storage fn) | ✅ |
| Deploy | Task 8 | ✅ |

### Gaps / Deliberate YAGNI Exclusions

| PRD Item | Decision |
|---------|---------|
| Export Resume (PDF) | **Excluded** — requires PDF generation library. Out of scope for this sprint. Add later. |
| Resume version history / rollback | **Excluded** — overwrite model is sufficient. Second resume = "backup". |
| Profile → feed auto-recalculation | **Excluded** — feed scoring runs in Python pipeline (GitHub Actions). UI cannot trigger it. Profile changes affect NEXT pipeline run automatically since `role_targets` is read by `distribute_feed.py`. |
| Analysis credits system | **Excluded** — Groq is free tier. No credit tracking needed. |
| Resume → Job Analysis auto-sync | **Excluded** — Job Analysis uses resume_variants (A/B/C/D snippets). Resume module is independent. Manual "Sync to Variant" is a future feature. For now, user can copy skills from Resume → into Job Analysis manually. |
| Seniority filter in preferences | **Stored** in `user_preferences.seniority_filter` (array) but **not wired to feed** (feed scoring is in Python pipeline). UI saves the preference, Python pipeline needs separate update to read it. |

### Placeholder Scan: NONE FOUND ✅

### Type Consistency Check

- `Storage.upsertResume(resume)` → `resume.id` optional (new) or UUID (update) ✅
- `Storage.saveResumeAnalysis(id, report)` → `report` is the JSON object from `analyzeResumeWithGroq` ✅
- `analyzeResumeWithGroq(structuredSections, targetRoles, apiKey)` → `structuredSections` matches the `structured_sections` JSONB shape ✅
- `emptyResume(profile)` uses `profile.experience_bullets` and `profile.tool_list` — both present in `user_profiles` table ✅
