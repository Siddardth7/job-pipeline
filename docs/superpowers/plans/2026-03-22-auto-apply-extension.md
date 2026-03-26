# Auto-Apply Chrome Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome MV3 extension that reads jobs from the JobAgent pipeline, auto-fills Greenhouse and Lever application forms with profile data and Railway-generated resume PDFs, and writes the applied status back to Supabase.

**Architecture:** A background service worker handles all cross-origin fetches (Railway PDF, Supabase, Claude Vision API). Content scripts handle DOM manipulation on ATS pages. A popup provides the job queue UI and trigger. All profile data lives in `chrome.storage.local`.

**Tech Stack:** Chrome Extension Manifest V3, vanilla JS (no bundler needed for Phase 1), Supabase JS client (loaded via importmap or CDN in background), Vitest for unit tests on pure logic functions.

**Spec:** `docs/superpowers/specs/2026-03-22-auto-apply-extension-design.md`

---

## File Map

```
extension/                         ← new subdirectory in monorepo root
├── manifest.json                  ← MV3 manifest, permissions, content_scripts
├── popup/
│   ├── popup.html                 ← Extension popup shell
│   ├── popup.js                   ← Job matching, variant picker, trigger auto-fill
│   └── popup.css                  ← Popup styles
├── options/
│   ├── options.html               ← Profile settings page
│   └── options.js                 ← Read/write chrome.storage.local profile
├── background.js                  ← Service worker: PDF fetch, screenshot, Supabase writes
├── content.js                     ← Injected into ATS pages: routes to adapter, overlay
├── lib/
│   ├── supabase.js                ← Supabase client, fetchPipeline(), markApplied()
│   ├── profile.js                 ← getProfile(), saveProfile()
│   └── resolver.js                ← resolveUrl() — follow aggregator redirects
└── adapters/
    ├── index.js                   ← detect(url) → returns adapter name string
    ├── greenhouse.js              ← detect(), fill(), showOverlay()
    └── lever.js                   ← detect(), fill(), showOverlay()

tests/                             ← Vitest unit tests (pure logic only)
├── adapters.test.js               ← detect() URL pattern tests
├── resolver.test.js               ← resolveUrl() aggregator detection
└── supabase.test.js               ← sanitizeForApply() output shape
```

**Testing note:** Chrome extension APIs (`chrome.storage`, `chrome.tabs`, `chrome.runtime`) cannot be unit tested without a browser. Tests cover only pure logic: URL detection, profile serialization, write-back payload shape. DOM-filling and overlay code is verified by loading the extension unpacked and testing against real Greenhouse/Lever pages.

---

## Phase 0: Pre-Build Validation

> These must pass before writing any adapter code. Results determine whether DataTransfer works and whether Railway needs a CORS fix.

---

### Task 0: Verify Railway CORS + Greenhouse Upload Widget

**Files:**
- No code changes — investigation only

- [ ] **Step 1: Check Railway CORS headers**

```bash
curl -si -X OPTIONS https://resume-compiler-production.up.railway.app/generate \
  -H "Origin: chrome-extension://test" \
  -H "Access-Control-Request-Method: POST" \
  | grep -i "access-control"
```

Expected: `access-control-allow-origin: *`

**Status: ✅ PASS** — Confirmed `access-control-allow-origin: *` on `resume-compiler-production.up.railway.app`.
CORS is set globally in `resume-compiler/app.py` via `@app.after_request`. No changes needed.

**Railway endpoint ground truth** (from `resume-compiler/app.py`):
- Resume: `POST /generate` with `{ variant, summary, skills_latex, company?, role? }` — all of `variant`, `summary`, `skills_latex` are **required**
- Cover letter: `POST /generate-cover-letter` with `{ company, role, summary?, variant_focus? }`
- `summary` and `skills_latex` must be stored in the extension profile (options page) — user fills once at setup

- [ ] **Step 2: Test DataTransfer on a real Greenhouse page**

1. Open any Greenhouse apply page (e.g., from `boards.greenhouse.io/rocketlab/jobs/...`)
2. Open DevTools → Console, paste:
```js
const input = document.querySelector('input[name="resume"]') || document.querySelector('input[type="file"]');
console.log('Input found:', input);
console.log('Input type:', input?.type);
// Check if it's plain HTML or a JS widget
console.log('Parent HTML:', input?.closest('.field, .upload, [class*="upload"]')?.innerHTML?.slice(0,300));
```
3. Then test DataTransfer injection:
```js
const blob = new Blob(['test'], { type: 'application/pdf' });
const file = new File([blob], 'test.pdf', { type: 'application/pdf' });
const dt = new DataTransfer();
dt.items.add(file);
input.files = dt.files;
input.dispatchEvent(new Event('change', { bubbles: true }));
console.log('Files set:', input.files.length, '— UI updated?');
```
4. Check whether the Greenhouse UI reflects the file name. If yes, DataTransfer works. If the UI shows nothing, it's a JS widget — note this and use a manual upload prompt fallback in the adapter.

- [ ] **Step 3: Record results**

Add a comment at the top of `extension/adapters/greenhouse.js` before writing the adapter:
```js
// PRE-BUILD VALIDATION RESULTS (fill in before coding):
// CORS on Railway: PASS / FAIL
// DataTransfer works on Greenhouse: YES / NO
// If NO: using manual upload fallback (adapter highlights input, user uploads manually)
```

---

## Phase 1: Extension Shell

---

