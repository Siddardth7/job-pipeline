-- ============================================================
-- JobAgent v2 Multi-User Schema Migration
-- Run in Supabase SQL editor AFTER enabling Supabase Auth
-- and creating all 3 user accounts manually.
--
-- PREREQUISITES:
--   1. Supabase Auth enabled (Auth → Settings → enable Email provider)
--   2. Three user accounts created in Auth → Users
--   3. Note down the UUID for Siddardth's account (the admin/owner)
--
-- STEPS TO RUN:
--   Run sections 1-6 in order in the Supabase SQL editor.
--   Each section is safe to re-run (uses IF NOT EXISTS / IF EXISTS).
-- ============================================================


-- ── SECTION 1: Extensions ─────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";


-- ── SECTION 2: New core tables ────────────────────────────────────────────────

-- Per-user profile: background, visa, experience bullets, domain family
create table if not exists user_profiles (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid references auth.users(id) not null unique,
  full_name            text,
  degree               text,
  graduation_year      integer,
  visa_status          text,               -- 'STEM OPT', 'US Citizen', 'H1B', 'TN', etc.
  visa_years_remaining integer,
  sponsorship_required boolean default false,
  experience_bullets   jsonb default '[]'::jsonb,  -- [{company, role, metric, tools}]
  tool_list            text[] default '{}',
  domain_family        text,               -- 'aerospace_manufacturing' | 'industrial_engineering' | 'mechanical_thermal'
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

-- Per-user role targets: what titles to prioritise in the feed
create table if not exists role_targets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) not null,
  title      text not null,
  cluster    text not null,   -- maps to query_engine.json cluster key
  priority   integer default 1,
  active     boolean default true,
  created_at timestamptz default now()
);

-- Per-user resume variants (summaries + skill lines + keyword banks)
create table if not exists resume_variants (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references auth.users(id) not null,
  variant_key        text not null,   -- 'A', 'B', 'C', 'D'
  variant_name       text not null,   -- e.g. 'Manufacturing & Plant Ops'
  summary_template   text,
  skill_lines        jsonb default '[]'::jsonb,  -- [{label, skills}]
  keywords_primary   text[] default '{}',
  keywords_secondary text[] default '{}',
  created_at         timestamptz default now(),
  unique (user_id, variant_key)
);

-- Per-user API keys (Groq, Serper, etc.) stored in DB instead of GitHub Secrets
create table if not exists user_integrations (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users(id) not null,
  service           text not null,   -- 'groq', 'serper', 'apify'
  api_key           text,
  is_valid          boolean,
  last_validated_at timestamptz,
  created_at        timestamptz default now(),
  unique (user_id, service)
);

-- Per-user UI + feed preferences
create table if not exists user_preferences (
  user_id             uuid primary key references auth.users(id),
  theme               text default 'dark',
  feed_min_score      integer default 30,
  h1b_filter          boolean default false,
  itar_strict         boolean default true,
  location_preference text[] default '{}',
  updated_at          timestamptz default now()
);

-- Shared job pool written by the pipeline (one row per unique job posting)
create table if not exists normalized_jobs (
  id               text primary key,
  job_title        text,
  company_name     text,
  job_url          text,
  location         text,
  posted_date      text,
  description      text,
  source           text,
  itar_flag        boolean default false,
  tier             text,
  h1b              text,
  industry         text,
  verdict          text default 'GREEN',
  relevance_score  integer default 50,
  boost_tags       text[] default '{}',
  pipeline_run_date date,
  created_at       timestamptz default now()
);

-- Per-user view of the shared job pool (status, pipeline, analysis)
create table if not exists user_job_feed (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid references auth.users(id) not null,
  job_id               text references normalized_jobs(id),
  user_relevance_score integer default 0,
  matched_clusters     text[] default '{}',
  status               text default 'new',   -- 'new' | 'viewed' | 'saved' | 'dismissed'
  in_pipeline          boolean default false,
  pipeline_added_at    timestamptz,
  analysis_result      jsonb,
  resume_variant       text,
  created_at           timestamptz default now(),
  unique (user_id, job_id)
);

-- Audit log of Groq analyses per user per job
create table if not exists job_analysis_history (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) not null,
  job_id          text,
  variant_used    text,
  analysis_result jsonb,
  created_at      timestamptz default now()
);

-- Pipeline run log (read-only for users, written by GitHub Actions service role)
create table if not exists scraper_runs (
  id            uuid primary key default gen_random_uuid(),
  run_date      date not null,
  scraper       text not null,
  status        text,               -- 'success' | 'error' | 'zero_results' | 'skipped'
  jobs_found    integer default 0,
  error_message text,
  created_at    timestamptz default now()
);

-- Company intelligence: shared pool with user contribution tracking
-- added_by = NULL means platform baseline (M628 static database)
create table if not exists company_intelligence (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  domain               text,
  tier                 integer,
  h1b                  text,
  itar                 text,
  industry             text,
  roles                text,
  ats_platform         text,
  ats_board_url        text,
  added_by             uuid references auth.users(id),  -- NULL = platform baseline
  contributed_by_users uuid[] default '{}'
);

