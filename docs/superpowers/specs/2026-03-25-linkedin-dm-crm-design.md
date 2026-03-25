# LinkedIn DM CRM Integration — Design Spec
**Date:** 2026-03-25
**Status:** Approved

## Overview

Integrate an existing LinkedIn DM CRM tool (which produces a `contacts_export.csv` from LinkedIn message exports) into the JobAgent Web application. The integration adds a third tab to the Networking page that shows all LinkedIn DM contacts with filtering, priority scoring, and inline note-editing.

## Components

### 1. Supabase Schema — `linkedin_dm_contacts` table

New table appended to `supabase_schema.sql`. Does **not** modify existing `contacts` or `netlog` tables.

```sql
create table if not exists linkedin_dm_contacts (
  id              text primary key,
  name            text,
  company         text,
  position        text,
  role_type       text,
  conv_status     text,
  last_contact    text,   -- ISO date string: YYYY-MM-DD
  days_since      integer,  -- stale after import; UI computes live from last_contact
  message_count   integer,
  follow_up       boolean default false,
  priority        integer,
  next_action     text,
  summary         text,
  notes           text,
  linkedin_url    text,
  email           text,
  source          text default 'linkedin_dm',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table linkedin_dm_contacts disable row level security;
```

**Delivered as:** SQL block appended to `supabase_schema.sql`. User runs it in the Supabase SQL editor.

### 2. Python Import Script — `linkedin_crm_import.py`

Standalone script at project root. Dependencies: `supabase` and `python-dotenv` (both via pip).

**Behavior:**
- CLI: `python linkedin_crm_import.py --csv <path>`
- Reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `.env.local`
- Reads each row from the CSV

**ID generation — collision-resistant slug:**
Slugify from `name` + `linkedin_url` to avoid silent overwrites when two contacts share the same name.
Algorithm:
1. Base slug: lowercase name, spaces → hyphens, strip non-alphanumeric/hyphen chars
2. If `linkedin_url` is non-empty: append a 4-char hex suffix derived from `hashlib.md5(linkedin_url.encode()).hexdigest()[:4]`
3. Example: `"John Smith"` + `"linkedin.com/in/johnsmith"` → `"john-smith-a3f2"`
4. If `linkedin_url` is empty: use base slug only (acceptable; LinkedIn profile URL is strongly recommended)

**CSV column → DB column mapping:**

| CSV Column | DB Column | Transform |
|---|---|---|
| `Name` | `name` | as-is |
| `Company` | `company` | as-is |
| `Position / Title` | `position` | as-is |
| `Role Type` | `role_type` | as-is |
| `Conversation Status` | `conv_status` | normalize (see below) |
| `Last Contact Date` | `last_contact` | as-is (expected YYYY-MM-DD) |
| `Days Since Contact` | `days_since` | `int(val)` if non-empty else None |
| `Message Count` | `message_count` | `int(val)` if non-empty else None |
| `Follow-Up Needed` | `follow_up` | `val.strip().lower() == 'yes'` |
| `Priority Score (1-10)` | `priority` | `int(val)` if non-empty else None |
| `Next Action` | `next_action` | as-is |
| `Conversation Summary` | `summary` | as-is |
| `Notes` | `notes` | as-is |
| `LinkedIn Profile URL` | `linkedin_url` | as-is |
| `Email` | `email` | as-is |

**`conv_status` normalization** — the CRM tool may produce slightly different strings. Normalize to these canonical values before inserting:

| Raw CRM value (case-insensitive match) | Canonical DB value |
|---|---|
| contains "active" or "opportunity" | `Opportunity Active` |
| contains "follow" | `Follow-Up Needed` |
| contains "await" or "waiting" | `Awaiting Reply` |
| contains "replied" or "responded" | `Replied` |
| contains "cold" or "no action" or empty | `Cold / No Action` |

- Upserts all rows into `linkedin_dm_contacts` using `on_conflict=id`
- Prints: `"Imported X contacts. Y follow-ups. Z active opportunities."`

### 3. Storage Layer — `src/lib/storage.js` additions

Four new async functions appended at the bottom of `storage.js`. All follow the existing pattern (throw on error, return data directly).

**`fetchLinkedInContacts()`**
```js
SELECT * FROM linkedin_dm_contacts ORDER BY priority DESC, last_contact DESC
```
Returns all rows as-is (snake_case; UI reads them directly without hydration).

**`fetchLinkedInFollowups()`**
```js
SELECT * FROM linkedin_dm_contacts WHERE follow_up = true ORDER BY priority DESC
```

