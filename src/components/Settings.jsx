import { useState, useEffect } from 'react';
import { Database, Zap, RefreshCw, Plus, Trash2, Edit3, Check, X, ChevronDown, Sparkles } from 'lucide-react';
import { DEFAULT_TEMPLATES } from '../lib/templates.js';
import * as Storage from '../lib/storage.js';

function Card({children, t, style}) {
  return <div style={{background:t.card,border:`1px solid ${t.border}`,borderRadius:12,padding:20,boxShadow:t.shadow,...style}}>{children}</div>;
}
function Btn({children, onClick, disabled, variant="primary", size="md", t, style:xs}) {
  const V={primary:{bg:t.pri,c:"#fff",b:"none"},secondary:{bg:"transparent",c:t.sub,b:`1px solid ${t.border}`},ghost:{bg:"transparent",c:t.muted,b:`1px solid ${t.border}`},green:{bg:t.greenL,c:t.green,b:`1px solid ${t.greenBd}`},red:{bg:t.redL,c:t.red,b:`1px solid ${t.redBd}`},danger:{bg:t.red,c:"#fff",b:"none"}};
  const s=V[variant]||V.primary; const p=size==="sm"?"5px 14px":"10px 20px"; const fs=size==="sm"?12.5:13.5;
  return <button onClick={onClick} disabled={disabled} style={{background:s.bg,color:s.c,border:s.b,padding:p,borderRadius:8,fontSize:fs,fontWeight:600,cursor:disabled?"not-allowed":"pointer",opacity:disabled?.4:1,fontFamily:"inherit",whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:6,...xs}}>{children}</button>;
}