-- Per-user target company lists (which companies each user is watching)
create table if not exists user_company_targets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) not null,
  company_id uuid references company_intelligence(id) not null,
  is_primary boolean default false,
  priority   integer default 1,
  notes      text,
  created_at timestamptz default now(),
  unique (user_id, company_id)
);


-- ── SECTION 3: Add user_id to existing tables ─────────────────────────────────
-- NOTE: Each ALTER is idempotent (IF NOT EXISTS). Safe to re-run.

alter table applications         add column if not exists user_id uuid references auth.users(id);
alter table netlog               add column if not exists user_id uuid references auth.users(id);
alter table contacts             add column if not exists user_id uuid references auth.users(id);
alter table templates            add column if not exists user_id uuid references auth.users(id);
alter table linkedin_dm_contacts add column if not exists user_id uuid references auth.users(id);


-- ── SECTION 4: RLS — drop old anon_all policies, enable user-scoped ones ──────

-- Drop existing blanket anon policies
drop policy if exists "anon_all" on jobs;
drop policy if exists "anon_all" on applications;
drop policy if exists "anon_all" on contacts;
drop policy if exists "anon_all" on netlog;
drop policy if exists "anon_all" on templates;
drop policy if exists "anon_all" on settings;
drop policy if exists "anon_all" on linkedin_dm_contacts;

-- Enable RLS on new tables
alter table user_profiles        enable row level security;
alter table role_targets         enable row level security;
alter table resume_variants      enable row level security;
alter table user_integrations    enable row level security;
alter table user_preferences     enable row level security;
alter table normalized_jobs      enable row level security;
alter table user_job_feed        enable row level security;
alter table job_analysis_history enable row level security;
alter table scraper_runs         enable row level security;
alter table company_intelligence enable row level security;
alter table user_company_targets enable row level security;

-- user_profiles: each user owns their own row
create policy "user_owns_profile" on user_profiles
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- role_targets: user-owned
create policy "user_owns_role_targets" on role_targets
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- resume_variants: user-owned
create policy "user_owns_resume_variants" on resume_variants
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- user_integrations: user-owned (API keys — never readable by other users)
create policy "user_owns_integrations" on user_integrations
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- user_preferences: user-owned
create policy "user_owns_preferences" on user_preferences
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- normalized_jobs: all authenticated users can read; only service role writes
create policy "authenticated_read_normalized_jobs" on normalized_jobs
  for select to authenticated
  using (true);

-- user_job_feed: user-owned
create policy "user_owns_feed" on user_job_feed
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- job_analysis_history: user-owned
create policy "user_owns_analysis_history" on job_analysis_history
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- scraper_runs: all authenticated users can read (admin transparency)
create policy "authenticated_read_scraper_runs" on scraper_runs
  for select to authenticated
  using (true);

-- applications: user-owned
create policy "user_owns_applications" on applications
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- netlog: user-owned
create policy "user_owns_netlog" on netlog
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- contacts: user-owned
create policy "user_owns_contacts" on contacts
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- templates: user-owned
create policy "user_owns_templates" on templates
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- linkedin_dm_contacts: user-owned
create policy "user_owns_linkedin_contacts" on linkedin_dm_contacts
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- company_intelligence: all authenticated can read; owner can insert/update their own entries
create policy "authenticated_read_companies" on company_intelligence
  for select to authenticated
  using (true);

create policy "user_can_add_companies" on company_intelligence
  for insert to authenticated
  with check (auth.uid() = added_by);

create policy "user_can_edit_own_companies" on company_intelligence
  for update to authenticated
  using (auth.uid() = added_by)
  with check (auth.uid() = added_by);

-- user_company_targets: user-owned
create policy "user_owns_company_targets" on user_company_targets
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ── SECTION 5: Jobs table — keep existing RLS for pipeline writes ─────────────
-- The jobs table is still written by the pipeline (service role bypasses RLS).
-- Add a read policy so authenticated users can see jobs during the transition
-- period (before full migration to normalized_jobs + user_job_feed is complete).

create policy "authenticated_read_jobs" on jobs
  for select to authenticated
  using (true);


-- ── SECTION 6: Settings — temporary anon read for Phase C migration ───────────
-- Allows the migration script to read groq/serper keys during data migration.
-- DELETE THIS POLICY after Phase C migration is complete.

create policy "temp_anon_settings_read" on settings
  for select to anon
  using (true);

-- ── POST-MIGRATION REMINDER ───────────────────────────────────────────────────
-- After running scripts/migrate_data_to_multiuser.py:
--   DROP POLICY "temp_anon_settings_read" ON settings;
-- Then lock settings down:
--   CREATE POLICY "user_owns_settings" ON settings
--     FOR ALL TO authenticated USING (true) WITH CHECK (true);