### Task 1: Scaffold Extension + Manifest

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/background.js` (stub)
- Create: `extension/content.js` (stub)
- Create: `extension/popup/popup.html`
- Create: `extension/popup/popup.css`

- [ ] **Step 1: Create `extension/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "JobAgent Auto-Apply",
  "version": "1.0.0",
  "description": "Auto-fill job applications from your JobAgent pipeline",
  "permissions": ["storage", "tabs", "scripting", "activeTab"],
  "host_permissions": [
    "https://*.greenhouse.io/*",
    "https://*.lever.co/*",
    "https://*.myworkdayjobs.com/*",
    "https://wefcbqfxzvvgremxhubi.supabase.co/*",
    "https://*.railway.app/*",
    "https://*/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "JobAgent Auto-Apply"
  },
  "content_scripts": [
    {
      "matches": [
        "https://*.greenhouse.io/*",
        "https://job-boards.greenhouse.io/*",
        "https://*.lever.co/*",
        "https://*.myworkdayjobs.com/*"
      ],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 2: Create `extension/background.js` stub**

```js
// background.js — Service worker
// Handles: Railway PDF fetch, Supabase writes, tab screenshot for Vision

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

async function handleFetchPdf({ railwayUrl, variant, summary, skills_latex, company, role }, sendResponse) {
  try {
    const res = await fetch(`${railwayUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant, summary, skills_latex, company, role }),
    });
    if (!res.ok) throw new Error(`Railway ${res.status}`);
    const buffer = await res.arrayBuffer();
    sendResponse({ ok: true, buffer });
  } catch (e) {
    sendResponse({ ok: false, error: e.message });
  }
}

