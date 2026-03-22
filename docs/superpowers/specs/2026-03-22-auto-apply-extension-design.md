# Auto-Apply Chrome Extension — Design Spec
**Date:** 2026-03-22
**Status:** Approved for implementation
**Scope:** Automate job application form-filling on ATS portals using pipeline data from the JobAgent app

---

## 1. Problem

The JobAgent app already scrapes jobs daily, scores them with AI, generates tailored resume/cover letter PDFs, and drafts networking messages. The remaining manual step is opening each job link, filling out the ATS application form, uploading the resume, and clicking Submit. This spec covers a Chrome extension that automates that last mile.

LinkedIn outreach is explicitly **out of scope** — the drafted notes are short enough to paste manually and the TOS risk is not worth it.

---

## 2. ATS Landscape (from today's actual data)

Analysis of `data/ats_companies.json` (curated target list) + today's scraper run (Mar 22):

| ATS | Source | Count | Priority |
|-----|--------|-------|----------|
| Greenhouse | ats_companies.json | 26 companies | Phase 1 |
| Lever | ats_companies.json | 6 companies | Phase 1 |
| Workday | Broader scrapers | ~21% of daily jobs | Phase 2 |
| Company portals (Garmin, ExxonMobil, Siemens, etc.) | Broader scrapers | ~38% of daily jobs | Phase 3 (Vision) |
| Oracle HCM, UltiPro/UKG, Rippling, Ashby | Broader scrapers | ~20% of daily jobs | Phase 3 (Vision) |

**Key insight:** The curated aerospace target list is 81% Greenhouse + 19% Lever — clean APIs, standardized forms, high-value companies (Rocket Lab, Archer, Shield AI, Beta Technologies, etc.). Build these first for maximum ROI. The broader scraper results are Workday-heavy and require a more resilient approach.

**Aggregator link problem:** Several job URLs from JSearch/SerpAPI point to aggregators (`adzuna.com`, `click2apply.net`, `prng.co`) rather than the real ATS. The extension must follow redirects to resolve the true apply URL before ATS detection runs.

---

## 3. Chosen Approach

**Chrome Extension (Manifest V3) with ATS-specific adapters**, with Claude Vision as fallback.

Rejected alternatives:
- **Playwright service (server-side):** Headless browsers are aggressively detected and blocked by ATS platforms. Session management and CAPTCHA handling add significant complexity.
- **Easy Apply only:** Only covers LinkedIn/Indeed Easy Apply — misses most aerospace/defense/manufacturing roles which live on Workday and company portals.

---

## 4. Architecture

```
JobAgent React App (Netlify)
        │
        │  reads/writes pipeline jobs
        ▼
    Supabase DB
    ├── jobs table       (in_pipeline=true → active pipeline)
    └── applications table (applied jobs, date string)
        │
        │  extension reads pipeline, writes applied status
        ▼
Chrome Extension
  ├── popup/           — Job queue UI, trigger auto-fill
  ├── background.js    — Service worker: Railway fetch, screenshot, Supabase writes
  ├── content.js       — Injected into ATS pages: field filling, overlay
  ├── lib/
  │   ├── supabase.js  — Read pipeline, write applied status
  │   ├── profile.js   — chrome.storage.local read/write
  │   └── resolver.js  — Follow redirects to find real ATS URL
  └── adapters/
      ├── greenhouse.js — Phase 1
      ├── lever.js      — Phase 1
      ├── workday.js    — Phase 2
      └── vision.js     — Phase 3 fallback (Claude API)
        │
        │  PDF fetch happens in background.js (not content script)
        ▼
Railway Resume Compiler
  POST /compile { template: "resume_A" } → PDF blob
  ⚠ Must have CORS header: Access-Control-Allow-Origin: * (verify before Phase 1)
```

---

## 5. Extension File Structure

```
jobagent-extension/
├── manifest.json
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── options/
│   ├── options.html     — Profile settings page
│   └── options.js
├── background.js        — MV3 service worker
├── content.js           — Entry point injected into ATS pages
├── lib/
│   ├── supabase.js
│   ├── profile.js
│   └── resolver.js
└── adapters/
    ├── index.js         — detect() → picks right adapter
    ├── greenhouse.js
    ├── lever.js
    ├── workday.js
    └── vision.js
```

