import { useState, useEffect, useRef } from 'react';
import { Users, Send, Linkedin, Mail, Copy, Check, MessageSquare, Sparkles, RefreshCw, AlertTriangle } from 'lucide-react';
import { fetchLinkedInContacts, updateLinkedInContactNotes } from '../lib/storage.js';
import { draftMessageWithGroq } from '../lib/groq.js';

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
const STATUS_OPTS = ['Pending', 'Replied', 'Coffee Chat', 'No Response'];
const STATUS_COLORS = {
  'Pending':     { bg: '#fef3c7', bd: '#fcd34d', tx: '#d97706' },
  'Replied':     { bg: '#dcfce7', bd: '#86efac', tx: '#16a34a' },
  'Coffee Chat': { bg: '#ede9fe', bd: '#c4b5fd', tx: '#7c3aed' },
  'No Response': { bg: '#fee2e2', bd: '#fca5a5', tx: '#dc2626' },
};

export default function Networking({currentJob, setCurrentJob, contactResults, setContactResults, networkingLog, addToNetworkingLog, netlogMeta, updateNetlogMeta, setPage, templates, groqKey, serperKey, t}) {
  const [co, setCo]       = useState(currentJob?.company || "");
  const [role, setRole]   = useState(currentJob?.role || "");
  const [loc, setLoc]     = useState(currentJob?.location || "");
  const [loading, setLoading] = useState(false);
  const [err, setErr]     = useState("");
  const [totalCount, setTotalCount] = useState(5);
  const [tab, setTab]     = useState("find");
  const [logFilter, setLogFilter] = useState("All");
  const dmLoaded = useRef(false);
  const [dmContacts, setDmContacts]           = useState([]);
  const [dmLoading, setDmLoading]             = useState(false);
  const [dmError, setDmError]                 = useState('');
  const [roleFilter, setRoleFilter]           = useState('All');
  const [statusFilter, setStatusFilter]       = useState('All');
  const [showFollowupOnly, setShowFollowupOnly] = useState(false);
  const [expandedSummaries, setExpandedSummaries] = useState(new Set());
  const [editedNotes, setEditedNotes]         = useState({});

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
      fetchLinkedInContacts()
        .then(data => { setEditedNotes({}); setDmContacts(data); setDmLoading(false); })
        .catch(e  => { setDmError(e.message); setDmLoading(false); });
    }
  }, [tab]);

  const sentIds = new Set(networkingLog.map(c => c.id));
  const today = new Date().toISOString().split('T')[0];

  const overdueCount = networkingLog.filter(c => {
    const meta = netlogMeta?.[c.id];
    return meta?.status === 'Pending' && meta?.followUpDate && meta.followUpDate < today;
  }).length;

  const filteredLog = logFilter === 'All'
    ? networkingLog
    : networkingLog.filter(c => (netlogMeta?.[c.id]?.status || 'Pending') === logFilter);

  const findContacts = async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch('/api/find-contacts', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({company: co, role, count: totalCount, serperKey})
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
        </div>
      </div>

      {tab === "find" && (
        <div>
          <Card t={t} style={{marginBottom:20}}>
            <SectionLabel t={t}>Find Contacts</SectionLabel>
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
            <Btn onClick={findContacts} disabled={loading||!co} t={t}>{loading?"Searching...":"Find Contacts"}</Btn>
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
                          <span style={{fontSize:10.5,fontWeight:700,padding:"2px 8px",borderRadius:10,background:t.priL,color:t.pri}}>{c.type}</span>
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
                    {["Date","Name","Type","Company","Status","Follow-up","LinkedIn"].map(h => (
                      <th key={h} style={{textAlign:"left",padding:"10px 12px",fontSize:11,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:1,whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredLog.map((c,i) => {
                    const meta = netlogMeta?.[c.id] || {};
                    const status = meta.status || 'Pending';
                    const followUpDate = meta.followUpDate || '';
                    const isOverdue = status === 'Pending' && followUpDate && followUpDate < today;
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
                            onChange={e => updateNetlogMeta(c.id, {status: e.target.value})}
                            style={{background:sc.bg,border:`1px solid ${sc.bd}`,borderRadius:7,padding:"4px 8px",color:sc.tx,fontSize:12,fontWeight:700,fontFamily:"inherit",outline:"none",cursor:"pointer"}}
                          >
                            {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td style={{padding:"10px 12px",whiteSpace:"nowrap"}}>
                          <span style={{fontSize:12,fontWeight:600,color:isOverdue?t.red:t.sub,display:"flex",alignItems:"center",gap:4}}>
                            {followUpDate || '—'}
                            {isOverdue && <AlertTriangle size={12} color={t.red}/>}
                          </span>
                        </td>
                        <td style={{padding:"10px 12px"}}>
                          {c.linkedinUrl && (
                            <a href={c.linkedinUrl} target="_blank" rel="noreferrer" style={{display:"inline-flex",alignItems:"center",gap:4,padding:"5px 12px",borderRadius:6,background:"#0077B5",color:"#fff",fontWeight:600,fontSize:12,textDecoration:"none"}}>
                              <Linkedin size={13}/> Open
                            </a>
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
    </div>
  );
}
