// background.js — MV3 Service Worker
// Handles cross-origin fetches (Railway PDF, Supabase writes)
// Content scripts and popups message this worker for privileged operations

const SUPABASE_URL = 'https://wefcbqfxzvvgremxhubi.supabase.co';

chrome.runtime.onInstalled.addListener(() => {
  console.log('[JobAgent] Extension installed');
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'FETCH_PDF') {
    handleFetchPdf(msg, sendResponse);
    return true;
  }
  if (msg.type === 'FETCH_COVER_LETTER') {
    handleFetchCoverLetter(msg, sendResponse);
    return true;
  }
  if (msg.type === 'MARK_APPLIED') {
    handleMarkApplied(msg, sendResponse);
    return true;
  }
});

// ── Railway PDF fetch ──────────────────────────────────────────────────────────
// POST /generate — requires variant (A/B/C/D), summary (plain text), skills_latex (raw LaTeX)
async function handleFetchPdf(msg, sendResponse) {
  const { railwayUrl, variant, summary, skills_latex, company, role } = msg;
  try {
    const res = await fetch(`${railwayUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant, summary, skills_latex, company, role }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Railway /generate ${res.status}: ${errText}`);
    }
    const buffer = await res.arrayBuffer();
    sendResponse({ ok: true, buffer });
  } catch (e) {
    console.error('[JobAgent] handleFetchPdf error:', e.message);
    sendResponse({ ok: false, error: e.message });
  }
}

// POST /generate-cover-letter — company + role required
async function handleFetchCoverLetter(msg, sendResponse) {
  const { railwayUrl, company, role, summary, variant_focus } = msg;
  try {
    const res = await fetch(`${railwayUrl}/generate-cover-letter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company, role, summary, variant_focus }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Railway /generate-cover-letter ${res.status}: ${errText}`);
    }
    const buffer = await res.arrayBuffer();
    sendResponse({ ok: true, buffer });
  } catch (e) {
    console.error('[JobAgent] handleFetchCoverLetter error:', e.message);
    sendResponse({ ok: false, error: e.message });
  }
}

// ── Supabase write-back ────────────────────────────────────────────────────────
async function handleMarkApplied(msg, sendResponse) {
  const { job, resumeVariant } = msg;
  try {
    // Read anon key from profile
    const result = await chrome.storage.local.get('jobagent_profile');
    const anonKey = result.jobagent_profile?.supabaseAnonKey || '';
    if (!anonKey) throw new Error('No Supabase anon key in profile');

    const supaHeaders = {
      'Content-Type': 'application/json',
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`,
    };

    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

    // 1. Upsert into applications (conflict on id)
    const appRow = {
      id: job.id,
      role: job.role,
      company: job.company,
      location: job.location || null,
      link: job.applyUrl,
      status: 'Applied',
      date: today,
      resume_variant: resumeVariant || job.resumeVariant || null,
      match: job.match || null,
      verdict: job.verdict || null,
    };

    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/applications`, {
      method: 'POST',
      headers: { ...supaHeaders, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(appRow),
    });
    if (!upsertRes.ok) {
      const err = await upsertRes.text();
      throw new Error(`applications upsert ${upsertRes.status}: ${err}`);
    }

    // 2. Patch jobs: set in_pipeline = false
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/jobs?id=eq.${encodeURIComponent(job.id)}`,
      {
        method: 'PATCH',
        headers: supaHeaders,
        body: JSON.stringify({ in_pipeline: false }),
      }
    );
    if (!patchRes.ok) {
      const err = await patchRes.text();
      throw new Error(`jobs patch ${patchRes.status}: ${err}`);
    }

    console.log(`[JobAgent] Marked applied: ${job.company} — ${job.role} (variant ${resumeVariant})`);
    sendResponse({ ok: true });
  } catch (e) {
    console.error('[JobAgent] handleMarkApplied error:', e.message);
    sendResponse({ ok: false, error: e.message });
  }
}