### manifest.json (partial — implementer must add `background`, `content_scripts`, `action`)
```json
{
  "manifest_version": 3,
  "name": "JobAgent Auto-Apply",
  "version": "1.0.0",
  "permissions": ["storage", "tabs", "scripting", "activeTab"],
  "host_permissions": [
    "https://*.greenhouse.io/*",
    "https://*.lever.co/*",
    "https://*.myworkdayjobs.com/*",
    "https://*.railway.app/*",
    "https://*/* "
  ],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup/popup.html" },
  "content_scripts": [{
    "matches": ["https://*.greenhouse.io/*", "https://*.lever.co/*", "https://*.myworkdayjobs.com/*"],
    "js": ["content.js"]
  }]
}
```

Note: `"https://*/*"` in `host_permissions` is required for the Vision fallback to work on arbitrary company portals. Chrome will show a broad permission warning on install.

---

## 6. User Profile (chrome.storage.local)

Stored locally in the browser — never sent to any server except to fill forms.

```json
{
  "firstName": "Jashwanth",
  "lastName": "...",
  "email": "...",
  "phone": "...",
  "linkedinUrl": "https://linkedin.com/in/...",
  "city": "Champaign",
  "state": "IL",
  "workAuth": "authorized",
  "needsSponsorship": true,
  "visaStatus": "F-1 OPT STEM",
  "railwayUrl": "https://jobagent-compiler.up.railway.app"
}
```

**Supabase credentials:** Reuse the same hardcoded `supabaseUrl` and `supabaseAnonKey` from `src/supabase.js` — they are already public in the frontend bundle. No auth flow needed; this is a single-user personal tool with no RLS enforced (confirm RLS is off on `jobs` and `applications` tables before shipping).

---

## 7. Apply Flow (Happy Path)

1. User opens a Greenhouse/Lever job link from the pipeline
2. Extension popup detects the ATS from the URL; matches to a pipeline job by comparing the full `job_url` stored in Supabase `jobs.link` against the current tab URL (exact match preferred; fallback: company slug substring match)
3. If `job.resume_variant` is null, popup shows a variant picker (A, B, etc.) — "Auto-fill" button is disabled until a variant is selected
4. User clicks **"Auto-fill"** in the popup
5. Popup sends message to `background.js`; background fetches resume PDF from Railway (`POST /compile { template: variant }`) — fetch runs in background service worker to avoid CORS restrictions
6. Background passes the PDF `ArrayBuffer` back to content script via `chrome.runtime.sendMessage`
7. Content script (adapter) constructs `File` from ArrayBuffer and fills all standard fields via DataTransfer; custom questions are highlighted red
8. Confirm overlay injected into the ATS page — checklist shows every field, including auto-filled work auth and sponsorship fields (always shown regardless of fill confidence)
9. User reviews, fixes flagged/red fields, clicks **"Submit Application"** in the overlay
10. Overlay's Submit click programmatically clicks the ATS's real submit button — this IS the final human action; no additional click required
11. On success (URL change or success text detected), background:
    - Upserts to `applications` table: `{ id, role, company, location, link, status: 'Applied', date: today, resume_variant, ... }`
    - Updates `jobs` table: `{ in_pipeline: false }` (removes from pipeline) matching on `id`
12. JobAgent app Applied tab reflects the change immediately on next load

---

## 8. Greenhouse Adapter

Greenhouse is consistent across all companies — same DOM structure, same field IDs.

### ⚠ Pre-build validation required
Before writing the adapter, manually open one real Greenhouse apply page (e.g., `boards.greenhouse.io/rocketlab/jobs/...`) and verify:
- Whether the resume upload is a plain `<input type="file">` or a JS-wrapped uploader widget (Filestack, etc.)
- If it's a JS widget, setting `input.files = dt.files` will NOT trigger the internal upload handler — the DataTransfer technique will silently fail and the form will submit without a resume. In that case, use the Vision adapter as fallback for resume upload, or inject a "click to upload" prompt.

### URL patterns
```
https://job-boards.greenhouse.io/{slug}/jobs/{id}
https://boards.greenhouse.io/{slug}/jobs/{id}
https://jobs.greenhouse.io/{id}
```

### Field map
| Field | Selector | Value Source | Handling |
|-------|----------|--------------|----------|
| First name | `#first_name` | profile.firstName | Auto |
| Last name | `#last_name` | profile.lastName | Auto |
| Email | `#email` | profile.email | Auto |
| Phone | `#phone` | profile.phone | Auto |
| Resume | `input[name="resume"]` or first `input[type="file"]` | Railway PDF → File | DataTransfer (verify first) |
| Cover letter | `input[name="cover_letter"]` | Railway PDF → File | DataTransfer (verify first) |
| LinkedIn URL | `input[name*="linkedin"]` | profile.linkedinUrl | Auto |
| Work auth (US) | `select` whose label text contains "authorized to work" | profile.workAuth → "Yes" | Auto — always shown in confirm overlay |
| Sponsorship | `select` whose label text contains "sponsor" | profile.needsSponsorship → "Yes" | Auto — always shown in confirm overlay |
| Custom questions | all other `.field` containers | varies | Highlight red, block Submit |

