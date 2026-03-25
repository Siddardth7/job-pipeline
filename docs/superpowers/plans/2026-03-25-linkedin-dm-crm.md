# LinkedIn DM CRM Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the LinkedIn DM CRM export tool into the JobAgent Web app by adding a new Supabase table, a Python import script, storage helpers, and a "LinkedIn DMs" third tab on the Networking page.

**Architecture:** A standalone Python script imports `contacts_export.csv` into a new `linkedin_dm_contacts` Supabase table. Four new storage functions expose that table to React. A third chip tab in `Networking.jsx` renders the data with filters, badges, and inline note-editing — using the existing `Card`, `Chip`, `Avatar`, `Btn` component primitives and the `t` theme object throughout.

**Tech Stack:** React 18 + Vite, Supabase JS client (`@supabase/supabase-js`), Python 3 + `supabase-py` + `python-dotenv`, Vitest (unit tests), inline styles only.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase_schema.sql` | Modify (append) | `linkedin_dm_contacts` table DDL |
| `linkedin_crm_import.py` | Create | CLI script: reads CSV → upserts to Supabase |
| `src/lib/storage.js` | Modify (append) | 4 new async storage functions |
| `src/components/Networking.jsx` | Modify | 3rd "LinkedIn DMs" tab + full view |
| `README.md` | Create/append | LinkedIn DM CRM Integration section |

---

## Task 1: Supabase Schema

**Files:**
- Modify: `supabase_schema.sql` (append at end)

> This task produces SQL only. The user manually runs it in the Supabase SQL editor. No automated test possible; verification is a manual check.

- [ ] **Step 1.1: Append the table definition to `supabase_schema.sql`**

Add this block at the very end of the file, after the existing RLS section:

```sql
-- ── LinkedIn DM Contacts ───────────────────────────────────────────────────────
create table if not exists linkedin_dm_contacts (
  id              text primary key,
  name            text,
  company         text,
  position        text,
  role_type       text,
  conv_status     text,
  last_contact    text,        -- ISO date: YYYY-MM-DD
  days_since      integer,     -- stale after import; UI computes live from last_contact
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

- [ ] **Step 1.2: Verify in Supabase SQL editor**

Run the SQL in the Supabase dashboard SQL editor.
Expected: "Success. No rows returned." with no errors.
Confirm the table appears under Table Editor in the dashboard.

- [ ] **Step 1.3: Commit**

```bash
git add supabase_schema.sql
git commit -m "feat: add linkedin_dm_contacts table to Supabase schema"
```

---

## Task 2: Python Import Script

**Files:**
- Create: `linkedin_crm_import.py` (project root)

- [ ] **Step 2.1: Create the script**

Create `/Users/jashwanth/jobagent-web/linkedin_crm_import.py`:

```python
#!/usr/bin/env python3
"""
linkedin_crm_import.py — Import contacts_export.csv from the LinkedIn CRM tool
into the Supabase linkedin_dm_contacts table.

Usage:
  python linkedin_crm_import.py --csv ~/Desktop/linkedin-crm/output/contacts_export.csv
"""
import argparse
import csv
import hashlib
import os
import re
import sys

from dotenv import load_dotenv
from supabase import create_client

# ── Load env ──────────────────────────────────────────────────────────────────
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '.env.local'))

SUPABASE_URL = os.getenv('VITE_SUPABASE_URL')
SUPABASE_KEY = os.getenv('VITE_SUPABASE_ANON_KEY')


# ── Helpers ───────────────────────────────────────────────────────────────────
def make_id(name: str, linkedin_url: str) -> str:
    """Generate a stable, collision-resistant slug from name + linkedin_url."""
    base = re.sub(r'[^a-z0-9-]', '', name.lower().replace(' ', '-'))
    base = re.sub(r'-+', '-', base).strip('-')
    if linkedin_url and linkedin_url.strip():
        suffix = hashlib.md5(linkedin_url.strip().encode()).hexdigest()[:4]
        return f"{base}-{suffix}"
    return base or 'unknown'


def normalize_status(raw: str) -> str:
    """Normalize CRM tool conv_status strings to 5 canonical values.

    Evaluation order matters — 'follow' check must come before 'active'
    so that 'Active Follow-Up' is classified as Follow-Up Needed, not Opportunity Active.
    """
    s = (raw or '').lower().strip()
    if 'follow' in s:
        return 'Follow-Up Needed'
    if 'opportunit' in s or 'active' in s:
        return 'Opportunity Active'
    if 'await' in s or 'waiting' in s:
        return 'Awaiting Reply'
    if 'replied' in s or 'responded' in s:
        return 'Replied'
    # 'cold', 'no action', or empty all fall through to default
    return 'Cold / No Action'


def to_int(val: str):
    try:
        return int(val.strip())
    except (ValueError, AttributeError):
        return None


def to_bool(val: str) -> bool:
    return (val or '').strip().lower() == 'yes'


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='Import LinkedIn CRM CSV to Supabase')
    parser.add_argument('--csv', required=True, help='Path to contacts_export.csv')
    args = parser.parse_args()

    csv_path = os.path.expanduser(args.csv)
    if not os.path.exists(csv_path):
        print(f"Error: file not found: {csv_path}", file=sys.stderr)
        sys.exit(1)

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Error: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in .env.local",
              file=sys.stderr)
        sys.exit(1)

    client = create_client(SUPABASE_URL, SUPABASE_KEY)

    rows = []
    with open(csv_path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = (row.get('Name') or '').strip()
            linkedin_url = (row.get('LinkedIn Profile URL') or '').strip()
            rows.append({
                'id':            make_id(name, linkedin_url),
                'name':          name or None,
                'company':       (row.get('Company') or '').strip() or None,
                'position':      (row.get('Position / Title') or '').strip() or None,
                'role_type':     (row.get('Role Type') or '').strip() or None,
                'conv_status':   normalize_status(row.get('Conversation Status', '')),
                'last_contact':  (row.get('Last Contact Date') or '').strip() or None,
                'days_since':    to_int(row.get('Days Since Contact', '')),
                'message_count': to_int(row.get('Message Count', '')),
                'follow_up':     to_bool(row.get('Follow-Up Needed', '')),
                'priority':      to_int(row.get('Priority Score (1-10)', '')),
                'next_action':   (row.get('Next Action') or '').strip() or None,
                'summary':       (row.get('Conversation Summary') or '').strip() or None,
                'notes':         (row.get('Notes') or '').strip() or None,
                'linkedin_url':  linkedin_url or None,
                'email':         (row.get('Email') or '').strip() or None,
            })

    if not rows:
        print("No rows found in CSV. Nothing imported.")
        return

    # Upsert in one batch (all rows have unique ids)
    client.table('linkedin_dm_contacts').upsert(rows, on_conflict='id').execute()

    follow_ups = sum(1 for r in rows if r['follow_up'])
    active = sum(1 for r in rows if r['conv_status'] == 'Opportunity Active')
    print(f"Imported {len(rows)} contacts. {follow_ups} follow-ups. {active} active opportunities.")


if __name__ == '__main__':
    main()
```

- [ ] **Step 2.2: Test the pure helper functions**

```bash
cd /Users/jashwanth/jobagent-web
python3 -c "
from linkedin_crm_import import make_id, normalize_status, to_int, to_bool
import hashlib

# make_id: with URL → name-XXXX
expected_suffix = hashlib.md5('linkedin.com/in/js'.encode()).hexdigest()[:4]
assert make_id('John Smith', 'linkedin.com/in/js') == f'john-smith-{expected_suffix}', 'make_id with URL failed'

# make_id: without URL → base slug only
assert make_id('Jane Doe', '') == 'jane-doe', f'make_id no URL failed: {make_id(\"Jane Doe\", \"\")}'

# make_id: idempotent (same inputs → same id)
a = make_id('Alex Kim', 'linkedin.com/in/alex1')
b = make_id('Alex Kim', 'linkedin.com/in/alex1')
assert a == b, 'make_id not idempotent'

# make_id: different URLs → different ids (collision resistance)
c = make_id('Alex Kim', 'linkedin.com/in/alex2')
assert a != c, 'make_id collision: different URLs should produce different ids'

# normalize_status — canonical values pass through
assert normalize_status('Opportunity Active') == 'Opportunity Active'
assert normalize_status('Follow-Up Needed') == 'Follow-Up Needed'
assert normalize_status('Awaiting Reply') == 'Awaiting Reply'
assert normalize_status('Replied') == 'Replied'
assert normalize_status('Cold / No Action') == 'Cold / No Action'

# normalize_status — fuzzy matches
assert normalize_status('Active') == 'Opportunity Active'
assert normalize_status('active opportunity') == 'Opportunity Active'
assert normalize_status('Needs Follow Up') == 'Follow-Up Needed'
assert normalize_status('Active Follow-Up') == 'Follow-Up Needed', 'Active Follow-Up should be Follow-Up Needed, not Opportunity Active'
assert normalize_status('Awaiting') == 'Awaiting Reply'
assert normalize_status('responded') == 'Replied'

# normalize_status — cold/empty fall through to default
assert normalize_status('Cold Lead') == 'Cold / No Action'
assert normalize_status('No Action Required') == 'Cold / No Action'
assert normalize_status('') == 'Cold / No Action'
assert normalize_status(None) == 'Cold / No Action'

# to_int / to_bool
assert to_int('7') == 7
assert to_int('') is None
assert to_bool('Yes') is True
assert to_bool('No') is False
assert to_bool('') is False

print('All helper tests passed.')
"
```

Expected output: `All helper tests passed.`

- [ ] **Step 2.3: Run a live import against Supabase**

First, unzip the LinkedIn export and run the LinkedIn CRM tool to produce `contacts_export.csv`. Then:

```bash
cd /Users/jashwanth/jobagent-web
python linkedin_crm_import.py --csv ~/Desktop/linkedin-crm/output/contacts_export.csv
```

Expected output format: `Imported N contacts. Y follow-ups. Z active opportunities.`

Verify in Supabase Table Editor: rows appear in `linkedin_dm_contacts`.

- [ ] **Step 2.4: Commit**

```bash
git add linkedin_crm_import.py
git commit -m "feat: add LinkedIn CRM import script with slug-based ID and status normalization"
```

---

## Task 3: Storage Layer

**Files:**
- Modify: `src/lib/storage.js` (append at end, after the existing `loadCurrentJob` function)

- [ ] **Step 3.1: Append the four new functions to `src/lib/storage.js`**

```js
// ── LinkedIn DM Contacts ───────────────────────────────────────────────────────
export async function fetchLinkedInContacts() {
  const { data, error } = await supabase
    .from('linkedin_dm_contacts')
    .select('*')
    .order('priority', { ascending: false })
    .order('last_contact', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function fetchLinkedInFollowups() {
  const { data, error } = await supabase
    .from('linkedin_dm_contacts')
    .select('*')
    .eq('follow_up', true)
    .order('priority', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function upsertLinkedInContact(contact) {
  const row = {
    id:            contact.id,
    name:          contact.name,
    company:       contact.company,
    position:      contact.position,
    role_type:     contact.role_type,
    conv_status:   contact.conv_status,
    last_contact:  contact.last_contact,
    days_since:    contact.days_since,
    message_count: contact.message_count,
    follow_up:     contact.follow_up,
    priority:      contact.priority,
    next_action:   contact.next_action,
    summary:       contact.summary,
    notes:         contact.notes,
    linkedin_url:  contact.linkedin_url,
    email:         contact.email,
    updated_at:    new Date().toISOString(),
  };
  const { error } = await supabase
    .from('linkedin_dm_contacts')
    .upsert(row, { onConflict: 'id' });
  if (error) throw error;
}

export async function updateLinkedInContactNotes(id, notes) {
  const { error } = await supabase
    .from('linkedin_dm_contacts')
    .update({ notes, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 3.2: Verify the build still compiles**

```bash
cd /Users/jashwanth/jobagent-web
npm run build 2>&1 | tail -5
```

Expected: build succeeds with no errors.

- [ ] **Step 3.3: Commit**

```bash
git add src/lib/storage.js
git commit -m "feat: add LinkedIn DM contact storage functions to storage.js"
```

---

## Task 4: Networking.jsx — LinkedIn DMs Tab

**Files:**
- Modify: `src/components/Networking.jsx`

Read the full file before making any edits. Make changes in the order specified below. Do not alter any existing line — only add new code.

- [ ] **Step 4.1: Update the two imports at the top of `Networking.jsx`**

**Change 1** — the React import at line 1. Replace:
```js
import { useState, useEffect } from 'react';
```
With:
```js
import { useState, useEffect, useRef } from 'react';
```

**Change 2** — add storage imports directly below the existing `lucide-react` import (line 3):
```js
import { fetchLinkedInContacts, updateLinkedInContactNotes } from '../lib/storage.js';
```

(`Users` is already imported from `lucide-react` — do not re-import it.)

- [ ] **Step 4.2: Add new state variables inside the `Networking` component**

Inside the `Networking` component function, after `const [logFilter, setLogFilter] = useState("All");` (around line 193), add:

```js
const dmLoaded = useRef(false);
const [dmContacts, setDmContacts]           = useState([]);
const [dmLoading, setDmLoading]             = useState(false);
const [dmError, setDmError]                 = useState('');
const [roleFilter, setRoleFilter]           = useState('All');
const [statusFilter, setStatusFilter]       = useState('All');
const [showFollowupOnly, setShowFollowupOnly] = useState(false);
const [expandedSummaries, setExpandedSummaries] = useState(new Set());
const [editedNotes, setEditedNotes]         = useState({});
```

- [ ] **Step 4.3: Add the `useEffect` that fetches DM contacts**

After the existing `useEffect` for `currentJob` (which ends around line 201), add:

```js
useEffect(() => {
  if (tab === 'dms' && !dmLoaded.current) {
    dmLoaded.current = true;
    setDmLoading(true);
    fetchLinkedInContacts()
      .then(data => { setEditedNotes({}); setDmContacts(data); setDmLoading(false); })
      .catch(e  => { setDmError(e.message); setDmLoading(false); });
  }
}, [tab]);
```

Note: `setEditedNotes({})` clears any stale note overrides before new data is loaded.

- [ ] **Step 4.4: Add the "LinkedIn DMs" chip and fix the tab chip container**

Find the inner chip-container `<div>` at line 263 (the one with `style={{display:"flex",gap:8}}`). It currently holds two chips.

**Change 1** — add `flexWrap:"wrap"` to that specific div:
```jsx
<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
```

**Change 2** — add the third chip after the existing `Networking Log` chip:
```jsx
<Chip active={tab==="dms"} onClick={() => setTab("dms")} t={t}>LinkedIn DMs</Chip>
```

Do not modify the outer header `<div>` at line 258 (the one with `justifyContent:"space-between"`).

- [ ] **Step 4.5: Add the `tab === "dms"` block**

In `Networking.jsx`, find line 431 which contains `      )}` — this closes the `tab === "log"` conditional. Line 432 is `    </div>` which closes the outer component wrapper. Insert the new block **between line 431 and line 432** (after the log block's closing `)}`, before the outer `</div>`):

```jsx
      {tab === "dms" && (
        <div>
          {/* ── Stats row ── */}
          {dmContacts.length > 0 && (() => {
            const followUps  = dmContacts.filter(c => c.follow_up).length;
            const active     = dmContacts.filter(c => c.conv_status === 'Opportunity Active').length;
            const recruiters = dmContacts.filter(c => c.role_type === 'Recruiter').length;
            const statStyle  = (bg, color) => ({
              padding:"8px 16px", borderRadius:10, fontSize:13, fontWeight:700,
              background:bg, color
            });
            return (
              <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:18}}>
                <div style={statStyle(t.card, t.tx)}>{dmContacts.length} total</div>
                <div style={statStyle(t.yellowL, t.yellow)}>{followUps} follow-ups</div>
                <div style={statStyle(t.greenL, t.green)}>{active} active opportunities</div>
                <div style={statStyle(t.priL, t.pri)}>{recruiters} recruiters</div>
              </div>
            );
          })()}

          {/* ── Filter bar ── */}
          {dmContacts.length > 0 && (() => {
            const sel = {background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:'8px 11px',color:t.tx,fontSize:12.5,fontFamily:'inherit',outline:'none'};
            return (
              <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:18,alignItems:"center"}}>
                <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} style={sel}>
                  {['All','Recruiter','Hiring Manager','Executive','Referral Contact','Alumni','Peer Engineer','Unknown'].map(v =>
                    <option key={v} value={v}>{v === 'All' ? 'All Roles' : v}</option>
                  )}
                </select>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={sel}>
                  {['All','Opportunity Active','Follow-Up Needed','Awaiting Reply','Replied','Cold / No Action'].map(v =>
                    <option key={v} value={v}>{v === 'All' ? 'All Statuses' : v}</option>
                  )}
                </select>
                <select value={showFollowupOnly ? 'followup' : 'all'} onChange={e => setShowFollowupOnly(e.target.value === 'followup')} style={sel}>
                  <option value="all">All Contacts</option>
                  <option value="followup">Follow-Up Only</option>
                </select>
              </div>
            );
          })()}

          {/* ── Loading ── */}
          {dmLoading && (
            <div style={{display:"flex",gap:6,alignItems:"center",padding:"20px 0"}}>
              {[0,1,2].map(i => <div key={i} style={{width:7,height:7,borderRadius:"50%",background:t.pri,animation:`lp-dot .8s ${i*.15}s ease-in-out infinite`,opacity:.3}}/>)}
            </div>
          )}

          {/* ── Error ── */}
          {dmError && <div style={{color:t.red,fontSize:13,fontWeight:600,marginBottom:12}}>{dmError}</div>}

          {/* ── Empty state ── */}
          {!dmLoading && !dmError && dmContacts.length === 0 && (
            <Card t={t} style={{textAlign:"center",padding:"60px 24px"}}>
              <Users size={32} color={t.muted} style={{marginBottom:12}}/>
              <div style={{fontSize:14,fontWeight:600,color:t.sub,marginBottom:12}}>No LinkedIn DM contacts yet.</div>
              <div style={{fontSize:13,color:t.muted,marginBottom:12}}>Run the import script to get started:</div>
              <div style={{background:t.hover,borderRadius:6,padding:"8px 14px",fontSize:12,fontFamily:"monospace",color:t.tx,display:"inline-block",textAlign:"left"}}>
                python linkedin_crm_import.py --csv ~/Desktop/linkedin-crm/output/contacts_export.csv
              </div>
            </Card>
          )}

          {/* ── Contact cards ── */}
          {!dmLoading && (() => {
            const ROLE_COLORS = {
              'Recruiter':        {bg:t.priL,   tx:t.pri},
              'Hiring Manager':   {bg:'#fee2e2', tx:'#dc2626'},
              'Executive':        {bg:'#ede9fe', tx:'#7c3aed'},
              'Referral Contact': {bg:'#ffedd5', tx:'#ea580c'},
              'Alumni':           {bg:'#ccfbf1', tx:'#0d9488'},
              'Peer Engineer':    {bg:t.greenL,  tx:t.green},
            };
            const STATUS_COLORS_DM = {
              'Opportunity Active': {bg:t.greenL,  tx:t.green},
              'Follow-Up Needed':   {bg:t.yellowL, tx:t.yellow},
              'Awaiting Reply':     {bg:t.priL,    tx:t.pri},
            };
            const priorityColor = (p) => {
              if (p >= 8) return {bg:'#fee2e2', tx:'#dc2626'};
              if (p >= 6) return {bg:'#ffedd5', tx:'#ea580c'};
              if (p >= 4) return {bg:t.yellowL,  tx:t.yellow};
              return {bg:t.hover, tx:t.muted};
            };

            const filtered = dmContacts
              .filter(c => roleFilter === 'All'   || c.role_type === roleFilter)
              .filter(c => statusFilter === 'All' || c.conv_status === statusFilter)
              .filter(c => !showFollowupOnly      || c.follow_up === true);

            return filtered.map(c => {
              const roleCl    = ROLE_COLORS[c.role_type] || {bg:t.hover, tx:t.muted};
              const statusCl  = STATUS_COLORS_DM[c.conv_status] || {bg:t.hover, tx:t.muted};
              const priCl     = priorityColor(c.priority);
              const isExpanded = expandedSummaries.has(c.id);
              const noteVal   = (editedNotes[c.id] ?? c.notes) ?? '';

              // Live days since contact (computed from last_contact YYYY-MM-DD)
              let daysText = null;
              if (c.last_contact) {
                const days = Math.floor((Date.now() - new Date(c.last_contact)) / 86400000);
                daysText = `${days} day${days !== 1 ? 's' : ''} ago`;
              } else if (c.days_since != null) {
                daysText = `${c.days_since} days ago`;
              }

              const toggleSummary = () => setExpandedSummaries(prev => {
                const next = new Set(prev);
                next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                return next;
              });

              const handleNoteBlur = () => {
                if (editedNotes[c.id] !== undefined && editedNotes[c.id] !== (c.notes || '')) {
                  updateLinkedInContactNotes(c.id, editedNotes[c.id]).catch(() => {});
                }
              };

              return (
                <Card key={c.id} t={t} style={{
                  marginBottom:12,
                  borderLeft: c.follow_up ? '4px solid #ea580c' : undefined,
                }}>
                  <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
                    <Avatar name={c.name} size={42} t={t}/>
                    <div style={{flex:1,minWidth:0}}>
                      {/* Header row */}
                      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:3}}>
                        {c.linkedin_url
                          ? <a href={c.linkedin_url} target="_blank" rel="noreferrer" style={{fontSize:14.5,fontWeight:700,color:t.tx,textDecoration:"none"}}>{c.name}</a>
                          : <span style={{fontSize:14.5,fontWeight:700,color:t.tx}}>{c.name}</span>
                        }
                        {c.follow_up && <span title="Follow-up needed">🔔</span>}
                        <span style={{fontSize:10.5,fontWeight:700,padding:"2px 8px",borderRadius:10,background:roleCl.bg,color:roleCl.tx}}>{c.role_type||'Unknown'}</span>
                        <span style={{fontSize:10.5,fontWeight:700,padding:"2px 8px",borderRadius:10,background:statusCl.bg,color:statusCl.tx}}>{c.conv_status}</span>
                        {c.priority != null && (
                          <span style={{marginLeft:'auto',fontSize:11,fontWeight:800,padding:"2px 8px",borderRadius:10,background:priCl.bg,color:priCl.tx}}>P{c.priority}</span>
                        )}
                      </div>
                      {/* Subtitle */}
                      <div style={{fontSize:13,color:t.muted,marginBottom:4}}>
                        {[c.company,c.position].filter(Boolean).join(' · ')}
                      </div>
                      {/* Days since */}
                      {daysText && <div style={{fontSize:12,color:t.muted,marginBottom:6}}>{daysText}</div>}
                      {/* Next action */}
                      {c.next_action && (
                        <div style={{fontSize:12,color:t.sub,background:t.hover,borderRadius:6,padding:"5px 10px",marginBottom:8}}>
                          <span style={{fontWeight:700}}>Next: </span>{c.next_action}
                        </div>
                      )}
                      {/* Expandable summary */}
                      {c.summary && (
                        <div style={{marginBottom:8}}>
                          <button onClick={toggleSummary} style={{fontSize:11.5,color:t.pri,background:"none",border:"none",padding:0,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>
                            {isExpanded ? 'Hide summary ▴' : 'Show summary ▾'}
                          </button>
                          {isExpanded && (
                            <div style={{fontSize:12.5,color:t.sub,marginTop:6,lineHeight:1.6}}>{c.summary}</div>
                          )}
                        </div>
                      )}
                      {/* Notes textarea — auto-saves on blur */}
                      <textarea
                        value={noteVal}
                        rows={2}
                        placeholder="Add notes..."
                        onChange={e => setEditedNotes(prev => ({...prev, [c.id]: e.target.value}))}
                        onBlur={handleNoteBlur}
                        style={{width:"100%",background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"7px 10px",color:t.tx,fontSize:12.5,fontFamily:"inherit",resize:"vertical",boxSizing:"border-box",outline:"none"}}
                      />
                    </div>
                  </div>
                </Card>
              );
            });
          })()}
        </div>
      )}
