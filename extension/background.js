// background.js — Service worker
// Handles: Railway PDF fetch, cover letter fetch, Supabase writes

chrome.runtime.onInstalled.addListener(() => {
  console.log('[JobAgent] Extension installed');
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'FETCH_PDF') {
    handleFetchPdf(msg, sendResponse);
    return true; // keep message channel open for async response
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

// POST /generate — requires variant (A/B/C/D), summary (plain text), skills_latex (raw LaTeX)
async function handleFetchPdf({ railwayUrl, variant, summary, skills_latex, company, role }, sendResponse) {
  try {
    const res = await fetch(`${railwayUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant, summary, skills_latex, company, role }),
    });
    if (!res.ok) throw new Error(`Railway /generate ${res.status}`);
    const buffer = await res.arrayBuffer();
    sendResponse({ ok: true, buffer });
  } catch (e) {
    sendResponse({ ok: false, error: e.message });
  }
}

// POST /generate-cover-letter — company + role required, summary + variant_focus optional
async function handleFetchCoverLetter({ railwayUrl, company, role, summary, variant_focus }, sendResponse) {
  try {
    const res = await fetch(`${railwayUrl}/generate-cover-letter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company, role, summary, variant_focus }),
    });
    if (!res.ok) throw new Error(`Railway /generate-cover-letter ${res.status}`);
    const buffer = await res.arrayBuffer();
    sendResponse({ ok: true, buffer });
  } catch (e) {
    sendResponse({ ok: false, error: e.message });
  }
}

async function handleMarkApplied({ job, resumeVariant }, sendResponse) {
  // Full implementation in Task 5
  sendResponse({ ok: true });
}
