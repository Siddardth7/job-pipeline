# Networking Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Networking section from a 5-tab monolith into a 3-tab system (Find Contacts / My Network / Actions) backed by a single unified `contacts` table, replacing the fragmented `netlog` + `linkedin_dm_contacts` + `netlog_meta` JSON blob.

**Architecture:** Promote `linkedin_dm_contacts` to `contacts` (rename + add 5 outreach columns + snooze field). Migrate `netlog` rows and dissolve `netlog_meta` JSON into proper columns. Split the 1400-line `Networking.jsx` into 10 focused components under `src/components/networking/`. Update `App.jsx`, `Dashboard.jsx`, `Applied.jsx`, and `dashboard-utils.js` to consume the unified `contacts` state.

**Tech Stack:** React 18, Supabase JS v2, Vite, Vitest, Lucide React icons. No new dependencies required except `@testing-library/react` + `jsdom` for component tests.

---

## ⚠️ GATE: P0 Must Deploy Before P1 UI Work Goes to Production

Tasks 1–4 are the data foundation. The UI work (Tasks 5–15) can be developed locally against the renamed table, but **do not merge the UI to main until the Supabase migration has been applied to production**.

---

## File Map

**New files to create:**
```
src/components/networking/
  FindTab.jsx
  NetworkTab.jsx
  ActionsTab.jsx
  shared/ContactDraftSection.jsx
  shared/Avatar.jsx
  shared/StatusBadge.jsx
src/components/networking/panels/
  ContactList.jsx
  ContactPanel.jsx
src/components/networking/actions/
  OverdueSection.jsx
  PromisesSection.jsx
  PocCandidatesSection.jsx
  NewConnectionsSection.jsx
  LinkedInSyncPanel.jsx
supabase_migration_networking_unify.sql
scripts/migrate-netlog-data.js
src/tests/storage-contacts.test.js
```

**Files to modify:**
```
src/lib/storage.js          — add fetchContacts, upsertContact, updateContactFields, updateContactNotes, fetchContactStats
src/App.jsx                 — replace networkingLog/netlogMeta state with contacts state
src/components/Networking.jsx  — replace body with thin 3-tab shell
src/components/Dashboard.jsx   — swap networkingLog+netlogMeta props for contacts
src/lib/dashboard-utils.js     — update calcStreak to use outreach_date
src/components/Applied.jsx     — swap networkingLog prop for contacts
linkedin_crm_import.py      — update table name
linkedin_messages_import.py — update table name + add user_id from env
linkedin_intelligence_v2.py — update table name + read user_id from env
```

---

## Task 1: Install test dependencies and configure Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.js`
- Create: `src/tests/setup.js`

- [ ] **Step 1: Install testing dependencies**

```bash
npm install --save-dev @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 2: Create vitest config**

Create `vitest.config.js`:
```js
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.js'],
    globals: true,
  },
});
```

- [ ] **Step 3: Create test setup file**

Create `src/tests/setup.js`:
```js
import '@testing-library/jest-dom';
```

- [ ] **Step 4: Verify vitest runs**

```bash
npm test
```
Expected: `No test files found, exiting with code 1` (or 0 — either is fine, no crash)

- [ ] **Step 5: Commit**

```bash
git add vitest.config.js src/tests/setup.js package.json package-lock.json
git commit -m "test: configure vitest with jsdom and testing-library"
```

---

## Task 2: Write Supabase migration SQL

**Files:**
- Create: `supabase_migration_networking_unify.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase_migration_networking_unify.sql`:
```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Networking Unification Migration
-- Promotes linkedin_dm_contacts → contacts (canonical unified table)
-- Adds outreach tracking + snooze field
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 0: Drop legacy search-cache contacts table (no storage.js references, safe)
-- Run this check first: SELECT count(*) FROM contacts;
-- If > 0, verify those are stale search results before dropping.
DROP TABLE IF EXISTS contacts CASCADE;

-- Step 1: Rename linkedin_dm_contacts → contacts
ALTER TABLE linkedin_dm_contacts RENAME TO contacts;

-- Step 2: Add outreach tracking + snooze columns
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'linkedin_import',
  ADD COLUMN IF NOT EXISTS outreach_sent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS outreach_date DATE,
  ADD COLUMN IF NOT EXISTS outreach_status TEXT,
  ADD COLUMN IF NOT EXISTS outreach_status_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS follow_up_snoozed_until DATE;

-- Step 3: Update RLS policy name (table renamed, policy references old name)
DROP POLICY IF EXISTS "user_owns_linkedin_contacts" ON contacts;
CREATE POLICY "user_owns_contacts" ON contacts
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Step 4: Rename existing indexes (optional — postgres renames them automatically
--         on table rename, but update for clarity)
-- No action needed — Postgres carries indexes through RENAME.

-- Step 5: Migrate netlog rows into contacts
-- This step is handled by scripts/migrate-netlog-data.js (see Task 3)
-- The SQL stub below is for reference only:
-- INSERT INTO contacts (id, user_id, name, company, position, linkedin_url, email,
--   source, outreach_sent, outreach_date, outreach_status)
-- SELECT id, user_id, name, company, role, linkedin_url, email,
--   'manual', true, NULL, 'Sent'
-- FROM netlog
-- ON CONFLICT (id) DO UPDATE SET
--   outreach_sent = true,
--   source = EXCLUDED.source;
```

- [ ] **Step 2: Apply migration in Supabase dashboard**

Go to Supabase → SQL Editor → paste and run `supabase_migration_networking_unify.sql`.

Verify success:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'contacts' AND column_name IN
  ('source','outreach_sent','outreach_date','outreach_status',
   'outreach_status_changed_at','follow_up_snoozed_until');
-- Should return 6 rows
```

- [ ] **Step 3: Commit**

```bash
git add supabase_migration_networking_unify.sql
git commit -m "chore: add supabase migration to unify contacts table"
```

---

## Task 3: Write netlog data migration script

**Files:**
- Create: `scripts/migrate-netlog-data.js`

- [ ] **Step 1: Create migration script**

Create `scripts/migrate-netlog-data.js`:
```js
// Run once: node scripts/migrate-netlog-data.js
// Migrates netlog rows + netlog_meta JSON into unified contacts table
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY  // needs service role to bypass RLS
);

const USER_ID = process.env.JOBAGENT_USER_ID;
if (!USER_ID) throw new Error('JOBAGENT_USER_ID env var required');

async function parseOutreachDate(raw) {
  if (!raw) return null;
  // Handle locale strings like "4/18/2026" or "18/4/2026"
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return null;
}

async function run() {
  // 1. Fetch all netlog rows
  const { data: netlogs, error: netErr } = await supabase
    .from('netlog').select('*').eq('user_id', USER_ID);
  if (netErr) throw netErr;
  console.log(`Found ${netlogs.length} netlog rows`);

  // 2. Fetch netlog_meta from settings
  const { data: metaRow } = await supabase
    .from('settings').select('value')
    .eq('key', `${USER_ID}:netlog_meta`).maybeSingle();
  let metaMap = {};
  try { metaMap = JSON.parse(metaRow?.value || '{}'); } catch { /* corrupt — ignore */ }
  console.log(`Found ${Object.keys(metaMap).length} netlog_meta entries`);

  // 3. Upsert netlog rows into contacts
  for (const row of netlogs) {
    const meta = metaMap[row.id] || {};
    const outreachDate = await parseOutreachDate(row.date);

    const contact = {
      id: row.id,
      user_id: USER_ID,
      name: row.name,
      company: row.company,
      position: row.role || null,
      linkedin_url: row.linkedin_url || null,
      email: row.email !== 'NA' ? row.email : null,
      source: row.id.startsWith('manual-') ? 'manual' : 'find_contacts',
      outreach_sent: true,
      outreach_date: outreachDate,
      outreach_status: meta.status || 'Sent',
      outreach_status_changed_at: meta.statusChangedAt || null,
    };

    const { error } = await supabase
      .from('contacts')
      .upsert(contact, { onConflict: 'id', ignoreDuplicates: false });

    if (error) {
      // Try linkedin_url match as fallback
      if (row.linkedin_url) {
        const { data: existing } = await supabase
          .from('contacts').select('id')
          .eq('linkedin_url', row.linkedin_url).eq('user_id', USER_ID).maybeSingle();
        if (existing) {
          await supabase.from('contacts')
            .update({ outreach_sent: true, outreach_date: outreachDate,
                      outreach_status: contact.outreach_status,
                      outreach_status_changed_at: contact.outreach_status_changed_at })
            .eq('id', existing.id);
          console.log(`  Merged via linkedin_url: ${row.name}`);
          continue;
        }
      }
      console.error(`  Failed to migrate ${row.name} (${row.id}):`, error.message);
    } else {
      console.log(`  Migrated: ${row.name}`);
    }
  }

  console.log('Migration complete. Verify counts:');
  const { count } = await supabase.from('contacts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', USER_ID).eq('outreach_sent', true);
  console.log(`  contacts with outreach_sent=true: ${count} (expected ~${netlogs.length})`);
}

run().catch(console.error);
```

