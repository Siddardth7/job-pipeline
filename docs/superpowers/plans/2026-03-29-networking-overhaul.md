# Networking Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix contact search (location filter + per-persona hybrid Serper strategy), add persona multiselect UI, overhaul status model (5 new statuses), update Follow-ups tab (Accepted/Replied only + 7-day auto-surface + inline AI draft), and add POC List tab.

**Architecture:** Two files changed only. `api/find-contacts.js` — full rewrite with hybrid Serper strategy (1 broad call + targeted fill-ins for missing personas, location-first with fallback). `src/components/Networking.jsx` — persona multiselect in Find Contacts, new STATUS_OPTS/STATUS_COLORS, `migrateStatus()` helper for backwards compatibility, rewritten Follow-ups tab filtering to Accepted/Replied + `FollowUpCard` component with inline AI draft, new POC List 5th tab. No schema changes. No groq.js changes.

**Tech Stack:** React 18, Vercel API routes (ES modules), Serper.dev Google Search API, Groq AI (already wired)

---

### Task 1: Rewrite api/find-contacts.js

**Files:**
- Modify: `api/find-contacts.js`

- [ ] **Step 1: Read the current file**

Read `api/find-contacts.js` fully before editing.

- [ ] **Step 2: Replace entire file with the new implementation**

Write the complete new `api/find-contacts.js`:

