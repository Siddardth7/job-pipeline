-- ============================================================
-- Migration: Add linkedin_url to user_profiles + missing role_targets columns
-- Run in Supabase SQL editor. Safe to re-run (uses IF NOT EXISTS).
-- ============================================================

-- user_profiles: linkedin_url was referenced in code but never added to schema
alter table user_profiles add column if not exists linkedin_url text;

-- role_targets: onboarding writes these but they were missing from v2 schema
alter table role_targets add column if not exists keywords    text[]  default '{}';
alter table role_targets add column if not exists boost_tags  text[]  default '{}';
alter table role_targets add column if not exists require_h1b boolean default false;
