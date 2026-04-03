-- ============================================================
-- LinkedIn DM Intelligence Upgrade — Migration
-- Run this in the Supabase SQL editor ONCE
-- Adds intelligence columns to linkedin_dm_contacts
-- ============================================================

-- ── Persona & Classification ──────────────────────────────────────────────────
alter table linkedin_dm_contacts
  add column if not exists persona              text,          -- Recruiter / Hiring Manager / Engineer / Senior Engineer / Alumni / Internal Employee / Referral Contact / Potential Mentor / Unknown
  add column if not exists persona_confidence   integer,       -- 0-100
  add column if not exists conversation_stage   text,          -- 17-level stage system
  add column if not exists relationship_strength text,         -- Low / Informational / Warm / Strong / POC Candidate / Confirmed POC

-- ── Conversation Intelligence ─────────────────────────────────────────────────
  add column if not exists i_sent_first         boolean,       -- did I initiate?
  add column if not exists they_replied         boolean,       -- did they reply at least once?
  add column if not exists two_way_conversation boolean,       -- meaningful back-and-forth?
  add column if not exists total_exchanges      integer,       -- count of back-and-forth turns
  add column if not exists tone                 text,          -- warm / neutral / dismissive / transactional / helpful / encouraging
  add column if not exists referral_discussed   boolean,       -- was referral mentioned?
  add column if not exists referral_secured     boolean,       -- did they forward my profile/provide referral?
  add column if not exists hiring_process_related boolean,    -- hiring-loop context?
  add column if not exists promise_made         boolean,       -- did they promise something?
  add column if not exists promise_text         text,          -- what was promised
  add column if not exists promise_status       text,          -- pending / completed / abandoned

-- ── POC Analysis ─────────────────────────────────────────────────────────────
  add column if not exists poc_score            integer,       -- 0-10
  add column if not exists is_poc_candidate     boolean default false,
  add column if not exists is_confirmed_poc     boolean default false,

-- ── Follow-Up Intelligence ───────────────────────────────────────────────────
  add column if not exists follow_up_priority   text,          -- urgent / high / medium / low / none
  add column if not exists follow_up_type       text,          -- reminder / thank-you / check-in / ask-update / re-engage / nurture / none
  add column if not exists follow_up_reason     text,
  add column if not exists follow_up_timing     text,          -- within 24h / 3 days / 1 week / 2 weeks / when ready
  add column if not exists follow_up_guidance   text,          -- concise what-to-say / what-not-to-say

-- ── CRM Enrichment ───────────────────────────────────────────────────────────
  add column if not exists crm_summary          text,          -- rich CRM-usable summary
  add column if not exists risk_notes           text,
  add column if not exists tags                 text,          -- comma-separated tags
  add column if not exists first_message_preview text,        -- first 400 chars of first message
  add column if not exists last_message_preview  text;        -- first 400 chars of last message

-- ── Index for common filters ──────────────────────────────────────────────────
create index if not exists idx_ldm_persona           on linkedin_dm_contacts (persona);
create index if not exists idx_ldm_conversation_stage on linkedin_dm_contacts (conversation_stage);
create index if not exists idx_ldm_poc_candidate     on linkedin_dm_contacts (is_poc_candidate);
create index if not exists idx_ldm_follow_up_priority on linkedin_dm_contacts (follow_up_priority);
create index if not exists idx_ldm_relationship      on linkedin_dm_contacts (relationship_strength);