```javascript
const PERSONA_MAP = {
  'Recruiter':       { keywords: ['recruiter', 'talent acquisition', 'recruiting'],                              query: 'recruiter OR "talent acquisition"' },
  'Hiring Manager':  { keywords: ['hiring manager'],                                                              query: '"hiring manager"' },
  'Peer Engineer':   { keywords: ['engineer', 'analyst', 'scientist', 'developer'],                              query: 'engineer OR analyst OR scientist' },
  'Executive':       { keywords: ['vp', 'vice president', 'director', 'president', 'ceo', 'cto', 'coo'],        query: 'director OR "vice president" OR vp' },
  'UIUC Alumni':     { keywords: ['uiuc', 'illinois', 'university of illinois'], checkSnippet: true,             query: '"university of illinois" OR uiuc' },
  'Senior Engineer': { keywords: ['senior engineer', 'staff engineer', 'principal'],                             query: '"senior engineer" OR "staff engineer" OR principal' },
};

const DEFAULT_PERSONAS = ['Recruiter', 'Hiring Manager', 'Peer Engineer', 'UIUC Alumni'];

async function serperSearch(query, apiKey, num = 10) {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num }),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.organic || [];
}

function buildBroadQuery(company, role, location) {
  let q = `site:linkedin.com/in "${company}"`;
  if (role)     q += ` "${role}"`;
  if (location) q += ` "${location}"`;
  return q;
}

function buildTargetedQuery(company, persona, location) {
  const q = `site:linkedin.com/in "${company}" ${PERSONA_MAP[persona].query}`;
  return location ? q + ` "${location}"` : q;
}

function classifyPersona(result, personas) {
  const tl = (result.title   || '').toLowerCase();
  const sl = (result.snippet || '').toLowerCase();
  for (const persona of personas) {
    const cfg  = PERSONA_MAP[persona];
    if (!cfg) continue;
    const text = cfg.checkSnippet ? tl + ' ' + sl : tl;
    if (cfg.keywords.some(k => text.includes(k))) return persona;
  }
  return null;
}

function parseContact(result, company, personaSlot, idx) {
  const parts = (result.title || '').split(' - ');
  const name  = parts[0]?.replace(' | LinkedIn', '').trim() || `Contact ${idx + 1}`;
  const title = parts[1]?.trim() || '';
  const tl    = title.toLowerCase();
  const sl    = (result.snippet || '').toLowerCase();

  let type = 'HR';
  if      (tl.includes('recruiter') || tl.includes('talent acquisition') || tl.includes('recruiting'))                                                           type = 'Recruiter';
  else if (tl.includes('hiring manager'))                                                                                                                          type = 'Hiring Manager';
  else if (tl.includes('senior engineer') || tl.includes('staff engineer') || tl.includes('principal'))                                                           type = 'Senior Engineer';
  else if (tl.includes('vp') || tl.includes('vice president') || tl.includes('director') || tl.includes('president') || tl.includes('ceo') || tl.includes('cto') || tl.includes('coo')) type = 'Executive';
  else if (tl.includes('engineer') || tl.includes('manager') || tl.includes('lead') || tl.includes('analyst') || tl.includes('scientist'))                      type = 'Peer';

  const uiuc = tl.includes('uiuc') || tl.includes('illinois') || sl.includes('uiuc') || sl.includes('university of illinois');

  return {
    id:          `c${Date.now()}-${idx}`,
    name,
    title,
    type,
    personaSlot,
    company,
    linkedin_url: result.link || '',
    email:        '',
    why:          (result.snippet || '').slice(0, 100),
    uiuc,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    company,
    role     = '',
    location = '',
    personas = DEFAULT_PERSONAS,
    serperKey,
  } = req.body || {};

  const apiKey = process.env.SERPER_API_KEY || serperKey;
  if (!apiKey)  return res.status(500).json({ error: 'No Serper API key — add it in Settings or set SERPER_API_KEY env var' });
  if (!company) return res.status(400).json({ error: 'company is required' });

  try {
    // ── Step 1: Broad call with location ──────────────────────────────────────
    let broad = await serperSearch(buildBroadQuery(company, role, location), apiKey, 10);
    if (broad.length === 0 && location) {
      broad = await serperSearch(buildBroadQuery(company, role, ''), apiKey, 10);
    }

    // ── Step 2: Classify broad results into persona buckets ───────────────────
    const buckets   = {};
    const usedLinks = new Set();
    for (const r of broad) {
      const persona = classifyPersona(r, personas);
      if (persona && !buckets[persona] && !usedLinks.has(r.link)) {
        buckets[persona] = r;
        usedLinks.add(r.link);
      }
    }

    // ── Step 3: Targeted fill-ins for missing personas ────────────────────────
    for (const persona of personas) {
      if (buckets[persona]) continue;
      let targeted = await serperSearch(buildTargetedQuery(company, persona, location), apiKey, 3);
      if (targeted.length === 0 && location) {
        targeted = await serperSearch(buildTargetedQuery(company, persona, ''), apiKey, 3);
      }
      const fresh = targeted.filter(r => !usedLinks.has(r.link));
      if (fresh.length > 0) {
        buckets[persona] = fresh[0];
        usedLinks.add(fresh[0].link);
      }
    }

    // ── Step 4: Build final contacts — fallback to unused broad results ────────
    const fallback = broad.filter(r => !usedLinks.has(r.link));
    let fi = 0;
    const contacts = personas.map((persona, i) => {
      const r = buckets[persona] || fallback[fi++] || null;
      return r ? parseContact(r, company, persona, i) : null;
    }).filter(Boolean);

    return res.status(200).json(contacts);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add api/find-contacts.js
git commit -m "feat: rewrite find-contacts — hybrid Serper strategy, location filter, per-persona search"
```

---

### Task 2: Update Find Contacts tab UI (Networking.jsx)

**Files:**
- Modify: `src/components/Networking.jsx`

- [ ] **Step 1: Read the current file**

Read `src/components/Networking.jsx` fully before making any edits.

- [ ] **Step 2: Add selectedPersonas and personasOpen state**

Find (around line 192):
```javascript
  const [totalCount, setTotalCount] = useState(5);
  const [tab, setTab]     = useState("find");
```
Replace with:
```javascript
  const [selectedPersonas, setSelectedPersonas] = useState(['Recruiter', 'Hiring Manager', 'Peer Engineer', 'UIUC Alumni']);
  const [personasOpen, setPersonasOpen] = useState(false);
  const [tab, setTab]     = useState("find");
```
(Remove `totalCount` — it is replaced by `selectedPersonas.length`.)

- [ ] **Step 3: Update findContacts to pass location and personas**

Find:
```javascript
        body: JSON.stringify({company: co, role, count: totalCount, serperKey})
```
Replace with:
```javascript
        body: JSON.stringify({ company: co, role, location: loc, personas: selectedPersonas, serperKey })
```

