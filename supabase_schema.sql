-- ============================================================
-- JobAgent v6.0 - Supabase Schema
-- Run this in the Supabase SQL editor before deploying
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ── Jobs ─────────────────────────────────────────────────────────────────────
create table if not exists jobs (
  id text primary key,
  role text,
  company text,
  location text,
  type text default 'Full-time',
  link text,
  posted text,
  itar_flag boolean default false,
  itar_detail text,
  tier text,
  h1b text,
  industry text,
  reason text,
  match integer,
  verdict text default 'GREEN',
  source text,
  domain_verified boolean default false,
  in_pipeline boolean default false,
  status text default 'active',
  jd text,
  analysis_result jsonb,
  resume_variant text,
  added_at bigint,
  created_at timestamptz default now()
);

-- ── Applications ─────────────────────────────────────────────────────────────
create table if not exists applications (
  id text primary key,
  role text,
  company text,
  company_link text,
  location text,
  link text,
  match text,
  verdict text,
  status text default 'Applied',
  date text,
  location_type text,
  type text,
  salary text,
  resume_variant text,
  fit_level text,
  created_at timestamptz default now()
);

-- ── Contacts (search results) ─────────────────────────────────────────────────
create table if not exists contacts (
  id text primary key,
  name text,
  title text,
  type text,
  company text,
  linkedin_url text,
  email text,
  why text,
  created_at timestamptz default now()
);

-- ── Networking Log ────────────────────────────────────────────────────────────
create table if not exists netlog (
  id text primary key,
  date text,
  name text,
  type text,
  company text,
  role text,
  email text,
  linkedin_url text,
  created_at timestamptz default now()
);

-- ── Templates ─────────────────────────────────────────────────────────────────
create table if not exists templates (
  id text primary key,
  name text,
  body text,
  created_at timestamptz default now()
);

-- ── Settings ──────────────────────────────────────────────────────────────────
create table if not exists settings (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

-- ── Row Level Security (RLS) ──────────────────────────────────────────────────
-- For a single-user app, you can either:
-- (a) Disable RLS entirely (simpler, fine for personal use)
-- (b) Enable RLS with anon policies

-- Option A: Disable RLS (simplest — just use the anon key, no auth needed)
alter table jobs disable row level security;
alter table applications disable row level security;
alter table contacts disable row level security;
alter table netlog disable row level security;
alter table templates disable row level security;
alter table settings disable row level security;

-- Option B: If you want RLS, uncomment below and use Supabase Auth
-- alter table jobs enable row level security;
-- create policy "anon_all" on jobs for all using (true) with check (true);
-- (repeat for all tables)
