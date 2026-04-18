# Networking Section Redesign — Design Spec

**Date:** 2026-04-18  
**Status:** Approved  
**Scope:** Full redesign of Networking page — navigation, data model, UI components

---

## 1. Problem Statement

The current Networking section has 5 tabs (Find Contacts, Networking Log, LinkedIn DMs, Follow-ups, POC List) backed by two completely separate contact stores (`netlog` + `linkedin_dm_contacts`) with no unification. Status metadata is stored as a JSON blob in the `settings` table (`netlog_meta`). The 1400-line monolithic `Networking.jsx` handles all 5 tabs.

Core failures:
- No canonical contact record — the same person can exist in both stores with no link
- `netlog_meta` as JSON blob is fragile, unqueryable, and breaks at scale
- Follow-ups and POC List are passive filtered views masquerading as tabs
- LinkedIn DMs is treated as a separate product rather than an auto-sync pipeline
- No daily action queue — users must manually hunt for overdue items across tabs

---

## 2. Design Decisions

| Question | Decision |
|---|---|
| Primary job of Networking page | All three modes: Find new contacts, manage existing network, act on today's queue |
| Contact unification | One unified `contacts` table — Approach 1: promote `linkedin_dm_contacts` |
| LinkedIn DMs role | Auto-sync pipeline, not a tab. Runs externally, upserts into `contacts` |
| Navigation | 3 tabs: **Find Contacts** · **My Network** · **Actions** |
| Contacts view layout | Gmail-style: compact list (left) + slide-out detail panel (right) |
| Actions tab contents | Overdue follow-ups, pending promises, POC candidates, new connections, sync status |
| Completion tracking | Every action item has a dedicated "I did it" button that records the action and removes the item from the queue |

---

## 3. Navigation Structure

```
Networking
├── Find Contacts          (contact discovery for target company)
├── My Network             (unified CRM — all contacts, split panel)
└── Actions                (daily queue — badge shows pending count)
```

**Retired tabs:** Networking Log, LinkedIn DMs, Follow-ups, POC List  
**LinkedIn DMs** becomes a background sync panel inside the Actions tab.

---

## 4. Data Model

### 4.1 Migration Strategy (Approach 1)

Promote `linkedin_dm_contacts` → `contacts`. Add 5 outreach-tracking columns from `netlog`/`netlog_meta`. Retire both legacy tables.

```sql
-- Step 0: Drop legacy search-cache `contacts` table (unused — no storage.js references,
--         data was cached in React state only). Verify before running:
--         SELECT count(*) FROM contacts;  -- expect 0 or stale search results
DROP TABLE IF EXISTS contacts CASCADE;

-- Step 1: Rename table (now safe — no collision)
ALTER TABLE linkedin_dm_contacts RENAME TO contacts;

-- Step 2: Add outreach tracking columns + snooze field
ALTER TABLE contacts
  ADD COLUMN source TEXT DEFAULT 'linkedin_import',
  ADD COLUMN outreach_sent BOOLEAN DEFAULT false,
  ADD COLUMN outreach_date DATE,
  ADD COLUMN outreach_status TEXT,
  ADD COLUMN outreach_status_changed_at TIMESTAMPTZ,
  ADD COLUMN follow_up_snoozed_until DATE;  -- replaces localStorage snooze

-- Step 3: Migrate netlog rows with explicit dedupe order:
--   a) Try exact ID match → update outreach fields on existing contact
--   b) Try linkedin_url match (case-insensitive) → merge outreach fields in
--   c) No match → INSERT as new contact (source='manual', outreach_sent=true)
--   Note: manual-${Date.now()} IDs will always fall through to (c) — that is correct.
--   Note: normalize outreach_date with TRY_CAST — locale strings ('4/18/2026') must
--         be parsed via application-layer migration script (not raw SQL CAST) since
--         toLocaleDateString() format varies by browser locale. Migration script should
--         use JS Date.parse() or Python dateutil.parser.parse() with fallback to NULL.

-- Step 4: Dissolve netlog_meta JSON from settings table:
--   Read settings WHERE key LIKE '%:netlog_meta', parse JSON,
--   for each {contactId: {status, statusChangedAt}} entry:
--     UPDATE contacts SET
--       outreach_status = entry.status,
--       outreach_status_changed_at = entry.statusChangedAt::timestamptz
--     WHERE id = contactId OR (outreach_sent = true AND id = contactId);
--   Corrupt/unparseable entries → default outreach_status = 'Sent'

-- Step 5: Update storage.js + Python scripts (see sections 7 and 4.3)

-- Step 6: Retire legacy tables after verifying row counts match
DROP TABLE IF EXISTS netlog;
DELETE FROM settings WHERE key LIKE '%:netlog_meta';
```

### 4.2 Unified `contacts` Schema

**Identity fields** (from both sources):
- `id`, `user_id`, `name`, `company`, `position`, `linkedin_url`, `email`

