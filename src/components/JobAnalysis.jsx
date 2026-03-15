import { useState, useEffect, useCallback } from 'react';
import { BarChart2, CheckCircle, Users, Copy, Check, Briefcase, Zap, SlidersHorizontal, Edit3 } from 'lucide-react';
import { analyzeJob } from '../lib/scoring.js';

const RESUMES = {
  A: {name:"Manufacturing & Plant Ops", skills:"GD&T, CMM, Fixtures"},
  B: {name:"Process & CI", skills:"FMEA, SPC, 8D, Lean"},
  C: {name:"Quality & Materials", skills:"CMM, MRB, Composites"},
  D: {name:"Equipment & NPI", skills:"Tooling, PFMEA, DOE"}
};

function Card({children, t, style}) {
  return <div style={{background:t.card,border:`1px solid ${t.border}`,borderRadius:12,padding:20,boxShadow:t.shadow,...style}}>{children}</div>;
}
function Btn({children, onClick, disabled, variant="primary", size="md", t, style:xs}) {
  const V={primary:{bg:t.pri,c:"#fff",b:"none"},secondary:{bg:"transparent",c:t.sub,b:`1px solid ${t.border}`},ghost:{bg:"transparent",c:t.muted,b:`1px solid ${t.border}`},green:{bg:t.greenL,c:t.green,b:`1px solid ${t.greenBd}`},red:{bg:t.redL,c:t.red,b:`1px solid ${t.redBd}`}};
  const s=V[variant]||V.primary; const p=size==="sm"?"5px 14px":"10px 20px"; const fs=size==="sm"?12.5:13.5;
  return <button onClick={onClick} disabled={disabled} style={{background:s.bg,color:s.c,border:s.b,padding:p,borderRadius:8,fontSize:fs,fontWeight:600,cursor:disabled?"not-allowed":"pointer",opacity:disabled?.4:1,fontFamily:"inherit",whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:6,...xs}}>{children}</button>;
}
function Input({label, value, onChange, placeholder, multiline, rows=4, t, style:xs}) {
  const base={width:"100%",background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"9px 13px",color:t.tx,fontSize:13.5,outline:"none",boxSizing:"border-box",fontFamily:"inherit",lineHeight:1.6,...xs};
  return <div style={{marginBottom:14}}>{label&&<label style={{fontSize:11,fontWeight:700,color:t.sub,display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:1}}>{label}</label>}{multiline?<textarea value={value} onChange={onChange} placeholder={placeholder} rows={rows} style={{...base,resize:"vertical"}}/>:<input value={value} onChange={onChange} placeholder={placeholder} style={base}/>}</div>;
}
function SectionLabel({children, t}) {
  return <div style={{fontSize:10.5,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:2,marginBottom:14}}>{children}</div>;
}

function robustCopy(text) {
  if (!text) return Promise.reject("Nothing to copy");
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); resolve(); } catch { reject(); }
    finally { document.body.removeChild(ta); }
  });
}

// Parse \skillline{Label}{Skills} into rows
function SkilllinePreview({latex, t}) {
  const lines = (latex || "").split('\n').filter(Boolean);
  const parsed = lines.map(line => {
    const m = line.match(/\\skillline\{([^}]+)\}\{([^}]+)\}/);
    return m ? {label: m[1], skills: m[2]} : null;
  }).filter(Boolean);

  if (!parsed.length) {
    return <div style={{fontSize:12.5,color:t.sub,whiteSpace:"pre-wrap",lineHeight:1.7}}>{latex}</div>;
  }
  return (
    <div>
      {parsed.map((row, i) => (
        <div key={i} style={{display:"flex",gap:8,marginBottom:6,fontSize:12,lineHeight:1.5,alignItems:"baseline"}}>
          <span style={{fontWeight:700,color:t.pri,minWidth:170,flexShrink:0,fontSize:11.5}}>{row.label.replace(/\\&/g, '&')}</span>
          <span style={{color:t.sub}}>{row.skills.replace(/\\&/g, '&')}</span>
        </div>
      ))}
    </div>
  );
}

