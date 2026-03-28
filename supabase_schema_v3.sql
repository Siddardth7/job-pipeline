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
  seniority_filter     text[] default '{}',
  exclude_roles        text[] default '{}',
  h1b_filter           boolean default false,
  feed_min_score       integer default 30,
  updated_at           timestamptz default now()
);

-- ── SECTION 3: RLS Policies ───────────────────────────────────────────────────
alter table resumes enable row level security;
alter table user_preferences enable row level security;

drop policy if exists "resumes_user_owns" on resumes;
drop policy if exists "preferences_user_owns" on user_preferences;

create policy "resumes_user_owns" on resumes
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "preferences_user_owns" on user_preferences
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