export default function AppSettings({templates, setTemplates, groqKey, setGroqKey, serperKey, setSerperKey, user, onSignOut, t}) {
  const [serperStatus, setSerperStatus] = useState("");
  const [testingSerper, setTestingSerper] = useState(false);
  const [serperInput, setSerperInput] = useState(serperKey || "");
  const [serperSaveStatus, setSerperSaveStatus] = useState("");
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [editDraft, setEditDraft] = useState({name:"", body:""});
  const [premiumOpen, setPremiumOpen] = useState(false);
  const [groqInput, setGroqInput] = useState(groqKey || "");
  const [groqSaveStatus, setGroqSaveStatus] = useState("");
  const [gistMigrateId, setGistMigrateId] = useState("");
  const [gistMigrateToken, setGistMigrateToken] = useState("");
  const [migrating, setMigrating] = useState(false);
  const [migrateStatus, setMigrateStatus] = useState("");

  // ── User Profile state ───────────────────────────────────────────────────────
  const [profile, setProfile] = useState({
    full_name: '', degree: '', graduation_year: '', visa_status: '',
    visa_years_remaining: '', domain_family: '',
  });
  const [profileSaving, setProfileSaving] = useState('');
  const [roleTargets, setRoleTargets] = useState([]);
  const [newRole, setNewRole] = useState({ title: '', cluster: 'manufacturing', priority: 1 });

  useEffect(() => {
    Storage.fetchUserProfile().then(p => { if (p) setProfile(p); }).catch(() => {});
    Storage.fetchRoleTargets().then(setRoleTargets).catch(() => {});
  }, []);

  const saveProfile = async () => {
    setProfileSaving('Saving...');
    try {
      await Storage.upsertUserProfile({
        full_name:            profile.full_name,
        degree:               profile.degree,
        graduation_year:      profile.graduation_year ? parseInt(profile.graduation_year) : null,
        visa_status:          profile.visa_status,
        visa_years_remaining: profile.visa_years_remaining ? parseInt(profile.visa_years_remaining) : null,
        domain_family:        profile.domain_family,
      });
      setProfileSaving('Saved!');
      setTimeout(() => setProfileSaving(''), 3000);
    } catch(e) {
      setProfileSaving('Error: ' + e.message);
    }
  };

  const addRoleTarget = async () => {
    if (!newRole.title.trim()) return;
    await Storage.upsertRoleTarget({ ...newRole, id: crypto.randomUUID() });
    const updated = await Storage.fetchRoleTargets();
    setRoleTargets(updated);
    setNewRole({ title: '', cluster: 'manufacturing', priority: 1 });
  };

  const removeRoleTarget = async (id) => {
    await Storage.deleteRoleTarget(id);
    setRoleTargets(prev => prev.filter(r => r.id !== id));
  };

  const saveSerperKey = async () => {
    try {
      setSerperSaveStatus("Saving...");
      await Storage.saveSetting('serper_api_key', serperInput.trim());
      setSerperKey(serperInput.trim());
      setSerperSaveStatus(serperInput.trim() ? "Saved!" : "Key cleared.");
      setTimeout(() => setSerperSaveStatus(""), 3000);
    } catch(e) {
      setSerperSaveStatus("Save failed: " + e.message);
    }
  };

  const testSerper = async () => {
    setTestingSerper(true);
    setSerperStatus("Testing...");
    const keyToUse = serperInput.trim() || serperKey;
    try {
      const res = await fetch('/.netlify/functions/find-contacts', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({company:"Boeing", role:"Engineer", count:3, serperKey: keyToUse})
      });
      if (res.ok) {
        const data = await res.json();
        setSerperStatus(`Connected! Found ${data.length} results.`);
      } else {
        const err = await res.json();
        setSerperStatus(`Error: ${err.error}`);
      }
    } catch(e) {
      setSerperStatus(`Failed: ${e.message}`);
    }
    setTestingSerper(false);
  };

  const startEdit = (tpl) => {
    setEditingTemplate(tpl.id);
    setEditDraft({name: tpl.name, body: tpl.body});
  };

  const saveEdit = async () => {
    const updated = templates.map(t => t.id === editingTemplate ? {...t, ...editDraft} : t);
    setTemplates(updated);
    try {
      await Storage.upsertTemplate({id: editingTemplate, ...editDraft});
    } catch(e) {
      console.error("Failed to save template:", e);
    }
    setEditingTemplate(null);
  };

  const deleteTemplate = async (id) => {
    if (DEFAULT_TEMPLATES.find(t => t.id === id)) return; // can't delete defaults
    setTemplates(prev => prev.filter(t => t.id !== id));
    try { await Storage.deleteTemplate(id); } catch(e) { console.error(e); }
  };

  const resetTemplates = () => {
    setTemplates(DEFAULT_TEMPLATES);
    DEFAULT_TEMPLATES.forEach(tpl => Storage.upsertTemplate(tpl).catch(console.error));
  };

  const saveGroqKey = async () => {
    try {
      setGroqSaveStatus("Saving...");
      await Storage.saveUserIntegration('groq', groqInput.trim());
      setGroqKey(groqInput.trim());
      setGroqSaveStatus(groqInput.trim() ? "Saved! Groq AI is now active." : "Key cleared.");
      setTimeout(() => setGroqSaveStatus(""), 3000);
    } catch(e) {
      setGroqSaveStatus("Save failed: " + e.message);
    }
  };

  const addTemplate = () => {
    const newTpl = {
      id: `custom-${Date.now()}`,
      name: "New Template",
      body: "Hi {{firstName}}, ..."
    };
    setTemplates(prev => [...prev, newTpl]);
    startEdit(newTpl);
  };

  const migrateFromGist = async () => {
    if (!gistMigrateId || !gistMigrateToken) return;
    setMigrating(true);
    setMigrateStatus("Fetching from Gist...");
    try {
      const authHeaders = [
        {'Authorization': `token ${gistMigrateToken}`},
        {'Authorization': `Bearer ${gistMigrateToken}`}
      ];
      let gistData = null;
      for (const headers of authHeaders) {
        const res = await fetch(`https://api.github.com/gists/${gistMigrateId.trim()}`, {headers});
        if (res.ok) {
          const data = await res.json();
          const raw = data?.files?.["jobagent_data.json"]?.content;
          if (raw) gistData = JSON.parse(raw);
          break;
        }
      }
      if (!gistData) throw new Error("Could not load data from Gist. Check ID and token.");

      const migrateItems = async (key, upsertFn) => {
        const items = gistData[key] || [];
        if (items.length > 0) {
          for (const item of items) {
            try { await upsertFn(item); } catch(e) { /* skip dups */ }
          }
        }
        return items.length;
      };

      const appCount = await migrateItems("ja_v5-apps", Storage.upsertApplication);
      const netCount = await migrateItems("ja_v5-netlog", Storage.upsertNetlog);

      setMigrateStatus(`Migration complete! ${appCount} applications, ${netCount} networking contacts imported to Supabase. Refresh the page to see your data.`);
    } catch(e) {
      setMigrateStatus(`Migration failed: ${e.message}`);
    }
    setMigrating(false);
  };

  const allTemplates = templates.length > 0 ? templates : DEFAULT_TEMPLATES;

  return (
    <div>
      <div style={{marginBottom:28}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
          <div>
            <h2 style={{margin:"0 0 4px",fontSize:24,fontWeight:800,color:t.tx}}>Settings</h2>
            <p style={{margin:0,fontSize:13.5,color:t.sub}}>Manage templates, test integrations, and migrate data.</p>
          </div>
          {user && (
            <div style={{display:'flex',alignItems:'center',gap:12,marginTop:4}}>
              <span style={{color:t.sub,fontSize:12.5}}>{user.email}</span>
              <button onClick={onSignOut} style={{
                background:t.redL, color:t.red, border:`1px solid ${t.redBd}`,
                padding:'5px 14px', borderRadius:8, fontSize:12.5, fontWeight:600,
                cursor:'pointer', fontFamily:'inherit',
              }}>Sign Out</button>
            </div>
          )}
        </div>
      </div>

      {/* Message Templates */}
      <Card t={t} style={{marginBottom:20}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:34,height:34,borderRadius:9,background:t.priL,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <Edit3 size={16} color={t.pri}/>
            </div>
            <div>
              <div style={{fontSize:14.5,fontWeight:700,color:t.tx}}>Message Templates</div>
              <div style={{fontSize:12,color:t.muted}}>{allTemplates.length} templates for networking outreach</div>
            </div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <Btn size="sm" variant="secondary" onClick={resetTemplates} t={t}><RefreshCw size={12}/> Reset to Defaults</Btn>
            <Btn size="sm" onClick={addTemplate} t={t}><Plus size={12}/> Add Template</Btn>
          </div>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {allTemplates.map(tpl => (
            <div key={tpl.id} style={{border:`1px solid ${t.border}`,borderRadius:10,overflow:"hidden"}}>
              {editingTemplate === tpl.id ? (
                <div style={{padding:16}}>
                  <div style={{marginBottom:10}}>
                    <label style={{fontSize:11,fontWeight:700,color:t.sub,display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:1}}>Template Name</label>
                    <input value={editDraft.name} onChange={e => setEditDraft(p=>({...p,name:e.target.value}))} style={{width:"100%",background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"9px 13px",color:t.tx,fontSize:13.5,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
                  </div>
                  <div style={{marginBottom:12}}>
                    <label style={{fontSize:11,fontWeight:700,color:t.sub,display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:1}}>Body (use {"{{firstName}}, {{company}}, {{role}}, {{variantFocus}}, {{variantSkills}}"})</label>
                    <textarea value={editDraft.body} onChange={e => setEditDraft(p=>({...p,body:e.target.value}))} rows={6} style={{width:"100%",background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"10px 14px",color:t.tx,fontSize:13,fontFamily:"inherit",resize:"vertical",boxSizing:"border-box",outline:"none",lineHeight:1.6}}/>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <Btn size="sm" variant="green" onClick={saveEdit} t={t}><Check size={12}/> Save</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => setEditingTemplate(null)} t={t}><X size={12}/> Cancel</Btn>
                  </div>
                </div>
              ) : (
                <div style={{padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13.5,fontWeight:700,color:t.tx,marginBottom:4}}>{tpl.name}</div>
                    <div style={{fontSize:12,color:t.muted,lineHeight:1.5,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{tpl.body}</div>
                  </div>
                  <div style={{display:"flex",gap:6,flexShrink:0,marginLeft:12}}>
                    <Btn size="sm" variant="secondary" onClick={() => startEdit(tpl)} t={t}><Edit3 size={11}/> Edit</Btn>
                    {!DEFAULT_TEMPLATES.find(d => d.id === tpl.id) && (
                      <Btn size="sm" variant="red" onClick={() => deleteTemplate(tpl.id)} t={t}><Trash2 size={11}/></Btn>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Serper API Key */}
      <Card t={t} style={{marginBottom:20}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
          <div style={{width:34,height:34,borderRadius:9,background:t.greenL,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <Database size={16} color={t.green}/>
          </div>
          <div>
            <div style={{fontSize:14.5,fontWeight:700,color:t.tx}}>Serper API Key</div>
            <div style={{fontSize:12,color:serperKey?t.green:t.muted}}>{serperKey ? "Active — Find Contacts enabled" : "Add key to enable Find Contacts in Networking"}</div>
          </div>
        </div>
        <div style={{background:t.hover,borderRadius:8,padding:"12px 14px",marginBottom:14,fontSize:12.5,color:t.sub,lineHeight:1.6}}>
          Get a free key at <strong>serper.dev</strong>. Powers the LinkedIn contact search in Networking.
        </div>
        <div style={{marginBottom:12}}>
          <label style={{fontSize:11,fontWeight:700,color:t.sub,display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:1}}>Serper API Key</label>
          <input
            type="password"
            value={serperInput}
            onChange={e => setSerperInput(e.target.value)}
            placeholder="paste your Serper key..."
            style={{width:"100%",background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"9px 13px",color:t.tx,fontSize:13,fontFamily:"monospace",outline:"none",boxSizing:"border-box"}}
          />
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <Btn onClick={saveSerperKey} disabled={serperInput === (serperKey||"")} t={t}>Save Key</Btn>
          <Btn variant="secondary" onClick={testSerper} disabled={testingSerper||(!serperInput&&!serperKey)} t={t}>{testingSerper ? "Testing..." : "Test Connection"}</Btn>
          {serperSaveStatus && <span style={{fontSize:12.5,fontWeight:600,color:serperSaveStatus.includes("failed")?t.red:t.green}}>{serperSaveStatus}</span>}
          {serperStatus && <span style={{fontSize:12.5,fontWeight:600,color:serperStatus.includes("Connected")?t.green:t.red}}>{serperStatus}</span>}
        </div>
      </Card>

      {/* Groq AI */}
      <Card t={t} style={{marginBottom:20}}>
        <button onClick={() => setPremiumOpen(!premiumOpen)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",background:"transparent",border:"none",cursor:"pointer",fontFamily:"inherit",padding:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:34,height:34,borderRadius:9,background:t.yellowL,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <Sparkles size={16} color={t.yellow}/>
            </div>
            <div style={{textAlign:"left"}}>
              <div style={{fontSize:14.5,fontWeight:700,color:t.tx}}>Groq AI (Free)</div>
              <div style={{fontSize:12,color:groqKey?t.green:t.muted}}>{groqKey ? "Active — AI-powered analysis enabled" : "Add key to enable AI analysis and drafting"}</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {groqKey && <span style={{fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,background:t.greenL,color:t.green}}>ACTIVE</span>}
            <ChevronDown size={16} color={t.muted} style={{transform:premiumOpen?"rotate(180deg)":"rotate(0deg)",transition:"transform .2s"}}/>
          </div>
        </button>
        {premiumOpen && (
          <div style={{marginTop:16,paddingTop:16,borderTop:`1px solid ${t.border}`}}>
            <div style={{background:t.hover,borderRadius:8,padding:"12px 14px",marginBottom:14,fontSize:12.5,color:t.sub,lineHeight:1.6}}>
              Groq provides a free API for <strong>llama-3.3-70b</strong>. Get a key at <strong>console.groq.com</strong> (free tier). Enables AI-powered Job Analysis and smart message drafting.
            </div>
            <div style={{marginBottom:12}}>
              <label style={{fontSize:11,fontWeight:700,color:t.sub,display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:1}}>Groq API Key</label>
              <input
                type="password"
                value={groqInput}
                onChange={e => setGroqInput(e.target.value)}
                placeholder="gsk_..."
                style={{width:"100%",background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"9px 13px",color:t.tx,fontSize:13,fontFamily:"monospace",outline:"none",boxSizing:"border-box"}}
              />
            </div>
            <div style={{display:"flex",gap:10,alignItems:"center"}}>
              <Btn onClick={saveGroqKey} disabled={groqInput === (groqKey||"")} t={t}><Sparkles size={13}/> Save Key</Btn>
              {groqKey && <Btn variant="secondary" onClick={() => { setGroqInput(""); }} t={t}>Clear</Btn>}
              {groqSaveStatus && (
                <span style={{fontSize:12.5,fontWeight:600,color:groqSaveStatus.includes("failed")?t.red:t.green}}>{groqSaveStatus}</span>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Import from GitHub Gist */}
      <Card t={t}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
          <div style={{width:34,height:34,borderRadius:9,background:t.priL,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <RefreshCw size={16} color={t.pri}/>
          </div>
          <div>
            <div style={{fontSize:14.5,fontWeight:700,color:t.tx}}>Import from GitHub Gist</div>
            <div style={{fontSize:12,color:t.muted}}>One-time migration from old localStorage/Gist storage to Supabase</div>
          </div>
        </div>

        <div style={{background:t.hover,borderRadius:8,padding:"12px 14px",marginBottom:16,fontSize:12.5,color:t.sub,lineHeight:1.6}}>
          If you used the previous version of JobAgent (v5.x with GitHub Gist sync), paste your Gist ID and token below to import your applications and networking log into Supabase.
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
          <div>
            <label style={{fontSize:11,fontWeight:700,color:t.sub,display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:1}}>Gist ID</label>
            <input value={gistMigrateId} onChange={e => setGistMigrateId(e.target.value)} placeholder="abc123def456..." style={{width:"100%",background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"9px 13px",color:t.tx,fontSize:13,fontFamily:"monospace",outline:"none",boxSizing:"border-box"}}/>
          </div>
          <div>
            <label style={{fontSize:11,fontWeight:700,color:t.sub,display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:1}}>GitHub Token (ghp_...)</label>
            <input type="password" value={gistMigrateToken} onChange={e => setGistMigrateToken(e.target.value)} placeholder="ghp_..." style={{width:"100%",background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"9px 13px",color:t.tx,fontSize:13,fontFamily:"monospace",outline:"none",boxSizing:"border-box"}}/>
          </div>
        </div>

        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <Btn onClick={migrateFromGist} disabled={migrating||!gistMigrateId||!gistMigrateToken} t={t}>
            {migrating ? "Migrating..." : "Import from Gist"}
          </Btn>
          {migrateStatus && (
            <span style={{fontSize:12.5,fontWeight:600,color:migrateStatus.includes("complete")?t.green:migrateStatus.includes("fail")?t.red:t.sub,maxWidth:500,lineHeight:1.4}}>{migrateStatus}</span>
          )}
        </div>
      </Card>

      {/* ── User Profile ──────────────────────────────────────────────────── */}
      <Card t={t} style={{marginBottom:16}}>
        <h3 style={{color:t.tx,fontSize:15,fontWeight:700,margin:'0 0 16px'}}>Your Profile</h3>
        {[
          ['Full Name',       'full_name',           'text',   'e.g. Siddardth Pathipaka'],
          ['Degree',          'degree',              'text',   'e.g. M.S. Aerospace Engineering'],
          ['Graduation Year', 'graduation_year',     'number', '2025'],
          ['Visa Status',     'visa_status',         'text',   'e.g. STEM OPT, H1B, US Citizen'],
          ['Domain Family',   'domain_family',       'text',   'aerospace_manufacturing / industrial_engineering / mechanical_thermal'],
        ].map(([label, key, type, placeholder]) => (
          <div key={key} style={{marginBottom:12}}>
            <label style={{display:'block',color:t.sub,fontSize:11.5,fontWeight:600,marginBottom:4,textTransform:'uppercase',letterSpacing:.5}}>{label}</label>
            <input
              type={type}
              value={profile[key] || ''}
              onChange={e => setProfile(p => ({...p, [key]: e.target.value}))}
              placeholder={placeholder}
              style={{width:'100%',padding:'8px 10px',borderRadius:7,border:`1px solid ${t.border}`,
                background:t.bg,color:t.tx,fontSize:13,boxSizing:'border-box',fontFamily:'inherit',outline:'none'}}
            />
          </div>
        ))}
        <Btn onClick={saveProfile} t={t} size="sm" style={{marginTop:4}}>
          {profileSaving || 'Save Profile'}
        </Btn>
      </Card>

      {/* ── Target Roles ──────────────────────────────────────────────────── */}
      <Card t={t} style={{marginBottom:16}}>
        <h3 style={{color:t.tx,fontSize:15,fontWeight:700,margin:'0 0 16px'}}>Target Roles</h3>
        <p style={{color:t.sub,fontSize:12.5,margin:'0 0 12px'}}>
          Roles the feed distribution script uses to score jobs for you. Add one per target title.
        </p>

        {roleTargets.length === 0 && (
          <p style={{color:t.muted,fontSize:12.5,marginBottom:12}}>No role targets yet — add some below.</p>
        )}
        {roleTargets.map(rt => (
          <div key={rt.id} style={{display:'flex',alignItems:'center',gap:8,marginBottom:8,padding:'7px 10px',borderRadius:7,background:t.hover}}>
            <span style={{flex:1,color:t.tx,fontSize:13}}>{rt.title}</span>
            <span style={{color:t.sub,fontSize:11.5,background:t.priL,padding:'2px 8px',borderRadius:12}}>{rt.cluster}</span>
            <Btn onClick={() => removeRoleTarget(rt.id)} variant="ghost" size="sm" t={t}>Remove</Btn>
          </div>
        ))}

        <div style={{display:'flex',gap:8,marginTop:12,flexWrap:'wrap'}}>
          <input
            value={newRole.title}
            onChange={e => setNewRole(p => ({...p, title: e.target.value}))}
            onKeyDown={e => e.key === 'Enter' && addRoleTarget()}
            placeholder="Role title (e.g. Process Engineer)"
            style={{flex:2,minWidth:180,padding:'7px 10px',borderRadius:7,border:`1px solid ${t.border}`,
              background:t.bg,color:t.tx,fontSize:13,fontFamily:'inherit',outline:'none'}}
          />
          <select
            value={newRole.cluster}
            onChange={e => setNewRole(p => ({...p, cluster: e.target.value}))}
            style={{flex:1,minWidth:140,padding:'7px 10px',borderRadius:7,border:`1px solid ${t.border}`,
              background:t.bg,color:t.tx,fontSize:13,fontFamily:'inherit'}}
          >
            {['manufacturing','process','quality','composites','materials',
              'industrial','industrial_operations','mechanical_thermal',
              'tooling_inspection','startup_manufacturing'].map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <Btn onClick={addRoleTarget} t={t} size="sm">Add</Btn>
        </div>
      </Card>
    </div>
  );
}
