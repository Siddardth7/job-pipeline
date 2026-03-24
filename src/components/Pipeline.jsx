import { useState } from 'react';
import { Activity, ArrowRight, Check, Trash2, ArrowUpDown, Filter } from 'lucide-react';

function Card({children, t, style, onClick}) {
  return <div onClick={onClick} style={{background:t.card,border:`1px solid ${t.border}`,borderRadius:12,padding:20,boxShadow:t.shadow,cursor:onClick?"pointer":"default",...style}}>{children}</div>;
}
function Btn({children, onClick, disabled, variant="primary", size="md", t, style:xs}) {
  const V={primary:{bg:t.pri,c:"#fff",b:"none"},secondary:{bg:"transparent",c:t.sub,b:`1px solid ${t.border}`},green:{bg:t.greenL,c:t.green,b:`1px solid ${t.greenBd}`},red:{bg:t.redL,c:t.red,b:`1px solid ${t.redBd}`}};
  const s=V[variant]||V.primary; const p=size==="sm"?"5px 14px":"10px 20px"; const fs=size==="sm"?12.5:13.5;
  return <button onClick={onClick} disabled={disabled} style={{background:s.bg,color:s.c,border:s.b,padding:p,borderRadius:8,fontSize:fs,fontWeight:600,cursor:disabled?"not-allowed":"pointer",opacity:disabled?.4:1,fontFamily:"inherit",whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:6,...xs}}>{children}</button>;
}
function SectionLabel({children, t}) {
  return <div style={{fontSize:10.5,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:2,marginBottom:14}}>{children}</div>;
}
function StatusBadge({status, t}) {
  const map={GREEN:{bg:t.greenL,c:t.green},YELLOW:{bg:t.yellowL,c:t.yellow},RED:{bg:t.redL,c:t.red}};
  const s=map[status]||{bg:t.hover,c:t.sub};
  return <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"4px 10px",borderRadius:20,fontSize:11.5,fontWeight:700,background:s.bg,color:s.c}}>{status}</span>;
}
const matchColor=(v,t)=>v>=90?t.green:v>=75?t.yellow:t.red;

function formatAddedDate(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {month:"short", day:"numeric"});
}

const SORT_OPTIONS = ["Date Added", "Match %", "Colour"];
const FILTER_OPTIONS = ["All", "GREEN", "YELLOW", "RED"];

