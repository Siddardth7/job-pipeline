// popup.js — JobAgent popup logic

const PROFILE_KEY = 'jobagent_profile';
const SUPABASE_URL = 'https://wefcbqfxzvvgremxhubi.supabase.co';

// --- ATS detection (inlined to avoid ES module import in popup) ---
const GH_PATTERNS = [
  /job-boards\.greenhouse\.io\/(\w+)\/jobs\/(\d+)/,
  /boards\.greenhouse\.io\/(\w+)\/jobs\/(\d+)/,
  /jobs\.greenhouse\.io\/(\d+)/,
];
const LEVER_PATTERNS = [/jobs\.lever\.co\/([\w-]+)/];

function detectAts(url) {
  if (GH_PATTERNS.some(p => p.test(url))) return 'greenhouse';
  if (LEVER_PATTERNS.some(p => p.test(url))) return 'lever';
  return null;
}

function extractSlug(url, ats) {
  const patterns = ats === 'greenhouse' ? GH_PATTERNS : LEVER_PATTERNS;
  for (const p of patterns) {
    const m = url.match(p);
    if (m && m[1]) return m[1].toLowerCase();
  }
  return null;
}

function matchJob(currentUrl, jobs) {
  const ats = detectAts(currentUrl);
  if (!ats) return null;
  const slug = extractSlug(currentUrl, ats);
  if (!slug) return null;
  return jobs.find(j => j.applyUrl && j.applyUrl.toLowerCase().includes(slug)) || null;
}

// --- Supabase pipeline fetch (plain fetch) ---
async function loadPipeline(anonKey) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/jobs?in_pipeline=eq.true&select=id,role,company,location,link,resume_variant,match,verdict,tier,h1b,itar_flag`,
    {
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
      },
    }
  );
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  const rows = await res.json();
  return rows.map(row => ({
    id: String(row.id || ''),
    role: row.role || '',
    company: row.company || '',
    location: row.location || '',
    applyUrl: row.link || '',
    resumeVariant: row.resume_variant || null,
    match: row.match != null ? parseInt(row.match) : null,
    verdict: row.verdict || null,
  }));
}

// --- UI helpers ---
function $id(id) { return document.getElementById(id); }

function showOnly(id) {
  ['loading', 'no-match', 'job-card'].forEach(s => {
    $id(s).style.display = s === id ? '' : 'none';
  });
}

function setBadge(ats) {
  const badge = $id('ats-badge');
  if (!ats) { badge.textContent = ''; badge.className = ''; return; }
  badge.textContent = ats.charAt(0).toUpperCase() + ats.slice(1);
  badge.className = ats;
}

// --- Main ---
document.addEventListener('DOMContentLoaded', async () => {
  // Wire options link
  $id('btn-options').addEventListener('click', e => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Get current tab URL
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentUrl = tab?.url || '';
  const ats = detectAts(currentUrl);
  setBadge(ats);

  if (!ats) {
    showOnly('no-match');
    $id('no-match').textContent = 'Not an ATS page. Navigate to a Greenhouse or Lever job posting.';
    return;
  }

  // Load profile
  const { jobagent_profile: profile } = await chrome.storage.local.get(PROFILE_KEY);
  const anonKey = profile?.supabaseAnonKey || '';

  if (!anonKey) {
    showOnly('no-match');
    $id('no-match').textContent = 'No Supabase key set. Open Profile Settings to configure.';
    return;
  }

  // Load pipeline and match job
  let job;
  try {
    const pipeline = await loadPipeline(anonKey);
    job = matchJob(currentUrl, pipeline);
  } catch (e) {
    showOnly('no-match');
    $id('no-match').textContent = `Error loading pipeline: ${e.message}`;
    return;
  }

  if (!job) {
    showOnly('no-match');
    $id('no-match').textContent = 'No pipeline job matched this page. Add the job to your pipeline first.';
    return;
  }

  // Show job card
  showOnly('job-card');
  $id('job-role').textContent = job.role;
  $id('job-company').textContent = job.company;

  // Show meta tags
  const meta = $id('job-meta');
  if (job.match != null) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = `${job.match}% match`;
    meta.appendChild(tag);
  }
  if (job.verdict) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = job.verdict;
    meta.appendChild(tag);
  }

  // Variant picker: show if no variant set on the job
  const variantSelect = $id('variant-select');
  if (job.resumeVariant) {
    variantSelect.value = job.resumeVariant;
    $id('variant-picker').style.display = 'none';
  } else {
    $id('variant-picker').style.display = '';
  }

  // Enable fill button
  const btn = $id('btn-fill');
  btn.disabled = false;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    $id('fill-status').textContent = 'Sending fill command...';

    const variant = job.resumeVariant || variantSelect.value || 'A';

    // Send FILL_FORM message to content script on the active tab
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'FILL_FORM',
        job,
        variant,
      });
      $id('fill-status').textContent = 'Filling form — review the overlay on the page.';
    } catch (e) {
      $id('fill-status').textContent = `Error: ${e.message}. Make sure you are on the job application page.`;
      btn.disabled = false;
    }
  });
});
