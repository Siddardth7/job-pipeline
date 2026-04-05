import { useState, useEffect, useRef } from 'react';
import { Users, Send, Linkedin, Mail, Copy, Check, MessageSquare, Sparkles, RefreshCw, AlertTriangle, Search, Plus, X } from 'lucide-react';
import { fetchLinkedInContacts, updateLinkedInContactNotes, fetchLinkedInStats } from '../lib/storage.js';
import { draftMessageWithGroq } from '../lib/groq.js';
import { supabase } from '../supabase.js';

function Card({children, t, style, onClick}) {
  return <div onClick={onClick} style={{background:t.card,border:`1px solid ${t.border}`,borderRadius:12,padding:20,boxShadow:t.shadow,cursor:onClick?"pointer":"default",...style}}>{children}</div>;
}
function Btn({children, onClick, disabled, variant="primary", size="md", t, style:xs}) {
  const V={primary:{bg:t.pri,c:"#fff",b:"none"},secondary:{bg:"transparent",c:t.sub,b:`1px solid ${t.border}`},green:{bg:t.greenL,c:t.green,b:`1px solid ${t.greenBd}`},red:{bg:t.redL,c:t.red,b:`1px solid ${t.redBd}`}};
  const s=V[variant]||V.primary; const p=size==="sm"?"5px 14px":"10px 20px"; const fs=size==="sm"?12.5:13.5;
  return <button onClick={onClick} disabled={disabled} style={{background:s.bg,color:s.c,border:s.b,padding:p,borderRadius:8,fontSize:fs,fontWeight:600,cursor:disabled?"not-allowed":"pointer",opacity:disabled?.4:1,fontFamily:"inherit",whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:6,...xs}}>{children}</button>;
}
function Input({label, value, onChange, placeholder, t, style:xs}) {
  return <div style={{marginBottom:14}}>{label&&<label style={{fontSize:11,fontWeight:700,color:t.sub,display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:1}}>{label}</label>}<input value={value} onChange={onChange} placeholder={placeholder} style={{width:"100%",background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"9px 13px",color:t.tx,fontSize:13.5,outline:"none",boxSizing:"border-box",fontFamily:"inherit",...xs}}/></div>;
}
function Chip({children, active, onClick, t, color}) {
  return <button onClick={onClick} style={{padding:"6px 16px",borderRadius:20,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",background:active?(color||t.pri):t.card,border:`1px solid ${active?(color||t.pri):t.border}`,color:active?"#fff":t.sub}}>{children}</button>;
}
function SectionLabel({children, t}) {
  return <div style={{fontSize:10.5,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:2,marginBottom:14}}>{children}</div>;
}
function Avatar({name, size=36, t}) {
  const initials = (name||"??").split(" ").slice(0,2).map(w => w[0]||"").join("").toUpperCase();
  const colors = ["#0284c7","#16a34a","#d97706","#7c3aed","#db2777","#0891b2"];
  const idx = name ? (name.charCodeAt(0)+name.charCodeAt(name.length-1))%colors.length : 0;
  return <div style={{width:size,height:size,borderRadius:"50%",background:colors[idx]+"22",border:`1.5px solid ${colors[idx]}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*.33,fontWeight:700,color:colors[idx],flexShrink:0}}>{initials}</div>;
}

function robustCopy(text) {
  if (!text) return Promise.reject("Nothing to copy");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); return Promise.resolve(); } catch { return Promise.reject(); }
      finally { document.body.removeChild(ta); }
    });
  }
  return Promise.resolve();
}

const PERSONAS = ['Recruiter', 'Hiring Manager', 'Peer Engineer', 'Executive', 'UIUC Alumni', 'Senior Engineer'];
const INTENTS = [
  { value: 'job_application_ask', label: 'Job Application Ask' },
  { value: 'cold_outreach',       label: 'Cold Outreach' },
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

function ContactDraftSection({contact, currentJob, groqKey, t}) {
  const autoPersona = contact.uiuc ? 'UIUC Alumni' : (contact.type || 'Peer Engineer');
  const [persona, setPersona]     = useState(PERSONAS.includes(autoPersona) ? autoPersona : 'Peer Engineer');
  const [intent, setIntent]       = useState('job_application_ask');
  const [format, setFormat]       = useState('connection_note');
  const [draft, setDraft]         = useState('');
  const [copied, setCopied]       = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError]     = useState('');
  const [regenNote, setRegenNote] = useState('');

  const selectedFormat = FORMATS.find(f => f.value === format) || FORMATS[0];
  const charCount = draft.length;
  const wordCount = draft.trim() ? draft.trim().split(/\s+/).length : 0;
  const limitVal  = selectedFormat.limitType === 'chars' ? charCount : wordCount;
  const overLimit = limitVal > selectedFormat.max;

  const generateDraft = async () => {
    if (!groqKey) { setAiError('Add your Groq API key in Settings to enable AI drafting.'); return; }
    setAiError('');
    setGenerating(true);
    try {
      const result = await draftMessageWithGroq(persona, intent, format, contact, currentJob, groqKey, regenNote);
      setDraft(result);
      setRegenNote(''); // clear after use
    } catch(e) {
      setAiError('AI draft failed: ' + e.message);
    }
    setGenerating(false);
  };

  const handleCopy = () => {
    robustCopy(draft).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  };

  const sel = {background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:'8px 11px',color:t.tx,fontSize:12.5,fontFamily:'inherit',outline:'none',width:'100%'};

  return (
    <div style={{marginTop:16,paddingTop:14,borderTop:`1px solid ${t.border}`}}>
      <div style={{fontSize:11,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:1.5,marginBottom:10,display:"flex",alignItems:"center",gap:6}}>
        <MessageSquare size={12}/> Draft Message
        {groqKey && <span style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:10,background:t.yellowL,color:t.yellow}}>Groq AI</span>}
        {contact.uiuc && <span style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:10,background:t.greenL,color:t.green}}>UIUC Alumni</span>}
      </div>

      {/* 3 selectors + Draft button */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr auto",gap:8,marginBottom:10,alignItems:"end"}}>
        <div>
          <label style={{fontSize:10,fontWeight:700,color:t.muted,display:"block",marginBottom:4,textTransform:"uppercase",letterSpacing:1}}>Persona</label>
          <select value={persona} onChange={e => setPersona(e.target.value)} style={sel}>
            {PERSONAS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={{fontSize:10,fontWeight:700,color:t.muted,display:"block",marginBottom:4,textTransform:"uppercase",letterSpacing:1}}>Intent</label>
          <select value={intent} onChange={e => setIntent(e.target.value)} style={sel}>
            {INTENTS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
          </select>
        </div>
        <div>
          <label style={{fontSize:10,fontWeight:700,color:t.muted,display:"block",marginBottom:4,textTransform:"uppercase",letterSpacing:1}}>Format</label>
          <select value={format} onChange={e => { setFormat(e.target.value); setDraft(''); }} style={sel}>
            {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <Btn size="sm" onClick={generateDraft} disabled={generating || !groqKey} t={t} style={{height:36,alignSelf:"end"}}>
          {generating ? <><RefreshCw size={12} style={{animation:"spin 1s linear infinite"}}/> Drafting...</> : <><Sparkles size={12}/> Draft</>}
        </Btn>
      </div>

      <div style={{fontSize:11.5,color:t.muted,marginBottom:10,padding:"5px 10px",background:t.hover,borderRadius:6}}>
        {FORMAT_HINTS[format]}
      </div>

      {!groqKey && (
        <div style={{fontSize:12,color:t.yellow,marginBottom:10,padding:"7px 11px",background:t.yellowL,borderRadius:6,border:`1px solid ${t.yellowBd}`}}>
          Add Groq API key in Settings to enable AI drafting.
        </div>
      )}
      {aiError && <div style={{fontSize:12,color:t.red,marginBottom:8,fontWeight:600}}>{aiError}</div>}

      {draft && (
        <div>
          <textarea value={draft} onChange={e => setDraft(e.target.value)}
            rows={format === 'cold_email' ? 9 : 5}
            style={{width:"100%",background:t.bg,border:`1px solid ${overLimit ? t.red : t.border}`,borderRadius:8,padding:"10px 14px",color:t.tx,fontSize:13,fontFamily:"inherit",resize:"vertical",boxSizing:"border-box",outline:"none",lineHeight:1.6}}
          />
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:6}}>
            <span style={{fontSize:11.5,fontWeight:700,color:overLimit ? t.red : t.green}}>
              {selectedFormat.limitType === 'chars'
                ? `${limitVal} / ${selectedFormat.max} chars${overLimit ? ' — OVER LIMIT' : ' — OK'}`
                : `${limitVal} / ${selectedFormat.max} words${overLimit ? ' — OVER LIMIT' : ' — OK'}`}
            </span>
            <Btn size="sm" variant="green" onClick={handleCopy} t={t}>
              {copied ? <><Check size={12}/> Copied!</> : <><Copy size={12}/> Copy</>}
            </Btn>
          </div>

          {/* Regeneration direction field */}
          <div style={{marginTop:10,display:"flex",gap:8,alignItems:"center"}}>
            <input
              value={regenNote}
              onChange={e => setRegenNote(e.target.value)}
              placeholder='Regeneration direction, e.g. "make shorter" or "focus on quality background"'
              onKeyDown={e => { if (e.key === 'Enter' && regenNote.trim()) generateDraft(); }}
              style={{flex:1,background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"7px 12px",color:t.tx,fontSize:12.5,fontFamily:"inherit",outline:"none"}}
            />
            <Btn size="sm" variant="secondary" onClick={generateDraft} disabled={generating || !groqKey} t={t}>
              <RefreshCw size={11}/> Redo
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// Status configuration
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

export default function Networking({currentJob, setCurrentJob, contactResults, setContactResults, networkingLog, addToNetworkingLog, netlogMeta, updateNetlogMeta, setPage, templates, groqKey, serperKey, t}) {
  const [co, setCo]       = useState(currentJob?.company || "");
  const [role, setRole]   = useState(currentJob?.role || "");
  const [loc, setLoc]     = useState(currentJob?.location || "");
  const [loading, setLoading] = useState(false);
  const [err, setErr]     = useState("");
  const [selectedPersonas, setSelectedPersonas] = useState(['Recruiter', 'Hiring Manager', 'Peer Engineer', 'UIUC Alumni']);
  const [personasOpen, setPersonasOpen] = useState(false);
  const [tab, setTab]     = useState("find");
  const [logFilter, setLogFilter] = useState("All");
  const [logSearch, setLogSearch] = useState("");
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContact, setNewContact] = useState({name:"",company:"",type:"Peer Engineer",role:"",email:"",linkedinUrl:""});
  const dmLoaded = useRef(false);
  const [dmContacts, setDmContacts]           = useState([]);
  const [dmLoading, setDmLoading]             = useState(false);
  const [dmError, setDmError]                 = useState('');
  const [dmNoteError, setDmNoteError]         = useState('');
  const [roleFilter, setRoleFilter]           = useState('All');
  const [statusFilter, setStatusFilter]       = useState('All');
  const [showFollowupOnly, setShowFollowupOnly] = useState(false);
  const [expandedSummaries, setExpandedSummaries] = useState(new Set());
  const [editedNotes, setEditedNotes]         = useState({});
  // Intelligence filters
  const [personaFilter, setPersonaFilter]     = useState('All');
  const [stageFilter, setStageFilter]         = useState('All');
  const [pocFilter, setPocFilter]             = useState('All');
  const [strengthFilter, setStrengthFilter]   = useState('All');
  const [fuPriorityFilter, setFuPriorityFilter] = useState('All');
  const [dmSearch, setDmSearch]               = useState('');
  const [dmStats, setDmStats]                 = useState(null);
  const [expandedGuidance, setExpandedGuidance] = useState(new Set());

  useEffect(() => {
    if (currentJob) {
      setCo(currentJob.company || "");
      setRole(currentJob.role || "");
      setLoc(currentJob.location || "");
    }
  }, [currentJob?.id]);

  useEffect(() => {
    if (tab === 'dms' && !dmLoaded.current) {
      dmLoaded.current = true;
      setDmLoading(true);
      setDmError('');
      fetchLinkedInContacts()
        .then(data => {
          setEditedNotes({});
          setDmContacts(data);
          setDmStats(fetchLinkedInStats(data));
          setDmLoading(false);
        })
        .catch(e  => { setDmError(e.message); setDmLoading(false); dmLoaded.current = false; });
    }
  }, [tab]);

  const sentIds = new Set(networkingLog.map(c => c.id));
  const today = new Date().toISOString().split('T')[0];

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

  const pocCount = networkingLog.filter(c => migrateStatus(netlogMeta?.[c.id]?.status) === 'Referral Secured').length;

  const filteredLog = networkingLog
    .filter(c => logFilter === 'All' || migrateStatus(netlogMeta?.[c.id]?.status) === logFilter)
    .filter(c => {
      if (!logSearch.trim()) return true;
      const q = logSearch.toLowerCase();
      return (c.name||"").toLowerCase().includes(q)
          || (c.company||"").toLowerCase().includes(q)
          || (c.role||"").toLowerCase().includes(q)
          || (c.linkedinUrl||c.linkedin_url||"").toLowerCase().includes(q);
    });

  const findContacts = async () => {
    setLoading(true);
    setErr("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/find-contacts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ company: co, role, location: loc, personas: selectedPersonas }),
      });
      if (!res.ok) {
        const txt = await res.text();
        let msg = `HTTP ${res.status}`;
        try { msg = JSON.parse(txt).error || msg; } catch { /* non-JSON error body */ }
        throw new Error(msg);
      }
      const contacts = await res.json();
      if (!Array.isArray(contacts) || contacts.length === 0) {
        throw new Error("No contacts found. Try different company name.");
      }
      setContactResults(contacts);
    } catch(e) {
      setErr(e.message);
    }
    setLoading(false);
  };

  const handleConnectionSent = (c) => {
    addToNetworkingLog({
      id: c.id,
      date: new Date().toLocaleDateString(),
      name: c.name || "Unknown",
      type: c.type || "Peer",
      company: c.company || co,
      role: c.title || c.type || "",
      email: c.email || "NA",
      linkedinUrl: c.linkedin_url || c.linkedinUrl || ""
    });
  };

  const getStatusStyle = (status) => STATUS_COLORS[status] || STATUS_COLORS['Pending'];

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
        <div>
          <h2 style={{margin:"0 0 4px",fontSize:24,fontWeight:700,color:t.tx}}>Networking</h2>
          <p style={{margin:0,fontSize:14,color:t.sub}}>{co ? `Contacts at ${co}` : "Find contacts at target companies"}</p>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <Chip active={tab==="find"} onClick={() => setTab("find")} t={t}>Find Contacts</Chip>
          <Chip active={tab==="log"} onClick={() => setTab("log")} t={t}>
            Networking Log ({networkingLog.length})
            {overdueCount > 0 && <span style={{marginLeft:6,fontSize:11,fontWeight:800,padding:"1px 6px",borderRadius:10,background:"#dc262622",color:"#dc2626"}}>{overdueCount}</span>}
          </Chip>
          <Chip active={tab==="dms"} onClick={() => setTab("dms")} t={t}>LinkedIn DMs</Chip>
          <Chip active={tab==="followups"} onClick={() => setTab("followups")} t={t} color={overdueCount > 0 ? "#dc2626" : undefined}>
            Follow-ups {overdueCount > 0 && <span style={{marginLeft:5,fontSize:11,fontWeight:800,padding:"1px 6px",borderRadius:10,background:"#dc262622",color:"#dc2626"}}>{overdueCount}</span>}
          </Chip>
          <Chip active={tab==="poc"} onClick={() => setTab("poc")} t={t} color={pocCount > 0 ? "#db2777" : undefined}>
            POC List {pocCount > 0 && <span style={{marginLeft:5,fontSize:11,fontWeight:800,padding:"1px 6px",borderRadius:10,background:"#db277722",color:"#db2777"}}>{pocCount}</span>}
          </Chip>
        </div>
      </div>

      {tab === "find" && (
        <div>
          <Card t={t} style={{marginBottom:20}}>
            <SectionLabel t={t}>Find Contacts</SectionLabel>
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
            <Btn onClick={() => { setPersonasOpen(false); findContacts(); }} disabled={loading||!co||selectedPersonas.length===0} t={t}>
              {loading ? "Searching..." : `Find ${selectedPersonas.length} Contact${selectedPersonas.length !== 1 ? 's' : ''}`}
            </Btn>
            {loading && (
              <div style={{display:"flex",gap:6,alignItems:"center",padding:"20px 0"}}>
                {[0,1,2].map(i => <div key={i} style={{width:7,height:7,borderRadius:"50%",background:t.pri,animation:`lp-dot .8s ${i*.15}s ease-in-out infinite`,opacity:.3}}/>)}
              </div>
            )}
            {err && <div style={{color:t.red,fontSize:13,fontWeight:600,marginTop:12}}>{err}</div>}
          </Card>

          {contactResults.length > 0 && (
            <div>
              <SectionLabel t={t}>Contacts Found ({contactResults.length})</SectionLabel>
              {contactResults.map(c => {
                const isSent = sentIds.has(c.id);
                const linkedinUrl = c.linkedin_url || c.linkedinUrl || "";
                const sc = STATUS_COLORS[c.type==="Recruiter"?'Pending':'Pending'];
                return (
                  <Card key={c.id} t={t} style={{marginBottom:12}}>
                    <div style={{display:"flex",alignItems:"flex-start",gap:14}}>
                      <Avatar name={c.name||c.type} size={42} t={t}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2,flexWrap:"wrap"}}>
                          <span style={{fontSize:14.5,fontWeight:700,color:t.tx}}>{c.name||c.type}</span>
                          <span style={{fontSize:10.5,fontWeight:700,padding:"2px 8px",borderRadius:10,background:t.priL,color:t.pri}}>{c.personaSlot || c.type}</span>
                          {c.uiuc && <span style={{fontSize:10.5,fontWeight:700,padding:"2px 8px",borderRadius:10,background:t.greenL,color:t.green}}>UIUC Alumni</span>}
                          {isSent && <span style={{fontSize:10.5,fontWeight:700,padding:"2px 8px",borderRadius:10,background:t.greenL,color:t.green}}>Sent</span>}
                        </div>
                        <div style={{fontSize:13,color:t.muted}}>{c.title || c.type} at {c.company}</div>
                        {c.email && c.email !== "NA" && c.email !== "" && (
                          <div style={{fontSize:12,color:t.sub,marginTop:2}}><Mail size={11} style={{display:"inline",verticalAlign:-1,marginRight:4}}/>{c.email}</div>
                        )}
                        {c.why && <div style={{fontSize:12,color:t.muted,marginTop:4,fontStyle:"italic"}}>{c.why}</div>}
                        <div style={{display:"flex",gap:8,alignItems:"center",marginTop:10}}>
                          {linkedinUrl && (
                            <a href={linkedinUrl} target="_blank" rel="noreferrer" style={{display:"flex",alignItems:"center",gap:6,padding:"7px 14px",borderRadius:8,background:"#0077B5",color:"#fff",fontWeight:700,fontSize:13,textDecoration:"none"}}>
                              <Linkedin size={14}/> LinkedIn Profile
                            </a>
                          )}
                          {!isSent && (
                            <Btn size="sm" variant="green" onClick={() => handleConnectionSent(c)} t={t}><Send size={12}/> Connection Sent</Btn>
                          )}
                        </div>
                        <ContactDraftSection contact={c} currentJob={currentJob} groqKey={groqKey} t={t}/>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {contactResults.length === 0 && !loading && (
            <Card t={t} style={{textAlign:"center",padding:"60px 24px"}}>
              <Users size={32} color={t.muted} style={{marginBottom:12}}/>
              <div style={{fontSize:14,fontWeight:600,color:t.sub}}>Search for contacts above.</div>
            </Card>
          )}
        </div>
      )}

      {tab === "log" && (
        <div>
          {/* Search + Add row */}
          <div style={{display:"flex",gap:10,marginBottom:14,alignItems:"center"}}>
            <div style={{flex:1,position:"relative"}}>
              <Search size={14} color={t.muted} style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)"}}/>
              <input
                value={logSearch}
                onChange={e => setLogSearch(e.target.value)}
                placeholder="Search by name, company, role, LinkedIn…"
                style={{width:"100%",background:t.card,border:`1px solid ${t.border}`,borderRadius:8,padding:"9px 12px 9px 36px",color:t.tx,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}
              />
            </div>
            <Btn size="sm" onClick={() => setShowAddContact(true)} t={t}><Plus size={13}/> Add Contact</Btn>
          </div>

          {/* Add Contact modal */}
          {showAddContact && (
            <Card t={t} style={{marginBottom:16,border:`1px solid ${t.priBd}`,background:t.priL+"55"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div style={{fontSize:13,fontWeight:700,color:t.tx}}>Add External Contact</div>
                <button onClick={() => { setShowAddContact(false); setNewContact({name:"",company:"",type:"Peer Engineer",role:"",email:"",linkedinUrl:""}); }} style={{background:"none",border:"none",cursor:"pointer",color:t.muted,padding:4}}><X size={16}/></button>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <Input label="Name *" value={newContact.name} onChange={e => setNewContact(p=>({...p,name:e.target.value}))} placeholder="Jane Smith" t={t}/>
                <Input label="Company" value={newContact.company} onChange={e => setNewContact(p=>({...p,company:e.target.value}))} placeholder="SpaceX" t={t}/>
                <div style={{marginBottom:14}}>
                  <label style={{fontSize:11,fontWeight:700,color:t.sub,display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:1}}>Type</label>
                  <select value={newContact.type} onChange={e => setNewContact(p=>({...p,type:e.target.value}))} style={{width:"100%",background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"9px 13px",color:t.tx,fontSize:13.5,fontFamily:"inherit",outline:"none"}}>
                    {PERSONAS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <Input label="Role / Title" value={newContact.role} onChange={e => setNewContact(p=>({...p,role:e.target.value}))} placeholder="Engineering Manager" t={t}/>
                <Input label="LinkedIn URL" value={newContact.linkedinUrl} onChange={e => setNewContact(p=>({...p,linkedinUrl:e.target.value}))} placeholder="https://linkedin.com/in/…" t={t}/>
                <Input label="Email" value={newContact.email} onChange={e => setNewContact(p=>({...p,email:e.target.value}))} placeholder="jane@company.com" t={t}/>
              </div>
              <Btn onClick={() => {
                if (!newContact.name.trim()) return;
                addToNetworkingLog({
                  id: `manual-${Date.now()}`,
                  date: new Date().toLocaleDateString(),
                  name: newContact.name.trim(),
                  type: newContact.type,
                  company: newContact.company.trim(),
                  role: newContact.role.trim(),
                  email: newContact.email.trim() || "NA",
                  linkedinUrl: newContact.linkedinUrl.trim(),
                });
                setShowAddContact(false);
                setNewContact({name:"",company:"",type:"Peer Engineer",role:"",email:"",linkedinUrl:""});
              }} disabled={!newContact.name.trim()} t={t}><Plus size={13}/> Add to Log</Btn>
            </Card>
          )}

          {/* Status filter row */}
          <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
            {['All', ...STATUS_OPTS].map(s => (
              <Chip key={s} active={logFilter===s} onClick={() => setLogFilter(s)} t={t}
                color={s !== 'All' ? STATUS_COLORS[s]?.tx : undefined}>
                {s}
                {s !== 'All' && (
                  <span style={{marginLeft:5,fontSize:11,fontWeight:800}}>
                    {networkingLog.filter(c => (netlogMeta?.[c.id]?.status||'Pending') === s).length}
                  </span>
                )}
              </Chip>
            ))}
            {overdueCount > 0 && (
              <span style={{display:"flex",alignItems:"center",gap:5,fontSize:12.5,color:t.red,fontWeight:700,marginLeft:8}}>
                <AlertTriangle size={14}/> {overdueCount} overdue follow-up{overdueCount > 1 ? 's' : ''}
              </span>
            )}
          </div>

          {filteredLog.length === 0 && (
            <Card t={t} style={{textAlign:"center",padding:"60px 24px"}}>
              <Users size={32} color={t.muted} style={{marginBottom:12}}/>
              <div style={{fontSize:14,fontWeight:600,color:t.sub}}>
                {logFilter === 'All' ? 'No networking contacts logged yet.' : `No contacts with status "${logFilter}".`}
              </div>
            </Card>
          )}
          {filteredLog.length > 0 && (
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{borderBottom:`2px solid ${t.border}`}}>
                    {["Date","Name","Type","Company","Status","LinkedIn","POC"].map(h => (
                      <th key={h} style={{textAlign:"left",padding:"10px 12px",fontSize:11,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:1,whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredLog.map((c,i) => {
                    const meta = netlogMeta?.[c.id] || {};
                    const status = migrateStatus(meta.status);
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
                    const sc = getStatusStyle(status);
                    return (
                      <tr key={c.id||i} style={{borderBottom:`1px solid ${t.border}`,background:isOverdue?t.redL+"88":undefined}}>
                        <td style={{padding:"10px 12px",color:t.tx,whiteSpace:"nowrap"}}>{c.date}</td>
                        <td style={{padding:"10px 12px",color:t.tx,fontWeight:600,whiteSpace:"nowrap"}}>{c.name}</td>
                        <td style={{padding:"10px 12px",whiteSpace:"nowrap"}}>
                          <span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:10,background:t.priL,color:t.pri}}>{c.type}</span>
                        </td>
                        <td style={{padding:"10px 12px",color:t.sub}}>{c.company}</td>
                        <td style={{padding:"10px 12px"}}>
                          <select
                            value={status}
                            onChange={e => updateNetlogMeta(c.id, { status: e.target.value, statusChangedAt: new Date().toISOString() })}
                            style={{background:sc.bg,border:`1px solid ${sc.bd}`,borderRadius:7,padding:"4px 8px",color:sc.tx,fontSize:12,fontWeight:700,fontFamily:"inherit",outline:"none",cursor:"pointer"}}
                          >
                            {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td style={{padding:"10px 12px"}}>
                          {(c.linkedinUrl||c.linkedin_url) && (
                            <a href={c.linkedinUrl||c.linkedin_url} target="_blank" rel="noreferrer" style={{display:"inline-flex",alignItems:"center",gap:4,padding:"5px 12px",borderRadius:6,background:"#0077B5",color:"#fff",fontWeight:600,fontSize:12,textDecoration:"none"}}>
                              <Linkedin size={13}/> Open
                            </a>
                          )}
                        </td>
                        <td style={{padding:"10px 12px"}}>
                          {status !== 'Referral Secured' && (
                            <button
                              onClick={() => updateNetlogMeta(c.id, { status: 'Referral Secured', statusChangedAt: new Date().toISOString() })}
                              style={{background:"#fce7f3",border:"1px solid #f9a8d4",borderRadius:6,padding:"4px 10px",fontSize:11.5,fontWeight:700,color:"#db2777",cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}
                            >
                              + POC
                            </button>
                          )}
                          {status === 'Referral Secured' && (
                            <span style={{fontSize:11,fontWeight:700,color:"#db2777"}}>✓ POC</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "dms" && (
        <div>

          {/* ── Intelligence Stats Row ── */}
          {dmContacts.length > 0 && dmStats && (() => {
            const s = dmStats;
            const stat = (label, val, bg, color, title) => (
              <div title={title} style={{padding:"10px 14px",borderRadius:10,fontSize:12,fontWeight:700,background:bg,color,minWidth:0,flexShrink:0}}>
                <div style={{fontSize:20,fontWeight:800,lineHeight:1}}>{val}</div>
                <div style={{fontSize:10,marginTop:2,opacity:.8,fontWeight:600,textTransform:"uppercase",letterSpacing:.5}}>{label}</div>
              </div>
            );
            return (
              <div style={{marginBottom:20}}>
                <div style={{fontSize:10.5,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:1.5,marginBottom:8}}>Network Intelligence</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {stat("Total",        s.total,        t.card,    t.tx,     "All imported LinkedIn contacts")}
                  {stat("Two-Way",      s.twoWay,       t.priL,    t.pri,    "Contacts with actual back-and-forth conversation")}
                  {stat("Warm",         s.warm,         t.greenL,  t.green,  "Warm or stronger relationship")}
                  {stat("POC Cands.",   s.pocCandidates,'#fce7f3', '#db2777',"Potential Points of Contact")}
                  {stat("Confirmed POC",s.confirmedPoc, '#fce7f3', '#db2777',"Referral secured or score ≥8")}
                  {stat("Recruiters",   s.recruiters,   t.priL,    t.pri,    "Classified as Recruiter")}
                  {stat("Hiring Mgrs.", s.hiringMgrs,   '#fee2e2', '#dc2626',"Classified as Hiring Manager")}
                  {stat("Follow-Ups",   s.followUps,    s.urgentFu > 0 ? '#fee2e2' : t.yellowL, s.urgentFu > 0 ? '#dc2626' : t.yellow, `${s.urgentFu} urgent`)}
                </div>
              </div>
            );
          })()}

          {/* ── Filter + Search Bar ── */}
          {dmContacts.length > 0 && (() => {
            const sel = {background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:'7px 10px',color:t.tx,fontSize:12,fontFamily:'inherit',outline:'none'};
            const hasFilters = personaFilter !== 'All' || stageFilter !== 'All' || pocFilter !== 'All'
              || strengthFilter !== 'All' || fuPriorityFilter !== 'All' || showFollowupOnly || dmSearch.trim();
            return (
              <div style={{marginBottom:18}}>
                {/* Search */}
                <div style={{position:"relative",marginBottom:8}}>
                  <Search size={14} style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:t.muted}}/>
                  <input
                    value={dmSearch}
                    onChange={e => setDmSearch(e.target.value)}
                    placeholder="Search by name, company, tags..."
                    style={{width:"100%",background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"8px 12px 8px 32px",color:t.tx,fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}
                  />
                  {dmSearch && (
                    <button onClick={() => setDmSearch('')} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:t.muted,padding:0}}>
                      <X size={14}/>
                    </button>
                  )}
                </div>
                {/* Filter row */}
                <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                  <select value={personaFilter} onChange={e => setPersonaFilter(e.target.value)} style={sel}>
                    {['All','Recruiter','Hiring Manager','Senior Engineer','Peer Engineer','Executive','Alumni','Referral Contact','Potential Mentor','Unknown'].map(v =>
                      <option key={v} value={v}>{v === 'All' ? 'All Personas' : v}</option>
                    )}
                  </select>
                  <select value={stageFilter} onChange={e => setStageFilter(e.target.value)} style={sel}>
                    {['All','Strong Rapport','Active Conversation','Warm Contact','Replied Once','Referral Requested','Referral Secured','Hiring Process Related','Initial Outreach Sent','Follow-Up Needed','Dormant','Cold / No Action'].map(v =>
                      <option key={v} value={v}>{v === 'All' ? 'All Stages' : v}</option>
                    )}
                  </select>
                  <select value={strengthFilter} onChange={e => setStrengthFilter(e.target.value)} style={sel}>
                    {['All','Confirmed POC','POC Candidate','Strong','Warm','Informational','Low'].map(v =>
                      <option key={v} value={v}>{v === 'All' ? 'All Strengths' : v}</option>
                    )}
                  </select>
                  <select value={pocFilter} onChange={e => setPocFilter(e.target.value)} style={sel}>
                    <option value="All">All POC Status</option>
                    <option value="confirmed">Confirmed POC</option>
                    <option value="candidate">POC Candidate</option>
                    <option value="none">Not POC</option>
                  </select>
                  <select value={fuPriorityFilter} onChange={e => setFuPriorityFilter(e.target.value)} style={sel}>
                    {['All','urgent','high','medium','low','none'].map(v =>
                      <option key={v} value={v}>{v === 'All' ? 'All Follow-Up' : v === 'none' ? 'No Follow-Up' : `${v.charAt(0).toUpperCase()+v.slice(1)} Priority`}</option>
                    )}
                  </select>
                  {hasFilters && (
                    <button onClick={() => { setPersonaFilter('All'); setStageFilter('All'); setPocFilter('All'); setStrengthFilter('All'); setFuPriorityFilter('All'); setShowFollowupOnly(false); setDmSearch(''); }}
                      style={{padding:"7px 12px",borderRadius:8,background:t.hover,border:`1px solid ${t.border}`,color:t.sub,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4}}>
                      <X size={11}/> Clear
                    </button>
                  )}
                </div>
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
          {dmError && (
            <div style={{textAlign:"center",padding:"40px 24px"}}>
              <div style={{fontSize:13,color:t.red,marginBottom:12,fontWeight:600}}>{dmError}</div>
              <button onClick={() => { dmLoaded.current = false; setDmError(''); setTab('find'); setTimeout(() => setTab('dms'), 50); }}
                style={{padding:"8px 18px",borderRadius:8,background:t.pri,color:"#fff",border:"none",fontWeight:600,cursor:"pointer",fontFamily:"inherit",fontSize:13}}>
                Retry
              </button>
            </div>
          )}

          {dmNoteError && <div style={{color:t.red,fontSize:12,fontWeight:600,marginBottom:8}}>{dmNoteError}</div>}

          {/* ── Empty state ── */}
          {!dmLoading && !dmError && dmContacts.length === 0 && (
            <Card t={t} style={{textAlign:"center",padding:"60px 24px"}}>
              <Users size={32} color={t.muted} style={{marginBottom:12}}/>
              <div style={{fontSize:14,fontWeight:600,color:t.sub,marginBottom:12}}>No LinkedIn DM contacts yet.</div>
              <div style={{fontSize:13,color:t.muted,marginBottom:12}}>Run the intelligence analysis script to populate this section:</div>
              <div style={{background:t.hover,borderRadius:6,padding:"8px 14px",fontSize:12,fontFamily:"monospace",color:t.tx,display:"inline-block",textAlign:"left"}}>
                python linkedin_intelligence_v2.py --zip ~/Desktop/Basic_LinkedInDataExport_*.zip
              </div>
            </Card>
          )}

          {/* ── Contact cards ── */}
          {!dmLoading && !dmError && (() => {
            // ── Color maps ────────────────────────────────────────────────────
            const PERSONA_COLORS = {
              'Recruiter':        {bg:t.priL,    tx:t.pri},
              'Hiring Manager':   {bg:'#fee2e2', tx:'#dc2626'},
              'Executive':        {bg:'#ede9fe', tx:'#7c3aed'},
              'Referral Contact': {bg:'#ffedd5', tx:'#ea580c'},
              'Alumni':           {bg:'#ccfbf1', tx:'#0d9488'},
              'Senior Engineer':  {bg:'#f0fdf4', tx:'#15803d'},
              'Peer Engineer':    {bg:t.greenL,  tx:t.green},
              'Potential Mentor': {bg:'#faf5ff', tx:'#7c3aed'},
            };
            const STAGE_COLORS = {
              'Strong Rapport':        {bg:'#f0fdf4', tx:'#15803d'},
              'Active Conversation':   {bg:t.greenL,  tx:t.green},
              'Warm Contact':          {bg:'#ecfdf5', tx:'#059669'},
              'Replied Once':          {bg:t.priL,    tx:t.pri},
              'Referral Requested':    {bg:'#fff7ed', tx:'#c2410c'},
              'Referral Secured':      {bg:'#fce7f3', tx:'#db2777'},
              'Hiring Process Related':{bg:'#fee2e2', tx:'#dc2626'},
              'Initial Outreach Sent': {bg:t.hover,   tx:t.sub},
              'Follow-Up Needed':      {bg:t.yellowL, tx:t.yellow},
              'Dormant':               {bg:t.hover,   tx:t.muted},
              'Cold / No Action':      {bg:t.hover,   tx:t.muted},
            };
            const STRENGTH_COLORS = {
              'Confirmed POC':  {bg:'#fce7f3', tx:'#db2777'},
              'POC Candidate':  {bg:'#fff1f5', tx:'#e11d63'},
              'Strong':         {bg:t.greenL,  tx:t.green},
              'Warm':           {bg:'#ecfdf5', tx:'#059669'},
              'Informational':  {bg:t.priL,    tx:t.pri},
              'Low':            {bg:t.hover,   tx:t.muted},
            };
            const FU_PRIORITY_COLORS = {
              'urgent': {bg:'#fee2e2', tx:'#dc2626'},
              'high':   {bg:'#ffedd5', tx:'#ea580c'},
              'medium': {bg:t.yellowL, tx:t.yellow},
              'low':    {bg:t.hover,   tx:t.muted},
            };
            const TONE_ICONS = {
              'warm':        '☀️',
              'encouraging': '⭐',
              'helpful':     '🤝',
              'neutral':     '○',
              'transactional':'→',
              'dismissive':  '✗',
            };

            // ── Filtering ─────────────────────────────────────────────────────
            const q = dmSearch.trim().toLowerCase();
            const filtered = dmContacts.filter(c => {
              if (personaFilter !== 'All' && c.persona !== personaFilter) return false;
              if (stageFilter !== 'All' && c.conversation_stage !== stageFilter) return false;
              if (strengthFilter !== 'All' && c.relationship_strength !== strengthFilter) return false;
              if (pocFilter === 'confirmed' && !c.is_confirmed_poc) return false;
              if (pocFilter === 'candidate' && (!c.is_poc_candidate || c.is_confirmed_poc)) return false;
              if (pocFilter === 'none' && c.is_poc_candidate) return false;
              if (fuPriorityFilter !== 'All' && c.follow_up_priority !== fuPriorityFilter) return false;
              if (showFollowupOnly && !c.follow_up) return false;
              if (q) {
                const haystack = [c.name, c.company, c.position, c.persona, c.conversation_stage, c.tags, c.crm_summary].join(' ').toLowerCase();
                if (!haystack.includes(q)) return false;
              }
              return true;
            });

            // ── Result count ─────────────────────────────────────────────────
            const resultLine = filtered.length !== dmContacts.length
              ? <div style={{fontSize:12,color:t.muted,marginBottom:12}}>Showing {filtered.length} of {dmContacts.length} contacts</div>
              : null;

            const cards = filtered.map(c => {
              const personaCl   = PERSONA_COLORS[c.persona] || {bg:t.hover, tx:t.muted};
              const stageCl     = STAGE_COLORS[c.conversation_stage] || {bg:t.hover, tx:t.muted};
              const strengthCl  = STRENGTH_COLORS[c.relationship_strength] || {bg:t.hover, tx:t.muted};
              const fuPriCl     = FU_PRIORITY_COLORS[c.follow_up_priority] || null;
              const toneIcon    = TONE_ICONS[c.tone] || '';
              const isSummaryExpanded = expandedSummaries.has(c.id);
              const isGuidanceExpanded = expandedGuidance.has(c.id);
              const noteVal     = (editedNotes[c.id] ?? c.notes) ?? '';

              // Days since
              let daysText = null, daysNum = null;
              if (c.last_contact) {
                daysNum = Math.floor((Date.now() - new Date(c.last_contact + 'T00:00:00')) / 86400000);
                daysText = `${daysNum}d ago`;
              } else if (c.days_since != null) {
                daysNum = c.days_since;
                daysText = `${daysNum}d ago`;
              }

              // Left border color by urgency / strength
              let borderColor = undefined;
              if (c.follow_up_priority === 'urgent') borderColor = '#dc2626';
              else if (c.follow_up_priority === 'high') borderColor = '#ea580c';
              else if (c.is_confirmed_poc) borderColor = '#db2777';
              else if (c.is_poc_candidate) borderColor = '#e11d63';
              else if (c.conversation_stage === 'Strong Rapport') borderColor = t.green;
              else if (c.follow_up) borderColor = t.yellow;

              const toggleSummary = () => setExpandedSummaries(prev => {
                const next = new Set(prev); next.has(c.id) ? next.delete(c.id) : next.add(c.id); return next;
              });
              const toggleGuidance = () => setExpandedGuidance(prev => {
                const next = new Set(prev); next.has(c.id) ? next.delete(c.id) : next.add(c.id); return next;
              });
              const handleNoteBlur = () => {
                if (editedNotes[c.id] !== undefined && editedNotes[c.id] !== (c.notes || '')) {
                  updateLinkedInContactNotes(c.id, editedNotes[c.id]).catch(e => setDmNoteError('Note save failed: ' + e.message));
                }
              };

              return (
                <Card key={c.id} t={t} style={{marginBottom:10, borderLeft: borderColor ? `4px solid ${borderColor}` : undefined}}>
                  <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
                    <Avatar name={c.name} size={40} t={t}/>
                    <div style={{flex:1,minWidth:0}}>

                      {/* ── Name + LinkedIn link ── */}
                      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:2}}>
                        {c.linkedin_url
                          ? <a href={c.linkedin_url} target="_blank" rel="noreferrer" style={{fontSize:14,fontWeight:700,color:t.tx,textDecoration:"none"}}>{c.name}</a>
                          : <span style={{fontSize:14,fontWeight:700,color:t.tx}}>{c.name}</span>
                        }
                        {c.is_confirmed_poc && <span title="Confirmed POC" style={{fontSize:11,fontWeight:800,padding:"1px 7px",borderRadius:10,background:'#fce7f3',color:'#db2777'}}>★ POC</span>}
                        {!c.is_confirmed_poc && c.is_poc_candidate && <span title="POC Candidate" style={{fontSize:11,fontWeight:700,padding:"1px 7px",borderRadius:10,background:'#fff1f5',color:'#e11d63'}}>◆ Candidate</span>}
                        {c.referral_secured && <span title="Referral secured" style={{fontSize:11,fontWeight:700,padding:"1px 7px",borderRadius:10,background:'#ecfdf5',color:'#059669'}}>✓ Referred</span>}
                        {c.promise_made && <span title={`Promise: ${c.promise_text||''}`} style={{fontSize:11,fontWeight:700,padding:"1px 7px",borderRadius:10,background:'#fff7ed',color:'#c2410c'}}>Promise</span>}
                        {c.follow_up && fuPriCl && (
                          <span style={{fontSize:10.5,fontWeight:800,padding:"1px 7px",borderRadius:10,background:fuPriCl.bg,color:fuPriCl.tx,marginLeft:'auto'}}>
                            {c.follow_up_priority === 'urgent' ? '🔴 Urgent' : c.follow_up_priority === 'high' ? '🟠 High' : '🟡 Follow-up'}
                          </span>
                        )}
                      </div>

                      {/* ── Company / Position ── */}
                      {(c.company || c.position) && (
                        <div style={{fontSize:12.5,color:t.muted,marginBottom:4}}>
                          {[c.company, c.position].filter(Boolean).join(' · ')}
                        </div>
                      )}

                      {/* ── Badge row: Persona | Stage | Strength | Tone | Days ── */}
                      <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center",marginBottom:8}}>
                        <span style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:8,background:personaCl.bg,color:personaCl.tx}}>
                          {c.persona || c.role_type || 'Unknown'}
                        </span>
                        {c.persona_confidence != null && c.persona_confidence < 60 && (
                          <span style={{fontSize:10,color:t.muted}}>~{c.persona_confidence}%</span>
                        )}
                        <span style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:8,background:stageCl.bg,color:stageCl.tx}}>
                          {c.conversation_stage || c.conv_status || '—'}
                        </span>
                        <span style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:8,background:strengthCl.bg,color:strengthCl.tx}}>
                          {c.relationship_strength || '—'}
                        </span>
                        {c.tone && c.tone !== 'neutral' && (
                          <span title={`Tone: ${c.tone}`} style={{fontSize:10,color:t.muted}}>{toneIcon} {c.tone}</span>
                        )}
                        {c.two_way_conversation && <span title="Two-way conversation" style={{fontSize:10,color:t.green}}>⇄ {c.total_exchanges || ''}x</span>}
                        {daysText && <span style={{fontSize:10.5,color:t.muted,marginLeft:"auto"}}>{daysText}</span>}
                      </div>

                      {/* ── POC Score bar ── */}
                      {c.poc_score != null && c.poc_score > 0 && (
                        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
                          <span style={{fontSize:10,fontWeight:700,color:t.muted,whiteSpace:"nowrap"}}>POC {c.poc_score}/10</span>
                          <div style={{flex:1,height:4,borderRadius:4,background:t.hover,overflow:"hidden"}}>
                            <div style={{height:"100%",width:`${c.poc_score * 10}%`,borderRadius:4,background: c.poc_score >= 7 ? '#db2777' : c.poc_score >= 5 ? '#ea580c' : c.poc_score >= 3 ? t.yellow : t.muted}}/>
                          </div>
                        </div>
                      )}

                      {/* ── Message count ── */}
                      {c.message_count > 0 && (
                        <div style={{fontSize:11,color:t.muted,marginBottom:6}}>
                          {c.message_count} message{c.message_count !== 1 ? 's' : ''}
                          {c.i_sent_first !== null && c.i_sent_first !== undefined && (
                            <span style={{marginLeft:6}}>{c.i_sent_first ? '(you initiated)' : '(they initiated)'}</span>
                          )}
                          {!c.they_replied && c.i_sent_first && <span style={{marginLeft:6,color:t.muted}}>— no reply</span>}
                        </div>
                      )}

                      {/* ── Promise tracking ── */}
                      {c.promise_made && c.promise_text && (
                        <div style={{marginBottom:8,padding:"6px 10px",borderRadius:6,background:'#fff7ed',border:"1px solid #fed7aa"}}>
                          <div style={{fontSize:10,fontWeight:700,color:'#c2410c',marginBottom:2,textTransform:"uppercase",letterSpacing:.5}}>Promise Made</div>
                          <div style={{fontSize:11.5,color:'#9a3412'}}>{c.promise_text.slice(0,180)}{c.promise_text.length > 180 ? '…' : ''}</div>
                          {c.promise_status && (
                            <div style={{fontSize:10,marginTop:3,fontWeight:600,color:'#c2410c'}}>Status: {c.promise_status}</div>
                          )}
                        </div>
                      )}

                      {/* ── Follow-up guidance ── */}
                      {c.follow_up && c.follow_up_type && c.follow_up_type !== 'none' && (
                        <div style={{marginBottom:8,padding:"6px 10px",borderRadius:6,background: c.follow_up_priority === 'urgent' ? '#fee2e2' : t.yellowL, border:`1px solid ${c.follow_up_priority === 'urgent' ? '#fca5a5' : t.yellowBd}`}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                            <div>
                              <div style={{fontSize:10,fontWeight:700,color:c.follow_up_priority === 'urgent' ? '#dc2626' : t.yellow,textTransform:"uppercase",letterSpacing:.5,marginBottom:2}}>
                                {c.follow_up_type.replace(/-/g,' ')} {c.follow_up_timing ? `· ${c.follow_up_timing}` : ''}
                              </div>
                              {c.follow_up_reason && (
                                <div style={{fontSize:11.5,color:c.follow_up_priority === 'urgent' ? '#b91c1c' : '#92400e'}}>{c.follow_up_reason}</div>
                              )}
                            </div>
                            {c.follow_up_guidance && (
                              <button onClick={toggleGuidance} style={{fontSize:10.5,color:t.pri,background:"none",border:"none",padding:0,cursor:"pointer",fontFamily:"inherit",fontWeight:600,whiteSpace:"nowrap",marginLeft:8}}>
                                {isGuidanceExpanded ? 'Hide tip ▴' : 'What to say ▾'}
                              </button>
                            )}
                          </div>
                          {isGuidanceExpanded && c.follow_up_guidance && (
                            <div style={{fontSize:11.5,color:t.sub,marginTop:6,lineHeight:1.6,paddingTop:6,borderTop:`1px solid ${t.border}`}}>
                              {c.follow_up_guidance}
                            </div>
                          )}
                        </div>
                      )}

                      {/* ── CRM Summary ── */}
                      {(c.crm_summary || c.summary) && (
                        <div style={{marginBottom:8}}>
                          <button onClick={toggleSummary} style={{fontSize:11,color:t.pri,background:"none",border:"none",padding:0,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>
                            {isSummaryExpanded ? 'Hide summary ▴' : 'Summary ▾'}
                          </button>
                          {isSummaryExpanded && (
                            <div style={{fontSize:12,color:t.sub,marginTop:5,lineHeight:1.6,padding:"6px 10px",background:t.hover,borderRadius:6}}>
                              {c.crm_summary || c.summary}
                            </div>
                          )}
                        </div>
                      )}

                      {/* ── Tags ── */}
                      {c.tags && (
                        <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:8}}>
                          {c.tags.split(',').filter(Boolean).map(tag => (
                            <span key={tag} style={{fontSize:10,padding:"1px 6px",borderRadius:6,background:t.hover,color:t.muted,border:`1px solid ${t.border}`}}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* ── Next action ── */}
                      {c.next_action && (
                        <div style={{fontSize:11.5,color:t.sub,background:t.hover,borderRadius:6,padding:"4px 9px",marginBottom:8}}>
                          <span style={{fontWeight:700}}>Next: </span>{c.next_action}
                        </div>
                      )}

                      {/* ── Notes textarea ── */}
                      <textarea
                        value={noteVal}
                        rows={2}
                        placeholder="Add notes..."
                        onChange={e => setEditedNotes(prev => ({...prev, [c.id]: e.target.value}))}
                        onBlur={handleNoteBlur}
                        style={{width:"100%",background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"6px 10px",color:t.tx,fontSize:12,fontFamily:"inherit",resize:"vertical",boxSizing:"border-box",outline:"none"}}
                      />
                    </div>
                  </div>
                </Card>
              );
            });

            return <>{resultLine}{cards}</>;
          })()}
        </div>
      )}

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
    </div>
  );
}