export default function Pipeline({pipeline, removePipeline, completePipeline, onLogApp, setPage, setCurrentJob, apps, t}) {
  const [sortBy, setSortBy] = useState("Date Added");
  const [filterBy, setFilterBy] = useState("All");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  const active = pipeline.filter(j => j.status === "active");
  const appKeys = new Set(apps.map(a => `${a.role}||${a.company}`));

  const handleComplete = (job) => {
    const key = `${job.role}||${job.company}`;
    if (!appKeys.has(key)) {
      onLogApp({
        id: `app-${Date.now()}`,
        role: job.role,
        company: job.company,
        location: job.location || "",
        link: job.link || "",
        companyLink: "",
        match: job.match || "",
        verdict: job.verdict || "GREEN",
        status: "Applied",
        date: new Date().toLocaleDateString(),
        locationType: job.locationType || "Onsite",
        type: job.type || "Full-time",
        salary: job.salary || "",
        resumeVariant: job.resumeVariant || "",
        fitLevel: job.verdict === "GREEN" ? "Green" : job.verdict === "YELLOW" ? "Yellow" : "Red"
      });
    }
    completePipeline(job.id);
  };

  // Apply filter
  const VERDICT_ORDER = { GREEN: 0, YELLOW: 1, RED: 2 };
  const filtered = filterBy === "All" ? active : active.filter(j => (j.verdict || "GREEN") === filterBy);

  // Apply sort
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "Date Added") return (b.addedAt || 0) - (a.addedAt || 0);
    if (sortBy === "Match %") return (b.match || 0) - (a.match || 0);
    if (sortBy === "Colour") return (VERDICT_ORDER[a.verdict] ?? 1) - (VERDICT_ORDER[b.verdict] ?? 1);
    return 0;
  });

  return (
    <div>
      <div style={{marginBottom:24}}>
        <h2 style={{margin:"0 0 4px",fontSize:24,fontWeight:700,color:t.tx}}>Pipeline</h2>
        <p style={{margin:0,fontSize:14,color:t.sub}}>Jobs you want to apply to this session. Process each one through Analysis and Networking.</p>
      </div>

      {/* Flow guide */}
      <Card t={t} style={{marginBottom:20,padding:"16px 24px"}}>
        <div style={{display:"flex",alignItems:"center",gap:0}}>
          {["Add Jobs","Analyze","Network","Complete"].map((step,i) => (
            <div key={step} style={{flex:1,display:"flex",alignItems:"center"}}>
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                <div style={{width:28,height:28,borderRadius:"50%",background:t.pri,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700}}>{i+1}</div>
                <span style={{fontSize:11,fontWeight:600,color:t.pri,whiteSpace:"nowrap"}}>{step}</span>
              </div>
              {i < 3 && <div style={{flex:1,height:2,background:t.border,margin:"0 4px",marginTop:-18}}/>}
            </div>
          ))}
        </div>
      </Card>

      {active.length === 0 && (
        <Card t={t} style={{textAlign:"center",padding:"60px 24px"}}>
          <Activity size={32} color={t.muted} style={{marginBottom:12}}/>
          <div style={{fontSize:14,fontWeight:600,color:t.sub,marginBottom:16}}>No jobs in pipeline. Add jobs from Find Jobs.</div>
          <Btn onClick={() => setPage("search")} t={t}>Find Jobs</Btn>
        </Card>
      )}

      {active.length > 0 && (
        <>
          {/* Controls row */}
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
            <SectionLabel t={t} style={{margin:0}}>Active ({filtered.length}{filterBy !== "All" ? ` of ${active.length}` : ""})</SectionLabel>
            <div style={{marginLeft:"auto",display:"flex",gap:8,position:"relative"}}>

              {/* Sort button */}
              <div style={{position:"relative"}}>
                <Btn size="sm" variant="secondary" onClick={() => { setShowSortMenu(s => !s); setShowFilterMenu(false); }} t={t}>
                  <ArrowUpDown size={13}/> {sortBy}
                </Btn>
                {showSortMenu && (
                  <div style={{position:"absolute",right:0,top:"calc(100% + 4px)",background:t.card,border:`1px solid ${t.border}`,borderRadius:10,boxShadow:"0 4px 16px rgba(0,0,0,.15)",zIndex:50,minWidth:140,overflow:"hidden"}}>
                    {SORT_OPTIONS.map(opt => (
                      <div key={opt} onClick={() => { setSortBy(opt); setShowSortMenu(false); }}
                        style={{padding:"9px 16px",fontSize:13,fontWeight:sortBy===opt?700:500,color:sortBy===opt?t.pri:t.tx,cursor:"pointer",background:sortBy===opt?t.priL:"transparent"}}
                        onMouseEnter={e => { if(sortBy!==opt) e.currentTarget.style.background=t.hover; }}
                        onMouseLeave={e => { if(sortBy!==opt) e.currentTarget.style.background="transparent"; }}>
                        {opt}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Filter button */}
              <div style={{position:"relative"}}>
                <Btn size="sm" variant={filterBy !== "All" ? "primary" : "secondary"} onClick={() => { setShowFilterMenu(s => !s); setShowSortMenu(false); }} t={t}>
                  <Filter size={13}/> {filterBy === "All" ? "Filter" : filterBy}
                </Btn>
                {showFilterMenu && (
                  <div style={{position:"absolute",right:0,top:"calc(100% + 4px)",background:t.card,border:`1px solid ${t.border}`,borderRadius:10,boxShadow:"0 4px 16px rgba(0,0,0,.15)",zIndex:50,minWidth:120,overflow:"hidden"}}>
                    {FILTER_OPTIONS.map(opt => (
                      <div key={opt} onClick={() => { setFilterBy(opt); setShowFilterMenu(false); }}
                        style={{padding:"9px 16px",fontSize:13,fontWeight:filterBy===opt?700:500,color:filterBy===opt?t.pri:t.tx,cursor:"pointer",background:filterBy===opt?t.priL:"transparent"}}
                        onMouseEnter={e => { if(filterBy!==opt) e.currentTarget.style.background=t.hover; }}
                        onMouseLeave={e => { if(filterBy!==opt) e.currentTarget.style.background="transparent"; }}>
                        {opt}
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </div>

          {sorted.length === 0 && (
            <Card t={t} style={{textAlign:"center",padding:"32px 24px"}}>
              <div style={{fontSize:13,color:t.muted}}>No {filterBy} jobs in pipeline.</div>
            </Card>
          )}

          {sorted.map(job => {
            const dateLabel = formatAddedDate(job.addedAt || job.pipeline_added_at);
            return (
              <Card key={job.id} t={t} style={{marginBottom:8,padding:"14px 18px"}}>
                <div style={{display:"flex",alignItems:"center",gap:14}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14.5,fontWeight:700,color:t.tx}}>{job.role}</div>
                    <div style={{fontSize:13,color:t.sub}}>{job.company}{job.location?` · ${job.location}`:""}</div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    {dateLabel && (
                      <span style={{fontSize:11.5,fontWeight:600,color:t.muted}}>{dateLabel}</span>
                    )}
                    {job.match != null && (
                      <span style={{fontSize:13,fontWeight:700,color:matchColor(job.match,t)}}>{job.match}%</span>
                    )}
                    <StatusBadge status={job.verdict||"YELLOW"} t={t}/>
                    <Btn size="sm" onClick={() => setPage("analyze", job)} t={t}><ArrowRight size={12}/> Analyze</Btn>
                    <Btn size="sm" variant="green" onClick={() => handleComplete(job)} t={t}><Check size={12}/> Complete</Btn>
                    <Btn size="sm" variant="red" onClick={() => removePipeline(job.id)} t={t}><Trash2 size={12}/></Btn>
                  </div>
                </div>
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}