- [ ] **Step 2: Run the migration (dry run first — check output only)**

```bash
JOBAGENT_USER_ID=your-user-id \
VITE_SUPABASE_URL=your-url \
SUPABASE_SERVICE_ROLE_KEY=your-service-key \
node scripts/migrate-netlog-data.js
```

Expected: each netlog row printed as "Migrated: [name]", final count matches netlog row count.

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-netlog-data.js
git commit -m "chore: add netlog → contacts data migration script"
```

---

## Task 4: Add unified contacts functions to storage.js

**Files:**
- Modify: `src/lib/storage.js`
- Create: `src/tests/storage-contacts.test.js`

- [ ] **Step 1: Write failing tests**

Create `src/tests/storage-contacts.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase module
vi.mock('../supabase.js', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  },
}));

import { supabase } from '../supabase.js';
import {
  fetchContacts,
  upsertContact,
  updateContactFields,
  updateContactNotes,
} from '../lib/storage.js';

const MOCK_USER_ID = 'test-user-123';
const mockUser = () =>
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: MOCK_USER_ID } } });

const mockChain = (returnVal) => {
  const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), update: vi.fn(),
                  upsert: vi.fn(), maybeSingle: vi.fn() };
  Object.values(chain).forEach(fn => fn.mockReturnValue(chain));
  chain.order.mockResolvedValue(returnVal);
  chain.upsert.mockResolvedValue({ error: null });
  chain.update.mockResolvedValue({ error: null });
  return chain;
};

beforeEach(() => { vi.clearAllMocks(); mockUser(); });

describe('fetchContacts', () => {
  it('queries contacts table filtered by user_id ordered by priority desc', async () => {
    const chain = mockChain({ data: [], error: null });
    supabase.from.mockReturnValue(chain);
    await fetchContacts();
    expect(supabase.from).toHaveBeenCalledWith('contacts');
    expect(chain.eq).toHaveBeenCalledWith('user_id', MOCK_USER_ID);
  });
});

describe('upsertContact', () => {
  it('upserts with user_id and onConflict id', async () => {
    const chain = mockChain({ error: null });
    supabase.from.mockReturnValue(chain);
    await upsertContact({ id: 'abc', name: 'Jane', outreach_sent: true });
    expect(supabase.from).toHaveBeenCalledWith('contacts');
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'abc', user_id: MOCK_USER_ID }),
      { onConflict: 'id' }
    );
  });
});

describe('updateContactFields', () => {
  it('updates fields filtered by id and user_id', async () => {
    const chain = mockChain({ error: null });
    supabase.from.mockReturnValue(chain);
    await updateContactFields('abc', { outreach_status: 'Accepted' });
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ outreach_status: 'Accepted', updated_at: expect.any(String) })
    );
    expect(chain.eq).toHaveBeenCalledWith('id', 'abc');
    expect(chain.eq).toHaveBeenCalledWith('user_id', MOCK_USER_ID);
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
npm test src/tests/storage-contacts.test.js
```
Expected: FAIL — `fetchContacts is not a function` (or similar)

- [ ] **Step 3: Add unified contacts functions to storage.js**

Add after the existing LinkedIn DM functions (around line 512) in `src/lib/storage.js`:
```js
// ── Unified Contacts ───────────────────────────────────────────────────────────
export async function fetchContacts() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('user_id', userId)
    .order('priority',    { ascending: false })
    .order('last_contact', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data || []).map(row => ({
    ...row,
    linkedinUrl: row.linkedin_url || null,
  }));
}

export async function upsertContact(contact) {
  if (!contact.id) throw new Error('upsertContact: id is required');
  const userId = await getUserId();
  const { error } = await supabase
    .from('contacts')
    .upsert({ ...contact, user_id: userId, updated_at: new Date().toISOString() },
             { onConflict: 'id' });
  if (error) throw error;
}