**Outreach tracking** (new — from netlog/netlog_meta):
- `source` — `linkedin_import | find_contacts | manual`
- `outreach_sent` — boolean
- `outreach_date` — date connection request was sent
- `outreach_status` — `Sent | Accepted | Replied | Coffee Chat | Referral Secured | Cold`
- `outreach_status_changed_at` — timestamp of last status change

**Intelligence fields** (preserved from linkedin_dm_contacts):
- `persona`, `conversation_stage`, `relationship_strength`
- `poc_score`, `is_poc_candidate`, `is_confirmed_poc`
- `follow_up`, `follow_up_priority`, `follow_up_type`, `follow_up_reason`, `follow_up_guidance`, `follow_up_snoozed_until`
- `promise_made`, `promise_text`, `promise_status`
- `referral_secured`, `referral_discussed`
- `tone`, `two_way_conversation`, `total_exchanges`, `message_count`
- `last_contact`, `days_since`, `notes`, `tags`, `summary`, `crm_summary`, `next_action`

### 4.3 LinkedIn Sync — Script Changes Required (3 scripts, ~3 lines each)

All three Python scripts hardcode `linkedin_dm_contacts` and need the table name updated to `contacts`. Additionally, two scripts have a broken user_id contract that must be fixed before RLS on the new table blocks their writes.

**Required changes per script:**

| Script | Table name change | user_id fix |
|---|---|---|
| `linkedin_crm_import.py:115` | `'linkedin_dm_contacts'` → `'contacts'` | None needed (already sets user_id) |
| `linkedin_messages_import.py:177` | `'linkedin_dm_contacts'` → `'contacts'` | Must add `user_id` to each row before upsert — accept as CLI arg or read from env var `JOBAGENT_USER_ID` |
| `linkedin_intelligence_v2.py:959,962` | `'linkedin_dm_contacts'` → `'contacts'` | Replace hardcoded UUID with `os.environ['JOBAGENT_USER_ID']` — fail loudly if unset |

**Import contract going forward:**
- Scripts receive `JOBAGENT_USER_ID` from environment (set once in shell profile / `.env`)
- Scripts upsert by `id` — intelligence fields are overwritten, outreach tracking fields (`outreach_sent`, `outreach_date`, `outreach_status`, `outreach_status_changed_at`, `source`) are preserved via upsert column exclusion or a `DO UPDATE SET` that skips those columns
- New contacts from sync get `source='linkedin_import'`, `outreach_sent=false` by default

---

## 5. Component Structure

```
src/components/Networking.jsx          (thin shell — tab state only)
src/components/networking/
  FindTab.jsx                          (contact discovery)
    ContactSearchForm.jsx
    ContactResultCard.jsx              (includes draft section)
  NetworkTab.jsx                       (My Network — split panel)
    ContactList.jsx                    (left panel — filterable list)
    ContactPanel.jsx                   (right panel — full detail)
  ActionsTab.jsx                       (daily queue)
    OverdueSection.jsx
    PromisesSection.jsx
    PocCandidatesSection.jsx
    NewConnectionsSection.jsx
    LinkedInSyncPanel.jsx
  shared/
    ContactDraftSection.jsx            (reused in Find + ContactPanel)
    StatusBadge.jsx
    Avatar.jsx
```

---

## 6. Tab Designs

### 6.1 Find Contacts

Unchanged from current, with one key behavior change:
- "Connection Sent" button → **"Add to Network"**
- Clicking upserts the contact into `contacts` with `outreach_sent=true`, `source='find_contacts'`, `outreach_status='Sent'`
- Contacts already in `contacts` show **"Already Added"** (disabled state)

### 6.2 My Network (Split Panel)

**Left panel:**
- Filter chips: All · Follow-up `n` · POC `n` · Accepted · (status filters)
- Search bar (name, company, persona)
- Compact contact rows — sorted by urgency (overdue first, then by last_contact desc)
- Left border color signals urgency: red = urgent, pink = POC, green = strong rapport, yellow = follow-up
- Click row → opens right panel

**Right panel (ContactPanel):**
- Name, title, company, LinkedIn link
- Outreach status selector (inline editable)
- Badge row: stage · strength · POC indicator · days since last contact
- Intelligence stats: POC score · message count · last contact
- Promise alert (if active)
- Notes textarea (auto-save on blur)
- "✨ Draft Follow-up Message" button → expands ContactDraftSection

### 6.3 Actions Tab

Sectioned daily queue. Badge on tab shows total pending count.

| Section | Trigger | Completion Button | What It Records |
|---|---|---|---|
| 🔴 Overdue Follow-ups | `outreach_status IN ('Accepted','Replied') AND (follow_up_snoozed_until IS NULL OR follow_up_snoozed_until < today) AND last_contact < today - 7` | **✓ I Followed Up** | `follow_up_snoozed_until = today + 15`, `last_contact` NOT touched |
| 🟠 Promises Pending | `promise_made=true AND promise_status != 'kept'` | **✓ Promise Kept** | `promise_status = 'kept'` |
| ★ POC Candidates | `poc_score ≥7 AND is_confirmed_poc=false` | **★ Confirm as POC** | `is_confirmed_poc=true`, `outreach_status='Referral Secured'` |
| 🟢 New Connections | `outreach_status='Accepted' AND outreach_status_changed_at > now() - 7 days` | **✓ Message Sent** | `outreach_status='Replied'`, `last_contact=today` |
| 🔄 LinkedIn Sync | Always shown | **Run Sync** | Shows last run date + contacts updated |

