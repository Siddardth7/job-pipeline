import { useState } from 'react';
import { Search, Plus, X, ExternalLink, Rocket } from 'lucide-react';
import { M628 } from '../data/m628.js';

function Card({children, t, style, onClick}) {
  return <div onClick={onClick} style={{background:t.card,border:`1px solid ${t.border}`,borderRadius:12,padding:20,boxShadow:t.shadow,cursor:onClick?"pointer":"default",...style}}>{children}</div>;
}
function Chip({children, active, onClick, t}) {
  return <button onClick={onClick} style={{padding:"6px 16px",borderRadius:20,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",background:active?t.pri:t.card,border:`1px solid ${active?t.pri:t.border}`,color:active?"#fff":t.sub}}>{children}</button>;
}
function Btn({children, onClick, disabled, variant="primary", size="md", t, style:xs}) {
  const V={primary:{bg:t.pri,c:"#fff",b:"none"},secondary:{bg:"transparent",c:t.sub,b:`1px solid ${t.border}`},green:{bg:t.greenL,c:t.green,b:`1px solid ${t.greenBd}`},red:{bg:t.redL,c:t.red,b:`1px solid ${t.redBd}`}};
  const s=V[variant]||V.primary; const p=size==="sm"?"5px 14px":"10px 20px"; const fs=size==="sm"?12.5:13.5;
  return <button onClick={onClick} disabled={disabled} style={{background:s.bg,color:s.c,border:s.b,padding:p,borderRadius:8,fontSize:fs,fontWeight:600,cursor:disabled?"not-allowed":"pointer",opacity:disabled?.4:1,fontFamily:"inherit",whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:6,...xs}}>{children}</button>;
}
function ModalOverlay({onClose, children, t}) {
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div onClick={e => e.stopPropagation()} style={{background:t.card,border:`1px solid ${t.border}`,borderRadius:16,padding:28,width:"100%",maxWidth:480,boxShadow:"0 20px 60px rgba(0,0,0,.3)",maxHeight:"85vh",overflowY:"auto"}}>
        {children}
      </div>
    </div>
  );
}

const PERSONA_OPTIONS = ['Recruiter','Hiring Manager','Peer Engineer','Executive','UIUC Alumni','Senior Engineer'];

const BLANK_FORM = { name:'', industry:'', tier:'2', h1b:'LIKELY', itar:'NO', roles:'', atsBoardUrl:'' };

export default function CompanyIntel({customCompanies, setCustomCompanies, onStartOutreach, t}) {
  const [query, setQuery]           = useState('');
  const [tierFilter, setTierFilter] = useState('all');
  const [filterVisa, setFilterVisa] = useState(false);
  const [showAdd, setShowAdd]       = useState(false);
  const [addForm, setAddForm]       = useState(BLANK_FORM);
  const [outreachCo, setOutreachCo] = useState(null); // company object for modal
  const [orPersonas, setOrPersonas] = useState(['Recruiter','Hiring Manager']);
  const [orCount, setOrCount]       = useState(5);

  const allCos = [...M628, ...(customCompanies||[]).filter(c => !M628.find(m => m.name === c.name))];

  const filtered = allCos.filter(c => {
    if (query.trim() && !c.name.toLowerCase().includes(query.toLowerCase()) && !(c.industry||'').toLowerCase().includes(query.toLowerCase())) return false;
    if (tierFilter !== 'all' && c.tier !== parseInt(tierFilter)) return false;
    if (filterVisa && c.h1b !== 'YES') return false;
    return true;
  });

  const handleAddSave = () => {
    if (!addForm.name.trim()) return;
    const newCo = {
      name: addForm.name.trim(),
      industry: addForm.industry.trim() || 'Unknown',
      tier: parseInt(addForm.tier) || 2,
      h1b: addForm.h1b,
      itar: addForm.itar,
      roles: addForm.roles.trim(),
      atsBoardUrl: addForm.atsBoardUrl.trim(),
      atsPlatform: addForm.atsBoardUrl.trim() ? 'Custom' : 'Unknown',
    };
    setCustomCompanies(prev => [...(prev||[]), newCo]);
    setAddForm(BLANK_FORM);
    setShowAdd(false);
  };

  const togglePersona = (p) => {
    setOrPersonas(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  };

  const handleStartOutreach = () => {
    if (onStartOutreach) onStartOutreach(outreachCo.name);
    setOutreachCo(null);
  };

  const inputStyle = {
    width:'100%', background:t.bg, border:`1px solid ${t.border}`, borderRadius:8,
    padding:'9px 12px', color:t.tx, fontSize:13.5, outline:'none', fontFamily:'inherit', boxSizing:'border-box',
  };
  const selStyle = {...inputStyle};
  const labelStyle = {fontSize:11,fontWeight:700,color:t.sub,display:'block',marginBottom:5,textTransform:'uppercase',letterSpacing:1};

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:24}}>
        <div>
          <h2 style={{margin:"0 0 4px",fontSize:24,fontWeight:700,color:t.tx}}>Company Intelligence</h2>
          <p style={{margin:0,fontSize:14,color:t.sub}}>{allCos.length} companies tracked{(customCompanies||[]).length>0?` (${(customCompanies||[]).length} custom)`:''}  </p>
        </div>
        <Btn onClick={() => setShowAdd(true)} t={t}>
          <Plus size={15}/> Add Company
        </Btn>
      </div>

      <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
        <div style={{position:"relative",flex:1,minWidth:200}}>
          <Search size={15} color={t.muted} style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)"}}/>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search companies..."
            style={{width:"100%",background:t.card,border:`1px solid ${t.border}`,borderRadius:9,padding:"9px 14px 9px 36px",color:t.tx,fontSize:13.5,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
        </div>
        <select value={tierFilter} onChange={e => setTierFilter(e.target.value)} style={{background:t.card,border:`1px solid ${t.border}`,borderRadius:9,padding:"9px 14px",color:t.tx,fontSize:13.5,fontFamily:"inherit",outline:"none"}}>
          <option value="all">All Tiers</option>
          {[1,2,3,4,5,6].map(n => <option key={n} value={n}>Tier {n}</option>)}
        </select>
        <Chip active={filterVisa} onClick={() => setFilterVisa(!filterVisa)} t={t}>H-1B Sponsors</Chip>
        <span style={{fontSize:13,color:t.muted,alignSelf:"center"}}>{filtered.length} companies</span>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14}}>
        {filtered.slice(0, 60).map(c => {
          const isCustom = (customCompanies||[]).find(x => x.name === c.name);
          return (
            <Card key={c.name} t={t} style={{padding:"16px 18px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:14.5,fontWeight:700,color:t.tx,marginBottom:2}}>
                    {c.name}
                    {isCustom && <span style={{fontSize:10,fontWeight:700,marginLeft:6,padding:"2px 6px",borderRadius:10,background:t.priL,color:t.pri}}>Custom</span>}
                  </div>
                  <div style={{fontSize:12.5,color:t.muted}}>{c.industry} · T{c.tier}</div>
                </div>
                <div style={{display:"flex",gap:5,flexShrink:0,marginLeft:8}}>
                  <span style={{fontSize:10.5,fontWeight:700,padding:"3px 8px",borderRadius:5,background:c.h1b==="YES"?t.greenL:t.yellowL,color:c.h1b==="YES"?t.green:t.yellow}}>H-1B: {c.h1b}</span>
                  {c.itar === "YES" && <span style={{fontSize:10.5,fontWeight:700,padding:"3px 8px",borderRadius:5,background:t.redL,color:t.red}}>ITAR</span>}
                </div>
              </div>
              {c.roles && <div style={{fontSize:12,color:t.muted,marginBottom:8}}>{c.roles}</div>}
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginTop:8}}>
                {c.atsBoardUrl && (
                  <a href={c.atsBoardUrl} target="_blank" rel="noreferrer" style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:12,color:t.pri,textDecoration:"none",fontWeight:600}}>
                    <ExternalLink size={12}/>{c.atsPlatform !== "Unknown" ? `Apply via ${c.atsPlatform}` : "Job Board"}
                  </a>
                )}
                <button onClick={() => { setOutreachCo(c); setOrPersonas(['Recruiter','Hiring Manager']); setOrCount(5); }}
                  style={{display:"inline-flex",alignItems:"center",gap:5,padding:"4px 12px",borderRadius:7,background:t.priL,border:`1px solid ${t.priBd}`,color:t.pri,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                  <Rocket size={12}/> Cold Outreach
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <Card t={t} style={{textAlign:"center",padding:"60px 24px"}}>
          <Search size={32} color={t.muted} style={{marginBottom:12}}/>
          <div style={{fontSize:14,fontWeight:600,color:t.sub}}>No companies match your search.</div>
        </Card>
      )}
      {filtered.length > 60 && (
        <div style={{textAlign:"center",padding:"20px 0",fontSize:13,color:t.muted}}>
          Showing 60 of {filtered.length}. Narrow your search to see more.
        </div>
      )}

      {/* ── Add Company Modal ── */}
      {showAdd && (
        <ModalOverlay onClose={() => setShowAdd(false)} t={t}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
            <div style={{fontSize:17,fontWeight:800,color:t.tx}}>Add Company</div>
            <button onClick={() => setShowAdd(false)} style={{background:"none",border:"none",cursor:"pointer",color:t.muted,padding:4}}><X size={18}/></button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div style={{gridColumn:"1/-1"}}>
              <label style={labelStyle}>Company Name *</label>
              <input value={addForm.name} onChange={e => setAddForm(f=>({...f,name:e.target.value}))} placeholder="e.g. SpaceX" style={inputStyle}/>
            </div>
            <div>
              <label style={labelStyle}>Industry</label>
              <input value={addForm.industry} onChange={e => setAddForm(f=>({...f,industry:e.target.value}))} placeholder="e.g. Aerospace" style={inputStyle}/>
            </div>
            <div>
              <label style={labelStyle}>Tier</label>
              <select value={addForm.tier} onChange={e => setAddForm(f=>({...f,tier:e.target.value}))} style={selStyle}>
                {[1,2,3,4,5,6].map(n=><option key={n} value={n}>Tier {n}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>H-1B Sponsorship</label>
              <select value={addForm.h1b} onChange={e => setAddForm(f=>({...f,h1b:e.target.value}))} style={selStyle}>
                <option value="YES">YES</option>
                <option value="LIKELY">LIKELY</option>
                <option value="NO">NO</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>ITAR</label>
              <select value={addForm.itar} onChange={e => setAddForm(f=>({...f,itar:e.target.value}))} style={selStyle}>
                <option value="NO">NO</option>
                <option value="YES">YES</option>
              </select>
            </div>
            <div style={{gridColumn:"1/-1"}}>
              <label style={labelStyle}>Target Roles (optional)</label>
              <input value={addForm.roles} onChange={e => setAddForm(f=>({...f,roles:e.target.value}))} placeholder="e.g. Manufacturing Engineer, Quality Engineer" style={inputStyle}/>
            </div>
            <div style={{gridColumn:"1/-1"}}>
              <label style={labelStyle}>ATS / Job Board URL (optional)</label>
              <input value={addForm.atsBoardUrl} onChange={e => setAddForm(f=>({...f,atsBoardUrl:e.target.value}))} placeholder="https://..." style={inputStyle}/>
            </div>
          </div>
          <div style={{display:"flex",gap:10,marginTop:20,justifyContent:"flex-end"}}>
            <Btn variant="secondary" onClick={() => setShowAdd(false)} t={t}>Cancel</Btn>
            <Btn onClick={handleAddSave} disabled={!addForm.name.trim()} t={t}><Plus size={14}/> Add Company</Btn>
          </div>
        </ModalOverlay>
      )}

      {/* ── Cold Outreach Planner Modal ── */}
      {outreachCo && (
        <ModalOverlay onClose={() => setOutreachCo(null)} t={t}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
            <div style={{fontSize:17,fontWeight:800,color:t.tx}}>Cold Outreach</div>
            <button onClick={() => setOutreachCo(null)} style={{background:"none",border:"none",cursor:"pointer",color:t.muted,padding:4}}><X size={18}/></button>
          </div>
          <div style={{fontSize:13,color:t.sub,marginBottom:20}}>{outreachCo.name} · {outreachCo.industry} · T{outreachCo.tier}</div>

          <div style={{marginBottom:16}}>
            <label style={labelStyle}>Target Personas</label>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {PERSONA_OPTIONS.map(p => (
                <button key={p} onClick={() => togglePersona(p)}
                  style={{padding:"6px 14px",borderRadius:20,fontSize:12.5,fontWeight:600,cursor:"pointer",fontFamily:"inherit",
                    background:orPersonas.includes(p)?t.pri:t.bg,
                    border:`1px solid ${orPersonas.includes(p)?t.pri:t.border}`,
                    color:orPersonas.includes(p)?"#fff":t.sub}}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div style={{marginBottom:20}}>
            <label style={labelStyle}>Number of Contacts</label>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <input type="number" min={3} max={10} value={orCount} onChange={e => setOrCount(Math.max(3,Math.min(10,+e.target.value)))}
                style={{width:70,...inputStyle}}/>
              <span style={{fontSize:13,color:t.sub}}>contacts total ({orPersonas.length > 0 ? `across ${orPersonas.join(', ')}` : 'no persona selected'})</span>
            </div>
          </div>

          <div style={{padding:"10px 14px",background:t.priL,borderRadius:8,border:`1px solid ${t.priBd}`,marginBottom:20,fontSize:13,color:t.sub}}>
            This will take you to Networking with <strong style={{color:t.tx}}>{outreachCo.name}</strong> pre-filled. Select <strong style={{color:t.tx}}>Cold Outreach</strong> intent and run Find Contacts there.
          </div>

          <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
            <Btn variant="secondary" onClick={() => setOutreachCo(null)} t={t}>Cancel</Btn>
            <Btn onClick={handleStartOutreach} disabled={orPersonas.length===0} t={t}>
              <Rocket size={14}/> Go to Networking →
            </Btn>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
