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
-- Step 1: Rename table
ALTER TABLE linkedin_dm_contacts RENAME TO contacts;

-- Step 2: Add outreach tracking columns
ALTER TABLE contacts
  ADD COLUMN source TEXT DEFAULT 'linkedin_import',
  ADD COLUMN outreach_sent BOOLEAN DEFAULT false,
  ADD COLUMN outreach_date DATE,
  ADD COLUMN outreach_status TEXT,
  ADD COLUMN outreach_status_changed_at TIMESTAMPTZ;

-- Step 3: Migrate netlog rows (upsert by id or linkedin_url)
-- source = 'manual' | 'find_contacts', outreach_sent = true

-- Step 4: Dissolve netlog_meta JSON → write status/statusChangedAt
--         into contacts.outreach_status / outreach_status_changed_at

-- Step 5: Update storage.js — replace all netlog + linkedin_dm_contacts
--         calls with unified contacts functions

-- Step 6: Retire netlog table + delete netlog_meta settings key
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
- `follow_up`, `follow_up_priority`, `follow_up_type`, `follow_up_reason`, `follow_up_guidance`
- `promise_made`, `promise_text`, `promise_status`
- `referral_secured`, `referral_discussed`
- `tone`, `two_way_conversation`, `total_exchanges`, `message_count`
- `last_contact`, `days_since`, `notes`, `tags`, `summary`, `crm_summary`, `next_action`

### 4.3 LinkedIn Sync — Zero Script Changes

The Python sync script already upserts by `id` into `linkedin_dm_contacts`. After table rename, it upserts into `contacts` — no script changes needed. New contacts discovered via sync get `source='linkedin_import'`, `outreach_sent=false` by default. If the sync detects the contact already exists via outreach, the outreach tracking fields (`outreach_sent`, `outreach_date`, `outreach_status`, `outreach_status_changed_at`, `source`) are preserved — the sync upsert only overwrites intelligence fields (persona, stage, strength, poc_score, follow_up, etc.).

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
| 🔴 Overdue Follow-ups | outreach_status in (Accepted, Replied) AND last contact ≥7d | **✓ I Followed Up** | `last_contact = today`, snooze 15d |
| 🟠 Promises Pending | `promise_made=true AND promise_status != 'kept'` | **✓ Promise Kept** | `promise_status = 'kept'` |
| ★ POC Candidates | `poc_score ≥7 AND is_confirmed_poc=false` | **★ Confirm as POC** | `is_confirmed_poc=true`, `outreach_status='Referral Secured'` |
| 🟢 New Connections | `outreach_status='Accepted' AND outreach_status_changed_at > now() - 7 days` | **✓ Message Sent** | `outreach_status='Replied'`, `last_contact=today` |
| 🔄 LinkedIn Sync | Always shown | **Run Sync** | Shows last run date + contacts updated |

**Dismiss behavior:** Every item also has "✕ Dismiss / Not Yet" which soft-hides for 7 days (stored in `localStorage`) and re-surfaces after.

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

## 8. App.jsx Changes

Remove:
- `networkingLog` state + `addToNetworkingLog` + `updateNetlogMeta` + `netlogMeta`
- `netlog_meta` read/write from settings
- Props passed to Dashboard and Networking for legacy netlog/meta

Add:
- `contacts` state loaded from unified `contacts` table
- `updateContact(id, fields)` function (replaces both netlogMeta updater and updateLinkedInContactFields)

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