async function handleFetchCoverLetter({ railwayUrl, company, role, summary, variant_focus }, sendResponse) {
  try {
    const res = await fetch(`${railwayUrl}/generate-cover-letter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company, role, summary, variant_focus }),
    });
    if (!res.ok) throw new Error(`Railway CL ${res.status}`);
    const buffer = await res.arrayBuffer();
    sendResponse({ ok: true, buffer });
  } catch (e) {
    sendResponse({ ok: false, error: e.message });
  }
}

async function handleMarkApplied({ job, resumeVariant }, sendResponse) {
  // Implemented in Task 5
  sendResponse({ ok: true });
}
```

- [ ] **Step 3: Create `extension/content.js` stub**

```js
// content.js — injected into ATS pages
// Routes to the correct adapter based on current URL

(async () => {
  const url = window.location.href;
  console.log('[JobAgent] Content script loaded on:', url);
  // Adapter routing implemented in Task 7
})();
```

- [ ] **Step 4: Create `extension/popup/popup.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JobAgent</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div id="app">
    <div id="header">
      <span class="logo">🧩 JobAgent</span>
      <span id="ats-badge"></span>
    </div>
    <div id="content">
      <div id="loading">Loading pipeline...</div>
      <div id="no-match" style="display:none">No pipeline job matched for this page.</div>
      <div id="job-card" style="display:none">
        <div id="job-role"></div>
        <div id="job-company"></div>
        <div id="job-meta"></div>
        <div id="variant-picker" style="display:none">
          <label>Resume variant:</label>
          <select id="variant-select">
            <option value="resume_A">A</option>
            <option value="resume_B">B</option>
            <option value="resume_C">C</option>
          </select>
        </div>
        <button id="btn-fill" disabled>⚡ Auto-fill Application</button>
        <div id="fill-status"></div>
      </div>
    </div>
    <div id="footer">
      <a id="btn-options" href="#">⚙ Profile Settings</a>
    </div>
  </div>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 5: Create `extension/popup/popup.css`**

```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
       font-size: 13px; width: 300px; background: #f9fafb; color: #111827; }
#header { display: flex; justify-content: space-between; align-items: center;
          padding: 12px 14px; background: #fff; border-bottom: 1px solid #e5e7eb; }
.logo { font-weight: 700; font-size: 14px; }
#ats-badge { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 10px;
             background: #dcfce7; color: #15803d; }
#content { padding: 14px; }
#loading, #no-match { color: #6b7280; text-align: center; padding: 20px 0; font-size: 12px; }
#job-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; }
#job-role { font-weight: 700; font-size: 14px; margin-bottom: 2px; }
#job-company { color: #6b7280; font-size: 12px; margin-bottom: 8px; }
#job-meta { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.badge { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 10px; }
.badge-green { background: #dcfce7; color: #15803d; }
.badge-blue { background: #dbeafe; color: #1d4ed8; }
.badge-gray { background: #f3f4f6; color: #6b7280; }
#variant-picker { margin-bottom: 10px; font-size: 12px; }
#variant-picker select { margin-left: 6px; padding: 3px 6px; border: 1px solid #d1d5db;
                          border-radius: 5px; font-size: 12px; }
#btn-fill { width: 100%; background: #6d28d9; color: #fff; border: none; border-radius: 8px;
            padding: 10px; font-weight: 700; font-size: 13px; cursor: pointer; }
#btn-fill:disabled { opacity: 0.4; cursor: not-allowed; }
#fill-status { margin-top: 8px; font-size: 11px; color: #6b7280; text-align: center;
               min-height: 16px; }
#footer { padding: 8px 14px; border-top: 1px solid #e5e7eb; background: #fff; }
#btn-options { color: #6b7280; text-decoration: none; font-size: 11px; }
#btn-options:hover { color: #111827; }
```

- [ ] **Step 6: Load extension in Chrome to verify it loads**

1. Open `chrome://extensions`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked" → select the `extension/` directory
4. Verify: extension icon appears in toolbar, no errors in the Extensions page
5. Click the icon → popup opens, shows "Loading pipeline..."

- [ ] **Step 7: Commit**

```bash
git add extension/
git commit -m "feat(extension): scaffold MV3 extension with manifest, popup shell, stubs"
```

---

### Task 2: Profile Settings Page

**Files:**
- Create: `extension/lib/profile.js`
- Create: `extension/options/options.html`
- Create: `extension/options/options.js`
- Modify: `extension/manifest.json` (add options_page)

- [ ] **Step 1: Create `extension/lib/profile.js`**

```js
// lib/profile.js — read/write profile from chrome.storage.local

const PROFILE_KEY = 'jobagent_profile';

const DEFAULT_PROFILE = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  linkedinUrl: '',
  city: '',
  state: '',
  workAuth: 'authorized',       // 'authorized' | 'not_authorized'
  needsSponsorship: true,
  visaStatus: 'F-1 OPT STEM',
  summary: '',           // resume summary paragraph (plain text) — required for /generate
  skills_latex: '',      // LaTeX skills block — required for /generate
  railwayUrl: 'https://resume-compiler-production.up.railway.app',
  supabaseUrl: 'https://wefcbqfxzvvgremxhubi.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndlZmNicWZ4enZ2Z3JlbXhodWJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNTI1NjUsImV4cCI6MjA4ODkyODU2NX0.vXTs_vh0dMvEt83FR589vKY9JfcMBFVgN82QblQH6OU',
};

export async function getProfile() {
  return new Promise(resolve => {
    chrome.storage.local.get(PROFILE_KEY, data => {
      resolve({ ...DEFAULT_PROFILE, ...(data[PROFILE_KEY] || {}) });
    });
  });
}

export async function saveProfile(updates) {
  const current = await getProfile();
  const merged = { ...current, ...updates };
  return new Promise(resolve => {
    chrome.storage.local.set({ [PROFILE_KEY]: merged }, resolve);
  });
}
```

- [ ] **Step 2: Create `extension/options/options.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>JobAgent — Profile Settings</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 520px;
           margin: 32px auto; padding: 0 16px; color: #111827; font-size: 13px; }
    h1 { font-size: 20px; margin-bottom: 24px; }
    h2 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;
         color: #6b7280; margin: 20px 0 10px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .field { margin-bottom: 10px; }
    label { display: block; font-size: 11px; font-weight: 700; color: #6b7280;
            text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    input, select { width: 100%; padding: 8px 10px; border: 1px solid #d1d5db;
                    border-radius: 6px; font-size: 13px; font-family: inherit; outline: none; }
    input:focus, select:focus { border-color: #6d28d9; box-shadow: 0 0 0 2px #ede9fe; }
    .mono { font-family: monospace; font-size: 11px; }
    #btn-save { background: #6d28d9; color: #fff; border: none; border-radius: 8px;
                padding: 10px 24px; font-weight: 700; font-size: 14px; cursor: pointer;
                margin-top: 16px; }
    #status { margin-top: 10px; font-size: 12px; color: #15803d; min-height: 18px; }
  </style>
</head>
<body>
  <h1>🧩 JobAgent Profile</h1>

  <h2>Personal Info</h2>
  <div class="row">
    <div class="field"><label>First Name</label><input id="firstName"></div>
    <div class="field"><label>Last Name</label><input id="lastName"></div>
  </div>
  <div class="field"><label>Email</label><input id="email" type="email"></div>
  <div class="field"><label>Phone</label><input id="phone" type="tel" placeholder="+1 (xxx) xxx-xxxx"></div>
  <div class="field"><label>LinkedIn URL</label><input id="linkedinUrl" placeholder="https://linkedin.com/in/..."></div>
  <div class="row">
    <div class="field"><label>City</label><input id="city"></div>
    <div class="field"><label>State</label><input id="state" placeholder="IL"></div>
  </div>

  <h2>Work Authorization</h2>
  <div class="field">
    <label>Visa / Status</label>
    <select id="visaStatus">
      <option value="F-1 OPT STEM">F-1 OPT STEM</option>
      <option value="F-1 OPT">F-1 OPT</option>
      <option value="H-1B">H-1B</option>
      <option value="Green Card">Green Card / PR</option>
      <option value="US Citizen">US Citizen</option>
    </select>
  </div>
  <div class="row">
    <div class="field">
      <label>Authorized to work in US?</label>
      <select id="workAuth">
        <option value="authorized">Yes</option>
        <option value="not_authorized">No</option>
      </select>
    </div>
    <div class="field">
      <label>Require sponsorship?</label>
      <select id="needsSponsorship">
        <option value="true">Yes (future)</option>
        <option value="false">No</option>
      </select>
    </div>
  </div>

  <h2>Resume Content</h2>
  <div class="field">
    <label>Resume Summary <span class="required">*</span></label>
    <textarea id="summary" rows="4" placeholder="Mechanical engineer with 3+ years experience in..."></textarea>
    <small>Plain text — injected into your resume PDF at %%SUMMARY%%</small>
  </div>
  <div class="field">
    <label>Skills Block (LaTeX) <span class="required">*</span></label>
    <textarea id="skills_latex" rows="6" placeholder="\textbf{CAD:} SolidWorks, CATIA ..."></textarea>
    <small>Raw LaTeX between %%SKILLS_BLOCK_START%% and %%SKILLS_BLOCK_END%% in your template</small>
  </div>

  <h2>Service URLs</h2>
  <div class="field"><label>Railway Compiler URL</label><input id="railwayUrl" class="mono"></div>
  <div class="field"><label>Supabase URL</label><input id="supabaseUrl" class="mono"></div>
  <div class="field"><label>Supabase Anon Key</label><input id="supabaseAnonKey" class="mono"></div>

  <button id="btn-save">Save Profile</button>
  <div id="status"></div>

  <script src="options.js" type="module"></script>
</body>
</html>
```

- [ ] **Step 3: Create `extension/options/options.js`**

```js
import { getProfile, saveProfile } from '../lib/profile.js';

const FIELDS = ['firstName','lastName','email','phone','linkedinUrl','city','state',
                 'visaStatus','workAuth','summary','skills_latex',
                 'railwayUrl','supabaseUrl','supabaseAnonKey'];

async function init() {
  const profile = await getProfile();
  FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = profile[id] ?? '';
  });
  document.getElementById('needsSponsorship').value = String(profile.needsSponsorship);
}

document.getElementById('btn-save').addEventListener('click', async () => {
  const updates = {};
  FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) updates[id] = el.value.trim();
  });
  updates.needsSponsorship = document.getElementById('needsSponsorship').value === 'true';
  await saveProfile(updates);
  const status = document.getElementById('status');
  status.textContent = '✓ Saved';
  setTimeout(() => { status.textContent = ''; }, 2000);
});

init();
```

- [ ] **Step 4: Add `options_page` to manifest**

In `extension/manifest.json`, add after the `"action"` block:
```json
"options_page": "options/options.html",
```

- [ ] **Step 5: Verify options page**

1. Reload the extension in `chrome://extensions`
2. Right-click extension icon → "Options"
3. Fill in your name, email, phone, LinkedIn URL, visa status
4. Click Save — verify "✓ Saved" appears
5. Reload the options page — verify values persisted

- [ ] **Step 6: Commit**

```bash
git add extension/lib/profile.js extension/options/ extension/manifest.json
git commit -m "feat(extension): add profile settings page with chrome.storage.local persistence"
```

---

### Task 3: Supabase Client — Read Pipeline + Write Applied

**Files:**
- Create: `extension/lib/supabase.js`
- Test: `tests/supabase.test.js`

- [ ] **Step 1: Write failing test for `sanitizeForApply`**

Create `tests/supabase.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { sanitizeForApply } from '../extension/lib/supabase.js';

describe('sanitizeForApply', () => {
  it('maps job fields to applications table shape', () => {
    const job = {
      id: 'job-123',
      role: 'Mechanical Engineer',
      company: 'Rocket Lab',
      location: 'Remote',
      link: 'https://boards.greenhouse.io/rocketlab/jobs/123',
      match: 94,
      verdict: 'GREEN',
      resume_variant: 'resume_A',
      location_type: 'Remote',
      type: 'Full-time',
    };
    const result = sanitizeForApply(job, 'resume_A');
    expect(result.role).toBe('Mechanical Engineer');
    expect(result.company).toBe('Rocket Lab');
    expect(result.status).toBe('Applied');
    expect(result.resume_variant).toBe('resume_A');
    expect(result.fit_level).toBe('Green');
    expect(result.date).toMatch(/\d+\/\d+\/\d+/);
    expect(result.id).toMatch(/^app-/);
  });

  it('maps YELLOW verdict to Yellow fit_level', () => {
    const job = { id: 'j1', verdict: 'YELLOW', role: 'r', company: 'c' };
    expect(sanitizeForApply(job, 'resume_A').fit_level).toBe('Yellow');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jashwanth/jobagent-web
npx vitest run tests/supabase.test.js
```
Expected: FAIL — `sanitizeForApply` not found.

- [ ] **Step 3: Create `extension/lib/supabase.js`**

```js
// lib/supabase.js
// Uses the Supabase REST API directly (no npm package — plain fetch in service worker)

const SUPABASE_URL = 'https://wefcbqfxzvvgremxhubi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndlZmNicWZ4enZ2Z3JlbXhodWJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNTI1NjUsImV4cCI6MjA4ODkyODU2NX0.vXTs_vh0dMvEt83FR589vKY9JfcMBFVgN82QblQH6OU';

function headers() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=minimal',
  };
}

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: { ...headers(), ...options.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${res.status}: ${body}`);
  }
  return res.status === 204 ? null : res.json();
}