```

- [ ] **Step 4.6: Verify the dev server starts with no console errors**

```bash
cd /Users/jashwanth/jobagent-web
npm run dev
```

Open `http://localhost:5173`, navigate to Networking. Verify:
- Three chips appear: "Find Contacts", "Networking Log (N)", "LinkedIn DMs"
- Existing Find Contacts and Networking Log tabs work exactly as before
- Clicking "LinkedIn DMs" shows a loading spinner, then contacts (or empty state if no import yet)
- Each card shows: name link, company/position subtitle, role badge, status badge, priority pill, days-ago text
- Cards with `follow_up = true` have an orange left border and 🔔
- Notes textarea saves on blur — verify in Supabase Table Editor after typing and clicking away
- Filter dropdowns narrow the list correctly
- "Show summary ▾" toggle expands/collapses the summary

- [ ] **Step 4.7: Verify the build succeeds**

```bash
npm run build 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 4.8: Commit**

```bash
git add src/components/Networking.jsx
git commit -m "feat: add LinkedIn DMs third tab to Networking page"
```

---

## Task 5: README

**Files:**
- Create or append: `README.md` (project root)

- [ ] **Step 5.1: Check if README.md exists at project root**

```bash
ls /Users/jashwanth/jobagent-web/README.md 2>/dev/null && echo "exists" || echo "not found"
```

If it exists, append the section below. If not, create the file with the section as its content.

- [ ] **Step 5.2: Add the LinkedIn DM CRM Integration section**

```markdown
## LinkedIn DM CRM Integration