**`upsertLinkedInContact(contact)`**
Upserts a single row. The `contact` object uses **snake_case** (matching what `fetchLinkedInContacts` returns — no hydration layer needed). Explicit field mapping:

```js
const row = {
  id: contact.id,
  name: contact.name,
  company: contact.company,
  position: contact.position,
  role_type: contact.role_type,
  conv_status: contact.conv_status,
  last_contact: contact.last_contact,
  days_since: contact.days_since,
  message_count: contact.message_count,
  follow_up: contact.follow_up,
  priority: contact.priority,
  next_action: contact.next_action,
  summary: contact.summary,
  notes: contact.notes,
  linkedin_url: contact.linkedin_url,
  email: contact.email,
  updated_at: new Date().toISOString(),
};
```

**`updateLinkedInContactNotes(id, notes)`**
Updates notes and explicitly sets `updated_at` (no DB trigger; application layer is responsible):
```js
{ notes, updated_at: new Date().toISOString() }
```
`.eq('id', id)` WHERE clause.

### 4. Networking.jsx — "LinkedIn DMs" third tab

**Tab bar change:** Add `"LinkedIn DMs"` as a third `Chip` alongside the existing two chips. Tab state value: `"dms"`. The existing header row uses `flexWrap: "wrap"` to accommodate a third chip without overflow on narrow viewports.

**New `tab === "dms"` view:**

#### a) State
- `dmContacts` (array, default `[]`)
- `dmLoading` (bool, default `false`)
- `dmError` (string, default `""`)
- `roleFilter` (string, default `"All"`)
- `statusFilter` (string, default `"All"`)
- `showFollowupOnly` (bool, default `false`)
- `expandedSummaries` (Set of ids, stored as `useState(new Set())`)
- `editedNotes` (object, id → string, default `{}`)
- `dmLoaded` — **use `useRef(false)`** (not useState). Data is import-driven and not expected to change during a session. A remount (navigating away and back) should NOT re-fetch. To force a refresh, the user re-runs the import script.
- Fetch guard: in a `useEffect` on `[tab]`, if `tab === 'dms' && !dmLoaded.current` then fetch and set `dmLoaded.current = true`.

**Notes textarea behavior:**
- Each textarea reads from `editedNotes[contact.id] ?? contact.notes`
- `onChange` updates `editedNotes` state (controlled input)
- `onBlur` calls `updateLinkedInContactNotes(id, editedNotes[id])` if value differs from `contact.notes`
- On re-fetch (if ever triggered), `editedNotes` is cleared to avoid stale overrides

#### b) Stats row (4 stat chips, rendered as styled divs not interactive Chip buttons)
| Stat | Count source | Color |
|------|-------------|-------|
| Total contacts | `dmContacts.length` | neutral (`t.card` bg, `t.tx` text) |
| Follow-ups needed | `follow_up === true` | orange (`t.yellowL` bg, `t.yellow` text) |
| Active opportunities | `conv_status === 'Opportunity Active'` | green (`t.greenL` bg, `t.green` text) |
| Recruiters | `role_type === 'Recruiter'` | blue (`t.priL` bg, `t.pri` text) |

Rendered as a flex row with gap, `borderRadius: 10`, `padding: "8px 16px"`.

#### c) Filter bar (3 dropdowns using `sel` style from `ContactDraftSection`)
- **Role Type:** All | Recruiter | Hiring Manager | Executive | Referral Contact | Alumni | Peer Engineer | Unknown
- **Status:** All | Opportunity Active | Follow-Up Needed | Awaiting Reply | Replied | Cold / No Action
- **Show:** All Contacts | Follow-Up Only (maps to `showFollowupOnly` bool)

Filtered list computed from `dmContacts`:
```js
dmContacts
  .filter(c => roleFilter === 'All' || c.role_type === roleFilter)
  .filter(c => statusFilter === 'All' || c.conv_status === statusFilter)
  .filter(c => !showFollowupOnly || c.follow_up === true)
```

#### d) Contact cards

Each uses the existing `Card` component with a conditional left orange border when `follow_up === true`:
```js
style={{ borderLeft: c.follow_up ? '4px solid #ea580c' : undefined }}
```

Structure per card:
- **Header row:** `Avatar` (name, size=42) + name as `<a>` link if `linkedin_url` present + 🔔 if `follow_up` + role type badge + status badge + priority pill (right-aligned via `marginLeft: 'auto'`)
- **Subtitle:** `{company} · {position}` in `t.muted` color, `fontSize: 13`
- **Days since:** computed live from `last_contact` (stored as `YYYY-MM-DD`):
  ```js
  const days = last_contact
    ? Math.floor((Date.now() - new Date(last_contact)) / 86400000)
    : null;
  ```
  Displayed as `"{days} days ago"` in `t.muted`, `fontSize: 12`. Falls back to stored `days_since` if `last_contact` is empty.
