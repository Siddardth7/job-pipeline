// lib/supabase.js — Supabase REST client for the Chrome extension service worker
// Uses plain fetch (no npm package) — compatible with MV3 service workers

const SUPABASE_URL = 'https://wefcbqfxzvvgremxhubi.supabase.co';

// Get profile from chrome.storage.local (lazy — called at request time)
async function getSupabaseKey() {
  const result = await chrome.storage.local.get('jobagent_profile');
  return result.jobagent_profile?.supabaseAnonKey || '';
}

function headers(anonKey) {
  return {
    'Content-Type': 'application/json',
    'apikey': anonKey,
    'Authorization': `Bearer ${anonKey}`,
  };
}

/**
 * Fetch all pipeline jobs (in_pipeline = true) from Supabase.
 * Returns array of job objects with camelCase fields for extension use.
 */
export async function fetchPipeline(anonKey) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/jobs?in_pipeline=eq.true&select=id,role,company,location,link,resume_variant,match,verdict,tier,h1b,itar_flag,source`,
    { headers: headers(anonKey) }
  );
  if (!res.ok) throw new Error(`fetchPipeline ${res.status}`);
  const rows = await res.json();
  return rows.map(sanitizeForApply);
}

/**
 * Transform a raw Supabase jobs row into the shape the extension needs.
 * Pure function — no side effects — testable without Chrome APIs.
 */
export function sanitizeForApply(row) {
  return {
    id: String(row.id || ''),
    role: row.role || '',
    company: row.company || '',
    location: row.location || '',
    applyUrl: row.link || '',         // link column = apply URL
    resumeVariant: row.resume_variant || null,
    match: row.match != null ? parseInt(row.match) : null,
    verdict: row.verdict || null,
    tier: row.tier || null,
    h1b: row.h1b || null,
    itarFlag: row.itar_flag || false,
  };
}

/**
 * Write "Applied" status back to Supabase.
 * 1. Upserts a row in applications table
 * 2. Patches jobs to set in_pipeline = false
 */
export async function markApplied(job, resumeVariant, anonKey) {
  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

  // 1. Upsert into applications
  const appRow = {
    id: job.id,
    role: job.role,
    company: job.company,
    location: job.location,
    link: job.applyUrl,
    status: 'Applied',
    date: today,
    resume_variant: resumeVariant || job.resumeVariant || null,
    match: job.match,
    verdict: job.verdict,
  };

  const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/applications`, {
    method: 'POST',
    headers: {
      ...headers(anonKey),
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(appRow),
  });
  if (!upsertRes.ok) {
    const err = await upsertRes.text();
    throw new Error(`markApplied upsert failed ${upsertRes.status}: ${err}`);
  }

  // 2. Patch jobs: set in_pipeline = false
  const patchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/jobs?id=eq.${encodeURIComponent(job.id)}`,
    {
      method: 'PATCH',
      headers: headers(anonKey),
      body: JSON.stringify({ in_pipeline: false }),
    }
  );
  if (!patchRes.ok) {
    const err = await patchRes.text();
    throw new Error(`markApplied patch jobs failed ${patchRes.status}: ${err}`);
  }
}