This app integrates with a local LinkedIn CRM tool that parses your LinkedIn message export and classifies conversations. The output is stored in Supabase and displayed in the Networking → LinkedIn DMs tab.

### Setup

**1. Export your LinkedIn data**
1. Go to LinkedIn → Settings → Data privacy → Get a copy of your data
2. Select "Messages" (and optionally Connections)
3. Download the `.zip` when ready (can take up to 24 hours)

**2. Run the LinkedIn CRM tool**
```
cd ~/Desktop/linkedin-crm
python main.py --input ~/Downloads/Basic_LinkedInDataExport_*.zip
```
This produces `output/contacts_export.csv`.

**3. Import contacts to Supabase**
```
cd /path/to/jobagent-web
pip install supabase python-dotenv
python linkedin_crm_import.py --csv ~/Desktop/linkedin-crm/output/contacts_export.csv
```
Output: `Imported N contacts. Y follow-ups. Z active opportunities.`

**4. View in the UI**
Open the app → Networking → **LinkedIn DMs** tab.

You'll see:
- Summary stats (total contacts, follow-ups, active opportunities, recruiters)
- Filterable contact cards with role/status badges and priority scoring
- Expandable conversation summaries
- Editable notes (auto-saved on blur)
- Orange left border + 🔔 for contacts needing follow-up

**5. Re-sync after a new LinkedIn export**
Re-run step 3. The import is fully idempotent — it upserts by contact ID (name slug + LinkedIn URL hash).
```

- [ ] **Step 5.3: Commit**

```bash
git add README.md
git commit -m "docs: add LinkedIn DM CRM Integration section to README"
```

---

## Final Verification

- [ ] `npm run build` — clean build, no errors
- [ ] `npm run lint` — no new linting errors introduced
- [ ] Supabase Table Editor shows rows in `linkedin_dm_contacts`
- [ ] Notes edited in the UI appear updated in Supabase within seconds of blur
- [ ] All three Networking tabs function correctly (Find Contacts, Networking Log, LinkedIn DMs)