- [ ] **Step 4: Replace the Find Contacts form inputs grid**

Find (the 3-col grid + count slider block):
```jsx
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:12}}>
              <Input label="Company" value={co} onChange={e => setCo(e.target.value)} t={t}/>
              <Input label="Role" value={role} onChange={e => setRole(e.target.value)} t={t}/>
              <Input label="Location" value={loc} onChange={e => setLoc(e.target.value)} t={t}/>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
              <span style={{fontSize:13.5,color:t.sub}}>Find</span>
              <input type="number" min={3} max={10} value={totalCount} onChange={e => setTotalCount(Math.max(3,Math.min(10,+e.target.value)))} style={{width:50,background:t.bg,border:`1px solid ${t.border}`,borderRadius:7,padding:"7px 10px",color:t.tx,fontSize:14,fontWeight:700,textAlign:"center",fontFamily:"inherit",outline:"none"}}/>
              <span style={{fontSize:13.5,color:t.sub}}>contacts</span>
            </div>
```
Replace with:
```jsx
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
              <Input label="Company" value={co} onChange={e => setCo(e.target.value)} t={t}/>
              <Input label="Role" value={role} onChange={e => setRole(e.target.value)} t={t}/>
              <Input label="Location" value={loc} onChange={e => setLoc(e.target.value)} t={t}/>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:11,fontWeight:700,color:t.sub,display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:1}}>Target Personas</label>
                <div style={{position:"relative"}}>
                  <button
                    onClick={() => setPersonasOpen(p => !p)}
                    style={{width:"100%",background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"9px 13px",color:selectedPersonas.length?t.tx:t.muted,fontSize:13,outline:"none",boxSizing:"border-box",fontFamily:"inherit",cursor:"pointer",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center"}}
                  >
                    <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"85%"}}>
                      {selectedPersonas.length ? selectedPersonas.join(", ") : "Select personas"}
                    </span>
                    <span style={{fontSize:10,flexShrink:0}}>▾</span>
                  </button>
                  {personasOpen && (
                    <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,background:t.card,border:`1px solid ${t.border}`,borderRadius:8,zIndex:100,padding:8,boxShadow:t.shadow}}>
                      {PERSONAS.map(p => (
                        <label key={p} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",cursor:"pointer",fontSize:13,color:t.tx,borderRadius:6,background:selectedPersonas.includes(p)?t.hover:"transparent"}}>
                          <input
                            type="checkbox"
                            checked={selectedPersonas.includes(p)}
                            onChange={e => setSelectedPersonas(prev => e.target.checked ? [...prev, p] : prev.filter(x => x !== p))}
                            style={{accentColor:t.pri}}
                          />
                          {p}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
```

- [ ] **Step 5: Update the Find Contacts button label to show count from personas**

Find:
```jsx
            <Btn onClick={findContacts} disabled={loading||!co} t={t}>{loading?"Searching...":"Find Contacts"}</Btn>
```
Replace with:
```jsx
            <Btn onClick={() => { setPersonasOpen(false); findContacts(); }} disabled={loading||!co||selectedPersonas.length===0} t={t}>
              {loading ? "Searching..." : `Find ${selectedPersonas.length} Contact${selectedPersonas.length !== 1 ? 's' : ''}`}
            </Btn>
```

- [ ] **Step 6: Update contact card to show personaSlot badge**

Find (in the contact card section, the type badge):
```jsx
                          <span style={{fontSize:10.5,fontWeight:700,padding:"2px 8px",borderRadius:10,background:t.priL,color:t.pri}}>{c.type}</span>
```
Replace with:
```jsx
                          <span style={{fontSize:10.5,fontWeight:700,padding:"2px 8px",borderRadius:10,background:t.priL,color:t.pri}}>{c.personaSlot || c.type}</span>
```

- [ ] **Step 7: Build to verify no errors**

