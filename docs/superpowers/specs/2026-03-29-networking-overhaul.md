# Networking Overhaul — Spec

**Date:** 2026-03-29
**Scope:** Three bug fixes + feature additions to the Networking tab: location-aware contact search, per-persona contact finding with UI multiselect, and a follow-up system overhaul including new statuses and a POC List tab.

---

## 1. Contact Search Fixes (Bugs 1 & 2)

### 1.1 Location filter — `api/find-contacts.js`

**Problem:** The `location` field is captured in the UI but never passed to the API or included in Serper queries. Contacts are returned from any geography.

**Fix:** Include location in Serper query string. Apply location-first with fallback:
- Primary query: `site:linkedin.com/in "[company]" "[role]" "[location]"`
- If 0 results → retry without location

Location is added as a plain string appended to the query (e.g., `"Austin TX"`). If location field is blank, skip the location clause entirely.

### 1.2 Per-persona contact finding — hybrid Serper strategy

**Problem:** A single broad query returns recruiter-heavy results. All 5 returned contacts end up classified as Recruiter.

**Fix — Option C hybrid:**

1. **Broad call** (1 Serper request, 10 results): `site:linkedin.com/in "[company]" "[role]" "[location]"`. Location-first with fallback. Classify each result into a persona bucket using title-keyword matching.
2. **Check coverage:** Compare returned persona buckets against the user's selected personas.
3. **Targeted fill-in** (1 Serper request per missing persona): For each selected persona not represented in broad results, fire: `site:linkedin.com/in "[company]" "[persona keyword]" "[location]"`. Location-first with fallback.
4. **Fallback:** If a targeted search still returns 0 results for a persona, fill that slot with an extra Recruiter or Peer contact from the broad results.
5. **Return:** Exactly N contacts — one per selected persona.

**Persona keyword map** (used in targeted queries and classification):

| Persona | Targeted query keyword | Title classification keywords |
|---|---|---|
| Recruiter | `recruiter OR "talent acquisition"` | recruiter, talent acquisition, recruiting |
| Hiring Manager | `"hiring manager"` | hiring manager |
| Peer Engineer | `engineer OR analyst OR scientist` | engineer, analyst, scientist, developer |
| Executive | `director OR "vice president" OR vp` | vp, vice president, director, president, ceo, cto, coo |
| UIUC Alumni | `"university of illinois" OR uiuc` | uiuc, illinois (in snippet/title) |
| Senior Engineer | `"senior engineer" OR "staff engineer" OR "principal"` | senior engineer, staff engineer, principal |

**API parameters (updated):**
```
company     — string (required)
role        — string
location    — string (optional, blank = no location filter)
personas    — string[] (selected persona names, default: ["Recruiter","Hiring Manager","Peer Engineer","UIUC Alumni"])
serperKey   — string (API key)
```

**Response shape** (unchanged per-contact, persona field added):
```json
{
  "id": "uuid",
  "name": "Jane Smith",
  "title": "Senior Recruiter",
  "company": "Acme Corp",
  "linkedinUrl": "https://linkedin.com/in/...",
  "type": "Recruiter",
  "personaSlot": "Recruiter",
  "uiuc": false
}
```

`personaSlot` is the persona this contact was selected to fill (may differ from `type` in fallback cases).

### 1.3 UI — Persona multiselect in Find Contacts tab

- Add a **persona multiselect dropdown** in the Find Contacts form, placed next to the Location field.
- Shows all 6 personas as checkboxes inside a dropdown.
- **Default checked:** Recruiter, Hiring Manager, Peer Engineer, UIUC Alumni.
- The number of selected personas determines N (contacts returned).
- Pass `location` and `personas` array to the API call.
- Contact cards display `personaSlot` badge (not re-classified client-side).

---

## 2. Follow-up System Overhaul (Bug 3)

### 2.1 Status model

**New status values** (replaces old Pending/Replied/Coffee Chat/No Response):

| Status | Meaning |
|---|---|
| `Sent` | Connection request sent, not yet accepted |
| `Accepted` | Connection request accepted, no reply yet |
| `Replied` | Contact replied to follow-up message |
| `Coffee Chat` | Meeting/call scheduled or happened |
| `Referral Secured` | Contact agreed to refer or has referred |

**Migration on load:** `Pending` → `Sent`, `No Response` → `Sent`.

**Status dropdown** in Networking Log: shows all 5 values in order above.

### 2.2 Follow-ups tab — who appears

Only contacts with status `Accepted` or `Replied` appear in Follow-ups. Contacts with `Sent` status (unaccepted) do NOT appear — you can't follow up with someone who hasn't accepted.

**Auto-surface rule** (checked client-side on load, no cron):
- Status = `Accepted` AND days since connection date ≥ 7
- Status = `Replied` AND days since `statusChangedAt` ≥ 7

Contacts not yet meeting the 7-day threshold are not shown in Follow-ups (they remain in the Networking Log only).

**`statusChangedAt` field:** Added to `netlog_meta` per contact. Set to current ISO timestamp whenever the status dropdown changes. Used to compute the 7-day window for `Replied` contacts. For existing contacts on migration, `statusChangedAt` defaults to the contact's `date` field.

### 2.3 Draft Follow-up button

- Each contact card in the Follow-ups tab gets a **"Draft Follow-up"** button.
- On click: calls `draftMessageWithGroq()` with `format="followup"` and the contact's stored name, title, company, role, and location.
- Draft renders inline below the card.
- Copy button copies draft to clipboard.
- Regenerate button replaces the draft (with optional direction input).
- One draft shown per contact at a time.

### 2.4 POC List tab (new 5th tab)

**Trigger:** Any contact whose status is set to `Referral Secured` in the Networking Log automatically appears here.

**Layout:**
- Grouped by company name.
- One "active POC" per company = most recently promoted to Referral Secured.
- If multiple Referral Secured contacts exist for the same company, all shown but the most recent is visually flagged as "Active POC".
- Each entry shows: name, title, company, LinkedIn link, date secured.
- Header displays goal: "Your Referral Network — one POC per company."

**No separate data store needed** — POC List is a filtered/grouped view of the existing netlog.

---

## 3. Files Changed

| File | Change |
|---|---|
| `api/find-contacts.js` | Accept `location` + `personas[]`; implement hybrid Serper strategy |
| `src/components/Networking.jsx` | Persona multiselect; pass location+personas to API; new status values; follow-up auto-surface logic; Draft Follow-up button + inline AI draft; new POC List tab |
| `src/lib/groq.js` | No changes needed — `draftMessageWithGroq` already supports `format="followup"` |

---

## 4. Out of Scope

- Backend cron for follow-up reminders (client-side display logic only)
- Persisting draft messages to Supabase
- Changing the LinkedIn DMs tab (separate system)
- Email notifications
