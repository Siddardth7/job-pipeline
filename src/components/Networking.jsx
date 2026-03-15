import { useState, useEffect } from 'react';
import { Users, Send, Linkedin, Mail, Copy, Check, MessageSquare } from 'lucide-react';
import { DEFAULT_TEMPLATES, fillTemplate } from '../lib/templates.js';
import { VARIANT_KEYWORDS, TEMPLATE_SUMMARIES, TEMPLATE_SKILLS } from '../lib/scoring.js';

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
function Chip({children, active, onClick, t}) {
  return <button onClick={onClick} style={{padding:"6px 16px",borderRadius:20,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",background:active?t.pri:t.card,border:`1px solid ${active?t.pri:t.border}`,color:active?"#fff":t.sub}}>{children}</button>;
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

function ContactDraftSection({contact, currentJob, templates, t}) {
  const [selectedTemplate, setSelectedTemplate] = useState(templates[0]?.id || "");
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);

  const allTemplates = templates.length > 0 ? templates : DEFAULT_TEMPLATES;

  const generateDraft = () => {
    const tpl = allTemplates.find(t => t.id === selectedTemplate) || allTemplates[0];
    if (!tpl) return;
    const firstName = (contact.name || "").split(" ")[0] || "there";
    const vars = {
      firstName,
      company: contact.company || currentJob?.company || "",
      role: currentJob?.role || "",
      variantFocus: "manufacturing and composites engineering",
      variantSkills: "GD&T, CMM, Lean, SPC",
      myAchievement: "reduced defect rates from 15% to 3% at Tata Boeing"
    };
    setDraft(fillTemplate(tpl, vars));
  };

  const handleCopy = () => {
    robustCopy(draft).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  };

  return (
    <div style={{marginTop:16,paddingTop:14,borderTop:`1px solid ${t.border}`}}>
      <div style={{fontSize:11,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:1.5,marginBottom:12,display:"flex",alignItems:"center",gap:6}}>
        <MessageSquare size={12}/> Draft Message
      </div>
      <div style={{display:"flex",gap:10,marginBottom:12,alignItems:"flex-end"}}>
        <div style={{flex:1}}>
          <label style={{fontSize:11,fontWeight:700,color:t.sub,display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:1}}>Template</label>
          <select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)} style={{width:"100%",background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"9px 13px",color:t.tx,fontSize:13,fontFamily:"inherit",outline:"none"}}>
            {allTemplates.map(tpl => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
          </select>
        </div>
        <Btn size="sm" onClick={generateDraft} t={t}><MessageSquare size={12}/> Generate Draft</Btn>
      </div>
      {draft && (
        <div>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={5} style={{width:"100%",background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"10px 14px",color:t.tx,fontSize:13,fontFamily:"inherit",resize:"vertical",boxSizing:"border-box",outline:"none",lineHeight:1.6}}/>
          <div style={{display:"flex",justifyContent:"flex-end",marginTop:8}}>
            <Btn size="sm" variant="green" onClick={handleCopy} t={t}>
              {copied ? <><Check size={12}/> Copied!</> : <><Copy size={12}/> Copy Message</>}
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Networking({currentJob, setCurrentJob, contactResults, setContactResults, networkingLog, addToNetworkingLog, setPage, templates, t}) {
  const [co, setCo] = useState(currentJob?.company || "");
  const [role, setRole] = useState(currentJob?.role || "");
  const [loc, setLoc] = useState(currentJob?.location || "");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [totalCount, setTotalCount] = useState(5);
  const [tab, setTab] = useState("find");

  useEffect(() => {
    if (currentJob) {
      setCo(currentJob.company || "");
      setRole(currentJob.role || "");
      setLoc(currentJob.location || "");
    }
  }, [currentJob?.id]);

  const sentIds = new Set(networkingLog.map(c => c.id));

  const findContacts = async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch('/api/find-contacts', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({company: co, role, count: totalCount})
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `HTTP ${res.status}`);
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

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
        <div>
          <h2 style={{margin:"0 0 4px",fontSize:24,fontWeight:700,color:t.tx}}>Networking</h2>
          <p style={{margin:0,fontSize:14,color:t.sub}}>{co ? `Contacts at ${co}` : "Find contacts at target companies"}</p>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Chip active={tab==="find"} onClick={() => setTab("find")} t={t}>Find Contacts</Chip>
          <Chip active={tab==="log"} onClick={() => setTab("log")} t={t}>Networking Log ({networkingLog.length})</Chip>
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
                return (
                  <Card key={c.id} t={t} style={{marginBottom:12}}>
                    <div style={{display:"flex",alignItems:"flex-start",gap:14}}>
                      <Avatar name={c.name||c.type} size={42} t={t}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
                          <span style={{fontSize:14.5,fontWeight:700,color:t.tx}}>{c.name||c.type}</span>
                          <span style={{fontSize:10.5,fontWeight:700,padding:"2px 8px",borderRadius:10,background:c.type==="HR"||c.type==="Recruiter"?t.priL:c.type==="Alumni"?t.greenL:t.yellowL,color:c.type==="HR"||c.type==="Recruiter"?t.pri:c.type==="Alumni"?t.green:t.yellow}}>{c.type}</span>
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
                        <ContactDraftSection contact={c} currentJob={currentJob} templates={templates} t={t}/>
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
          {networkingLog.length === 0 && (
            <Card t={t} style={{textAlign:"center",padding:"60px 24px"}}>
              <Users size={32} color={t.muted} style={{marginBottom:12}}/>
              <div style={{fontSize:14,fontWeight:600,color:t.sub}}>No networking contacts logged yet.</div>
            </Card>
          )}
          {networkingLog.length > 0 && (
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{borderBottom:`2px solid ${t.border}`}}>
                    {["Date","Name","Type","Company","Role","Email","LinkedIn"].map(h => (
                      <th key={h} style={{textAlign:"left",padding:"10px 12px",fontSize:11,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:1}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {networkingLog.map((c,i) => (
                    <tr key={c.id||i} style={{borderBottom:`1px solid ${t.border}`}}>
                      <td style={{padding:"10px 12px",color:t.tx}}>{c.date}</td>
                      <td style={{padding:"10px 12px",color:t.tx,fontWeight:600}}>{c.name}</td>
                      <td style={{padding:"10px 12px"}}><span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:10,background:t.priL,color:t.pri}}>{c.type}</span></td>
                      <td style={{padding:"10px 12px",color:t.sub}}>{c.company}</td>
                      <td style={{padding:"10px 12px",color:t.sub}}>{c.role}</td>
                      <td style={{padding:"10px 12px",color:t.sub,fontSize:12}}>{c.email||"NA"}</td>
                      <td style={{padding:"10px 12px"}}>
                        {c.linkedinUrl && (
                          <a href={c.linkedinUrl} target="_blank" rel="noreferrer" style={{display:"inline-flex",alignItems:"center",gap:4,padding:"5px 12px",borderRadius:6,background:"#0077B5",color:"#fff",fontWeight:600,fontSize:12,textDecoration:"none"}}>
                            <Linkedin size={13}/> Open
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