export async function updateContactFields(id, updates) {
  if (!id) throw new Error('updateContactFields: id is required');
  const userId = await getUserId();
  const { error } = await supabase
    .from('contacts')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function updateContactNotes(id, notes) {
  if (!id) throw new Error('updateContactNotes: id is required');
  const userId = await getUserId();
  const { error } = await supabase
    .from('contacts')
    .update({ notes, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

export function computeContactStats(contacts) {
  const c = contacts || [];
  const outreached    = c.filter(x => x.outreach_sent);
  const overdue       = outreached.filter(x => {
    if (!['Accepted','Replied'].includes(x.outreach_status)) return false;
    const snoozed = x.follow_up_snoozed_until;
    if (snoozed && new Date(snoozed) >= new Date()) return false;
    const last = x.last_contact ? new Date(x.last_contact) : null;
    return last && Math.floor((Date.now() - last) / 86400000) >= 7;
  });
  return {
    total:          c.length,
    outreached:     outreached.length,
    overdue:        overdue.length,
    pocConfirmed:   c.filter(x => x.is_confirmed_poc).length,
    pocCandidates:  c.filter(x => x.is_poc_candidate && !x.is_confirmed_poc).length,
    promisesPending:c.filter(x => x.promise_made && x.promise_status !== 'kept').length,
    newConnections: c.filter(x => {
      if (x.outreach_status !== 'Accepted') return false;
      if (!x.outreach_status_changed_at) return false;
      return Math.floor((Date.now() - new Date(x.outreach_status_changed_at)) / 86400000) <= 7;
    }).length,
  };
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
npm test src/tests/storage-contacts.test.js
```
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage.js src/tests/storage-contacts.test.js
git commit -m "feat: add unified contacts CRUD functions to storage.js"
```

---

## Task 5: Update App.jsx — replace legacy networking state

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Find and remove legacy networking state**

In `src/App.jsx`, locate these lines (around 122–128) and remove them:
```js
// REMOVE these lines:
const [networkingLog, setNetworkingLog] = useState([]);
const [netlogMeta, setNetlogMeta] = useState({});
```

Replace with:
```js
const [contacts, setContacts] = useState([]);
```

- [ ] **Step 2: Replace netlog load in the settings fetch effect**

Find the block that loads `netlog_meta` from settings (around `App.jsx:189`):
```js
// REMOVE:
if (dbSettings.netlog_meta) {
  try { setNetlogMeta(JSON.parse(dbSettings.netlog_meta)); } catch { /* ignore */ }
}
```
No replacement needed — contacts are loaded separately.

- [ ] **Step 3: Add contacts fetch to the initial data load effect**

Find the `useEffect` that loads apps, pipeline, etc. (around `App.jsx:160`). Add contacts fetch alongside:
```js
Storage.fetchContacts().then(setContacts).catch(e => console.warn('contacts load error:', e));
```

- [ ] **Step 4: Replace addToNetworkingLog and updateNetlogMeta with updateContact**

Find `addToNetworkingLog` (around `App.jsx:300`) and `updateNetlogMeta` (around `App.jsx:308`). Remove both. Add:
```js
const updateContact = useCallback(async (id, fields) => {
  setContacts(prev => prev.map(c => c.id === id ? { ...c, ...fields } : c));
  try {
    await Storage.updateContactFields(id, fields);
  } catch (e) {
    console.warn('updateContact error:', e);
  }
}, []);

const addContact = useCallback(async (contact) => {
  const existing = contacts.find(c => c.id === contact.id);
  if (!existing) setContacts(prev => [contact, ...prev]);
  try {
    await Storage.upsertContact(contact);
  } catch (e) {
    console.warn('addContact error:', e);
  }
}, [contacts]);
```

- [ ] **Step 5: Update nav badge (App.jsx:480)**

Find the networking nav badge. Replace:
```js
// REMOVE:
{id === "networking" && networkingLog.length > 0 && (
  <span ...>{networkingLog.length}</span>
)}
```
Replace with:
```js
{id === "networking" && contacts.filter(c => c.outreach_sent).length > 0 && (
  <span style={{marginLeft:"auto",fontSize:11,fontWeight:700,padding:"1px 7px",borderRadius:20,background:t.green+"22",color:t.green}}>
    {contacts.filter(c => c.outreach_sent).length}
  </span>
)}
```

- [ ] **Step 6: Update props passed to Networking, Dashboard, Applied**

Find where `<Networking>` is rendered (around `App.jsx:398`). Replace props:
```jsx
// REMOVE: networkingLog, addToNetworkingLog, netlogMeta, updateNetlogMeta
// ADD: contacts, addContact, updateContact
<Networking
  currentJob={currentJob} setCurrentJob={setCurrentJob}
  contactResults={contactResults} setContactResults={setContactResults}
  contacts={contacts} addContact={addContact} updateContact={updateContact}
  setPage={setPage} templates={templates} groqKey={groqKey} serperKey={serperKey} t={t}
/>
```

Find where `<Dashboard>` is rendered (around `App.jsx:365`). Replace props:
```jsx
// REMOVE: networkingLog, netlogMeta
// ADD: contacts
<Dashboard apps={apps} pipeline={pipeline} contacts={contacts} setPage={setPage} t={t}/>
```

Find where `<Applied>` is rendered (around `App.jsx:404`). Replace props:
```jsx
// REMOVE: networkingLog
// ADD: contacts
<Applied apps={apps} contacts={contacts} setPage={setPage} updateApplicationStatus={updateApplicationStatus} t={t}/>
```

- [ ] **Step 7: Verify app still loads (dev server)**

```bash
npm run dev
```
Open browser. Expected: App loads without console errors about undefined props.

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx
git commit -m "refactor: replace networkingLog+netlogMeta with unified contacts state in App.jsx"
```

---

## Task 6: Update Dashboard.jsx and dashboard-utils.js

**Files:**
- Modify: `src/components/Dashboard.jsx`
- Modify: `src/lib/dashboard-utils.js`

- [ ] **Step 1: Update dashboard-utils.js calcStreak signature**

In `src/lib/dashboard-utils.js`, find `calcStreak` (around line 63):
```js
// BEFORE:
export function calcStreak(apps, networkingLog) {
  // ...
  networkingLog.some(c => isSameLocalDay(c.date, d));
```

Replace with:
```js
export function calcStreak(apps, contacts) {
  // contacts filtered to outreached ones with outreach_date
  const outreached = (contacts || []).filter(c => c.outreach_sent && c.outreach_date);
  // replace networkingLog.some(...) with:
  outreached.some(c => isSameLocalDay(c.outreach_date, d));
```

Apply the full change — replace every reference to `networkingLog` in the function with `contacts` / `outreached`.

- [ ] **Step 2: Update Dashboard.jsx props and derived values**

In `src/components/Dashboard.jsx`, update the function signature (line 46):
```js
// BEFORE:
export default function Dashboard({ apps, pipeline, searchResults: _searchResults, networkingLog, netlogMeta, setPage, t }) {

// AFTER:
export default function Dashboard({ apps, pipeline, contacts, setPage, t }) {
```

Replace derived values:
```js
// REMOVE: const netSpark = buildSparkData(networkingLog, 7);
// ADD:
const outreached = (contacts || []).filter(c => c.outreach_sent);
const netSpark = buildSparkData(outreached.map(c => ({ date: c.outreach_date })), 7);

// REMOVE: const streak = calcStreak(apps, networkingLog);
// ADD:
const streak = calcStreak(apps, contacts);

// REMOVE: const totalNetworked = networkingLog.length;
// ADD:
const totalNetworked = outreached.length;

// REMOVE: networkingLog.forEach(...) + netlogMeta lookups for overdue
// ADD:
const overdueFollowUps = outreached.filter(c => {
  if (!['Accepted','Replied'].includes(c.outreach_status)) return false;
  const snoozed = c.follow_up_snoozed_until;
  if (snoozed && new Date(snoozed) >= new Date()) return false;
  const last = c.last_contact ? new Date(c.last_contact) : null;
  return last && Math.floor((Date.now() - last) / 86400000) >= 7;
}).length;
```

- [ ] **Step 3: Verify dashboard renders correctly**

```bash
npm run dev
```
Navigate to Dashboard. Expected: networking stats show correct counts, no console errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/Dashboard.jsx src/lib/dashboard-utils.js
git commit -m "refactor: update Dashboard and calcStreak to use unified contacts"
```

---

## Task 7: Update Applied.jsx

**Files:**
- Modify: `src/components/Applied.jsx`

- [ ] **Step 1: Update function signature and usages**

In `src/components/Applied.jsx` (line 34):
```js
// BEFORE:
export default function Applied({apps, networkingLog, setPage, updateApplicationStatus, t}) {

// AFTER:
export default function Applied({apps, contacts, setPage, updateApplicationStatus, t}) {
```

Replace all `networkingLog` references with filtered contacts:
```js
// At the top of the component, add:
const networkingLog = (contacts || []).filter(c => c.outreach_sent);
// Now all existing networkingLog usages below work without further changes.
```

This one-line adapter means zero further changes needed in the component body.

- [ ] **Step 2: Verify Applied tab renders**

```bash
npm run dev
```
Navigate to Applied tab. Expected: networking count and list render correctly.

- [ ] **Step 3: Commit**

```bash
git add src/components/Applied.jsx
git commit -m "refactor: swap networkingLog prop for contacts in Applied.jsx"
```

---

## Task 8: Create shared networking components

**Files:**
- Create: `src/components/networking/shared/Avatar.jsx`
- Create: `src/components/networking/shared/StatusBadge.jsx`
- Create: `src/components/networking/shared/ContactDraftSection.jsx`

- [ ] **Step 1: Extract Avatar into shared component**

Create `src/components/networking/shared/Avatar.jsx`:
```jsx
export default function Avatar({ name, size = 36, t }) {
  const initials = (name || '??').split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
  const colors = ['#0284c7','#16a34a','#d97706','#7c3aed','#db2777','#0891b2'];
  const idx = name ? (name.charCodeAt(0) + name.charCodeAt(name.length - 1)) % colors.length : 0;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: colors[idx] + '22', border: `1.5px solid ${colors[idx]}44`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.33, fontWeight: 700, color: colors[idx], flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}
```

- [ ] **Step 2: Create StatusBadge**

Create `src/components/networking/shared/StatusBadge.jsx`:
```jsx
const STATUS_COLORS = {
  'Sent':             { bg: '#f1f5f9', bd: '#cbd5e1', tx: '#64748b' },
  'Accepted':         { bg: '#fef3c7', bd: '#fcd34d', tx: '#d97706' },
  'Replied':          { bg: '#dcfce7', bd: '#86efac', tx: '#16a34a' },
  'Coffee Chat':      { bg: '#ede9fe', bd: '#c4b5fd', tx: '#7c3aed' },
  'Referral Secured': { bg: '#fce7f3', bd: '#f9a8d4', tx: '#db2777' },
  'Cold':             { bg: '#f0f4f8', bd: '#94a3b8', tx: '#475569' },
};

export { STATUS_COLORS };

export default function StatusBadge({ status }) {
  const sc = STATUS_COLORS[status] || STATUS_COLORS['Sent'];
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
      background: sc.bg, border: `1px solid ${sc.bd}`, color: sc.tx,
    }}>
      {status || 'Sent'}
    </span>
  );
}
```

- [ ] **Step 3: Move ContactDraftSection into shared**

Create `src/components/networking/shared/ContactDraftSection.jsx` — copy the `ContactDraftSection` function verbatim from `src/components/Networking.jsx` (lines 61–176). Add the import at the top:
```jsx
import { useState } from 'react';
import { MessageSquare, Sparkles, RefreshCw, Copy, Check } from 'lucide-react';
import { draftMessageWithGroq } from '../../../lib/groq.js';

const PERSONAS = ['Recruiter','Hiring Manager','Peer Engineer','Executive','UIUC Alumni','Senior Engineer'];
const INTENTS = [
  { value: 'job_application_ask', label: 'Job Application Ask' },
  { value: 'cold_outreach', label: 'Cold Outreach' },
];
const FORMATS = [
  { value: 'connection_note', label: 'Connection Note',   limitType: 'chars', max: 300 },
  { value: 'followup',        label: 'Follow-up Message', limitType: 'words', max: 100 },
  { value: 'cold_email',      label: 'Cold Email',        limitType: 'words', max: 150 },
];
const FORMAT_HINTS = {
  connection_note: 'Context only — WHY you are connecting. No metrics, no stats. 300 chars max.',
  followup:        'Thank for connecting, why reaching out, one stat, clear ask. 100 words max.',
  cold_email:      'Intro, composites stat, STEM OPT line, clear ask. 150 words max.',
};

function robustCopy(text) {
  if (!text) return Promise.reject('Nothing to copy');
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return Promise.resolve();
}

export default function ContactDraftSection({ contact, currentJob, groqKey, t }) {
  // ... (paste the full function body from Networking.jsx lines 62-176 here)
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/networking/
git commit -m "feat: extract shared networking components (Avatar, StatusBadge, ContactDraftSection)"
```

---

## Task 9: Build ContactList (left panel of My Network)

**Files:**
- Create: `src/components/networking/panels/ContactList.jsx`

- [ ] **Step 1: Create ContactList**

Create `src/components/networking/panels/ContactList.jsx`:
```jsx
import { useState } from 'react';
import { Search, X } from 'lucide-react';
import Avatar from '../shared/Avatar.jsx';

const STATUS_OPTS = ['All','Sent','Accepted','Replied','Coffee Chat','Referral Secured','Cold'];

function urgencyScore(c) {
  const today = new Date();
  const last = c.last_contact ? new Date(c.last_contact) : null;
  const days = last ? Math.floor((today - last) / 86400000) : 999;
  const snoozed = c.follow_up_snoozed_until && new Date(c.follow_up_snoozed_until) >= today;
  const overdue = !snoozed && ['Accepted','Replied'].includes(c.outreach_status) && days >= 7;
  if (overdue && c.follow_up_priority === 'urgent') return 100;
  if (overdue) return 80;
  if (c.is_confirmed_poc) return 60;
  if (c.is_poc_candidate) return 50;
  if (c.conversation_stage === 'Strong Rapport') return 40;
  return days > 0 ? Math.max(0, 30 - days) : 0;
}

function borderColor(c, t) {
  const today = new Date();
  const last = c.last_contact ? new Date(c.last_contact) : null;
  const days = last ? Math.floor((today - last) / 86400000) : 999;
  const snoozed = c.follow_up_snoozed_until && new Date(c.follow_up_snoozed_until) >= today;
  const overdue = !snoozed && ['Accepted','Replied'].includes(c.outreach_status) && days >= 7;
  if (overdue && c.follow_up_priority === 'urgent') return '#dc2626';
  if (c.is_confirmed_poc) return '#db2777';
  if (c.is_poc_candidate) return '#e11d63';
  if (c.conversation_stage === 'Strong Rapport') return t.green;
  if (overdue) return t.yellow;
  return undefined;
}

export default function ContactList({ contacts, selectedId, onSelect, t }) {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterPoc, setFilterPoc] = useState('All'); // All | poc | follow-up

  const today = new Date();

  const filtered = [...contacts]
    .filter(c => {
      if (filterStatus !== 'All' && c.outreach_status !== filterStatus) return false;
      if (filterPoc === 'poc' && !c.is_confirmed_poc && !c.is_poc_candidate) return false;
      if (filterPoc === 'follow-up') {
        const snoozed = c.follow_up_snoozed_until && new Date(c.follow_up_snoozed_until) >= today;
        if (snoozed || !c.follow_up) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = [c.name, c.company, c.position, c.persona].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => urgencyScore(b) - urgencyScore(a));

  const outreached = contacts.filter(c => c.outreach_sent);
  const followUpCount = outreached.filter(c => {
    const snoozed = c.follow_up_snoozed_until && new Date(c.follow_up_snoozed_until) >= today;
    return !snoozed && c.follow_up;
  }).length;
  const pocCount = contacts.filter(c => c.is_confirmed_poc || c.is_poc_candidate).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Filter chips */}
      <div style={{ padding: '10px 10px 6px', borderBottom: `1px solid ${t.border}`, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {[
          { label: 'All', key: 'All' },
          { label: `Follow-up${followUpCount > 0 ? ` ${followUpCount}` : ''}`, key: 'follow-up' },
          { label: `POC${pocCount > 0 ? ` ${pocCount}` : ''}`, key: 'poc' },
        ].map(f => (
          <button key={f.key} onClick={() => setFilterPoc(f.key)}
            style={{ padding: '3px 10px', borderRadius: 12, fontSize: 10.5, fontWeight: 700,
              background: filterPoc === f.key ? t.pri : t.card,
              border: `1px solid ${filterPoc === f.key ? t.pri : t.border}`,
              color: filterPoc === f.key ? '#fff' : t.sub, cursor: 'pointer', fontFamily: 'inherit' }}>
            {f.label}
          </button>
        ))}
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: '3px 6px', borderRadius: 8, fontSize: 10.5, background: t.bg,
            border: `1px solid ${t.border}`, color: t.sub, fontFamily: 'inherit', outline: 'none' }}>
          {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {/* Search */}
      <div style={{ padding: '7px 10px', borderBottom: `1px solid ${t.border}`, position: 'relative' }}>
        <Search size={13} style={{ position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)', color: t.muted }} />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search contacts…"
          style={{ width: '100%', background: t.bg, border: `1px solid ${t.border}`, borderRadius: 6,
            padding: '6px 10px 6px 28px', color: t.tx, fontSize: 12, fontFamily: 'inherit',
            outline: 'none', boxSizing: 'border-box' }} />
        {search && (
          <button onClick={() => setSearch('')}
            style={{ position: 'absolute', right: 18, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer', color: t.muted, padding: 0 }}>
            <X size={12} />
          </button>
        )}
      </div>
      {/* Contact rows */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: t.muted }}>No contacts found.</div>
        )}
        {filtered.map(c => {
          const last = c.last_contact ? new Date(c.last_contact) : null;
          const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
          const bd = borderColor(c, t);
          return (
            <div key={c.id} onClick={() => onSelect(c)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px',
                borderBottom: `1px solid ${t.border}`, cursor: 'pointer',
                background: selectedId === c.id ? t.priL : 'transparent',
                borderLeft: bd ? `3px solid ${bd}` : '3px solid transparent' }}>
              <Avatar name={c.name} size={32} t={t} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: selectedId === c.id ? 700 : 600, fontSize: 12.5,
                  color: t.tx, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.name}
                </div>
                <div style={{ fontSize: 11, color: t.muted, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[c.company, c.position].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {days !== null && (
                  <div style={{ fontSize: 10, color: days >= 7 ? t.red : t.muted, fontWeight: days >= 7 ? 700 : 400 }}>
                    {days}d
                  </div>
                )}
                {c.is_confirmed_poc && <div style={{ fontSize: 10, color: '#db2777' }}>★ POC</div>}
                {!c.is_confirmed_poc && c.outreach_status && (
                  <div style={{ fontSize: 10, color: t.muted }}>{c.outreach_status}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/networking/panels/ContactList.jsx
git commit -m "feat: build ContactList left panel for My Network tab"
```

---

## Task 10: Build ContactPanel (right panel of My Network)

**Files:**
- Create: `src/components/networking/panels/ContactPanel.jsx`

- [ ] **Step 1: Create ContactPanel**

Create `src/components/networking/panels/ContactPanel.jsx`:
```jsx
import { useState } from 'react';
import { Linkedin } from 'lucide-react';
import Avatar from '../shared/Avatar.jsx';
import StatusBadge, { STATUS_COLORS } from '../shared/StatusBadge.jsx';
import ContactDraftSection from '../shared/ContactDraftSection.jsx';

const STATUS_OPTS = ['Sent','Accepted','Replied','Coffee Chat','Referral Secured','Cold'];

export default function ContactPanel({ contact, updateContact, currentJob, groqKey, t }) {
  const [noteVal, setNoteVal] = useState(contact?.notes || '');
  const [showDraft, setShowDraft] = useState(false);

  if (!contact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: t.muted, fontSize: 13 }}>
        Select a contact to view details
      </div>
    );
  }

  const last = contact.last_contact ? new Date(contact.last_contact) : null;
  const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
  const sc = STATUS_COLORS[contact.outreach_status] || STATUS_COLORS['Sent'];

  const handleNoteBlur = () => {
    if (noteVal !== (contact.notes || '')) {
      updateContact(contact.id, { notes: noteVal });
    }
  };

  const handleStatusChange = (status) => {
    updateContact(contact.id, {
      outreach_status: status,
      outreach_status_changed_at: new Date().toISOString(),
    });
  };

  return (
    <div style={{ padding: 16, overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Avatar name={contact.name} size={44} t={t} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: t.tx }}>{contact.name}</div>
            <div style={{ fontSize: 12, color: t.muted }}>
              {[contact.position, contact.company].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>
        {contact.linkedin_url && (
          <a href={contact.linkedin_url} target="_blank" rel="noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px',
              borderRadius: 6, background: '#0077B5', color: '#fff', fontWeight: 600,
              fontSize: 11.5, textDecoration: 'none' }}>
            <Linkedin size={12} /> LinkedIn
          </a>
        )}
      </div>

      {/* Status row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: t.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Status</span>
        <select value={contact.outreach_status || 'Sent'} onChange={e => handleStatusChange(e.target.value)}
          style={{ background: sc.bg, border: `1px solid ${sc.bd}`, borderRadius: 7,
            padding: '4px 8px', color: sc.tx, fontSize: 12, fontWeight: 700,
            fontFamily: 'inherit', outline: 'none', cursor: 'pointer' }}>
          {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {days !== null && (
          <span style={{ fontSize: 11, color: days >= 7 ? t.red : t.muted, fontWeight: days >= 7 ? 700 : 400, marginLeft: 'auto' }}>
            {days}d ago
          </span>
        )}
      </div>

      {/* Badge row */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 12 }}>
        {contact.conversation_stage && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 8,
            background: t.priL, color: t.pri }}>{contact.conversation_stage}</span>
        )}
        {contact.relationship_strength && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 8,
            background: t.greenL, color: t.green }}>{contact.relationship_strength}</span>
        )}
        {contact.is_confirmed_poc && (
          <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 8,
            background: '#fce7f3', color: '#db2777' }}>★ Confirmed POC</span>
        )}
        {!contact.is_confirmed_poc && contact.is_poc_candidate && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 8,
            background: '#fff1f5', color: '#e11d63' }}>◆ POC Candidate</span>
        )}
      </div>

      {/* Intel stats */}
      {(contact.poc_score || contact.message_count) && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {contact.poc_score > 0 && (
            <div style={{ flex: 1, padding: '8px', background: t.hover, borderRadius: 6, border: `1px solid ${t.border}`, fontSize: 11 }}>
              <div style={{ color: t.muted, marginBottom: 2 }}>POC Score</div>
              <div style={{ fontWeight: 700, color: '#db2777', fontSize: 16 }}>{contact.poc_score}/10</div>
            </div>
          )}
          {contact.message_count > 0 && (
            <div style={{ flex: 1, padding: '8px', background: t.hover, borderRadius: 6, border: `1px solid ${t.border}`, fontSize: 11 }}>
              <div style={{ color: t.muted, marginBottom: 2 }}>Messages</div>
              <div style={{ fontWeight: 700, color: t.tx, fontSize: 16 }}>
                {contact.message_count}{contact.two_way_conversation ? ' ⇄' : ''}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Promise alert */}
      {contact.promise_made && contact.promise_text && contact.promise_status !== 'kept' && (
        <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 6,
          background: '#fff7ed', border: '1px solid #fed7aa', fontSize: 11.5, color: '#92400e' }}>
          <span style={{ fontWeight: 700 }}>Promise: </span>{contact.promise_text}
        </div>
      )}

      {/* Notes */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
          color: t.muted, marginBottom: 4, letterSpacing: 1 }}>Notes</div>
        <textarea value={noteVal} onChange={e => setNoteVal(e.target.value)} onBlur={handleNoteBlur}
          rows={3} placeholder="Add notes…"
          style={{ width: '100%', background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8,
            padding: '8px 10px', color: t.tx, fontSize: 12.5, fontFamily: 'inherit',
            resize: 'vertical', boxSizing: 'border-box', outline: 'none', lineHeight: 1.6 }} />
      </div>

      {/* Draft toggle */}
      <button onClick={() => setShowDraft(v => !v)}
        style={{ width: '100%', padding: '9px 14px', borderRadius: 8, background: t.greenL,
          border: `1px solid ${t.greenBd}`, color: t.green, fontSize: 12.5,
          fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', marginBottom: showDraft ? 0 : 8 }}>
        ✨ {showDraft ? 'Hide' : 'Draft Follow-up Message'}
      </button>
      {showDraft && (
        <ContactDraftSection contact={contact} currentJob={currentJob} groqKey={groqKey} t={t} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/networking/panels/ContactPanel.jsx
git commit -m "feat: build ContactPanel right panel for My Network tab"
```

---

## Task 11: Build ActionsTab with all sections

**Files:**
- Create: `src/components/networking/actions/OverdueSection.jsx`
- Create: `src/components/networking/actions/PromisesSection.jsx`
- Create: `src/components/networking/actions/PocCandidatesSection.jsx`
- Create: `src/components/networking/actions/NewConnectionsSection.jsx`
- Create: `src/components/networking/actions/LinkedInSyncPanel.jsx`
- Create: `src/components/networking/ActionsTab.jsx`

- [ ] **Step 1: Create OverdueSection**

Create `src/components/networking/actions/OverdueSection.jsx`:
```jsx
import { Linkedin, Sparkles } from 'lucide-react';
import Avatar from '../shared/Avatar.jsx';

export default function OverdueSection({ contacts, updateContact, onDraft, t }) {
  const today = new Date();
  const overdue = contacts.filter(c => {
    if (!['Accepted','Replied'].includes(c.outreach_status)) return false;
    const snoozed = c.follow_up_snoozed_until && new Date(c.follow_up_snoozed_until) >= today;
    if (snoozed) return false;
    const last = c.last_contact ? new Date(c.last_contact) : null;
    return last && Math.floor((Date.now() - last) / 86400000) >= 7;
  });

  if (overdue.length === 0) return null;

  const handleFollowedUp = (c) => {
    const snoozedUntil = new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0];
    updateContact(c.id, { follow_up_snoozed_until: snoozedUntil });
  };

  const handleDismiss = (c) => {
    const snoozedUntil = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    updateContact(c.id, { follow_up_snoozed_until: snoozedUntil });
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: 1, color: '#dc2626', marginBottom: 8 }}>
        🔴 Overdue Follow-ups ({overdue.length})
      </div>
      {overdue.map(c => {
        const days = Math.floor((Date.now() - new Date(c.last_contact)) / 86400000);
        return (
          <div key={c.id} style={{ padding: 12, borderRadius: 8, background: '#fef2f2',
            border: '1px solid #fecaca', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Avatar name={c.name} size={32} t={t} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>{c.name}</div>
                  <div style={{ fontSize: 11.5, color: '#64748b' }}>
                    {c.outreach_status} · {c.company} · {days}d ago
                  </div>
                </div>
              </div>
              <span style={{ padding: '2px 8px', borderRadius: 10, background: '#fee2e2',
                color: '#dc2626', fontSize: 10, fontWeight: 800, alignSelf: 'flex-start' }}>
                🔴 Overdue
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {c.linkedin_url && (
                <a href={c.linkedin_url} target="_blank" rel="noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px',
                    borderRadius: 6, background: '#0077B5', color: '#fff', fontWeight: 600,
                    fontSize: 11.5, textDecoration: 'none' }}>
                  <Linkedin size={11} /> LinkedIn
                </a>
              )}
              <button onClick={() => onDraft(c)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px',
                  borderRadius: 6, background: '#f0fdf4', border: '1px solid #86efac',
                  color: '#15803d', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                <Sparkles size={11} /> Draft Message
              </button>
              <button onClick={() => handleFollowedUp(c)}
                style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 6,
                  background: '#15803d', color: '#fff', fontSize: 11.5,
                  fontWeight: 700, cursor: 'pointer', border: 'none', fontFamily: 'inherit' }}>
                ✓ I Followed Up
              </button>
              <button onClick={() => handleDismiss(c)}
                style={{ padding: '5px 10px', borderRadius: 6, background: '#f1f5f9',
                  border: '1px solid #e2e8f0', color: '#64748b', fontSize: 11.5,
                  fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                ✕ Not Yet
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create PromisesSection**

Create `src/components/networking/actions/PromisesSection.jsx`:
```jsx
import { Linkedin } from 'lucide-react';
import Avatar from '../shared/Avatar.jsx';

export default function PromisesSection({ contacts, updateContact, t }) {
  const pending = contacts.filter(c => c.promise_made && c.promise_status !== 'kept');
  if (pending.length === 0) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: 1, color: '#c2410c', marginBottom: 8 }}>
        🟠 Promises Pending ({pending.length})
      </div>
      {pending.map(c => (
        <div key={c.id} style={{ padding: 12, borderRadius: 8, background: '#fff7ed',
          border: '1px solid #fed7aa', marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <Avatar name={c.name} size={32} t={t} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>{c.name}</div>
              <div style={{ fontSize: 11.5, color: '#92400e', marginTop: 2 }}>"{c.promise_text}"</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {c.linkedin_url && (
              <a href={c.linkedin_url} target="_blank" rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px',
                  borderRadius: 6, background: '#0077B5', color: '#fff',
                  fontWeight: 600, fontSize: 11.5, textDecoration: 'none' }}>
                <Linkedin size={11} /> LinkedIn
              </a>
            )}
            <button onClick={() => updateContact(c.id, { promise_status: 'kept' })}
              style={{ padding: '5px 12px', borderRadius: 6, background: '#15803d', color: '#fff',
                fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: 'none', fontFamily: 'inherit' }}>
              ✓ Promise Kept
            </button>
            <button onClick={() => updateContact(c.id, { promise_status: 'dismissed' })}
              style={{ padding: '5px 10px', borderRadius: 6, background: '#fff',
                border: '1px solid #fed7aa', color: '#c2410c', fontSize: 11.5,
                fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              ✕ Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create PocCandidatesSection**

Create `src/components/networking/actions/PocCandidatesSection.jsx`:
```jsx
import Avatar from '../shared/Avatar.jsx';

export default function PocCandidatesSection({ contacts, updateContact, t }) {
  const candidates = contacts.filter(c => c.poc_score >= 7 && !c.is_confirmed_poc);
  if (candidates.length === 0) return null;

  const handleConfirm = (c) => {
    updateContact(c.id, {
      is_confirmed_poc: true,
      outreach_status: 'Referral Secured',
      outreach_status_changed_at: new Date().toISOString(),
    });
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: 1, color: '#db2777', marginBottom: 8 }}>
        ★ POC Candidates Ready to Convert ({candidates.length})
      </div>
      {candidates.map(c => (
        <div key={c.id} style={{ padding: 12, borderRadius: 8, background: '#fce7f3',
          border: '1px solid #f9a8d4', marginBottom: 8,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Avatar name={c.name} size={32} t={t} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>{c.name}</div>
              <div style={{ fontSize: 11.5, color: '#9d174d' }}>
                Score {c.poc_score}/10 · {c.relationship_strength} · {c.position} at {c.company}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => handleConfirm(c)}
              style={{ padding: '5px 12px', borderRadius: 6, background: '#db2777', color: '#fff',
                fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: 'none', fontFamily: 'inherit' }}>
              ★ Confirm as POC
            </button>
            <button onClick={() => updateContact(c.id, { is_poc_candidate: false })}
              style={{ padding: '5px 10px', borderRadius: 6, background: '#f1f5f9',
                border: '1px solid #e2e8f0', color: '#64748b', fontSize: 11.5,
                fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Not Yet
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Create NewConnectionsSection**

Create `src/components/networking/actions/NewConnectionsSection.jsx`:
```jsx
import { Linkedin, Sparkles } from 'lucide-react';
import Avatar from '../shared/Avatar.jsx';

export default function NewConnectionsSection({ contacts, updateContact, onDraft, t }) {
  const recent = contacts.filter(c => {
    if (c.outreach_status !== 'Accepted') return false;
    if (!c.outreach_status_changed_at) return false;
    return Math.floor((Date.now() - new Date(c.outreach_status_changed_at)) / 86400000) <= 7;
  });
  if (recent.length === 0) return null;

  const handleMessageSent = (c) => {
    updateContact(c.id, {
      outreach_status: 'Replied',
      last_contact: new Date().toISOString().split('T')[0],
      follow_up_snoozed_until: new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0],
      outreach_status_changed_at: new Date().toISOString(),
    });
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: 1, color: '#16a34a', marginBottom: 8 }}>
        🟢 New Connections — Send First Message ({recent.length})
      </div>
      {recent.map(c => {
        const days = Math.floor((Date.now() - new Date(c.outreach_status_changed_at)) / 86400000);
        return (
          <div key={c.id} style={{ padding: 12, borderRadius: 8, background: '#f0fdf4',
            border: '1px solid #86efac', marginBottom: 8,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Avatar name={c.name} size={32} t={t} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>{c.name}</div>
                <div style={{ fontSize: 11.5, color: '#166534' }}>
                  Accepted {days}d ago · {c.persona} · {c.company}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {c.linkedin_url && (
                <a href={c.linkedin_url} target="_blank" rel="noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px',
                    borderRadius: 6, background: '#0077B5', color: '#fff',
                    fontWeight: 600, fontSize: 11.5, textDecoration: 'none' }}>
                  <Linkedin size={11} /> LinkedIn
                </a>
              )}
              <button onClick={() => onDraft(c)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px',
                  borderRadius: 6, background: '#fff', border: '1px solid #86efac',
                  color: '#15803d', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                <Sparkles size={11} /> Draft
              </button>
              <button onClick={() => handleMessageSent(c)}
                style={{ padding: '5px 12px', borderRadius: 6, background: '#15803d', color: '#fff',
                  fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: 'none', fontFamily: 'inherit' }}>
                ✓ Message Sent
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Create LinkedInSyncPanel**

Create `src/components/networking/actions/LinkedInSyncPanel.jsx`:
```jsx
export default function LinkedInSyncPanel({ t }) {
  return (
    <div style={{ padding: '12px 14px', borderRadius: 8, background: t.hover,
      border: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: t.tx, marginBottom: 2 }}>
          🔄 LinkedIn Sync
        </div>
        <div style={{ fontSize: 11.5, color: t.muted }}>
          Run the sync script to update statuses and add new contacts from your LinkedIn export.
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: 11, color: t.sub, marginTop: 6,
          background: t.bg, padding: '4px 8px', borderRadius: 4, display: 'inline-block' }}>
          python linkedin_intelligence_v2.py --zip ~/Desktop/Basic_LinkedInDataExport_*.zip
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create ActionsTab**

Create `src/components/networking/ActionsTab.jsx`:
```jsx
import { useState } from 'react';
import OverdueSection from './actions/OverdueSection.jsx';
import PromisesSection from './actions/PromisesSection.jsx';
import PocCandidatesSection from './actions/PocCandidatesSection.jsx';
import NewConnectionsSection from './actions/NewConnectionsSection.jsx';
import LinkedInSyncPanel from './actions/LinkedInSyncPanel.jsx';
import ContactDraftSection from './shared/ContactDraftSection.jsx';

export default function ActionsTab({ contacts, updateContact, currentJob, groqKey, t }) {
  const [draftContact, setDraftContact] = useState(null);

  const hasItems = contacts.some(c =>
    ['Accepted','Replied'].includes(c.outreach_status) ||
    (c.promise_made && c.promise_status !== 'kept') ||
    (c.poc_score >= 7 && !c.is_confirmed_poc)
  );

  return (
    <div>
      {!hasItems && (
        <div style={{ textAlign: 'center', padding: '60px 24px', color: t.muted, fontSize: 14 }}>
          ✓ Nothing needs attention right now. Check back tomorrow.
        </div>
      )}
      <OverdueSection contacts={contacts} updateContact={updateContact} onDraft={setDraftContact} t={t} />
      <PromisesSection contacts={contacts} updateContact={updateContact} t={t} />
      <PocCandidatesSection contacts={contacts} updateContact={updateContact} t={t} />
      <NewConnectionsSection contacts={contacts} updateContact={updateContact} onDraft={setDraftContact} t={t} />
      <LinkedInSyncPanel t={t} />

      {/* Draft panel — appears when user clicks Draft on any contact */}
      {draftContact && (
        <div style={{ marginTop: 16, padding: 14, border: `1px solid ${t.border}`, borderRadius: 10, background: t.card }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.tx }}>
              Drafting message for {draftContact.name}
            </div>
            <button onClick={() => setDraftContact(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.muted, fontSize: 18 }}>×</button>
          </div>
          <ContactDraftSection contact={draftContact} currentJob={currentJob} groqKey={groqKey} t={t} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add src/components/networking/actions/ src/components/networking/ActionsTab.jsx
git commit -m "feat: build ActionsTab with overdue, promises, POC candidates, new connections, sync panel"
```

---

## Task 12: Build NetworkTab (My Network — split panel)

**Files:**
- Create: `src/components/networking/NetworkTab.jsx`

- [ ] **Step 1: Create NetworkTab**

Create `src/components/networking/NetworkTab.jsx`:
```jsx
import { useState } from 'react';
import ContactList from './panels/ContactList.jsx';
import ContactPanel from './panels/ContactPanel.jsx';

export default function NetworkTab({ contacts, updateContact, currentJob, groqKey, t }) {
  const [selected, setSelected] = useState(null);

  // When a contact is updated, sync the selected view
  const handleUpdateContact = (id, fields) => {
    updateContact(id, fields);
    if (selected?.id === id) setSelected(prev => ({ ...prev, ...fields }));
  };

  return (
    <div style={{ display: 'flex', border: `1px solid ${t.border}`, borderRadius: 12,
      overflow: 'hidden', background: t.card, minHeight: 500 }}>
      {/* Left panel — contact list */}
      <div style={{ width: '40%', minWidth: 260, borderRight: `1px solid ${t.border}`,
        display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 12px', borderBottom: `1px solid ${t.border}`,
          fontSize: 11, fontWeight: 700, color: t.muted, textTransform: 'uppercase', letterSpacing: 1 }}>
          My Network · {contacts.length}
        </div>
        <ContactList
          contacts={contacts}
          selectedId={selected?.id}
          onSelect={setSelected}
          t={t}
        />
      </div>
      {/* Right panel — contact detail */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <ContactPanel
          contact={selected}
          updateContact={handleUpdateContact}
          currentJob={currentJob}
          groqKey={groqKey}
          t={t}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/networking/NetworkTab.jsx
git commit -m "feat: build NetworkTab with split-panel layout"
```

---

## Task 13: Build FindTab

**Files:**
- Create: `src/components/networking/FindTab.jsx`

- [ ] **Step 1: Create FindTab**

Create `src/components/networking/FindTab.jsx` — extract the `tab === "find"` section from `Networking.jsx` (lines 488–586). Key change: replace the "Connection Sent" button logic with "Add to Network":

```jsx
import { useState } from 'react';
import { Users, Linkedin, Mail, Send } from 'lucide-react';
import { supabase } from '../../supabase.js';
import Avatar from './shared/Avatar.jsx';
import ContactDraftSection from './shared/ContactDraftSection.jsx';

const PERSONAS = ['Recruiter','Hiring Manager','Peer Engineer','Executive','UIUC Alumni','Senior Engineer'];

export default function FindTab({ currentJob, contacts, addContact, groqKey, serperKey, t }) {
  const [co, setCo]       = useState(currentJob?.company || '');
  const [role, setRole]   = useState(currentJob?.role || '');
  const [loc, setLoc]     = useState(currentJob?.location || '');
  const [selectedPersonas, setSelectedPersonas] = useState(['Recruiter','Hiring Manager','Peer Engineer','UIUC Alumni']);
  const [personasOpen, setPersonasOpen] = useState(false);
  const [results, setResults]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [err, setErr]           = useState('');

  // IDs already in unified contacts (to show "Already Added")
  const addedIds = new Set(contacts.map(c => c.id));

  const findContacts = async () => {
    setLoading(true); setErr('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/find-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ company: co, role, location: loc, personas: selectedPersonas }),
      });
      if (!res.ok) { const t = await res.text(); throw new Error(JSON.parse(t).error || `HTTP ${res.status}`); }
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) throw new Error('No contacts found.');
      setResults(data);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };

  const handleAddToNetwork = (c) => {
    addContact({
      id: c.id,
      name: c.name || c.type,
      company: c.company || co,
      position: c.title || c.type || '',
      linkedin_url: c.linkedin_url || c.linkedinUrl || '',
      email: c.email && c.email !== 'NA' ? c.email : null,
      persona: c.type || null,
      source: 'find_contacts',
      outreach_sent: true,
      outreach_date: new Date().toISOString().split('T')[0],
      outreach_status: 'Sent',
      outreach_status_changed_at: new Date().toISOString(),
    });
  };

  // ... render (copy the find tab JSX from Networking.jsx lines 488-586,
  // replacing "Connection Sent" / addToNetworkingLog with handleAddToNetwork,
  // and sentIds.has(c.id) with addedIds.has(c.id) → show "Already Added")
}
```

Fill in the full render section by copying from the original `Networking.jsx` `tab === "find"` block and applying the two substitutions above.

- [ ] **Step 2: Commit**

```bash
git add src/components/networking/FindTab.jsx
git commit -m "feat: build FindTab with unified contacts addContact integration"
```

---

## Task 14: Replace Networking.jsx with thin shell

**Files:**
- Modify: `src/components/Networking.jsx`

- [ ] **Step 1: Replace monolith with thin shell**

Replace the entire contents of `src/components/Networking.jsx` with:
```jsx
import { useState } from 'react';
import { computeContactStats } from '../lib/storage.js';
import FindTab from './networking/FindTab.jsx';
import NetworkTab from './networking/NetworkTab.jsx';
import ActionsTab from './networking/ActionsTab.jsx';

function Chip({ children, active, onClick, t, color }) {
  return (
    <button onClick={onClick}
      style={{ padding: '6px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600,
        cursor: 'pointer', fontFamily: 'inherit',
        background: active ? (color || t.pri) : t.card,
        border: `1px solid ${active ? (color || t.pri) : t.border}`,
        color: active ? '#fff' : t.sub }}>
      {children}
    </button>
  );
}

export default function Networking({ currentJob, contacts, addContact, updateContact,
  contactResults, setContactResults, setPage, groqKey, serperKey, t }) {
  const [tab, setTab] = useState('find');
  const stats = computeContactStats(contacts);
  const actionsBadge = stats.overdue + stats.promisesPending + stats.pocCandidates + stats.newConnections;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 700, color: t.tx }}>Networking</h2>
          <p style={{ margin: 0, fontSize: 14, color: t.sub }}>
            {contacts.filter(c => c.outreach_sent).length} contacts · {stats.overdue} overdue
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Chip active={tab === 'find'} onClick={() => setTab('find')} t={t}>Find Contacts</Chip>
          <Chip active={tab === 'network'} onClick={() => setTab('network')} t={t}>
            My Network <span style={{ marginLeft: 5, fontSize: 11, fontWeight: 800 }}>
              {contacts.length}
            </span>
          </Chip>
          <Chip active={tab === 'actions'} onClick={() => setTab('actions')} t={t}
            color={actionsBadge > 0 ? '#dc2626' : undefined}>
            Actions
            {actionsBadge > 0 && (
              <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, padding: '1px 6px',
                borderRadius: 10, background: '#dc262622', color: '#dc2626' }}>
                {actionsBadge}
              </span>
            )}
          </Chip>
        </div>
      </div>

      {tab === 'find' && (
        <FindTab currentJob={currentJob} contacts={contacts}
          addContact={addContact} groqKey={groqKey} serperKey={serperKey} t={t} />
      )}
      {tab === 'network' && (
        <NetworkTab contacts={contacts} updateContact={updateContact}
          currentJob={currentJob} groqKey={groqKey} t={t} />
      )}
      {tab === 'actions' && (
        <ActionsTab contacts={contacts} updateContact={updateContact}
          currentJob={currentJob} groqKey={groqKey} t={t} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify full app renders without errors**

```bash
npm run dev
```

Open app, click Networking. Verify:
- Three tabs render
- My Network shows the split panel
- Actions shows the queue sections
- Find Contacts searches and adds to network

- [ ] **Step 3: Commit**

```bash
git add src/components/Networking.jsx
git commit -m "refactor: replace monolithic Networking.jsx with thin 3-tab shell"
```

---

## Task 15: Update Python sync scripts

**Files:**
- Modify: `linkedin_crm_import.py`
- Modify: `linkedin_messages_import.py`
- Modify: `linkedin_intelligence_v2.py`

- [ ] **Step 1: Update linkedin_crm_import.py**

At line 115, change:
```python
# BEFORE:
client.table('linkedin_dm_contacts').upsert(rows, on_conflict='id').execute()

# AFTER:
client.table('contacts').upsert(rows, on_conflict='id').execute()
```

- [ ] **Step 2: Update linkedin_messages_import.py**

At line 177, change table name. Also add user_id injection — find where rows are built and add:
```python
import os
USER_ID = os.environ.get('JOBAGENT_USER_ID')
if not USER_ID:
    raise EnvironmentError('JOBAGENT_USER_ID env var required')

# In the row-building loop, add: row['user_id'] = USER_ID
# Then at line 177:
client.table('contacts').upsert(rows_to_upsert, on_conflict='id').execute()
```

- [ ] **Step 3: Update linkedin_intelligence_v2.py**

At lines 959 and 962:
```python
# BEFORE (line 959):
r['user_id'] = 'de1bafab-7e76-4b80-a7ed-8de86c6d9bad'
# AFTER:
import os
USER_ID = os.environ.get('JOBAGENT_USER_ID')
if not USER_ID:
    raise EnvironmentError('JOBAGENT_USER_ID env var required — add to shell: export JOBAGENT_USER_ID=your-uuid')
r['user_id'] = USER_ID

# BEFORE (line 962):
client.table('linkedin_dm_contacts').upsert(...)
# AFTER:
client.table('contacts').upsert(...)
```

- [ ] **Step 4: Test one script dry-run**

```bash
export JOBAGENT_USER_ID=your-user-id
python linkedin_crm_import.py --dry-run  # or whatever flag shows output without writing
```

Expected: no errors about missing env var or wrong table name.

- [ ] **Step 5: Commit**

```bash
git add linkedin_crm_import.py linkedin_messages_import.py linkedin_intelligence_v2.py
git commit -m "fix: update linkedin sync scripts — rename table to contacts, read user_id from env"
```

---

## Task 16: P3 Cleanup — retire legacy tables and props

> **Only run after verifying production data is intact in unified contacts table.**

**Files:**
- Create: `supabase_migration_retire_netlog.sql`

- [ ] **Step 1: Create cleanup migration**

Create `supabase_migration_retire_netlog.sql`:
```sql
-- Run ONLY after verifying contacts table has all expected rows
-- Check: SELECT count(*) FROM contacts WHERE outreach_sent = true;
-- Should match former netlog row count.

-- Remove netlog_meta from settings
DELETE FROM settings WHERE key LIKE '%:netlog_meta';

-- Drop netlog table
DROP TABLE IF EXISTS netlog;
```

- [ ] **Step 2: Verify row counts before applying**

In Supabase SQL editor:
```sql
SELECT
  (SELECT count(*) FROM contacts WHERE outreach_sent = true) AS unified_outreached,
  (SELECT count(*) FROM netlog) AS legacy_netlog;
-- unified_outreached should be >= legacy_netlog
```

- [ ] **Step 3: Apply cleanup migration**

Run `supabase_migration_retire_netlog.sql` in Supabase SQL editor.

- [ ] **Step 4: Final commit**

```bash
git add supabase_migration_retire_netlog.sql
git commit -m "chore: retire netlog table and netlog_meta settings key"
```

---

## Self-Review

**Spec coverage check:**

| Spec Requirement | Task |
|---|---|
| Drop legacy `contacts` search-cache table | Task 2 Step 1 |
| Rename `linkedin_dm_contacts` → `contacts` | Task 2 |
| Add 5 outreach columns + snooze field | Task 2 |
| 3-tier dedupe strategy in migration | Task 3 |
| Explicit date normalization for outreach_date | Task 3 |
| Unified storage.js functions | Task 4 |
| `computeContactStats` (replaces fetchLinkedInStats) | Task 4 |
| App.jsx legacy state removal | Task 5 |
| Nav badge updated | Task 5 Step 5 |
| Dashboard.jsx + dashboard-utils.js updated | Task 6 |
| Applied.jsx updated | Task 7 |
| Shared components (Avatar, StatusBadge, ContactDraftSection) | Task 8 |
| ContactList left panel with urgency sort | Task 9 |
| ContactPanel right panel with status editor, notes, draft | Task 10 |
| OverdueSection + ✓ I Followed Up button | Task 11 |
| PromisesSection + ✓ Promise Kept button | Task 11 |
| PocCandidatesSection + ★ Confirm as POC button | Task 11 |
| NewConnectionsSection + ✓ Message Sent button | Task 11 |
| LinkedInSyncPanel | Task 11 |
| ActionsTab assembling all sections | Task 11 |
| NetworkTab split panel | Task 12 |
| FindTab with "Add to Network" | Task 13 |
| Networking.jsx thin shell | Task 14 |
| Python script updates (table name + user_id env) | Task 15 |
| Retire netlog + netlog_meta | Task 16 |
| Snooze written to DB not localStorage | Tasks 9, 11 |
| Dismiss writes `follow_up_snoozed_until` | Task 11 |