**Selector strategy for work auth / sponsorship:** Match by label text, not by `name` attribute. `select[name*="authorized"]` is too broad and risks filling unrelated dropdowns. Use:
```js
document.querySelectorAll('label').forEach(label => {
  if (/authorized to work/i.test(label.textContent)) {
    const select = label.closest('.field')?.querySelector('select');
    if (select) setSelectValue(select, 'Yes');
  }
});
```

### Resume upload (DataTransfer — pending validation above)
```js
// Runs in content script after receiving ArrayBuffer from background
async function injectResume(input, arrayBuffer) {
  const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
  const file = new File([blob], 'resume.pdf', { type: 'application/pdf' });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
```

### Background → Content message flow (avoids CORS)
```js
// background.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'FETCH_PDF') {
    fetch(msg.url, { method: 'POST', body: JSON.stringify(msg.body),
                     headers: { 'Content-Type': 'application/json' } })
      .then(r => r.arrayBuffer())
      .then(buf => sendResponse({ ok: true, buffer: buf }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true; // keep channel open for async response
  }
});
```

---

## 9. Lever Adapter

~80% identical to Greenhouse. Key differences:

### URL pattern
```
https://jobs.lever.co/{company}/{jobId}/apply
```

### Field differences
| Field | Lever selector | Greenhouse selector |
|-------|---------------|---------------------|
| Full name | `input[name="name"]` | `#first_name` + `#last_name` (joined) |
| Current company | `input[name="org"]` | n/a |
| LinkedIn | `input[name="urls[LinkedIn]"]` | label text match |
| Resume | first `input[type="file"]` | `input[name="resume"]` |

Lever combines first + last into a single `name` field. The adapter joins `profile.firstName + ' ' + profile.lastName`.

---

## 10. Workday Adapter (Phase 2)

Workday is significantly more complex:
- Multi-step wizard (3–5 pages)
- React-based UI — must trigger synthetic React events, not just native DOM events
- Dynamic DOM — elements render after JS execution; use `MutationObserver` to wait

### React input fill pattern
```js
function setReactInput(input, value) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  ).set;
  nativeInputValueSetter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
```

### Strategy
- Use `MutationObserver` to wait for each step's DOM to settle before filling
- Pause between steps — do not auto-advance pages; require user to click Next
- Capture screenshot for each step via background and use Vision to identify fields if Workday layout changes

---

## 11. Vision Fallback Adapter (Phase 3)

For any unrecognized ATS (company portals, Oracle HCM, UltiPro, etc.):

1. Content script sends message to `background.js` requesting a screenshot
2. **Background** calls `chrome.tabs.captureVisibleTab(null, { format: 'png' })` — this API is background-only, not available in content scripts
3. Background sends screenshot data URL + profile data to Claude API (`claude-sonnet-4-6`)
4. Prompt: *"Here is a job application form. Given this profile data, return a JSON array of `{ selector, value }` pairs for every visible field you can identify."*
5. Background returns the fill instructions to content script
6. Content script applies fills and shows confirm overlay

**Cost:** ~$0.02–0.05 per application page. Acceptable for the long tail.

---

## 12. Aggregator Link Resolver

Some scraped job URLs point to aggregators rather than the real ATS. The extension resolves these before ATS detection:

```js
async function resolveUrl(url) {
  const AGGREGATORS = ['adzuna.com', 'click2apply.net', 'prng.co', 'indeed.com/rc'];
  if (!AGGREGATORS.some(a => url.includes(a))) return url;

  return new Promise((resolve, reject) => {
    const TIMEOUT_MS = 10_000;
    let resolved = false;

    chrome.tabs.create({ url, active: false }, (tab) => {
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          chrome.tabs.remove(tab.id);
          reject(new Error('Redirect timeout'));
        }
      }, TIMEOUT_MS);

      chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
        if (tabId !== tab.id || changeInfo.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        if (!resolved) {
          resolved = true;
          // Get final URL via tabs.get (not changeInfo.url which doesn't exist)
          chrome.tabs.get(tabId, (t) => {
            chrome.tabs.remove(tabId);
            resolve(t.url || url);
          });
        }
      });
    });
  });
}
```

**Note:** Some aggregators use client-side redirects that complete after `status === 'complete'`. For these, add a 1-second delay before `tabs.get` and check again.

---

## 13. Supabase Write-Back (Correct Schema)