**Dismiss behavior:** Every item has "✕ Dismiss / Not Yet" which sets `follow_up_snoozed_until = today + 7` in the database (not localStorage — so it persists across devices and sessions).

---

## 7. storage.js Changes

Replace all `netlog` and `linkedin_dm_contacts` calls with unified `contacts` functions:

```js
// New unified functions replacing both legacy sets
fetchContacts()           // replaces fetchNetlog() + fetchLinkedInContacts()
upsertContact(contact)    // replaces upsertNetlog() + upsertLinkedInContact()
updateContactFields(id, updates)   // replaces updateLinkedInContactFields()
updateContactNotes(id, notes)      // replaces updateLinkedInContactNotes()
fetchContactStats(contacts)        // replaces fetchLinkedInStats()
```

`netlog_meta` JSON blob in `settings` is fully replaced by `outreach_status` + `outreach_status_changed_at` columns on `contacts`. No more JSON blob reads/writes in App.jsx.

---

## 8. Files Requiring Changes

### App.jsx
Remove:
- `networkingLog` state + `addToNetworkingLog` + `updateNetlogMeta` + `netlogMeta`
- `netlog_meta` read/write from settings
- Props passed to Dashboard, Networking, Applied for legacy netlog/meta
- Nav badge at `App.jsx:480` that counts `networkingLog.length`

Add:
- `contacts` state loaded from unified `contacts` table via `fetchContacts()`
- `updateContact(id, fields)` function (replaces both netlogMeta updater and updateLinkedInContactFields)
- Nav badge updated to count `contacts.filter(c => c.outreach_sent).length`

### Dashboard.jsx
- Replace `networkingLog` + `netlogMeta` props with `contacts` (unified array)
- `totalNetworked` → `contacts.filter(c => c.outreach_sent).length`
- `overdueFollowUps` → computed from contacts using the same trigger logic as Actions tab
- Spark data (`buildSparkData`) → use `contacts` filtered by `outreach_date`

### dashboard-utils.js
- `calcStreak(apps, networkingLog)` → `calcStreak(apps, contacts)` — use `outreach_date` field instead of `c.date`

### Applied.jsx
- Replace `networkingLog` prop with `contacts` filtered to `outreach_sent=true`
- Count and list rendering unchanged — just swap the data source

### Networking.jsx (the monolith — fully replaced)
- Deleted and replaced by the new component tree in `src/components/networking/`

---

## 9. Kill List

| What | Action |
|---|---|
| `Networking Log` tab | Removed — content merged into My Network |
| `LinkedIn DMs` tab | Removed — becomes background sync in Actions tab |
| `Follow-ups` tab | Removed — becomes filter chip + section in Actions tab |
| `POC List` tab | Removed — becomes filter chip in My Network + section in Actions tab |
| `netlog` table | Retired after migration |
| `netlog_meta` JSON in settings | Dissolved into contacts columns |
| Monolithic 1400-line `Networking.jsx` | Split into 10 focused components |

---

## 10. Risk Areas

| Risk | Mitigation |
|---|---|
| netlog contacts without a linkedin_dm_contacts match | Upsert by `id`, fallback match on `linkedin_url` — unmatched contacts still get created with minimal fields |
| netlog_meta JSON parse failure | Run migration with null-safe fallback; corrupt entries default to `outreach_status='Sent'` |
| LinkedIn sync script breaks after rename | Verify script references table name directly — if using Supabase client, the table name string just changes |
| Dashboard still references netlogMeta props | Update Dashboard.jsx props simultaneously with App.jsx refactor |
| Contact IDs collision between netlog and linkedin_dm_contacts | netlog IDs are UUIDs; linkedin_dm_contacts IDs are also strings — validate uniqueness before migration |

---

## 11. Implementation Order

### P0 — Foundation (do first, nothing else works without this)
1. Supabase migration: rename table + add columns
2. Migrate netlog rows + dissolve netlog_meta into contacts columns
3. Update `storage.js` with unified contacts functions
4. Update `App.jsx` — remove legacy state, add `contacts` state

### P1 — Core UI
5. Build `NetworkTab.jsx` with split panel (ContactList + ContactPanel)
6. Build `ActionsTab.jsx` with all 5 sections + completion buttons
7. Update `FindTab.jsx` — "Add to Network" behavior

### P2 — Polish
8. Actions tab badge count (live count from contacts state)
9. Sort logic in ContactList (urgency-first)
10. Soft-dismiss localStorage persistence

### P3 — Cleanup
11. Delete legacy `netlog` table migration
12. Remove all legacy props from Dashboard.jsx
13. Delete `netlog_meta` settings key