// Fetch all pipeline jobs (in_pipeline = true)
export async function fetchPipeline() {
  const data = await sbFetch('/jobs?in_pipeline=eq.true&select=*');
  return data || [];
}

// Build applications table row from a job
export function sanitizeForApply(job, resumeVariant) {
  return {
    id: `app-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    role: job.role || null,
    company: job.company || null,
    location: job.location || null,
    link: job.link || null,
    company_link: '',
    match: job.match != null ? parseInt(job.match) || null : null,
    verdict: job.verdict || null,
    status: 'Applied',
    date: new Date().toLocaleDateString(),
    location_type: job.location_type || job.locationType || null,
    type: job.type || null,
    salary: job.salary || null,
    resume_variant: resumeVariant || job.resume_variant || null,
    fit_level: job.verdict === 'GREEN' ? 'Green' : job.verdict === 'YELLOW' ? 'Yellow' : 'Red',
  };
}

// Write applied status: upsert to applications + remove from pipeline
export async function markApplied(job, resumeVariant) {
  const appRow = sanitizeForApply(job, resumeVariant);

  // 1. Insert application record
  await sbFetch('/applications', {
    method: 'POST',
    headers: { 'Prefer': 'return=minimal,resolution=merge-duplicates' },
    body: JSON.stringify(appRow),
  });

  // 2. Remove job from pipeline
  await sbFetch(`/jobs?id=eq.${encodeURIComponent(job.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ in_pipeline: false, pipeline_added_at: null }),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/supabase.test.js
```
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add extension/lib/supabase.js tests/supabase.test.js
git commit -m "feat(extension): add Supabase client with fetchPipeline and markApplied"
```

---

## Phase 2: Popup — Job Matching + Trigger

---

### Task 4: Popup Logic

**Files:**
- Create: `extension/popup/popup.js`
- Create: `tests/adapters.test.js` (detector only, imported here for URL matching)

- [ ] **Step 1: Write failing tests for URL matching**

Create `tests/adapters.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { detectAts } from '../extension/adapters/index.js';

describe('detectAts', () => {
  it('detects Greenhouse', () => {
    expect(detectAts('https://job-boards.greenhouse.io/rocketlab/jobs/123')).toBe('greenhouse');
    expect(detectAts('https://boards.greenhouse.io/archer/jobs/456')).toBe('greenhouse');
  });
  it('detects Lever', () => {
    expect(detectAts('https://jobs.lever.co/shieldai/abc-def')).toBe('lever');
  });
  it('returns null for unknown', () => {
    expect(detectAts('https://careers.garmin.com/jobs/123')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/adapters.test.js
```
Expected: FAIL — `detectAts` not found.

- [ ] **Step 3: Create `extension/adapters/index.js`**

```js
// adapters/index.js — URL-based ATS detection

export function detectAts(url) {
  if (!url) return null;
  const u = url.toLowerCase();
  if (u.includes('greenhouse.io')) return 'greenhouse';
  if (u.includes('lever.co')) return 'lever';
  if (u.includes('myworkdayjobs.com') || u.includes('workday.com')) return 'workday';
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/adapters.test.js
```
Expected: PASS.

- [ ] **Step 5: Create `extension/popup/popup.js`**

```js
import { fetchPipeline } from '../lib/supabase.js';
import { detectAts } from '../adapters/index.js';

const $ = id => document.getElementById(id);

async function init() {
  // Get current tab URL
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabUrl = tab?.url || '';

  // Detect ATS
  const ats = detectAts(tabUrl);
  const badge = $('ats-badge');
  if (ats) {
    badge.textContent = ats.charAt(0).toUpperCase() + ats.slice(1) + ' detected';
    badge.style.display = 'inline';
  } else {
    badge.style.display = 'none';
  }

  // Load pipeline
  let pipeline = [];
  try {
    pipeline = await fetchPipeline();
  } catch (e) {
    $('loading').textContent = 'Error loading pipeline: ' + e.message;
    return;
  }
  $('loading').style.display = 'none';

  // Match current tab to pipeline job
  const job = matchJob(tabUrl, pipeline);
  if (!job) {
    $('no-match').style.display = 'block';
    return;
  }

  // Show job card
  $('job-card').style.display = 'block';
  $('job-role').textContent = job.role;
  $('job-company').textContent = `${job.company}${job.location ? ' · ' + job.location : ''}`;

  // Meta badges
  const meta = $('job-meta');
  if (job.verdict) meta.innerHTML += `<span class="badge badge-${job.verdict.toLowerCase()}">${job.verdict}</span>`;
  if (job.match) meta.innerHTML += `<span class="badge badge-blue">${job.match}%</span>`;

  // Variant picker
  const variant = job.resume_variant;
  if (!variant) {
    $('variant-picker').style.display = 'block';
    $('btn-fill').disabled = false;
    $('variant-select').addEventListener('change', () => updateFillButton());
    updateFillButton();
  } else {
    meta.innerHTML += `<span class="badge badge-gray">${variant}</span>`;
    $('btn-fill').disabled = false;
    $('btn-fill').dataset.variant = variant;
  }

  $('btn-fill').addEventListener('click', () => triggerFill(tab.id, job, ats));

  $('btn-options').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

function matchJob(tabUrl, pipeline) {
  // Exact URL match first
  const exact = pipeline.find(j => j.link && j.link === tabUrl);
  if (exact) return exact;
  // Slug fallback: extract company slug from Greenhouse/Lever URL
  const ghMatch = tabUrl.match(/greenhouse\.io\/([^/]+)/);
  if (ghMatch) {
    const slug = ghMatch[1].toLowerCase();
    return pipeline.find(j => j.company?.toLowerCase().includes(slug) ||
                               j.link?.toLowerCase().includes(slug)) || null;
  }
  const lvMatch = tabUrl.match(/lever\.co\/([^/]+)/);
  if (lvMatch) {
    const slug = lvMatch[1].toLowerCase();
    return pipeline.find(j => j.company?.toLowerCase().includes(slug) ||
                               j.link?.toLowerCase().includes(slug)) || null;
  }
  return null;
}

function updateFillButton() {
  const variant = $('variant-select').value;
  const btn = $('btn-fill');
  btn.disabled = !variant;
  btn.dataset.variant = variant;
}

async function triggerFill(tabId, job, ats) {
  const btn = $('btn-fill');
  const variant = btn.dataset.variant;
  btn.disabled = true;
  $('fill-status').textContent = 'Fetching resume PDF...';

  // Read profile to get railwayUrl, summary, skills_latex (profile settings, not from job)
  const { jobagent_profile: profile } = await chrome.storage.local.get('jobagent_profile');
  const railwayUrl = profile?.railwayUrl || 'https://resume-compiler-production.up.railway.app';
  const summary = profile?.summary || '';
  const skills_latex = profile?.skills_latex || '';

  // Ask background to fetch PDF (runs in service worker — no CORS restriction)
  // /generate requires: variant (A/B/C/D), summary (plain text), skills_latex (raw LaTeX)
  const response = await chrome.runtime.sendMessage({
    type: 'FETCH_PDF',
    railwayUrl,
    variant,          // e.g. 'A' (not 'resume_A' — the server uppercases and validates)
    summary,
    skills_latex,
    company: job.company,
    role: job.role,
  });

  if (!response.ok) {
    $('fill-status').textContent = '✗ PDF fetch failed: ' + response.error;
    btn.disabled = false;
    return;
  }

  $('fill-status').textContent = 'Filling form...';

  // Send fill command to content script
  // Note: content script reads profile itself from chrome.storage.local
  // Note: cover letter fetch is deferred to Phase 2 — only resume PDF sent for now
  await chrome.tabs.sendMessage(tabId, {
    type: 'FILL_FORM',
    ats,
    job,
    variant,           // included so MARK_APPLIED can record it
    pdfBuffer: response.buffer,
  });

  $('fill-status').textContent = '✓ Form filled — review and submit';
}

init().catch(console.error);
```

- [ ] **Step 6: Reload extension, open a Greenhouse page, verify popup shows job card**

1. Reload extension in `chrome://extensions`
2. Navigate to a Greenhouse apply URL from your pipeline
3. Click extension icon
4. Verify: ATS badge shows "Greenhouse detected", job card shows role + company, Auto-fill button is enabled

- [ ] **Step 7: Commit**

```bash
git add extension/popup/popup.js extension/adapters/index.js tests/adapters.test.js
git commit -m "feat(extension): popup job matching, variant picker, fill trigger"
```

---

## Phase 3: Greenhouse Adapter + Confirm Overlay

---

### Task 5: Greenhouse Adapter

**Files:**
- Create: `extension/adapters/greenhouse.js`

> ⚠ Only proceed if Task 0 validation confirmed DataTransfer works on Greenhouse. If not, replace the `injectFile` function with a manual upload prompt.

- [ ] **Step 1: Create `extension/adapters/greenhouse.js`**

```js
// adapters/greenhouse.js
// Fills a Greenhouse application form from profile + PDF buffers

export async function fill(profile, job, resumeBuffer, coverBuffer) {
  const results = { filled: [], flagged: [] };

  // --- Text fields ---
  setField('#first_name', profile.firstName, results);
  setField('#last_name', profile.lastName, results);
  setField('#email', profile.email, results);
  setField('#phone', profile.phone, results);
  setField('input[name*="linkedin"], input[id*="linkedin"]', profile.linkedinUrl, results);
  setField('input[name*="website"], input[id*="website"]', '', results); // leave blank

  // --- Work auth (label-text matching) ---
  fillSelectByLabel(/authorized to work/i, profile.workAuth === 'authorized' ? 'Yes' : 'No', results, '⚠ Work Auth');
  fillSelectByLabel(/require.*sponsor|visa.*sponsor/i, profile.needsSponsorship ? 'Yes' : 'No', results, '⚠ Sponsorship');

  // --- File uploads ---
  if (resumeBuffer) {
    const input = document.querySelector('input[name="resume"], input[data-qa="resume-input"], input[type="file"]');
    if (input) {
      injectFile(input, resumeBuffer, 'resume.pdf');
      results.filled.push('Resume PDF');
    } else {
      results.flagged.push('Resume input not found — upload manually');
    }
  }
  if (coverBuffer) {
    const inputs = document.querySelectorAll('input[type="file"]');
    const coverInput = [...inputs].find(i => !i.closest('[data-qa="resume"]') && inputs.indexOf(i) > 0);
    if (coverInput) {
      injectFile(coverInput, coverBuffer, 'cover_letter.pdf');
      results.filled.push('Cover Letter PDF');
    }
  }

  // --- Custom questions: flag everything not yet filled ---
  document.querySelectorAll('.field, [data-qa*="question"]').forEach(field => {
    const input = field.querySelector('input:not([type=hidden]), textarea, select');
    if (!input || input.value) return;
    const label = field.querySelector('label')?.textContent?.trim() || 'Unknown field';
    results.flagged.push(label);
    input.style.outline = '2px solid #dc2626'; // highlight red
  });

  return results;
}

function setField(selector, value, results) {
  const el = document.querySelector(selector);
  if (!el || !value) return;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  results.filled.push(selector);
}

function fillSelectByLabel(labelRegex, value, results, name) {
  for (const label of document.querySelectorAll('label')) {
    if (!labelRegex.test(label.textContent)) continue;
    const field = label.closest('.field, .form-field, [class*="field"]');
    const select = field?.querySelector('select') || document.getElementById(label.htmlFor);
    if (!select) continue;
    const option = [...select.options].find(o => o.text.trim().toLowerCase().startsWith(value.toLowerCase()));
    if (option) {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      results.filled.push(name);
    } else {
      results.flagged.push(`${name} — option "${value}" not found`);
    }
    return;
  }
}

function injectFile(input, arrayBuffer, filename) {
  const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
  const file = new File([blob], filename, { type: 'application/pdf' });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
```

- [ ] **Step 2: Commit**

```bash
git add extension/adapters/greenhouse.js
git commit -m "feat(extension): Greenhouse adapter — field fill + DataTransfer resume upload"
```

---

### Task 6: Content Script Routing + Confirm Overlay

**Files:**
- Modify: `extension/content.js`

- [ ] **Step 1: Replace content.js stub with full implementation**

```js
// content.js — injected into ATS pages
// Listens for FILL_FORM message from popup, routes to adapter, shows overlay

import { fill as fillGreenhouse } from './adapters/greenhouse.js';
import { fill as fillLever } from './adapters/lever.js';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'FILL_FORM') return;
  handleFill(msg).then(sendResponse);
  return true;
});

async function handleFill({ ats, job, variant, pdfBuffer }) {
  let results = { filled: [], flagged: [] };

  // Read profile from storage (not passed in message — kept small)
  const stored = await new Promise(r => chrome.storage.local.get('jobagent_profile', r));
  const profile = stored.jobagent_profile || {};

  // pdfBuffer is the resume ArrayBuffer from background (cover letter deferred to Phase 2)
  const resumeBuffer = pdfBuffer || null;

  if (ats === 'greenhouse') {
    results = await fillGreenhouse(profile, job, resumeBuffer, null);
  } else if (ats === 'lever') {
    results = await fillLever(profile, job, resumeBuffer, null);
  } else {
    results.flagged.push('No adapter for this ATS — fill manually');
  }

  showOverlay(results, job, variant);
  return results;
}

function showOverlay(results, job, variant) {
  // Remove any existing overlay
  document.getElementById('jobagent-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'jobagent-overlay';
  overlay.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 999999;
    width: 280px; background: #fff; border: 2px solid #6d28d9;
    border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.18);
    font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 13px;
  `;

  const hasBlockers = results.flagged.length > 0;

  overlay.innerHTML = `
    <div style="background:#6d28d9;color:#fff;padding:10px 14px;border-radius:10px 10px 0 0;
                font-weight:700;display:flex;justify-content:space-between;align-items:center;">
      🧩 JobAgent — Review Before Submitting
      <button id="joa-close" style="background:none;border:none;color:#fff;cursor:pointer;font-size:16px;">×</button>
    </div>
    <div style="padding:12px 14px;">
      ${results.filled.map(f => `<div style="color:#15803d;margin-bottom:3px;">✓ ${f}</div>`).join('')}
      ${results.flagged.map(f => `<div style="color:#dc2626;margin-bottom:3px;font-weight:600;">⚠ ${f}</div>`).join('')}
    </div>
    ${hasBlockers ? `<div style="padding:0 14px 10px;font-size:11px;color:#92400e;
        background:#fef3c7;margin:0 14px 12px;border-radius:6px;padding:8px 10px;">
        Fix red fields above before submitting.</div>` : ''}
    <div style="padding:0 14px 14px;">
      <button id="joa-submit" style="width:100%;background:${hasBlockers ? '#9ca3af' : '#15803d'};
        color:#fff;border:none;border-radius:8px;padding:10px;font-weight:700;
        font-size:13px;cursor:${hasBlockers ? 'not-allowed' : 'pointer'};"
        ${hasBlockers ? 'disabled' : ''}>
        ✅ Submit Application
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('joa-close').addEventListener('click', () => overlay.remove());

  if (!hasBlockers) {
    document.getElementById('joa-submit').addEventListener('click', async () => {
      const submitBtn = document.querySelector(
        'input[type="submit"], button[type="submit"], #submit_app, [data-qa="btn-submit"]'
      );
      if (!submitBtn) {
        alert('Could not find Submit button — please click it manually.');
        return;
      }
      submitBtn.click();
      // Watch for success — pass variant so it's recorded in the applied row
      waitForSuccess(job, variant);
    });
  }
}

function waitForSuccess(job, variant) {
  // Greenhouse redirects to /confirmation or shows a success message after submit
  const observer = new MutationObserver(() => {
    const isSuccess = document.querySelector('[data-qa="confirmation"], .confirmation-page') ||
                      /thank you|application received|successfully applied/i.test(document.body.textContent);
    if (isSuccess || window.location.href.includes('confirmation')) {
      observer.disconnect();
      // Pass variant so the applied record captures the user-selected variant
      chrome.runtime.sendMessage({ type: 'MARK_APPLIED', job, resumeVariant: variant });
      showSuccessToast();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  // Also check on URL change
  setTimeout(() => {
    if (window.location.href.includes('confirmation')) {
      observer.disconnect();
      chrome.runtime.sendMessage({ type: 'MARK_APPLIED', job, resumeVariant: variant });
    }
  }, 3000);
}

function showSuccessToast() {
  document.getElementById('jobagent-overlay')?.remove();
  const toast = document.createElement('div');
  toast.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:999999;
    background:#15803d;color:#fff;padding:12px 18px;border-radius:10px;
    font-family:-apple-system,sans-serif;font-weight:700;font-size:13px;
    box-shadow:0 4px 16px rgba(0,0,0,0.2);`;
  toast.textContent = '✅ Applied! Logged in JobAgent.';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
```

- [ ] **Step 2: Update `background.js` to handle MARK_APPLIED**

Replace the stub `handleMarkApplied` in `background.js`:
```js
import { markApplied } from './lib/supabase.js';

async function handleMarkApplied({ job, resumeVariant }, sendResponse) {
  try {
    await markApplied(job, resumeVariant || job.resume_variant);
    sendResponse({ ok: true });
  } catch (e) {
    console.error('[JobAgent] markApplied failed:', e);
    sendResponse({ ok: false, error: e.message });
  }
}
```

Also add the import at the top of `background.js`:
```js
import { markApplied } from './lib/supabase.js';
```

- [ ] **Step 3: Manual test on a real Greenhouse page**

1. Reload extension
2. Navigate to a Greenhouse apply page from your pipeline
3. Open extension popup → click "Auto-fill"
4. Verify: form fields filled, overlay appears with checklist
5. If DataTransfer worked: resume filename should appear in the file input UI
6. Check flagged (red) fields — fix them manually
7. Click "Submit Application" in the overlay
8. Verify: form submits, success toast appears
9. Open JobAgent app → Applied tab → verify job appears

- [ ] **Step 4: Commit**

```bash
git add extension/content.js extension/background.js
git commit -m "feat(extension): content script routing, confirm overlay, success detection, Supabase write-back"
```

---

## Phase 4: Lever Adapter

---

### Task 7: Lever Adapter

**Files:**
- Create: `extension/adapters/lever.js`

- [ ] **Step 1: Create `extension/adapters/lever.js`**

```js
// adapters/lever.js — fills a Lever application form
// ~80% same as greenhouse.js; key differences: combined name field, different selectors

export async function fill(profile, job, resumeBuffer, coverBuffer) {
  const results = { filled: [], flagged: [] };

  // Lever uses a single "name" field
  setField('input[name="name"]', `${profile.firstName} ${profile.lastName}`.trim(), results, 'Name');
  setField('input[name="email"]', profile.email, results, 'Email');
  setField('input[name="phone"]', profile.phone, results, 'Phone');
  setField('input[name="org"]', '', results, 'Current Company'); // leave blank
  setField('input[name="urls[LinkedIn]"]', profile.linkedinUrl, results, 'LinkedIn');

  // Resume upload
  const fileInputs = document.querySelectorAll('input[type="file"]');
  if (fileInputs[0] && resumeBuffer) {
    injectFile(fileInputs[0], resumeBuffer, 'resume.pdf');
    results.filled.push('Resume PDF');
  } else if (!fileInputs[0]) {
    results.flagged.push('Resume input not found');
  }

  // Cover letter (second file input if present)
  if (fileInputs[1] && coverBuffer) {
    injectFile(fileInputs[1], coverBuffer, 'cover_letter.pdf');
    results.filled.push('Cover Letter PDF');
  }

  // Custom/additional questions
  document.querySelectorAll('.application-question').forEach(field => {
    const input = field.querySelector('input:not([type=hidden]), textarea, select');
    if (!input || input.value) return;
    const label = field.querySelector('label')?.textContent?.trim() || 'Unknown field';
    results.flagged.push(label);
    input.style.outline = '2px solid #dc2626';
  });

  return results;
}

function setField(selector, value, results, name) {
  const el = document.querySelector(selector);
  if (!el || !value) return;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  results.filled.push(name);
}

function injectFile(input, arrayBuffer, filename) {
  const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
  const file = new File([blob], filename, { type: 'application/pdf' });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
```

- [ ] **Step 2: Manual test on a real Lever page**

1. Open a Lever apply URL from your pipeline (e.g., `jobs.lever.co/shieldai/...`)
2. Click extension popup → Auto-fill
3. Verify: name (first + last joined), email, phone filled
4. Check resume upload works
5. Verify overlay appears with checklist

- [ ] **Step 3: Commit**

```bash
git add extension/adapters/lever.js
git commit -m "feat(extension): Lever adapter — combined name field, file upload, custom question flagging"
```

---

## Phase 5: Aggregator Link Resolver

---

### Task 8: Aggregator Link Resolver

**Files:**
- Create: `extension/lib/resolver.js`
- Test: `tests/resolver.test.js`

- [ ] **Step 1: Write failing test for aggregator detection**

Create `tests/resolver.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { isAggregatorUrl } from '../extension/lib/resolver.js';

describe('isAggregatorUrl', () => {
  it('detects known aggregators', () => {
    expect(isAggregatorUrl('https://www.adzuna.com/details/12345')).toBe(true);
    expect(isAggregatorUrl('https://www.click2apply.net/abcdef')).toBe(true);
    expect(isAggregatorUrl('https://dsp.prng.co/meAnKhb')).toBe(true);
  });
  it('passes through real ATS URLs', () => {
    expect(isAggregatorUrl('https://boards.greenhouse.io/rocketlab/jobs/123')).toBe(false);
    expect(isAggregatorUrl('https://jobs.lever.co/shieldai/abc')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/resolver.test.js
```

- [ ] **Step 3: Create `extension/lib/resolver.js`**

```js
// lib/resolver.js — follow aggregator redirect links to find real ATS URL

const AGGREGATORS = ['adzuna.com', 'click2apply.net', 'prng.co', 'indeed.com/rc', 'ziprecruiter.com/c'];

export function isAggregatorUrl(url) {
  return AGGREGATORS.some(a => url.includes(a));
}

// Resolves an aggregator URL by opening a background tab and following redirects.
// Must be called from background.js (uses chrome.tabs API).
export function resolveUrl(url) {
  if (!isAggregatorUrl(url)) return Promise.resolve(url);

  return new Promise((resolve, reject) => {
    const TIMEOUT_MS = 10_000;
    let done = false;

    chrome.tabs.create({ url, active: false }, (tab) => {
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          chrome.tabs.remove(tab.id);
          reject(new Error(`Redirect timeout for: ${url}`));
        }
      }, TIMEOUT_MS);

      function listener(tabId, changeInfo) {
        if (tabId !== tab.id || changeInfo.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        if (!done) {
          done = true;
          // Small delay for client-side redirects
          setTimeout(() => {
            chrome.tabs.get(tabId, (t) => {
              chrome.tabs.remove(tabId);
              resolve(t?.url || url);
            });
          }, 800);
        }
      }

      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/resolver.test.js
```

- [ ] **Step 5: Wire resolver into background.js**

Add a `RESOLVE_URL` message handler in `background.js`:
```js
import { resolveUrl } from './lib/resolver.js';

// Inside onMessage listener, add:
if (msg.type === 'RESOLVE_URL') {
  resolveUrl(msg.url)
    .then(resolved => sendResponse({ ok: true, url: resolved }))
    .catch(e => sendResponse({ ok: false, error: e.message }));
  return true;
}
```

- [ ] **Step 6: Commit**

```bash
git add extension/lib/resolver.js tests/resolver.test.js extension/background.js
git commit -m "feat(extension): aggregator link resolver with timeout + client-side redirect handling"
```

---

## Phase 6: Final Integration Test

---

### Task 9: End-to-End Validation

**Files:**
- No code changes — validation only

- [ ] **Step 1: Run all unit tests**

```bash
npx vitest run
```
Expected: All tests pass.

- [ ] **Step 2: Full flow test — Greenhouse**

1. Add a Greenhouse job to your pipeline in the JobAgent app
2. Navigate to its apply URL in Chrome
3. Click extension icon → verify job card shows with correct role, company, match%
4. Click Auto-fill
5. Verify all standard fields filled, overlay shows checklist
6. Fix any flagged fields
7. Click Submit in overlay
8. Verify JobAgent app Applied tab shows the job within 5 seconds

- [ ] **Step 3: Full flow test — Lever**

Repeat Step 2 with a Lever job (e.g., Shield AI, Beta Technologies).

- [ ] **Step 4: Test profile settings round-trip**

1. Open Options page, change email, save
2. Trigger an auto-fill on any Greenhouse page
3. Verify the new email appears in the filled form

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "test(extension): Phase 1 validation complete — Greenhouse + Lever adapters working"
```

---

## Vitest Setup (if not already configured)

If the repo doesn't have Vitest yet:

```bash
cd /Users/jashwanth/jobagent-web
npm install --save-dev vitest
```

Add to `package.json`:
```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

Ensure `package.json` has `"type": "module"` (required for ESM imports in test files):
```json
"type": "module"
```

Create `vitest.config.js`:
```js
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node' }
});
```

---

## Phase 2 + 3 (Future)

- **Workday adapter** (`extension/adapters/workday.js`): MutationObserver-based, React synthetic events, multi-step pause between pages
- **Vision fallback** (`extension/adapters/vision.js`): `chrome.tabs.captureVisibleTab` in background → Claude Vision API → fill instructions
- **Aggregator pre-processing**: Run `resolveUrl` on all pipeline jobs at load time to normalize links