Based on `src/lib/storage.js`:

**Tables:** `jobs` (pipeline), `applications` (applied history)
**Pipeline filter:** `jobs` where `in_pipeline = true`
**Job URL column:** `jobs.link` (not `job_url`)
**No `applied_at` column** — `applications.date` is a string (e.g., `"3/22/2026"`)

### Extension write-back after successful submit
```js
// 1. Upsert to applications table
await supabase.from('applications').upsert({
  id: `app-${Date.now()}`,
  role: job.role,
  company: job.company,
  location: job.location || '',
  link: job.link || '',
  company_link: '',
  match: job.match || null,
  verdict: job.verdict || 'GREEN',
  status: 'Applied',
  date: new Date().toLocaleDateString(),
  location_type: job.location_type || '',
  type: job.type || '',
  salary: job.salary || '',
  resume_variant: job.resume_variant || '',
  fit_level: job.verdict === 'GREEN' ? 'Green' : job.verdict === 'YELLOW' ? 'Yellow' : 'Red',
}, { onConflict: 'id' });

// 2. Remove from pipeline
await supabase.from('jobs').upsert(
  { id: job.id, in_pipeline: false, pipeline_added_at: null },
  { onConflict: 'id' }
);
```

### Pipeline match logic
Match the current tab URL to a pipeline job by comparing `tab.url` to `jobs.link`. Exact URL match preferred. Fallback: extract company slug from the ATS URL (e.g., `rocketlab` from `boards.greenhouse.io/rocketlab/...`) and find the pipeline job whose `company` field contains that slug (case-insensitive). Do not rely on `company` string equality alone — names may differ ("Rocket Lab" vs. "Rocket Lab USA").

---

## 14. Error Handling

| Scenario | Handling |
|----------|----------|
| Field selector not found | Log warning, flag field in confirm overlay |
| Railway PDF fetch fails (CORS or network) | Show error in popup, block auto-fill |
| DataTransfer doesn't trigger upload widget | Highlight file input, prompt user to upload manually |
| Supabase write-back fails | Retry once; show toast in popup; do not block submission |
| ATS not recognized | Offer Vision fallback or skip |
| Custom question detected | Highlight red on page; block Submit until all red fields acknowledged |
| Submit button not found | Show error overlay; let user submit manually |
| Aggregator redirect times out | Show error, open real URL in tab manually |

---

## 15. What's NOT Automated (By Design)

- **Custom essay questions** — flagged for manual input, never auto-answered
- **Work samples / portfolio uploads** — flagged
- **Salary expectations** — flagged
- **The final Submit click** — always requires clicking the overlay's "Submit Application" button; the ATS submit button is never triggered without this explicit user action
- **LinkedIn outreach** — out of scope

---

## 16. Build Phases

| Phase | Deliverable | Covers |
|-------|-------------|--------|
| 1 | Greenhouse + Lever adapters + popup + profile settings | 32 curated companies |
| 2 | Workday adapter | ~21% of broader daily scraper output |
| 3 | Vision fallback + aggregator resolver | Everything else |

---

## 17. Pre-Build Checklist (resolve before Phase 1 starts)

- [ ] **CORS on Railway `/compile`:** Confirm `Access-Control-Allow-Origin: *` is returned. If not, add it to `resume-compiler/app.py`. This is a hard blocker — without it, all PDF fetches will fail.
- [ ] **Greenhouse upload widget type:** Manually open one Greenhouse apply page and inspect whether `input[name="resume"]` is a plain file input or a JS-wrapped uploader. If it's a widget, DataTransfer won't work — need an alternative upload strategy before writing the adapter.
- [ ] **Supabase RLS:** Confirm RLS is off on `jobs` and `applications` tables (single-user personal tool — should be off). If on, the extension needs a sign-in flow.
- [ ] **Extension location:** Subdirectory in this monorepo (`extension/`) vs. separate repo. Monorepo preferred — shares Supabase URL/key and `ats_companies.json`.
- [ ] **Cover letter:** Always generate one per application, or make it optional in the popup? Default: always generate; user can uncheck in popup.

---

## 18. Open Questions (resolved)

| # | Question | Answer |
|---|----------|--------|
| 1 | Monorepo or separate repo? | Monorepo (`extension/` subdir) — see pre-build checklist |
| 2 | `resumeVariant` always populated? | No — nullable. Popup shows variant picker when null; blocks auto-fill until selected. |
| 3 | Cover letter always generated? | Default yes; optional checkbox in popup |
| 4 | Supabase table schema? | Resolved — see Section 13. `jobs` + `applications` tables, `link` column, `date` string |