- **Next Action box:** if `next_action` is non-empty, show in a `div` with `background: t.hover, borderRadius: 6, padding: "5px 10px", fontSize: 12, color: t.sub`
- **Expandable summary:** `<button>` toggles `expandedSummaries` Set. Shows "Show summary ▾" / "Hide summary ▴". Content in a `div` with `fontSize: 12.5, color: t.sub, marginTop: 6`
- **Notes textarea:** `rows={2}`, `placeholder="Add notes..."`, reads `editedNotes[c.id] ?? c.notes ?? ''`

**Badge colors:**
- Role Type:
  - Recruiter: `t.priL` bg, `t.pri` text
  - Hiring Manager: `#fee2e2` bg, `#dc2626` text
  - Executive: `#ede9fe` bg, `#7c3aed` text
  - Referral Contact: `#ffedd5` bg, `#ea580c` text
  - Alumni: `#ccfbf1` bg, `#0d9488` text
  - Peer Engineer: `t.greenL` bg, `t.green` text
  - Unknown / default: `t.hover` bg, `t.muted` text

- Conv Status:
  - Opportunity Active: `t.greenL` bg, `t.green` text
  - Follow-Up Needed: `t.yellowL` bg, `t.yellow` text
  - Awaiting Reply: `t.priL` bg, `t.pri` text
  - Replied / Cold / No Action / default: `t.hover` bg, `t.muted` text

- Priority pill (right side, `fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 10`):
  - ≥8: `#fee2e2` bg, `#dc2626` text
  - ≥6: `#ffedd5` bg, `#ea580c` text
  - ≥4: `t.yellowL` bg, `t.yellow` text
  - <4 or null: `t.hover` bg, `t.muted` text

#### e) Empty state
If `dmContacts.length === 0` and not loading, show centered `Card` with `Users` icon (already imported) and:
```
No LinkedIn DM contacts yet.
Run the import script to get started:

  python linkedin_crm_import.py --csv ~/Desktop/linkedin-crm/output/contacts_export.csv
```
Code snippet in a `<code>` block styled with `background: t.hover, borderRadius: 6, padding: "8px 12px", fontSize: 12, fontFamily: "monospace"`.

#### f) Loading and error states
- Loading: same dot-spinner pattern used in Find Contacts (3 animated dots)
- Error: `<div style={{color: t.red, fontSize: 13, fontWeight: 600}}>` same as existing `err` display

### 5. README.md

Create (or append to) `README.md` at the project root. If the file exists, append to it. Add a `## LinkedIn DM CRM Integration` section covering:
1. How to export LinkedIn data: Settings → Data privacy → Get a copy of your data → select Messages
2. Running the LinkedIn CRM tool to produce `contacts_export.csv`
3. Running `linkedin_crm_import.py --csv <path>` to push data to Supabase
4. Finding it in the UI: Networking → LinkedIn DMs tab
5. Re-syncing: re-run the import after each new LinkedIn export

## Data Flow

```
LinkedIn export (.zip)
  → linkedin-crm tool (~/Desktop/linkedin-crm/)
    → contacts_export.csv
      → linkedin_crm_import.py --csv <path>
        → normalizes conv_status values
        → generates collision-resistant id slugs
        → upserts to Supabase: linkedin_dm_contacts
          → fetchLinkedInContacts() in storage.js
            → Networking.jsx LinkedIn DMs tab
              → live days-since computed from last_contact
              → notes saved via updateLinkedInContactNotes()
```

## Constraints

- No new npm packages
- No modifications to `contacts`, `netlog` tables
- No changes to existing Find Contacts or Networking Log functionality
- Inline styles only, using `t` theme object
- `.env.local` for Supabase credentials in Python script
- `upsertLinkedInContact` uses snake_case keys (no camelCase hydration layer)
- `dmLoaded` uses `useRef` (not useState); no re-fetch on remount
- `updated_at` set explicitly by application layer (no DB trigger)

## Files Changed

| File | Change |
|------|--------|
| `supabase_schema.sql` | Append new table + RLS disable |
| `linkedin_crm_import.py` | New file at project root |
| `src/lib/storage.js` | Append 4 new functions |
| `src/components/Networking.jsx` | Add 3rd tab chip + LinkedIn DMs view |
| `README.md` | Create or append LinkedIn DM CRM Integration section |
