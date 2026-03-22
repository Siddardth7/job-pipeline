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
- **Playwright service (server-side):** Headless browsers are aggressively detected and blocked by LinkedIn and increasingly by ATS platforms. Session management and CAPTCHA handling add significant complexity.
- **Easy Apply only:** Only covers LinkedIn/Indeed Easy Apply — misses most aerospace/defense/manufacturing roles which live on Workday and company portals.

---

## 4. Architecture

```
JobAgent React App (Netlify)
        │
        │  reads/writes pipeline jobs
        ▼
    Supabase DB
        │
        │  pipeline jobs (job_url, resumeVariant, status)
        ▼
Chrome Extension
  ├── popup/           — Job queue UI, trigger auto-fill
  ├── background.js    — Service worker, tab management, Supabase client
  ├── lib/
  │   ├── supabase.js  — Read pipeline, write Applied status
  │   ├── profile.js   — chrome.storage.local read/write
  │   └── resolver.js  — Follow redirects to find real ATS URL
  └── adapters/
      ├── greenhouse.js — Phase 1
      ├── lever.js      — Phase 1
      ├── workday.js    — Phase 2
      └── vision.js     — Phase 3 fallback (Claude API)
        │
        │  fetches PDF for upload
        ▼
Railway Resume Compiler
  POST /compile { template: "resume_A" } → PDF blob
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

### manifest.json permissions
```json
{
  "manifest_version": 3,
  "permissions": ["storage", "tabs", "scripting", "activeTab"],
  "host_permissions": [
    "https://*.greenhouse.io/*",
    "https://*.lever.co/*",
    "https://*.myworkdayjobs.com/*",
    "https://*.railway.app/*"
  ]
}
```

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
  "railwayUrl": "https://jobagent-compiler.up.railway.app",
  "supabaseUrl": "...",
  "supabaseAnonKey": "..."
}
```

---

## 7. Apply Flow (Happy Path)

1. User opens a Greenhouse/Lever job link from the pipeline
2. Extension popup detects the ATS from the URL, matches to a pipeline job via company slug
3. User clicks **"Auto-fill"** in the popup
4. Background worker fetches resume PDF from Railway (`POST /compile { template: job.resumeVariant }`)
5. Content script (adapter) fills all standard fields; custom questions are highlighted in red
6. Confirm overlay injected into the ATS page — checklist of filled vs. flagged fields
7. User reviews, optionally fixes flagged fields, clicks **"Submit Application"**
8. Extension programmatically clicks the real ATS submit button
9. On success (URL change or success message), background worker updates Supabase: `status = 'Applied'`, `applied_at = now()`
10. JobAgent app Applied tab reflects the change immediately

---

## 8. Greenhouse Adapter

Greenhouse is consistent across all companies — same DOM structure, same field IDs.

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
| Resume | `input[name="resume"]` | Railway PDF → File | DataTransfer trick |
| Cover letter | `input[name="cover_letter"]` | Railway PDF → File | DataTransfer trick |
| LinkedIn URL | `input[name*="linkedin"]` | profile.linkedinUrl | Auto |
| Work auth (US) | `select[name*="authorized"]` | profile.workAuth → "Yes" | Auto |
| Sponsorship | `select[name*="sponsor"]` | profile.needsSponsorship → "Yes" | Auto |
| Custom questions | `.custom-question` | varies | Flag for manual |

### Resume upload (DataTransfer technique)
```js
async function uploadResume(input, railwayUrl, variant) {
  const res = await fetch(`${railwayUrl}/compile`, {
    method: 'POST',
    body: JSON.stringify({ template: variant })
  });
  const blob = await res.blob();
  const file = new File([blob], 'resume.pdf', { type: 'application/pdf' });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
```

Browsers block direct `input.value` assignment for file inputs. `DataTransfer` is the standard workaround — works in all Chromium-based browsers.

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
| Full name | `input[name="name"]` | `#first_name` + `#last_name` |
| Current company | `input[name="org"]` | n/a |
| LinkedIn | `input[name="urls[LinkedIn]"]` | `input[name*="linkedin"]` |
| Resume | `input[type="file"]` (first one) | `input[name="resume"]` |

Lever combines first + last into a single `name` field. The adapter joins `profile.firstName + ' ' + profile.lastName`.

---

## 10. Workday Adapter (Phase 2)

Workday is significantly more complex:
- Multi-step wizard (3–5 pages)
- Dynamic DOM — elements render after JS execution
- React-based UI — must trigger synthetic React events, not just DOM events
- CAPTCHA on some company instances

### Strategy
- Use `MutationObserver` to wait for each step's DOM to settle before filling
- Trigger React's synthetic events: `Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true }))`
- Pause between steps for human review (don't auto-advance pages)

---

## 11. Vision Fallback Adapter (Phase 3)

For any unrecognized ATS (company portals, Oracle HCM, UltiPro, etc.):

1. Content script captures a screenshot of the current page via `chrome.tabs.captureVisibleTab`
2. Background worker sends screenshot + profile data to Claude API (`claude-sonnet-4-6`)
3. Prompt: *"Here is a job application form. Given this profile data, return a JSON array of { selector, value } pairs for every visible field you can identify."*
4. Content script applies the returned fills
5. Falls through to the same confirm overlay

**Cost:** ~$0.02–0.05 per application page (vision input tokens). Acceptable for cases where no adapter exists.

---

## 12. Aggregator Link Resolver

Some scraped job URLs point to aggregators rather than the real ATS. The extension resolves these before ATS detection:

```js
async function resolveUrl(url) {
  const AGGREGATORS = ['adzuna.com', 'click2apply.net', 'prng.co', 'indeed.com/rc'];
  if (!AGGREGATORS.some(a => url.includes(a))) return url;
  // Open in background tab, follow redirects, return final URL
  const tab = await chrome.tabs.create({ url, active: false });
  return new Promise(resolve => {
    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.remove(tab.id);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(info.url || url);
      }
    });
  });
}
```

---

## 13. Error Handling

| Scenario | Handling |
|----------|----------|
| Field selector not found | Log warning, flag field in confirm overlay |
| Railway PDF fetch fails | Show error in popup, block auto-fill until resolved |
| Supabase write-back fails | Retry once; show toast in popup; don't block submission |
| ATS not recognized | Offer Vision fallback or skip |
| Custom question detected | Highlight in red on page; block Submit until acknowledged |
| Submit button not found | Show error overlay; let user submit manually |

---

## 14. What's NOT Automated (By Design)

- **Custom essay questions** — flagged for manual input, never auto-answered
- **Work samples / portfolio uploads** — flagged
- **Salary expectations** — flagged (user knows the number)
- **The final Submit click** — always requires explicit human confirmation
- **LinkedIn outreach** — out of scope

---

## 15. Build Phases

| Phase | Deliverable | Covers |
|-------|-------------|--------|
| 1 | Greenhouse + Lever adapters + popup + profile settings | 32 curated companies (~81% Greenhouse, ~19% Lever) |
| 2 | Workday adapter | ~21% of broader daily scraper output |
| 3 | Vision fallback + aggregator resolver | Everything else |

---

## 16. Open Questions

1. **Where does the extension live?** Separate repo (`jobagent-extension/`) or subdirectory in this monorepo (`extension/`)? Monorepo is simpler for sharing types and Supabase config.
2. **Resume variant selection:** The pipeline job has a `resumeVariant` field — does it always have this populated, or does the user need to pick in the popup?
3. **Cover letter:** Always generate one, or make it optional per application?
4. **Supabase pipeline table schema:** Need to confirm the exact table name and column names for `job_url`, `status`, `applied_at` before writing the Supabase client.