export default function JobAnalysis({currentJob, updatePipelineJob, completePipeline, onLogApp, setPage, setCurrentJob, apps, findCompany, isBlacklisted, checkITAR, t}) {
  const [co, setCo] = useState(currentJob?.company || "");
  const [role, setRole] = useState(currentJob?.role || "");
  const [loc, setLoc] = useState(currentJob?.location || "");
  const [link, setLink] = useState(currentJob?.link || "");
  const [jd, setJd] = useState(currentJob?.jd || "");
  const [res, setRes] = useState(null);
  const [result, setResult] = useState(currentJob?.analysisResult || null);
  const [loading, setLoading] = useState(false);
  const [checks, setChecks] = useState(null);
  const [copied, setCopied] = useState("");
  const [showRaw1, setShowRaw1] = useState(false);
  const [showRaw2, setShowRaw2] = useState(false);

  // Sync from currentJob whenever the active job changes
  useEffect(() => {
    if (currentJob) {
      setCo(currentJob.company || "");
      setRole(currentJob.role || "");
      setLoc(currentJob.location || "");
      setLink(currentJob.link || "");
      setJd(currentJob.jd || "");
      setResult(currentJob.analysisResult || null);
    }
  }, [currentJob?.id]);

  // Persist JD and form fields back to currentJob so they survive page switches
  const syncToParent = useCallback((updates) => {
    setCurrentJob(prev => prev ? {...prev, ...updates} : updates);
  }, [setCurrentJob]);

  const handleJdChange = (e) => {
    setJd(e.target.value);
    syncToParent({ jd: e.target.value });
  };
  const handleCoChange = (e) => { setCo(e.target.value); syncToParent({ company: e.target.value }); };
  const handleRoleChange = (e) => { setRole(e.target.value); syncToParent({ role: e.target.value }); };
  const handleLocChange = (e) => { setLoc(e.target.value); syncToParent({ location: e.target.value }); };
  const handleLinkChange = (e) => { setLink(e.target.value); syncToParent({ link: e.target.value }); };

  // ITAR/blacklist checks
  useEffect(() => {
    if (!co && !jd) return;
    const c = {};
    if (co) { c.bl = isBlacklisted(co); c.m628 = findCompany(co); }
    if (jd) c.itar = checkITAR(jd);
    c.ok = !c.bl && (!c.itar || c.itar.length === 0);
    setChecks(c);
  }, [co, jd]);

  const analyze = () => {
    if (!jd.trim()) return;
    setLoading(true);
    setTimeout(() => {
      const analysisResult = analyzeJob(jd, res);
      setResult(analysisResult);
      syncToParent({ analysisResult, jd, company: co, role, location: loc, link });
      if (currentJob?.id) {
        updatePipelineJob(currentJob.id, { analysisResult, jd, company: co, role, location: loc, link });
      }
      setLoading(false);
    }, 300);
  };

  const copyText = (k, v) => {
    robustCopy(v).then(() => { setCopied(k); setTimeout(() => setCopied(""), 2500); }).catch(() => {});
  };

  const handleCompleteAndLog = () => {
    if (currentJob?.id) completePipeline(currentJob.id);
    const appKey = `${currentJob?.role||role}||${currentJob?.company||co}`;
    const appKeys = new Set(apps.map(a => `${a.role}||${a.company}`));
    if (!appKeys.has(appKey)) {
      onLogApp({
        id: `app-${Date.now()}`,
        role: currentJob?.role || role,
        company: currentJob?.company || co,
        location: currentJob?.location || loc,
        link: currentJob?.link || link,
        companyLink: "",
        match: currentJob?.match || "",
        verdict: currentJob?.verdict || "GREEN",
        status: "Applied",
        date: new Date().toLocaleDateString(),
        locationType: currentJob?.locationType || "Onsite",
        type: currentJob?.type || "Full-time",
        salary: currentJob?.salary || "",
        resumeVariant: result?.recommendedResume || res || "",
        fitLevel: (currentJob?.verdict) === "GREEN" ? "Green" : (currentJob?.verdict) === "YELLOW" ? "Yellow" : "Red"
      });
    }
    setPage("pipeline");
  };

  const mod1LaTeX = result ? `\\textbf{${result.mod1_summary}}` : "";

  return (
    <div>
      <div style={{marginBottom:24}}>
        <h2 style={{margin:"0 0 4px",fontSize:24,fontWeight:700,color:t.tx}}>Job Analysis</h2>
        <p style={{margin:0,fontSize:14,color:t.sub}}>Resume modifications for ATS optimization (2 edits only: Summary + Skills)</p>
      </div>

      {!currentJob?.role && !co && (
        <Card t={t} style={{textAlign:"center",padding:"60px 24px"}}>
          <BarChart2 size={32} color={t.muted} style={{marginBottom:12}}/>
          <div style={{fontSize:14,fontWeight:600,color:t.sub,marginBottom:16}}>Select a job from Pipeline to analyze.</div>
          <Btn onClick={() => setPage("pipeline")} t={t}>Go to Pipeline</Btn>
        </Card>
      )}

      {(currentJob?.role || co) && (
        <Card t={t} style={{marginBottom:16}}>
          <SectionLabel t={t}>Job Details</SectionLabel>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12,marginBottom:12}}>
            <Input label="Company" value={co} onChange={handleCoChange} t={t}/>
            <Input label="Role" value={role} onChange={handleRoleChange} t={t}/>
            <Input label="Location" value={loc} onChange={handleLocChange} t={t}/>
            <Input label="Link" value={link} onChange={handleLinkChange} t={t}/>
          </div>
          <Input
            label="Full Job Description"
            value={jd}
            onChange={handleJdChange}
            placeholder="Paste the complete job description here..."
            multiline rows={8} t={t}
          />
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            <Btn onClick={analyze} disabled={loading||!jd.trim()} t={t}>
              {loading ? "Analyzing..." : "Run Resume Analysis"}
            </Btn>
            <span style={{fontSize:12,color:t.muted}}>Override resume:</span>
            {["Auto","A","B","C","D"].map(k => {
              const active = k === "Auto" ? res === null : res === k;
              return (
                <button key={k}
                  onClick={() => setRes(k === "Auto" ? null : (res === k ? null : k))}
                  style={{padding:"8px 14px",borderRadius:8,fontSize:12.5,fontWeight:700,cursor:"pointer",fontFamily:"inherit",
                    background:active?t.pri+"18":"transparent",
                    border:`1px solid ${active?t.pri:t.border}`,
                    color:active?t.pri:t.sub}}>
                  {k === "Auto" ? "Auto-detect" : `Resume ${k}`}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {checks && (
        <Card t={t} style={{marginBottom:16,borderColor:checks.ok?t.greenBd:t.redBd}}>
          {checks.bl && <div style={{color:t.red,fontSize:13,fontWeight:700,marginBottom:4}}>⛔ Blacklisted: {checks.bl}</div>}
          {checks.itar?.length > 0 && <div style={{color:t.red,fontSize:13,fontWeight:700,marginBottom:4}}>🔒 ITAR keywords: {checks.itar.join(", ")}</div>}
          {checks.m628 && <div style={{color:t.green,fontSize:13,fontWeight:600,marginBottom:4}}>✓ M628: {checks.m628.name} · Tier {checks.m628.tier} · H-1B: {checks.m628.h1b} · ITAR: {checks.m628.itar}</div>}
          {checks.ok && <div style={{color:t.green,fontSize:13,fontWeight:600}}>✓ No ITAR or blacklist flags</div>}
        </Card>
      )}

      {loading && (
        <div style={{display:"flex",gap:6,alignItems:"center",justifyContent:"center",padding:"40px 0"}}>
          {[0,1,2].map(i => <div key={i} style={{width:7,height:7,borderRadius:"50%",background:t.pri,animation:`lp-dot .8s ${i*.15}s ease-in-out infinite`,opacity:.3}}/>)}
        </div>
      )}

      {result && !loading && (
        <div>
          {/* Recommended Resume */}
          <Card t={t} style={{marginBottom:16}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
              <Briefcase size={16} color={t.pri}/>
              <span style={{fontSize:14,fontWeight:700,color:t.tx}}>Recommended Resume</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",background:t.priL,border:`1px solid ${t.priBd}`,borderRadius:10}}>
              <div style={{width:40,height:40,borderRadius:8,background:t.pri,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:800,color:"#fff"}}>{result.recommendedResume}</div>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:t.tx}}>{RESUMES[result.recommendedResume]?.name || "Unknown"}</div>
                <div style={{fontSize:12.5,color:t.sub}}>{result.resumeReason}</div>
              </div>
            </div>
          </Card>

          <div style={{background:t.redL,border:`1px solid ${t.redBd}`,borderRadius:8,padding:"10px 16px",marginBottom:16,fontSize:12.5,fontWeight:700,color:t.red}}>
            CRITICAL: Only TWO modifications permitted — Summary and Skills only. Experience and project bullets are LOCKED.
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>

            {/* MOD 1: Summary */}
            <Card t={t} style={{borderColor:t.greenBd}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:28,height:28,borderRadius:7,background:t.greenL,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <Edit3 size={14} color={t.green}/>
                  </div>
                  <div>
                    <div style={{fontSize:13.5,fontWeight:700,color:t.tx}}>Mod 1 — Summary</div>
                    <div style={{fontSize:11,color:t.muted}}>Paste inside \textbf{"{...}"} in Overleaf</div>
                  </div>
                </div>
                <Btn size="sm" variant="green" onClick={() => copyText("mod1", result.mod1_summary)} t={t}>
                  {copied === "mod1" ? <><Check size={11}/> Copied</> : <><Copy size={11}/> Copy Text</>}
                </Btn>
              </div>

              {/* Preview */}
              <div style={{background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"14px 16px",marginBottom:10}}>
                <div style={{fontSize:10,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Preview</div>
                <div style={{fontSize:13,lineHeight:1.8,color:t.tx,fontStyle:"italic"}}>{result.mod1_summary || "—"}</div>
              </div>

              {/* Raw LaTeX toggle */}
              <button onClick={() => setShowRaw1(!showRaw1)} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:t.muted,fontWeight:600,padding:0,marginBottom:showRaw1?8:0}}>
                {showRaw1 ? "▼" : "▶"} Raw LaTeX
              </button>
              {showRaw1 && (
                <div style={{position:"relative"}}>
                  <div style={{background:t.hover,border:`1px solid ${t.border}`,borderRadius:6,padding:"10px 12px",fontSize:11,lineHeight:1.7,color:t.sub,fontFamily:"monospace",whiteSpace:"pre-wrap",maxHeight:120,overflowY:"auto"}}>
                    {mod1LaTeX}
                  </div>
                  <Btn size="sm" variant="ghost" onClick={() => copyText("mod1latex", mod1LaTeX)} t={t}
                    style={{position:"absolute",top:6,right:6,fontSize:10}}>
                    {copied==="mod1latex"?<><Check size={10}/> Copied</>:<><Copy size={10}/> Copy LaTeX</>}
                  </Btn>
                </div>
              )}
            </Card>

            {/* MOD 2: Skills */}
            <Card t={t} style={{borderColor:t.greenBd}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:28,height:28,borderRadius:7,background:t.greenL,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <SlidersHorizontal size={14} color={t.green}/>
                  </div>
                  <div>
                    <div style={{fontSize:13.5,fontWeight:700,color:t.tx}}>Mod 2 — Skills</div>
                    <div style={{fontSize:11,color:t.muted}}>Replace all \skillline rows in Overleaf</div>
                  </div>
                </div>
                <Btn size="sm" variant="green" onClick={() => copyText("mod2", result.mod2_skills)} t={t}>
                  {copied === "mod2" ? <><Check size={11}/> Copied</> : <><Copy size={11}/> Copy LaTeX</>}
                </Btn>
              </div>

              {/* Formatted preview */}
              <div style={{background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"12px 14px",marginBottom:10}}>
                <div style={{fontSize:10,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Preview</div>
                <SkilllinePreview latex={result.mod2_skills} t={t}/>
              </div>

              {/* Raw LaTeX toggle */}
              <button onClick={() => setShowRaw2(!showRaw2)} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:t.muted,fontWeight:600,padding:0,marginBottom:showRaw2?8:0}}>
                {showRaw2 ? "▼" : "▶"} Raw LaTeX
              </button>
              {showRaw2 && (
                <div style={{background:t.hover,border:`1px solid ${t.border}`,borderRadius:6,padding:"10px 12px",fontSize:11,lineHeight:1.7,color:t.sub,fontFamily:"monospace",whiteSpace:"pre-wrap",maxHeight:180,overflowY:"auto"}}>
                  {result.mod2_skills}
                </div>
              )}
            </Card>
          </div>

          {/* Additional Analysis */}
          <Card t={t} style={{marginBottom:16}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
              <Zap size={16} color={t.pri}/>
              <span style={{fontSize:14,fontWeight:700,color:t.tx}}>Additional Analysis</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
              <div>
                <div style={{fontSize:11,fontWeight:700,color:t.sub,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Top 5 Missing Keywords</div>
                <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:12}}>
                  {(result.missing_keywords || []).map(k => (
                    <span key={k} style={{fontSize:12,padding:"3px 10px",borderRadius:20,background:t.redL,color:t.red,fontWeight:600}}>{k}</span>
                  ))}
                </div>
                {result.top_matches?.length > 0 && (
                  <>
                    <div style={{fontSize:11,fontWeight:700,color:t.sub,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Keyword Matches Found</div>
                    <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                      {result.top_matches.map(k => (
                        <span key={k} style={{fontSize:12,padding:"3px 10px",borderRadius:20,background:t.greenL,color:t.green,fontWeight:600}}>{k}</span>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <div><span style={{fontSize:12,color:t.sub}}>ATS Keyword Coverage: </span><span style={{fontSize:14,fontWeight:800,color:t.tx}}>{result.ats_coverage}</span></div>
                <div><span style={{fontSize:12,color:t.sub}}>Composites Visible: </span><span style={{fontSize:13,fontWeight:700,color:result.composites_visible?t.green:t.red}}>{result.composites_visible?"Yes — composites keywords present":"No — add composites terms"}</span></div>
                <div><span style={{fontSize:12,color:t.sub}}>Quantification: </span><span style={{fontSize:13,fontWeight:700,color:t.tx}}>{result.quantification_check}</span></div>
              </div>
            </div>
          </Card>

          {/* Action buttons */}
          <div style={{display:"flex",gap:10}}>
            <Btn onClick={() => { syncToParent({company:co,role,location:loc,link,jd}); setPage("networking"); }} t={t}>
              <Users size={14}/> Find Contacts
            </Btn>
            <Btn variant="green" onClick={handleCompleteAndLog} t={t}>
              <CheckCircle size={14}/> Complete & Log to Tracker
            </Btn>
            <Btn variant="ghost" onClick={() => setResult(null)} t={t}>Re-Analyze</Btn>
          </div>
        </div>
      )}
    </div>
  );
}