```bash
cd /Users/jashwanth/jobagent-web && npm run build 2>&1 | tail -15
```
Expected: build succeeds with no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/Networking.jsx
git commit -m "feat: add persona multiselect to Find Contacts, pass location+personas to API"
```

---

### Task 3: Status model update (Networking.jsx)

**Files:**
- Modify: `src/components/Networking.jsx`

- [ ] **Step 1: Replace STATUS_OPTS and STATUS_COLORS**

Find:
```javascript
const STATUS_OPTS = ['Pending', 'Replied', 'Coffee Chat', 'No Response'];
const STATUS_COLORS = {
  'Pending':     { bg: '#fef3c7', bd: '#fcd34d', tx: '#d97706' },
  'Replied':     { bg: '#dcfce7', bd: '#86efac', tx: '#16a34a' },
  'Coffee Chat': { bg: '#ede9fe', bd: '#c4b5fd', tx: '#7c3aed' },
  'No Response': { bg: '#fee2e2', bd: '#fca5a5', tx: '#dc2626' },
};
```
Replace with:
```javascript
const STATUS_OPTS = ['Sent', 'Accepted', 'Replied', 'Coffee Chat', 'Referral Secured'];
const STATUS_COLORS = {
  'Sent':             { bg: '#f1f5f9', bd: '#cbd5e1', tx: '#64748b' },
  'Accepted':         { bg: '#fef3c7', bd: '#fcd34d', tx: '#d97706' },
  'Replied':          { bg: '#dcfce7', bd: '#86efac', tx: '#16a34a' },
  'Coffee Chat':      { bg: '#ede9fe', bd: '#c4b5fd', tx: '#7c3aed' },
  'Referral Secured': { bg: '#fce7f3', bd: '#f9a8d4', tx: '#db2777' },
};

function migrateStatus(s) {
  if (s === 'Pending' || s === 'No Response' || !s) return 'Sent';
  return s;
}
```

- [ ] **Step 2: Update overdueCount to use new logic**

Find:
```javascript
  const overdueCount = networkingLog.filter(c => {
    const meta = netlogMeta?.[c.id];
    return meta?.status === 'Pending' && meta?.followUpDate && meta.followUpDate < today;
  }).length;
```
Replace with:
```javascript
  const overdueCount = networkingLog.filter(c => {
    const meta   = netlogMeta?.[c.id] || {};
    const status = migrateStatus(meta.status);
    if (status === 'Accepted') {
      const d = c.date ? new Date(c.date) : null;
      return d && Math.floor((Date.now() - d) / 86400000) >= 7;
    }
    if (status === 'Replied') {
      const d = meta.statusChangedAt ? new Date(meta.statusChangedAt) : null;
      return d && Math.floor((Date.now() - d) / 86400000) >= 7;
    }
    return false;
  }).length;
```

- [ ] **Step 3: Update filteredLog to use migrateStatus**

Find:
```javascript
  const filteredLog = logFilter === 'All'
    ? networkingLog
    : networkingLog.filter(c => (netlogMeta?.[c.id]?.status || 'Pending') === logFilter);
```
Replace with:
```javascript
  const filteredLog = logFilter === 'All'
    ? networkingLog
    : networkingLog.filter(c => migrateStatus(netlogMeta?.[c.id]?.status) === logFilter);
```

- [ ] **Step 4: Update status read in Networking Log table rows**

Find (inside `filteredLog.map`):
```javascript
                    const meta = netlogMeta?.[c.id] || {};
                    const status = meta.status || 'Pending';
                    const followUpDate = meta.followUpDate || '';
                    const isOverdue = status === 'Pending' && followUpDate && followUpDate < today;
```
Replace with:
```javascript
                    const meta = netlogMeta?.[c.id] || {};
                    const status = migrateStatus(meta.status);
                    const followUpDate = meta.followUpDate || '';
                    const isOverdue = (() => {
                      if (status === 'Accepted') {
                        const d = c.date ? new Date(c.date) : null;
                        return d && Math.floor((Date.now() - d) / 86400000) >= 7;
                      }
                      if (status === 'Replied') {
                        const d = meta.statusChangedAt ? new Date(meta.statusChangedAt) : null;
                        return d && Math.floor((Date.now() - d) / 86400000) >= 7;
                      }
                      return false;
                    })();
