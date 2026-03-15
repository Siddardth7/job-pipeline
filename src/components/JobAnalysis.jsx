import { useState, useEffect } from 'react';
import { BarChart2, CheckCircle, Users, Copy, Check, Briefcase, Zap, SlidersHorizontal, Edit3, Target } from 'lucide-react';
import { analyzeJob } from '../lib/scoring.js';

const RESUMES = {
  A: {name:"Manufacturing & Plant Ops", skills:"GD&T, CMM, Fixtures"},
  B: {name:"Process & CI", skills:"FMEA, SPC, 8D, Lean"},
  C: {name:"Quality & Materials", skills:"CMM, MRB, Composites"},
  D: {name:"Equipment & NPI", skills:"Tooling, PFMEA, DOE"}
};

function Card({children, t, style, onClick}) {
  return <div onClick={onClick} style={{background:t.card,border:`1px solid ${t.border}`,borderRadius:12,padding:20,boxShadow:t.shadow,cursor:onClick?"pointer":"default",...style}}>{children}</div>;
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
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return fallbackCopy(text);
}
function fallbackCopy(text) {
  return new Promise((resolve, reject) => {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); resolve(); } catch { reject("Copy failed"); }
    finally { document.body.removeChild(ta); }
  });
}

export default function JobAnalysis({currentJob, updatePipelineJob, completePipeline, onLogApp, setPage, setCurrentJob, apps, findCompany, isBlacklisted, checkITAR, t}) {
  const [co, setCo] = useState(currentJob?.company || "");
  const [role, setRole] = useState(currentJob?.role || "");
  const [loc, setLoc] = useState(currentJob?.location || "");
  const [link, setLink] = useState(currentJob?.link || "");
  const [jd, setJd] = useState(currentJob?.jd || "");
  const [res, setRes] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [checks, setChecks] = useState(null);
  const [copied, setCopied] = useState("");
  const isExternal = currentJob?.source === "external";

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
      if (currentJob?.id) {
        updatePipelineJob(currentJob.id, {analysisResult, jd, company: co, role, location: loc, link});
      }
      setLoading(false);
    }, 300);
  };

  const copyText = (k, v) => {
    robustCopy(v).then(() => { setCopied(k); setTimeout(() => setCopied(""), 2000); }).catch(() => {});
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

  return (
    <div>
      <div style={{marginBottom:24}}>
        <h2 style={{margin:"0 0 4px",fontSize:24,fontWeight:700,color:t.tx}}>Job Analysis</h2>
        <p style={{margin:0,fontSize:14,color:t.sub}}>Resume modifications for ATS optimization (2 edits only: Summary + Skills)</p>
      </div>

      {!currentJob?.role && (
        <Card t={t} style={{textAlign:"center",padding:"60px 24px"}}>
          <BarChart2 size={32} color={t.muted} style={{marginBottom:12}}/>
          <div style={{fontSize:14,fontWeight:600,color:t.sub,marginBottom:16}}>Select a job from Pipeline to analyze.</div>
          <Btn onClick={() => setPage("pipeline")} t={t}>Go to Pipeline</Btn>
        </Card>
      )}

      {(currentJob?.role || co) && (
        <Card t={t} style={{marginBottom:16}}>
          <SectionLabel t={t}>Job Details {isExternal && <span style={{color:t.yellow,fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:10,background:t.yellowL,marginLeft:8}}>EXTERNAL</span>}</SectionLabel>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12,marginBottom:12}}>
            <Input label="Company" value={co} onChange={e => setCo(e.target.value)} t={t}/>
            <Input label="Role" value={role} onChange={e => setRole(e.target.value)} t={t}/>
            <Input label="Location" value={loc} onChange={e => setLoc(e.target.value)} t={t}/>
            <Input label="Link" value={link} onChange={e => setLink(e.target.value)} t={t}/>
          </div>
          <Input label="Full Job Description" value={jd} onChange={e => setJd(e.target.value)} placeholder="Paste the complete job description here..." multiline rows={8} t={t}/>
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            <Btn onClick={analyze} disabled={loading||!jd.trim()} t={t}>{loading?"Analyzing...":"Run Resume Analysis"}</Btn>
            <span style={{fontSize:12,color:t.muted}}>Override resume:</span>
            {["A","B","C","D","Auto"].map(k => (
              <button key={k} onClick={() => setRes(k === "Auto" ? null : (res === k ? null : k))} style={{padding:"8px 14px",borderRadius:8,fontSize:12.5,fontWeight:700,cursor:"pointer",fontFamily:"inherit",background:(k === "Auto" ? res === null : res === k)?t.pri+"18":"transparent",border:`1px solid ${(k === "Auto" ? res === null : res === k)?t.pri:t.border}`,color:(k === "Auto" ? res === null : res === k)?t.pri:t.sub}}>
                {k === "Auto" ? "Auto-detect" : `Resume ${k}`}
              </button>
            ))}
          </div>
        </Card>
      )}

      {checks && (
        <Card t={t} style={{marginBottom:16,borderColor:checks.ok?t.greenBd:t.redBd}}>
          {checks.bl && <div style={{color:t.red,fontSize:13,fontWeight:700,marginBottom:4}}>Blacklisted: {checks.bl}</div>}
          {checks.itar?.length > 0 && <div style={{color:t.red,fontSize:13,fontWeight:700,marginBottom:4}}>ITAR keywords: {checks.itar.join(", ")}</div>}
          {checks.m628 && <div style={{color:t.green,fontSize:13,fontWeight:600,marginBottom:4}}>M628: {checks.m628.name} (T{checks.m628.tier} H-1B: {checks.m628.h1b} ITAR: {checks.m628.itar})</div>}
          {checks.ok && <div style={{color:t.green,fontSize:13,fontWeight:600}}>No ITAR or blacklist flags</div>}
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
            CRITICAL: Only TWO modifications permitted. Experience and project bullets are LOCKED.
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
                  {copied === "mod1" ? <><Check size={11}/> Copied</> : <><Copy size={11}/> Copy</>}
                </Btn>
              </div>
              <div style={{background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"14px 16px"}}>
                <div style={{fontSize:10.5,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Preview</div>
                <div style={{fontSize:13,lineHeight:1.8,color:t.tx,fontStyle:"italic"}}>{result.mod1_summary || "—"}</div>
              </div>
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
                    <div style={{fontSize:11,color:t.muted}}>Keywords matched</div>
                  </div>
                </div>
                <Btn size="sm" variant="green" onClick={() => copyText("mod2", result.mod2_skills)} t={t}>
                  {copied === "mod2" ? <><Check size={11}/> Copied</> : <><Copy size={11}/> Copy</>}
                </Btn>
              </div>
              <div style={{background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"12px 14px"}}>
                <div style={{fontSize:10.5,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Skills Preview</div>
                <div style={{fontSize:12.5,lineHeight:1.8,color:t.tx}}>{result.mod2_skills}</div>
              </div>
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
                <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                  {(result.missing_keywords || []).map(k => (
                    <span key={k} style={{fontSize:12,padding:"3px 10px",borderRadius:20,background:t.redL,color:t.red,fontWeight:600}}>{k}</span>
                  ))}
                </div>
                {result.top_matches?.length > 0 && (
                  <div style={{marginTop:12}}>
                    <div style={{fontSize:11,fontWeight:700,color:t.sub,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Keyword Matches</div>
                    <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                      {result.top_matches.map(k => (
                        <span key={k} style={{fontSize:12,padding:"3px 10px",borderRadius:20,background:t.greenL,color:t.green,fontWeight:600}}>{k}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div><span style={{fontSize:12,color:t.sub}}>ATS Keyword Coverage: </span><span style={{fontSize:13,fontWeight:700,color:t.tx}}>{result.ats_coverage}</span></div>
                <div><span style={{fontSize:12,color:t.sub}}>Composites Visible: </span><span style={{fontSize:13,fontWeight:700,color:result.composites_visible?t.green:t.red}}>{result.composites_visible?"Yes":"No"}</span></div>
                <div><span style={{fontSize:12,color:t.sub}}>Quantification: </span><span style={{fontSize:13,fontWeight:700,color:t.tx}}>{result.quantification_check}</span></div>
              </div>
            </div>
          </Card>

          {/* Action buttons */}
          <div style={{display:"flex",gap:10}}>
            <Btn onClick={() => { setCurrentJob(prev => ({...prev, company:co, role, location:loc, link, jd})); setPage("networking"); }} t={t}><Users size={14}/> Find Contacts</Btn>
            <Btn variant="green" onClick={handleCompleteAndLog} t={t}><CheckCircle size={14}/> Complete & Log to Tracker</Btn>
            <Btn variant="ghost" onClick={() => setResult(null)} t={t}>Re-Analyze</Btn>
          </div>
        </div>
      )}
    </div>
  );
}