```

- [ ] **Step 5: Update status dropdown onChange to include statusChangedAt**

Find (inside the log table status cell):
```javascript
                            onChange={e => updateNetlogMeta(c.id, {status: e.target.value})}
```
Replace with:
```javascript
                            onChange={e => updateNetlogMeta(c.id, { status: e.target.value, statusChangedAt: new Date().toISOString() })}
```

- [ ] **Step 6: Remove the follow-up date cell from log table (no longer needed)**

The `followUpDate` column in the log table is no longer needed since the 7-day rule is automatic. Find the table header array and the follow-up cell:

Find:
```jsx
                    {["Date","Name","Type","Company","Status","Follow-up","LinkedIn"].map(h => (
```
Replace with:
```jsx
                    {["Date","Name","Type","Company","Status","LinkedIn"].map(h => (
```

Find (the follow-up `<td>` in each row — it renders `followUpDate`):
```jsx
                        <td style={{padding:"10px 12px",whiteSpace:"nowrap"}}>
                          <span style={{fontSize:12,fontWeight:600,color:isOverdue?t.red:t.sub,display:"flex",alignItems:"center",gap:4}}>
                            {followUpDate || '—'}
                            {isOverdue && <AlertTriangle size={12} color={t.red}/>}
                          </span>
                        </td>
```
Replace with an empty fragment (remove the cell entirely):
```jsx
```
(Delete those 6 lines entirely.)

- [ ] **Step 7: Build to verify no errors**

```bash
cd /Users/jashwanth/jobagent-web && npm run build 2>&1 | tail -15
```
Expected: build succeeds with no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/Networking.jsx
git commit -m "feat: update networking log status model — Sent/Accepted/Replied/Coffee Chat/Referral Secured"
```

---

### Task 4: Follow-ups tab overhaul (Networking.jsx)

**Files:**
- Modify: `src/components/Networking.jsx`

- [ ] **Step 1: Add FollowUpCard component before the Networking export**

`FollowUpCard` needs its own `useState` for the inline draft, so it must be a proper component (not an inline function). Add it **before** the `export default function Networking(...)` line.

Find the line:
```javascript
export default function Networking({currentJob,
```
Insert the entire `FollowUpCard` component immediately before it:

```javascript
function FollowUpCard({ c, meta, groqKey, updateNetlogMeta, t }) {
  const [draft, setDraft]       = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState('');
  const [copied, setCopied]     = useState(false);

  const status = migrateStatus(meta.status);
  const sc     = STATUS_COLORS[status] || { bg: t.hover, bd: t.border, tx: t.sub };

  const daysAgo = (() => {
    if (status === 'Accepted') {
      const d = c.date ? new Date(c.date) : null;
      return d ? Math.floor((Date.now() - d) / 86400000) : null;
    }
    if (status === 'Replied') {
      const d = meta.statusChangedAt ? new Date(meta.statusChangedAt) : null;
      return d ? Math.floor((Date.now() - d) / 86400000) : null;
    }
    return null;
  })();

  const draftFollowUp = async () => {
    if (!groqKey) { setDraftErr('Add Groq API key in Settings.'); return; }
    setDrafting(true);
    setDraftErr('');
    try {
      const contact = { name: c.name, title: c.role, company: c.company, why: '', uiuc: false, type: c.type };
      const job     = { role: c.role, company: c.company, location: '' };
      const result  = await draftMessageWithGroq(c.type || 'Recruiter', 'job_application_ask', 'followup', contact, job, groqKey, '');
      setDraft(result);
    } catch (e) {
      setDraftErr('Draft failed: ' + e.message);
    }
    setDrafting(false);
  };

  const handleCopy = () => {
    robustCopy(draft).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  };

  return (
    <Card t={t} style={{ marginBottom: 10, padding: 14, borderLeft: daysAgo >= 7 ? `3px solid ${t.yellow}` : undefined }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: t.tx }}>{c.name}</div>
          <div style={{ fontSize: 12.5, color: t.sub, marginTop: 2 }}>{c.role}{c.company ? ` at ${c.company}` : ""}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: sc.bg, border: `1px solid ${sc.bd}`, color: sc.tx }}>{status}</span>
            {daysAgo !== null && (
              <span style={{ fontSize: 11, fontWeight: 600, color: daysAgo >= 7 ? t.red : t.sub }}>
                {daysAgo}d {daysAgo >= 7 ? '— follow up now' : 'ago'}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {c.linkedinUrl && (
            <a href={c.linkedinUrl} target="_blank" rel="noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 6, background: "#0077B5", color: "#fff", fontWeight: 600, fontSize: 12, textDecoration: "none" }}>
              <Linkedin size={12} /> Message
            </a>
          )}
          <Btn size="sm" variant="secondary" onClick={draftFollowUp} disabled={drafting} t={t}>
            {drafting
              ? <><RefreshCw size={11} style={{ animation: "lp-spin 1s linear infinite" }} /> Drafting...</>
              : <><Sparkles size={11} /> Draft Follow-up</>}
          </Btn>
          <select
            value={status}
            onChange={e => updateNetlogMeta(c.id, { status: e.target.value, statusChangedAt: new Date().toISOString() })}
            style={{ background: sc.bg, border: `1px solid ${sc.bd}`, borderRadius: 7, padding: "4px 8px", color: sc.tx, fontSize: 12, fontWeight: 700, fontFamily: "inherit", outline: "none", cursor: "pointer" }}
          >
            {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {draftErr && <div style={{ fontSize: 12, color: t.red, marginTop: 8, fontWeight: 600 }}>{draftErr}</div>}
      {!groqKey && !draft && (
        <div style={{ fontSize: 11.5, color: t.yellow, marginTop: 8, padding: "5px 10px", background: t.yellowL, borderRadius: 6 }}>
          Add Groq API key in Settings to enable AI drafting.
        </div>
      )}
      {draft && (
        <div style={{ marginTop: 12 }}>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={5}
            style={{ width: "100%", background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8, padding: "10px 14px", color: t.tx, fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box", outline: "none", lineHeight: 1.6 }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
            <Btn size="sm" variant="green" onClick={handleCopy} t={t}>
              {copied ? <><Check size={12} /> Copied!</> : <><Copy size={12} /> Copy</>}
            </Btn>
          </div>
        </div>
      )}
    </Card>
  );
}

```

- [ ] **Step 2: Replace the entire followups tab body**

Find (the entire `{tab === "followups" && (` block through its closing `)}` — from line ~652 to ~749):

```jsx
      {tab === "followups" && (
        <div>
          <div style={{marginBottom:16,padding:"10px 14px",borderRadius:8,background:t.yellowL,border:`1px solid ${t.yellowBd}`,fontSize:12.5,color:t.yellow,fontWeight:600}}>
            ⚠️ LinkedIn only allows messaging 1st-degree connections. For pending requests, copy the message and send manually after they accept.
          </div>
          ...
        </div>
      )}
```

Replace the entire block with:

```jsx
      {tab === "followups" && (
        <div>
          <div style={{marginBottom:16,padding:"10px 14px",borderRadius:8,background:t.yellowL,border:`1px solid ${t.yellowBd}`,fontSize:12.5,color:t.yellow,fontWeight:600}}>
            ⚠️ Only contacts who accepted your request appear here. Draft a follow-up and send via LinkedIn.
          </div>

          {networkingLog.length === 0 && (
            <Card t={t} style={{textAlign:"center",padding:"60px 24px"}}>
              <Users size={32} color={t.muted} style={{marginBottom:12}}/>
              <div style={{fontSize:14,fontWeight:600,color:t.sub}}>No networking contacts yet.</div>
            </Card>
          )}

          {networkingLog.length > 0 && (() => {
            const withMeta = networkingLog
              .map(c => ({...c, meta: netlogMeta?.[c.id] || {}}))
              .filter(c => { const s = migrateStatus(c.meta.status); return s === 'Accepted' || s === 'Replied'; });

            const daysFor = (c) => {
              const s = migrateStatus(c.meta.status);
              if (s === 'Accepted') {
                const d = c.date ? new Date(c.date) : null;
                return d ? Math.floor((Date.now() - d) / 86400000) : 0;
              }
              if (s === 'Replied') {
                const d = c.meta.statusChangedAt ? new Date(c.meta.statusChangedAt) : null;
                return d ? Math.floor((Date.now() - d) / 86400000) : 0;
              }
              return 0;
            };

            const due      = withMeta.filter(c => daysFor(c) >= 7);
            const upcoming = withMeta.filter(c => daysFor(c) < 7);

            if (withMeta.length === 0) {
              return (
                <Card t={t} style={{textAlign:"center",padding:"60px 24px"}}>
                  <Users size={32} color={t.muted} style={{marginBottom:12}}/>
                  <div style={{fontSize:14,fontWeight:600,color:t.sub,marginBottom:8}}>No accepted contacts yet.</div>
                  <div style={{fontSize:13,color:t.muted}}>Mark contacts as "Accepted" in the Networking Log when they accept your request.</div>
                </Card>
              );
            }

            return (
              <div>
                {due.length > 0 && (
                  <div style={{marginBottom:20}}>
                    <div style={{fontSize:12,fontWeight:700,color:t.yellow,textTransform:"uppercase",letterSpacing:1.5,marginBottom:10}}>🟡 Follow-up Due ({due.length})</div>
                    {due.map(c => <FollowUpCard key={c.id} c={c} meta={c.meta} groqKey={groqKey} updateNetlogMeta={updateNetlogMeta} t={t}/>)}
                  </div>
                )}
                {upcoming.length > 0 && (
                  <div style={{marginBottom:20}}>
                    <div style={{fontSize:12,fontWeight:700,color:t.green,textTransform:"uppercase",letterSpacing:1.5,marginBottom:10}}>✅ Recently Connected ({upcoming.length})</div>
                    {upcoming.map(c => <FollowUpCard key={c.id} c={c} meta={c.meta} groqKey={groqKey} updateNetlogMeta={updateNetlogMeta} t={t}/>)}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
```

- [ ] **Step 3: Build to verify no errors**

```bash
cd /Users/jashwanth/jobagent-web && npm run build 2>&1 | tail -15
```
Expected: build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/Networking.jsx
git commit -m "feat: rewrite follow-ups tab — Accepted/Replied filter, 7-day auto-surface, inline draft button"
```

---

### Task 5: Add POC List tab (Networking.jsx)

**Files:**
- Modify: `src/components/Networking.jsx`

- [ ] **Step 1: Add POC count computed value**

After the `overdueCount` declaration, add:

```javascript
  const pocCount = networkingLog.filter(c => migrateStatus(netlogMeta?.[c.id]?.status) === 'Referral Secured').length;
```

- [ ] **Step 2: Add POC List chip to the tab bar**

Find (the last chip in the tab bar):
```jsx
          <Chip active={tab==="followups"} onClick={() => setTab("followups")} t={t} color={overdueCount > 0 ? "#dc2626" : undefined}>
            Follow-ups {overdueCount > 0 && <span style={{marginLeft:5,fontSize:11,fontWeight:800,padding:"1px 6px",borderRadius:10,background:"#dc262622",color:"#dc2626"}}>{overdueCount}</span>}
          </Chip>
```
After it, add:
```jsx
          <Chip active={tab==="poc"} onClick={() => setTab("poc")} t={t} color={pocCount > 0 ? "#db2777" : undefined}>
            POC List {pocCount > 0 && <span style={{marginLeft:5,fontSize:11,fontWeight:800,padding:"1px 6px",borderRadius:10,background:"#db277722",color:"#db2777"}}>{pocCount}</span>}
          </Chip>
```

- [ ] **Step 3: Add POC tab content**

Find the closing `</div>` that ends the entire Networking component return (the one just before `);` at the end of the file, after the followups tab closing `}`):

```jsx
    </div>
  );
}
```

Insert the POC tab block immediately before `    </div>` (i.e., between the followups `)}` and the outer `</div>`):

```jsx
      {tab === "poc" && (
        <div>
          <div style={{marginBottom:20}}>
            <h3 style={{margin:"0 0 4px",fontSize:16,fontWeight:700,color:t.tx}}>Your Referral Network</h3>
            <p style={{margin:0,fontSize:13,color:t.sub}}>One POC per company — contacts who secured a referral for you.</p>
          </div>

          {(() => {
            const pocs = networkingLog
              .map(c => ({...c, meta: netlogMeta?.[c.id] || {}}))
              .filter(c => migrateStatus(c.meta.status) === 'Referral Secured')
              .sort((a, b) => new Date(b.date) - new Date(a.date));

            if (pocs.length === 0) {
              return (
                <Card t={t} style={{textAlign:"center",padding:"60px 24px"}}>
                  <Users size={32} color={t.muted} style={{marginBottom:12}}/>
                  <div style={{fontSize:14,fontWeight:600,color:t.sub,marginBottom:8}}>No POCs yet.</div>
                  <div style={{fontSize:13,color:t.muted}}>When a contact secures a referral, mark them as "Referral Secured" in the Networking Log.</div>
                </Card>
              );
            }

            // Group by company
            const byCompany = {};
            for (const c of pocs) {
              const key = (c.company || 'Unknown').toLowerCase();
              if (!byCompany[key]) byCompany[key] = { company: c.company || 'Unknown', contacts: [] };
              byCompany[key].contacts.push(c);
            }

            return Object.values(byCompany).map(group => (
              <div key={group.company} style={{marginBottom:24}}>
                <div style={{fontSize:11,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:1.5,marginBottom:10,paddingBottom:6,borderBottom:`1px solid ${t.border}`}}>{group.company}</div>
                {group.contacts.map((c, i) => (
                  <Card key={c.id} t={t} style={{marginBottom:8,padding:14,borderLeft:i===0?`3px solid #db2777`:undefined}}>
                    <div style={{display:"flex",alignItems:"center",gap:12}}>
                      <Avatar name={c.name} size={38} t={t}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                          <span style={{fontWeight:700,fontSize:14,color:t.tx}}>{c.name}</span>
                          {i === 0 && <span style={{fontSize:10.5,fontWeight:700,padding:"2px 8px",borderRadius:10,background:t.greenL,color:t.green}}>Active POC</span>}
                          <span style={{fontSize:10.5,fontWeight:700,padding:"2px 8px",borderRadius:10,background:'#fce7f3',color:'#db2777'}}>Referral Secured</span>
                        </div>
                        <div style={{fontSize:12.5,color:t.muted,marginTop:2}}>{c.role}</div>
                        <div style={{fontSize:12,color:t.sub,marginTop:2}}>Secured {c.date}</div>
                      </div>
                      {c.linkedinUrl && (
                        <a href={c.linkedinUrl} target="_blank" rel="noreferrer"
                          style={{display:"inline-flex",alignItems:"center",gap:4,padding:"5px 10px",borderRadius:6,background:"#0077B5",color:"#fff",fontWeight:600,fontSize:12,textDecoration:"none",flexShrink:0}}>
                          <Linkedin size={12}/> LinkedIn
                        </a>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            ));
          })()}
        </div>
      )}
```

- [ ] **Step 4: Build to verify no errors**

```bash
cd /Users/jashwanth/jobagent-web && npm run build 2>&1 | tail -15
```
Expected: build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/Networking.jsx
git commit -m "feat: add POC List tab — grouped Referral Secured contacts by company"
```

---

### Task 6: Run tests and deploy

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/jashwanth/jobagent-web && npm test
```
Expected: all vitest tests pass (existing tests cover dashboard-utils and storage; no new unit tests needed since the contact search is an external API and the UI changes are visual).

- [ ] **Step 2: Final build check**

```bash
cd /Users/jashwanth/jobagent-web && npm run build 2>&1 | tail -10
```
Expected: build succeeds.

- [ ] **Step 3: Push to origin**

```bash
git push origin main
```
Expected: push succeeds, Vercel auto-deployment triggers.

- [ ] **Step 4: Verify Vercel deployment**

```bash
cd /Users/jashwanth/jobagent-web && npx vercel --prod 2>&1 | tail -10
```
Expected: deployment URL printed, status: Ready.
