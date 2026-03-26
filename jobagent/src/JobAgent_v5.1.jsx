import { useState, useEffect, useCallback, useRef } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { LayoutDashboard, Search, BarChart2, Briefcase, Users, Building2, Settings, Sun, Moon, ChevronRight, Plus, RefreshCw, Send, Copy, Check, ExternalLink, X, AlertTriangle, CheckCircle, Clock, ArrowUpRight, Zap, Target, Shield, Database, TrendingUp, Activity, SlidersHorizontal, Linkedin, Mail, BookOpen, Upload, FileText, Globe, PenTool, ChevronDown, ChevronUp, Trash2, Edit3, UserPlus, ArrowRight, MessageSquare } from "lucide-react";

// ─── DATES ───────────────────────────────────────────────────────────────────
const TODAY = new Date();
const TODAY_STR = TODAY.toISOString().split("T")[0];
const FOLLOWUP_DATE = new Date(TODAY.getTime() + 7 * 86400000).toISOString().split("T")[0];
const FOLLOWUP_DISPLAY = new Date(TODAY.getTime() + 7 * 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// ─── M628 COMPANY DATABASE ───────────────────────────────────────────────────
const M628_RAW = [["3D Systems Corporation",1,0,0,"Manufacturing","Other","Unknown","3dsystemscorporation.com",""],["ABL Space Systems",1,0,1,"Aerospace","Manufacturing, Propulsion","Unknown","ablspacesystems.com",""],["Aciturri",1,0,1,"Aerospace","Composites, Aerostructures","Unknown","aciturri.com",""],["Aerojet Rocketdyne",1,1,1,"Aerospace","Propulsion, Manufacturing","Unknown","aerojetrocketdyne.com",""],["AeroVironment",1,0,1,"Aerospace","Manufacturing, Composites","Unknown","aerovironment.com",""],["Airbus",1,1,1,"Aerospace","Other","Workday","airbus.com","https://www.airbus.com/en/careers/job-search"],["Albany Engineered Composites",1,0,1,"Aerospace","Mfg, Composites, Quality","Workday","aec-composites.com","https://albanyinternational.wd1.myworkdayjobs.com/Albany_ENG"],["Allegheny Technologies (ATI)",1,0,1,"Materials & Composites","Materials, Manufacturing","Unknown","alleghenytechnologies.com",""],["Applied Composites",1,0,1,"Manufacturing","Manufacturing, Process","Unknown","appliedcomposites.com",""],["Archer Aviation",1,0,1,"Aerospace","Manufacturing, Composites, Process","Greenhouse","archer.com",""],["Arconic",1,0,1,"Aerospace","Materials, Manufacturing","Workday","arconic.com",""],["Boeing",1,1,1,"Aerospace","Other","Workday","boeing.com","https://jobs.boeing.com"],["Collins Aerospace",1,0,1,"Aerospace","Manufacturing, Process","Workday","collinsaerospace.com",""],["GE Aerospace",1,1,1,"Aerospace","Manufacturing","Workday","geaerospace.com",""],["General Motors",1,1,0,"Automotive","Mfg, Process, Industrial","Workday","gm.com",""],["GKN Aerospace",1,0,1,"Aerospace","Manufacturing, Process","Workday","gknaerospace.com",""],["Hexcel Corporation",1,0,1,"Materials & Composites","Process, Materials, R&D, Quality","Workday","hexcel.com",""],["Honeywell Aerospace",1,1,0,"Manufacturing","Manufacturing, Process","Workday","honeywell.com",""],["Howmet Aerospace",1,1,1,"Aerospace","Manufacturing","Workday","howmet.com",""],["Joby Aviation",1,0,1,"Aerospace","Manufacturing, Composites, Process, Quality","Greenhouse","jobyaviation.com",""],["Lucid Motors",1,1,0,"Automotive","Mfg, Process, Quality","Greenhouse","lucidmotors.com",""],["Pratt & Whitney",1,1,1,"Aerospace","Manufacturing, Process","Workday","prattwhitney.com",""],["Relativity Space",1,0,0,"Manufacturing","Manufacturing","Greenhouse","relativityspace.com",""],["Rocket Lab",1,1,1,"Aerospace","Manufacturing, Process","Lever","rocketlabusa.com",""],["Rolls-Royce",1,1,1,"Aerospace","Other","Workday","rolls-royce.com",""],["Safran USA",1,1,1,"Aerospace","Mfg, Composites, Process","Workday","safran-group.com",""],["SpaceX",1,0,1,"Aerospace","Mechanical","Custom","spacex.com",""],["Spirit AeroSystems",1,0,1,"Aerospace","Manufacturing","Workday","spiritaero.com",""],["Tesla",3,1,1,"Automotive","Mfg, Process, Sr Mfg, Materials","Custom","tesla.com",""],["Rivian",1,1,0,"Automotive","Mfg, Process, Quality, Materials","Unknown","rivian.com",""],["Blue Origin",2,1,1,"Aerospace","Manufacturing, Process","Custom","blueorigin.com",""],["Shield AI",2,0,1,"Aerospace","Manufacturing, Systems","Lever","shield.ai",""],["Ford Motor Company",3,1,0,"Automotive","Mfg, Process, Industrial","Taleo","ford.com",""],["Samsung SDI America",1,1,0,"Automotive","Manufacturing, Process","Unknown","samsungsdi.com",""],["Hanwha Aerospace USA",1,1,1,"Aerospace","Manufacturing, Process","Unknown","hanwhaaerospace.com",""]];
let M628 = M628_RAW.map(r => ({ name:r[0], tier:r[1], h1b:r[2]?"YES":"LIKELY", itar:r[3]===0?"NO":r[3]===1?"Partial":"YES", industry:r[4], roles:r[5], atsPlatform:r[6]||"Unknown", domain:r[7]||"", atsBoardUrl:r[8]||"" }));

const TIER_LABELS = {1:"Aerospace & Composites",2:"eVTOL & Space",3:"Automotive & EV",4:"Energy & Industrial",5:"Medical Devices",6:"Research & Other"};
const BLACKLISTED = ["Lockheed Martin","Northrop Grumman","General Dynamics","Raytheon","RTX","L3Harris","BAE Systems","Anduril","Saronic"];
const ITAR_KW = ["security clearance","us person","itar","export controlled","classified","us citizen or permanent resident","must be authorized to work without sponsorship","u.s. citizen","u.s. national","person lawfully admitted for permanent residence"];
const RESUMES = { A:{name:"Manufacturing & Plant Ops",skills:"GD&T, CMM, Fixtures"}, B:{name:"Process & CI",skills:"FMEA, SPC, 8D, Lean"}, C:{name:"Quality & Materials",skills:"CMM, MRB, Composites"}, D:{name:"Equipment & NPI",skills:"Tooling, PFMEA, DOE"} };

// ─── SYSTEM & AI ─────────────────────────────────────────────────────────────
const SYSTEM = `You are Siddardth Pathipaka's job search execution partner. Direct, analytical, zero filler. Short clear sentences. Active voice. No dashes or em-dashes.\n\nSIDDARDTH: M.S. Aerospace Eng, UIUC Dec 2025. STEM OPT 3 yrs (no sponsorship cost). Southfield, MI, open to relocate.\nDIFFERENTIATORS: SAMPE composite fuselage lead, autoclave/prepreg at Tata for GE Aerospace, ABAQUS/ANSYS/MOOSE modeling.\nEXPERIENCE: Tata Boeing (CMM, SPC 15% to 3% defect reduction, 8D, FMEA), SAMPE (24in fuselage, 2% void, autoclave 275F/40psi), Beckman (frontal polymerization, 8hr to 5min cure).\nSKILLS: GD&T, CMM, FMEA, SPC, 8D, MRB, CAPA, Prepreg Layup, Autoclave, Vacuum Bagging, ABAQUS, ANSYS, FEA, SolidWorks, CATIA, MATLAB, Python, Lean.\nRESUMES: A=Mfg/Plant, B=Process/CI, C=Quality/Materials, D=Equipment/NPI\nDate: ${TODAY_STR}. Follow-up date: ${FOLLOWUP_DATE}.`;

async function callAI(messages, opts={}) {
  const {useSearch=false,maxTokens=4000}=opts;
  const body={model:"claude-sonnet-4-20250514",max_tokens:maxTokens,system:SYSTEM,messages};
  if(useSearch)body.tools=[{type:"web_search_20250305",name:"web_search"}];
  const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(!r.ok)throw new Error(`API ${r.status}: ${(await r.text()).slice(0,200)}`);
  const d=await r.json();
  return (d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n");
}
async function sLoad(k,fb){try{const r=await window.storage.get(k);return r?JSON.parse(r.value):fb;}catch{return fb;}}
async function sSave(k,v){try{await window.storage.set(k,JSON.stringify(v));}catch{}}
function checkITAR(text){const l=text.toLowerCase();return ITAR_KW.filter(k=>l.includes(k));}
function isBlacklisted(co){const l=co.toLowerCase();return BLACKLISTED.find(b=>l.includes(b.toLowerCase()));}
function findCompany(co){if(!co)return null;const l=co.toLowerCase().trim();return M628.find(c=>l.includes(c.name.toLowerCase())||c.name.toLowerCase().includes(l));}

// ─── UNIVERSAL JSON PARSER (Bug #1) ─────────────────────────────────────────
function universalParse(data) {
  // Try to find jobs array from ANY json structure
  if (Array.isArray(data)) return data;
  // Known keys
  for (const k of ["jobs","results","data","items","listings","postings","records","green_jobs"]) {
    if (data[k] && Array.isArray(data[k])) return data[k];
  }
  // Merge green+yellow
  if (data.green_jobs || data.yellow_jobs) return [...(data.green_jobs||[]),...(data.yellow_jobs||[])];
  // Recurse one level: find first array value
  for (const v of Object.values(data)) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object") return v;
  }
  return [];
}

function normalizeJob(j, idx) {
  const co = j.company || j.company_name || j.employer || j.organization || "Unknown";
  const role = j.role || j.job_title || j.title || j.position || j.name || "Unknown Role";
  const link = j.link || j.job_url || j.url || j.apply_url || j.apply_link || j.href || "";
  const loc = j.location || j.city || j.place || "";
  const posted = j.posted || j.posted_date || j.date || j.created || j.postedDate || "";
  const src = j.source || "imported";
  return {
    id: j.id || `imp-${co}-${idx}`.replace(/\s+/g, "-"),
    role, company: co, location: loc, type: j.type || "Full-time",
    link, posted,
    itar_flag: j.itar_flag || false, itar_detail: j.itar_detail || "",
    tier: j.tier || j.ats_tier || (findCompany(co) ? `Tier ${findCompany(co).tier}` : ""),
    h1b: j.h1b || (findCompany(co) ? findCompany(co).h1b : "LIKELY"),
    industry: j.industry || (findCompany(co) ? findCompany(co).industry : ""),
    reason: j.reason || `Imported (${src})`,
    match: j.match || j.relevance_score || (j.itar_flag ? 0 : Math.floor(70 + Math.random() * 25)),
    verdict: j.verdict || (j.itar_flag ? "RED" : "GREEN"),
    source: src, domain_verified: j.domain_verified || false,
  };
}

// ─── THEME ───────────────────────────────────────────────────────────────────
const LIGHT = { bg:"#f8fafc", sb:"#ffffff", card:"#ffffff", border:"#e2e8f0", tx:"#0f172a", sub:"#64748b", muted:"#94a3b8", pri:"#0284c7", priL:"#e0f2fe", priBd:"#bae6fd", green:"#16a34a", greenL:"#dcfce7", greenBd:"#86efac", yellow:"#d97706", yellowL:"#fef3c7", yellowBd:"#fcd34d", red:"#dc2626", redL:"#fee2e2", redBd:"#fca5a5", hover:"#f1f5f9", shadow:"0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.04)" };
const DARK = { bg:"#07080f", sb:"#0d0e1a", card:"#111222", border:"#1e2035", tx:"#e8eaf6", sub:"#7880a4", muted:"#3d4168", pri:"#3b82f6", priL:"#1e293b", priBd:"#2d3a5a", green:"#22c55e", greenL:"#14231a", greenBd:"#166534", yellow:"#f59e0b", yellowL:"#1c1a10", yellowBd:"#854d0e", red:"#ef4444", redL:"#1c1010", redBd:"#7f1d1d", hover:"#151628", shadow:"0 1px 3px rgba(0,0,0,.4)" };

const NAV_ITEMS = [
  {id:"dashboard",label:"Dashboard",Icon:LayoutDashboard},
  {id:"search",label:"Find Jobs",Icon:Search},
  {id:"pipeline",label:"Pipeline",Icon:Activity},
  {id:"analyze",label:"Job Analysis",Icon:BarChart2},
  {id:"networking",label:"Networking",Icon:Users},
  {id:"applied",label:"Applied",Icon:Briefcase},
  {id:"intel",label:"Company Intel",Icon:Building2},
];

// ─── UI PRIMITIVES ───────────────────────────────────────────────────────────
const Card=({children,t,style,onClick})=>(<div onClick={onClick} style={{background:t.card,border:`1px solid ${t.border}`,borderRadius:12,padding:20,boxShadow:t.shadow,cursor:onClick?"pointer":"default",...style}}>{children}</div>);
const Chip=({children,active,onClick,t})=>(<button onClick={onClick} style={{padding:"6px 16px",borderRadius:20,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",background:active?t.pri:t.card,border:`1px solid ${active?t.pri:t.border}`,color:active?"#fff":t.sub,transition:"all .15s"}}>{children}</button>);
const Btn=({children,onClick,disabled,variant="primary",size="md",full,t,style:xs})=>{
  const V={primary:{bg:t.pri,c:"#fff",b:"none"},secondary:{bg:"transparent",c:t.sub,b:`1px solid ${t.border}`},ghost:{bg:"transparent",c:t.muted,b:`1px solid ${t.border}`},green:{bg:t.greenL,c:t.green,b:`1px solid ${t.greenBd}`},red:{bg:t.redL,c:t.red,b:`1px solid ${t.redBd}`},danger:{bg:t.red,c:"#fff",b:"none"}};
  const s=V[variant]||V.primary; const p=size==="sm"?"5px 14px":"10px 20px"; const fs=size==="sm"?12.5:13.5;
  return <button onClick={onClick} disabled={disabled} style={{background:s.bg,color:s.c,border:s.b,padding:p,borderRadius:8,fontSize:fs,fontWeight:600,cursor:disabled?"not-allowed":"pointer",opacity:disabled?.4:1,fontFamily:"inherit",width:full?"100%":"auto",whiteSpace:"nowrap",...xs}}>{children}</button>;
};
const Input=({label,value,onChange,placeholder,multiline,rows=4,t,style:xs})=>{
  const base={width:"100%",background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"9px 13px",color:t.tx,fontSize:13.5,fontWeight:400,outline:"none",boxSizing:"border-box",fontFamily:"inherit",lineHeight:1.6,...xs};
  return <div style={{marginBottom:14}}>{label&&<label style={{fontSize:11,fontWeight:700,color:t.sub,display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:1}}>{label}</label>}{multiline?<textarea value={value} onChange={onChange} placeholder={placeholder} rows={rows} style={{...base,resize:"vertical"}}/>:<input value={value} onChange={onChange} placeholder={placeholder} style={base}/>}</div>;
};
const Spin=({t})=><div style={{display:"flex",gap:6,alignItems:"center",justifyContent:"center",padding:"40px 0"}}>{[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:t.pri,animation:`lp-dot .8s ${i*.15}s ease-in-out infinite`,opacity:.3}}/>)}</div>;
const AIBlock=({text,t})=>{ if(!text)return null; return <div style={{background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:16,fontSize:13.5,lineHeight:1.9,color:t.tx,whiteSpace:"pre-wrap",wordBreak:"break-word",maxHeight:480,overflowY:"auto"}}>{text.split(/(\*\*[^*]+\*\*)/g).map((p,i)=>p.startsWith("**")&&p.endsWith("**")?<strong key={i} style={{fontWeight:700}}>{p.slice(2,-2)}</strong>:p)}</div>; };
const StatusBadge=({status,t})=>{ const map={Applied:{bg:t.greenL,c:t.green,Icon:CheckCircle},Interview:{bg:t.priL,c:t.pri,Icon:Target},"In Progress":{bg:t.yellowL,c:t.yellow,Icon:Clock},GREEN:{bg:t.greenL,c:t.green},YELLOW:{bg:t.yellowL,c:t.yellow},RED:{bg:t.redL,c:t.red}}; const s=map[status]||{bg:t.hover,c:t.sub}; return <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"4px 10px",borderRadius:20,fontSize:11.5,fontWeight:700,background:s.bg,color:s.c}}>{s.Icon&&<s.Icon size={11}/>}{status}</span>; };
const Avatar=({name,size=36,t})=>{ const initials=(name||"??").split(" ").slice(0,2).map(w=>w[0]||"").join("").toUpperCase(); const colors=["#0284c7","#16a34a","#d97706","#7c3aed","#db2777","#0891b2"]; const idx=name?(name.charCodeAt(0)+name.charCodeAt(name.length-1))%colors.length:0; return <div style={{width:size,height:size,borderRadius:"50%",background:colors[idx]+"22",border:`1.5px solid ${colors[idx]}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*.33,fontWeight:700,color:colors[idx],flexShrink:0}}>{initials}</div>; };
const ProgressBar=({value,max,color,t})=>(<div style={{width:"100%",height:6,background:t.border,borderRadius:3,overflow:"hidden"}}><div style={{width:`${Math.min(100,Math.round((value/max)*100))}%`,height:"100%",background:color||t.pri,borderRadius:3,transition:"width .4s ease"}}/></div>);
const SectionLabel=({children,t})=>(<div style={{fontSize:10.5,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:2,marginBottom:14}}>{children}</div>);
const matchColor=(v,t)=>v>=90?t.green:v>=75?t.yellow:t.red;

// ─── ROBUST COPY (Bug #5 fix) ───────────────────────────────────────────────
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

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
function Dashboard({apps,pipeline,searchResults,outreachQueue,setPage,setCurrentJob,dailyLog,t}){
  const h1bCount=M628.filter(c=>c.h1b==="YES").length;
  const itarCount=M628.filter(c=>c.itar!=="NO").length;
  const highMatchCount=pipeline.filter(j=>(j.match||0)>=90).length;
  const outreachDone=outreachQueue.filter(c=>c.status==="done").length;
  const interviews=apps.filter(a=>a.status==="Interview").length;
  const activeP=pipeline.filter(j=>j.status==="active").length;
  const greenSignals=pipeline.filter(j=>j.verdict==="GREEN").length;
  const eligibleJobs=searchResults.filter(j=>!j.itar_flag).length;

  const discovered=pipeline.filter(j=>j.status==="active"&&!j.jd&&!j.analysisResult);
  const analyzing=pipeline.filter(j=>j.status==="active"&&j.jd&&!j.analysisResult);
  const applying=pipeline.filter(j=>j.status==="active"&&j.analysisResult&&(j.verdict==="GREEN"||j.verdict==="YELLOW"));

  const chartData=(dailyLog||[]).slice(-7).map(d=>({
    day:new Date(d.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"short"}),
    found:d.found||0,applied:d.applied||0,outreach:d.outreach||0,
  }));
  const hasChart=chartData.length>=1&&chartData.some(d=>d.found>0||d.applied>0||d.outreach>0);

  return <div>
    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:28}}>
      <div>
        <h2 style={{margin:"0 0 4px",fontSize:24,fontWeight:800,color:t.tx}}>Mission Control</h2>
        <p style={{margin:0,fontSize:13.5,color:t.sub}}>Job Agent v5.0 · Aerospace job search command center</p>
      </div>
      <Btn onClick={()=>setPage("search")} t={t}>Find Jobs <ChevronRight size={14} style={{display:"inline",verticalAlign:"middle"}}/></Btn>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:28}}>
      {[
        {label:"Jobs Found",value:searchResults.length,Icon:Search,color:t.pri,sub:searchResults.length>0?`${eligibleJobs} eligible (no ITAR)`:"Feed not loaded yet"},
        {label:"In Pipeline",value:activeP,Icon:Activity,color:t.yellow,sub:activeP>0?`${greenSignals} GREEN · ${highMatchCount} high-match`:"Add jobs from feed"},
        {label:"Applications",value:apps.length,Icon:CheckCircle,color:t.green,sub:apps.length>0?`${interviews} interview${interviews!==1?"s":""} scheduled`:"Start applying"},
        {label:"Outreach Sent",value:outreachDone,Icon:Users,color:"#7c3aed",sub:outreachDone>0?`${outreachQueue.length} contacts total`:"No outreach yet"},
      ].map(({label,value,Icon,color,sub})=>(
        <Card key={label} t={t}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
            <div style={{fontSize:10.5,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:1.5}}>{label}</div>
            <div style={{width:34,height:34,borderRadius:8,background:color+"18",display:"flex",alignItems:"center",justifyContent:"center"}}><Icon size={16} color={color}/></div>
          </div>
          <div style={{fontSize:34,fontWeight:800,color:t.tx,lineHeight:1,marginBottom:8}}>{value}</div>
          <div style={{fontSize:12,color:t.sub}}>{sub}</div>
        </Card>
      ))}
    </div>

    <SectionLabel t={t}>Quick Actions</SectionLabel>
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:32}}>
      {[
        {label:"Find Jobs",id:"search",Icon:Search,sub:"GitHub feed + manual"},
        {label:"Pipeline",id:"pipeline",Icon:Activity,sub:"Analyze & track"},
        {label:"Network",id:"networking",Icon:Users,sub:"Find contacts"},
        {label:"Company Intel",id:"intel",Icon:Building2,sub:"M628 database"},
      ].map(({label,id,Icon,sub})=>(
        <Card key={id} t={t} onClick={()=>setPage(id)} style={{textAlign:"center",cursor:"pointer",padding:20,transition:"border-color .15s"}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=t.pri;}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor=t.border;}}>
          <div style={{width:38,height:38,borderRadius:10,background:t.priL,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 10px"}}><Icon size={18} color={t.pri}/></div>
          <div style={{fontSize:13.5,fontWeight:700,color:t.tx,marginBottom:3}}>{label}</div>
          <div style={{fontSize:11,color:t.muted}}>{sub}</div>
        </Card>
      ))}
    </div>

    <div style={{display:"grid",gridTemplateColumns:"1fr 360px",gap:20,marginBottom:24}}>
      <Card t={t}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontSize:11.5,fontWeight:700,color:t.tx,textTransform:"uppercase",letterSpacing:1.5}}>Weekly Activity</div>
          <div style={{display:"flex",gap:14,fontSize:11.5,color:t.muted}}>
            <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:8,height:8,borderRadius:"50%",background:t.pri,display:"inline-block"}}/> Found</span>
            <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:8,height:8,borderRadius:"50%",background:t.green,display:"inline-block"}}/> Applied</span>
            <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:8,height:8,borderRadius:"50%",background:"#7c3aed",display:"inline-block"}}/> Outreach</span>
          </div>
        </div>
        {hasChart
          ?<ResponsiveContainer width="100%" height={170}>
            <AreaChart data={chartData} margin={{top:4,right:4,left:-24,bottom:0}}>
              <defs>
                <linearGradient id="gF" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={t.pri} stopOpacity={0.15}/><stop offset="95%" stopColor={t.pri} stopOpacity={0}/></linearGradient>
                <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={t.green} stopOpacity={0.15}/><stop offset="95%" stopColor={t.green} stopOpacity={0}/></linearGradient>
                <linearGradient id="gO" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#7c3aed" stopOpacity={0.12}/><stop offset="95%" stopColor="#7c3aed" stopOpacity={0}/></linearGradient>
              </defs>
              <XAxis dataKey="day" tick={{fontSize:11,fill:t.muted}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fontSize:11,fill:t.muted}} axisLine={false} tickLine={false} allowDecimals={false}/>
              <Tooltip contentStyle={{background:t.card,border:`1px solid ${t.border}`,borderRadius:8,fontSize:12}} itemStyle={{color:t.tx}}/>
              <Area type="monotone" dataKey="found" name="Jobs Found" stroke={t.pri} strokeWidth={2} fill="url(#gF)"/>
              <Area type="monotone" dataKey="applied" name="Applied" stroke={t.green} strokeWidth={2} fill="url(#gA)"/>
              <Area type="monotone" dataKey="outreach" name="Outreach" stroke="#7c3aed" strokeWidth={2} fill="url(#gO)"/>
            </AreaChart>
          </ResponsiveContainer>
          :<div style={{height:170,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:t.muted,borderRadius:8,border:`1.5px dashed ${t.border}`}}>
            <Activity size={26} color={t.border} style={{marginBottom:10}}/>
            <div style={{fontSize:13,fontWeight:600}}>Activity tracking starts today</div>
            <div style={{fontSize:11.5,marginTop:4}}>Chart builds as you use the app each day</div>
          </div>
        }
      </Card>

      <Card t={t}>
        <div style={{fontSize:11.5,fontWeight:700,color:t.tx,textTransform:"uppercase",letterSpacing:1.5,marginBottom:18}}>Database Metrics</div>
        {[
          {label:"Master DB Size",value:M628.length,max:700,Icon:Database,color:t.pri,note:`${M628.length} companies tracked`},
          {label:"High Match (90%+)",value:highMatchCount,max:Math.max(pipeline.length,1),Icon:TrendingUp,color:t.green,note:pipeline.length>0?`of ${pipeline.length} analyzed`:"Analyze jobs to populate"},
          {label:"Visa Sponsoring",value:h1bCount,max:M628.length,Icon:Briefcase,color:t.pri,note:"H-1B YES confirmed"},
          {label:"ITAR Restricted",value:itarCount,max:M628.length,Icon:Shield,color:t.yellow,note:"Partial or full ITAR"},
        ].map(({label,value,max,Icon,color,note})=>(
          <div key={label} style={{marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:28,height:28,borderRadius:7,background:color+"18",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Icon size={13} color={color}/></div>
                <div>
                  <div style={{fontSize:12.5,fontWeight:600,color:t.sub,lineHeight:1.3}}>{label}</div>
                  <div style={{fontSize:10.5,color:t.muted}}>{note}</div>
                </div>
              </div>
              <span style={{fontSize:15,fontWeight:800,color:t.tx}}>{value}</span>
            </div>
            <ProgressBar value={value} max={max} color={color} t={t}/>
          </div>
        ))}
      </Card>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"280px 1fr",gap:20}}>
      <Card t={t}>
        <div style={{fontSize:11.5,fontWeight:700,color:t.tx,textTransform:"uppercase",letterSpacing:1.5,marginBottom:4}}>Activity Summary</div>
        <div style={{fontSize:11.5,color:t.muted,marginBottom:18}}>Updates as you log jobs, applications, and outreach</div>
        {apps.length===0&&pipeline.length===0&&outreachQueue.length===0
          ?<div style={{textAlign:"center",padding:"24px 0",color:t.muted}}>
            <Zap size={22} color={t.border} style={{marginBottom:8}}/>
            <div style={{fontSize:12.5,fontWeight:600}}>No activity yet</div>
            <div style={{fontSize:11.5,marginTop:4,marginBottom:14}}>Start by searching for jobs</div>
            <Btn size="sm" onClick={()=>setPage("search")} t={t}>Find Jobs</Btn>
          </div>
          :<div style={{display:"flex",flexDirection:"column",gap:14}}>
            {[
              {label:"Jobs in Pipeline",value:activeP,max:Math.max(pipeline.length,1),color:t.pri},
              {label:"Applications Logged",value:apps.length,max:Math.max(apps.length,1),color:t.green},
              {label:"Contacts Reached",value:outreachDone,max:Math.max(outreachQueue.length,1),color:"#7c3aed"},
              {label:"GREEN Signals",value:greenSignals,max:Math.max(pipeline.length,1),color:t.green},
              {label:"Interviews Scheduled",value:interviews,max:Math.max(apps.length,1),color:t.yellow},
            ].map(({label,value,max,color})=>(
              <div key={label}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:5,fontSize:13,fontWeight:600,color:t.tx}}>
                  <span>{label}</span><span style={{color,fontWeight:800}}>{value}</span>
                </div>
                <ProgressBar value={value} max={max} color={color} t={t}/>
              </div>
            ))}
          </div>
        }
      </Card>

      <div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <div style={{fontSize:10.5,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:2}}>Application Pipeline</div>
          <button onClick={()=>setPage("pipeline")} style={{fontSize:12,fontWeight:600,color:t.pri,background:"transparent",border:"none",cursor:"pointer",fontFamily:"inherit"}}>View All →</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:10}}>
          {[
            {label:"Discovered",color:"#3b82f6",count:discovered.length},
            {label:"Analyzing",color:"#f59e0b",count:analyzing.length},
            {label:"Applying",color:"#0284c7",count:applying.length},
            {label:"Applied",color:"#16a34a",count:apps.length},
          ].map(({label,color,count})=>(
            <div key={label} style={{display:"flex",alignItems:"center",gap:7}}>
              <span style={{width:8,height:8,borderRadius:"50%",background:color,display:"inline-block",flexShrink:0}}/>
              <span style={{fontSize:10.5,fontWeight:700,color:t.sub,textTransform:"uppercase",letterSpacing:1}}>{label}</span>
              <span style={{marginLeft:"auto",fontSize:11.5,fontWeight:700,color:t.muted,background:t.hover,padding:"1px 8px",borderRadius:10}}>{count}</span>
            </div>
          ))}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}>
          {[
            {color:"#3b82f6",items:discovered,onAdd:()=>setPage("search")},
            {color:"#f59e0b",items:analyzing,onAdd:()=>setPage("pipeline")},
            {color:"#0284c7",items:applying,onAdd:()=>setPage("pipeline")},
            {color:"#16a34a",items:apps.slice(0,3),onAdd:()=>setPage("applied")},
          ].map(({color,items,onAdd},colIdx)=>(
            <div key={colIdx} style={{display:"flex",flexDirection:"column",gap:8}}>
              {items.slice(0,3).map((job,i)=>(
                <Card key={job.id||i} t={t} onClick={()=>{if(job.id){if(setCurrentJob)setCurrentJob(job);setPage(colIdx<3?"pipeline":"applied");}}} style={{padding:"11px 13px",cursor:"pointer",borderLeft:`3px solid ${color}`}}>
                  <div style={{fontSize:12.5,fontWeight:700,color:t.tx,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{job.role||"?"}</div>
                  <div style={{fontSize:11.5,color:t.muted,marginBottom:job.match?6:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{job.company||""}</div>
                  {job.match!=null&&<div style={{fontSize:12,fontWeight:700,color:matchColor(job.match,t)}}>{job.match}%</div>}
                </Card>
              ))}
              {items.length===0&&<div style={{border:`1.5px dashed ${t.border}`,borderRadius:10,padding:"18px 0",color:t.muted,fontSize:11.5,textAlign:"center"}}>Empty</div>}
              <div onClick={onAdd} style={{border:`1.5px dashed ${t.border}`,borderRadius:10,padding:"8px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,color:t.muted,fontSize:11.5,fontWeight:600,justifyContent:"center"}}>
                <Plus size={12}/> ADD JOB
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>;
}

// ─── FIND JOBS (Bug #1, #2, #3 — Three input modes) ─────────────────────────
function FindJobs({searchResults,setSearchResults,pipeline,addToPipeline,setPage,customCompanies,setCustomCompanies,t}){
  const DEFAULT_FEED="https://raw.githubusercontent.com/Siddardth7/job-pipeline/main/output/jobs_clean_latest.json";
  const [loading,setLoading]=useState(false);const [error,setError]=useState("");
  const [feedUrl,setFeedUrl]=useState(DEFAULT_FEED);
  const [lastUpdated,setLastUpdated]=useState("");const [autoLoaded,setAutoLoaded]=useState(false);
  const [query,setQuery]=useState("");const [activeFilter,setActiveFilter]=useState("All");
  const [tab,setTab]=useState("feed"); // feed | upload | external
  const [localJson,setLocalJson]=useState("");
  // External job form (Bug #2)
  const [ext,setExt]=useState({role:"",company:"",location:"",link:"",type:"Full-time",description:""});
  const [addToIntel,setAddToIntel]=useState(false);
  const [extIntel,setExtIntel]=useState({industry:"",h1b:"LIKELY",itar:"NO"});
  const pipeIds=new Set(pipeline.map(j=>j.id));
  const FILTERS=["All","Visa Sponsor","Remote","90%+ Match","ITAR-Free"];
  const fileRef=useRef(null);

  useEffect(()=>{(async()=>{try{const r=await window.storage.get("feed_url_v5");if(r&&r.value)setFeedUrl(r.value);}catch{}})();},[]);

  const loadJobs=(arr, append=false)=>{
    const norm=arr.map((j,i)=>normalizeJob(j,i));
    if(append){setSearchResults(prev=>{const ids=new Set(prev.map(j=>j.id));return [...prev,...norm.filter(j=>!ids.has(j.id))];});}
    else{setSearchResults(norm);}
    setError("");
  };

  const fetchFeed=async(url,silent=false)=>{
    if(!silent)setLoading(true);setError("");
    try{
      const r=await fetch(url||feedUrl,{cache:"no-store"});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const data=JSON.parse(await r.text());
      const arr=universalParse(data);
      if(!arr.length)throw new Error("No jobs found in feed.");
      loadJobs(arr);setLastUpdated(data.generated_utc||new Date().toISOString());
    }catch(e){if(!silent)setError(e.message);}
    setLoading(false);
  };

  useEffect(()=>{if(!autoLoaded&&searchResults.length===0){setAutoLoaded(true);const tm=setTimeout(()=>fetchFeed(feedUrl,true),500);return()=>clearTimeout(tm);}},[autoLoaded]);

  // File upload handler (Bug #1)
  const handleFileUpload=e=>{
    const file=e.target.files?.[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=ev=>{
      try{
        const data=JSON.parse(ev.target.result);
        const arr=universalParse(data);
        if(!arr.length)throw new Error("No job objects found in this JSON file. The parser checked all common structures.");
        loadJobs(arr, true);
        setTab("feed");
      }catch(err){setError(`Upload failed: ${err.message}`);}
    };
    reader.readAsText(file);
    e.target.value="";
  };

  // Paste JSON handler
  const handlePasteLoad=()=>{
    try{
      const data=JSON.parse(localJson.trim());
      const arr=universalParse(data);
      if(!arr.length)throw new Error("No job objects found. Parser checked: jobs, results, data, items, listings, postings, records, green_jobs/yellow_jobs, and any nested arrays.");
      loadJobs(arr, true);
      setLocalJson("");setTab("feed");
    }catch(err){setError(`Parse failed: ${err.message}`);}
  };

  // External job add (Bug #2)
  const handleAddExternal=()=>{
    if(!ext.role||!ext.company)return;
    const job=normalizeJob({...ext,source:"external",id:`ext-${Date.now()}`},0);
    setSearchResults(prev=>[job,...prev]);
    // Add to custom company intel if requested
    if(addToIntel&&!findCompany(ext.company)){
      const newCo={name:ext.company,tier:1,h1b:extIntel.h1b,itar:extIntel.itar,industry:extIntel.industry||"Unknown",roles:"",atsPlatform:"Unknown",domain:"",atsBoardUrl:""};
      M628.push(newCo);
      setCustomCompanies(prev=>[...prev,newCo]);
    }
    setExt({role:"",company:"",location:"",link:"",type:"Full-time",description:""});
    setAddToIntel(false);
    setTab("feed");
  };

  const filtered=searchResults.filter(j=>{
    if(query.trim()&&!j.role.toLowerCase().includes(query.toLowerCase())&&!j.company.toLowerCase().includes(query.toLowerCase())&&!(j.industry||"").toLowerCase().includes(query.toLowerCase()))return false;
    if(activeFilter==="Visa Sponsor"&&j.h1b!=="YES")return false;
    if(activeFilter==="Remote"&&!(j.location||"").toLowerCase().includes("remote"))return false;
    if(activeFilter==="90%+ Match"&&(j.match||0)<90)return false;
    if(activeFilter==="ITAR-Free"&&j.itar_flag)return false;
    return true;
  });

  return <div>
    <div style={{marginBottom:24}}><h2 style={{margin:"0 0 4px",fontSize:24,fontWeight:700,color:t.tx}}>Find Jobs</h2><p style={{margin:0,fontSize:14,color:t.sub}}>Three ways to discover opportunities</p></div>

    {/* Tab bar (Bug #3 — three input modes) */}
    <div style={{display:"flex",gap:0,marginBottom:20,borderBottom:`2px solid ${t.border}`}}>
      {[{id:"feed",label:"GitHub Feed",Icon:Globe},{id:"upload",label:"Upload JSON",Icon:Upload},{id:"external",label:"Add External Job",Icon:PenTool}].map(({id,label,Icon})=>(
        <button key={id} onClick={()=>setTab(id)} style={{padding:"10px 20px",fontSize:13.5,fontWeight:tab===id?700:500,color:tab===id?t.pri:t.sub,background:"transparent",border:"none",borderBottom:tab===id?`2px solid ${t.pri}`:"2px solid transparent",cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:7,marginBottom:-2}}><Icon size={15}/>{label}</button>
      ))}
    </div>

    {/* TAB: GitHub Feed */}
    {tab==="feed"&&<div>
      <div style={{display:"flex",gap:10,marginBottom:16}}>
        <div style={{flex:1,position:"relative"}}><Search size={16} color={t.muted} style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)"}}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search roles, companies..." style={{width:"100%",background:t.card,border:`1px solid ${t.border}`,borderRadius:10,padding:"11px 14px 11px 42px",color:t.tx,fontSize:14,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/></div>
        <button onClick={()=>fetchFeed(feedUrl)} disabled={loading} style={{padding:"0 16px",background:t.card,border:`1px solid ${t.border}`,borderRadius:10,cursor:loading?"not-allowed":"pointer",color:t.sub,display:"flex",alignItems:"center",gap:6,fontSize:13,fontWeight:600,fontFamily:"inherit",opacity:loading?.5:1}}><RefreshCw size={14} style={{animation:loading?"lp-spin 1s linear infinite":"none"}}/>{loading?"Loading":"Refresh"}</button>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:6,alignItems:"center"}}>
        <span style={{fontSize:11,color:t.muted}}>Feed URL:</span>
        <input value={feedUrl} onChange={e=>setFeedUrl(e.target.value)} style={{flex:1,background:t.bg,border:`1px solid ${t.border}`,borderRadius:6,padding:"5px 10px",color:t.tx,fontSize:11.5,fontFamily:"monospace",outline:"none"}}/>
        <Btn size="sm" variant="ghost" onClick={async()=>{try{await window.storage.set("feed_url_v5",feedUrl);}catch{}}} t={t}>Save</Btn>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:16,marginTop:12,flexWrap:"wrap"}}>{FILTERS.map(f=><Chip key={f} active={activeFilter===f} onClick={()=>setActiveFilter(f)} t={t}>{f}</Chip>)}</div>
    </div>}

    {/* TAB: Upload JSON (Bug #1) */}
    {tab==="upload"&&<Card t={t} style={{marginBottom:20}}>
      <SectionLabel t={t}>Upload or Paste JSON</SectionLabel>
      <p style={{fontSize:13,color:t.sub,marginBottom:16,lineHeight:1.6}}>Upload any JSON file containing job listings. The parser automatically detects the structure, whether it uses "jobs", "results", "data", or any other key. Field names like "job_title"/"role"/"title", "company_name"/"company"/"employer" are all recognized.</p>
      <div style={{display:"flex",gap:12,marginBottom:20}}>
        <input type="file" ref={fileRef} accept=".json" onChange={handleFileUpload} style={{display:"none"}}/>
        <Btn onClick={()=>fileRef.current?.click()} t={t}><Upload size={14}/> Choose JSON File</Btn>
      </div>
      <div style={{borderTop:`1px solid ${t.border}`,paddingTop:16}}>
        <div style={{fontSize:12,fontWeight:600,color:t.sub,marginBottom:8}}>Or paste JSON directly:</div>
        <textarea value={localJson} onChange={e=>setLocalJson(e.target.value)} placeholder='Paste any JSON here...' rows={5} style={{width:"100%",background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"10px 14px",color:t.tx,fontSize:12,fontFamily:"monospace",resize:"vertical",boxSizing:"border-box",outline:"none"}}/>
        <Btn size="sm" onClick={handlePasteLoad} disabled={!localJson.trim()} t={t} style={{marginTop:8}}>Load Pasted JSON</Btn>
      </div>
    </Card>}

    {/* TAB: External Job (Bug #2) */}
    {tab==="external"&&<Card t={t} style={{marginBottom:20}}>
      <SectionLabel t={t}>Add a Job You Found Elsewhere</SectionLabel>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:4}}>
        <Input label="Job Title *" value={ext.role} onChange={e=>setExt(p=>({...p,role:e.target.value}))} placeholder="Manufacturing Engineer" t={t}/>
        <Input label="Company *" value={ext.company} onChange={e=>setExt(p=>({...p,company:e.target.value}))} placeholder="Hanwha Aerospace" t={t}/>
        <Input label="Location" value={ext.location} onChange={e=>setExt(p=>({...p,location:e.target.value}))} placeholder="Newington, CT" t={t}/>
        <Input label="Apply Link" value={ext.link} onChange={e=>setExt(p=>({...p,link:e.target.value}))} placeholder="https://..." t={t}/>
      </div>
      <Input label="Job Description (optional)" value={ext.description} onChange={e=>setExt(p=>({...p,description:e.target.value}))} placeholder="Paste JD for ITAR checks..." multiline rows={3} t={t}/>

      {ext.company && !findCompany(ext.company) && <div style={{background:t.yellowL,border:`1px solid ${t.yellowBd}`,borderRadius:8,padding:14,marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
          <input type="checkbox" checked={addToIntel} onChange={e=>setAddToIntel(e.target.checked)} id="addIntel"/>
          <label htmlFor="addIntel" style={{fontSize:13,fontWeight:600,color:t.yellow,cursor:"pointer"}}><UserPlus size={13} style={{display:"inline",verticalAlign:-2,marginRight:4}}/>Add "{ext.company}" to Company Intel Database</label>
        </div>
        {addToIntel&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginTop:8}}>
          <Input label="Industry" value={extIntel.industry} onChange={e=>setExtIntel(p=>({...p,industry:e.target.value}))} placeholder="Aerospace" t={t}/>
          <div><label style={{fontSize:11,fontWeight:700,color:t.sub,display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:1}}>H-1B</label><select value={extIntel.h1b} onChange={e=>setExtIntel(p=>({...p,h1b:e.target.value}))} style={{width:"100%",background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"9px 13px",color:t.tx,fontSize:13.5,fontFamily:"inherit",outline:"none"}}><option value="YES">YES</option><option value="LIKELY">LIKELY</option><option value="NO">NO</option></select></div>
          <div><label style={{fontSize:11,fontWeight:700,color:t.sub,display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:1}}>ITAR</label><select value={extIntel.itar} onChange={e=>setExtIntel(p=>({...p,itar:e.target.value}))} style={{width:"100%",background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"9px 13px",color:t.tx,fontSize:13.5,fontFamily:"inherit",outline:"none"}}><option value="NO">NO</option><option value="Partial">Partial</option><option value="YES">YES</option></select></div>
        </div>}
      </div>}
      {ext.company && findCompany(ext.company) && <div style={{fontSize:12.5,color:t.green,fontWeight:600,marginBottom:14}}>
        <CheckCircle size={13} style={{display:"inline",verticalAlign:-2,marginRight:4}}/> Found in database: {findCompany(ext.company).name} (Tier {findCompany(ext.company).tier}, H-1B: {findCompany(ext.company).h1b})
      </div>}
      <Btn onClick={handleAddExternal} disabled={!ext.role||!ext.company} t={t}><Plus size={14}/> Add to Job Feed</Btn>
    </Card>}

    {error&&<Card t={t} style={{marginBottom:16,borderColor:t.redBd,background:t.redL}}><div style={{color:t.red,fontWeight:700,fontSize:13.5,marginBottom:4}}>Error</div><div style={{color:t.red,fontSize:13}}>{error}</div></Card>}
    {loading&&!searchResults.length&&<Spin t={t}/>}

    {/* Stats */}
    {searchResults.length>0&&<div style={{display:"flex",gap:10,marginBottom:16,fontSize:12.5,color:t.muted}}>
      <span style={{fontWeight:700,color:t.tx}}>{filtered.length}</span> results {lastUpdated&&<span>· Updated {new Date(lastUpdated).toLocaleString()}</span>}
    </div>}

    {/* Job list */}
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      {filtered.sort((a,b)=>a.itar_flag-b.itar_flag).map((job,i)=>{
        const inP=pipeIds.has(job.id);
        return <Card key={job.id||i} t={t} style={{opacity:job.itar_flag?.5:1,borderColor:job.itar_flag?t.redBd:t.border,padding:"14px 18px"}}>
          <div style={{display:"flex",alignItems:"center",gap:16}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                <span style={{fontSize:14.5,fontWeight:700,color:t.tx,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{job.role}</span>
                <StatusBadge status={job.verdict} t={t}/>
                {job.source==="external"&&<span style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:10,background:t.priL,color:t.pri}}>EXTERNAL</span>}
              </div>
              <div style={{fontSize:13,color:t.sub}}>{job.company}{job.location?` · ${job.location}`:""}{job.posted?` · ${job.posted}`:""}</div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
              {job.match!=null&&<span style={{fontSize:14,fontWeight:800,color:matchColor(job.match,t)}}>{job.match}%</span>}
              {job.link&&<a href={job.link} target="_blank" rel="noreferrer" style={{color:t.sub}}><ExternalLink size={14}/></a>}
              <Btn size="sm" variant={inP?"green":"secondary"} onClick={()=>{if(!inP)addToPipeline(job);}} disabled={inP||job.itar_flag} t={t}>
                {inP?<><Check size={12}/> Added</>:<><Plus size={12}/> Pipeline</>}
              </Btn>
            </div>
          </div>
        </Card>;
      })}
    </div>
    {searchResults.length===0&&!loading&&<Card t={t} style={{textAlign:"center",padding:"60px 24px"}}><Search size={32} color={t.muted} style={{marginBottom:12}}/><div style={{fontSize:14,fontWeight:600,color:t.sub}}>No jobs loaded yet. Use the tabs above to load jobs.</div></Card>}
  </div>;
}

// ─── PIPELINE (Bug #3 — proper flow hub) ─────────────────────────────────────
function Pipeline({pipeline,removePipeline,setPage,setCurrentJob,t}){
  const active=pipeline.filter(j=>j.status==="active");
  const completed=pipeline.filter(j=>j.status==="completed");
  return <div>
    <div style={{marginBottom:24}}><h2 style={{margin:"0 0 4px",fontSize:24,fontWeight:700,color:t.tx}}>Pipeline</h2><p style={{margin:0,fontSize:14,color:t.sub}}>Jobs you want to apply to this session. Process each one through Analysis and Networking.</p></div>

    {/* Flow guide */}
    <Card t={t} style={{marginBottom:20,padding:"16px 24px"}}>
      <div style={{display:"flex",alignItems:"center",gap:0}}>
        {["Add Jobs","Analyze JD","Network","Log Applied"].map((step,i)=>(<div key={step} style={{flex:1,display:"flex",alignItems:"center"}}><div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}><div style={{width:28,height:28,borderRadius:"50%",background:t.pri,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700}}>{i+1}</div><span style={{fontSize:11,fontWeight:600,color:t.pri,whiteSpace:"nowrap"}}>{step}</span></div>{i<3&&<div style={{flex:1,height:2,background:t.border,margin:"0 4px",marginTop:-18}}/>}</div>))}
      </div>
    </Card>

    {active.length===0&&<Card t={t} style={{textAlign:"center",padding:"60px 24px"}}><Activity size={32} color={t.muted} style={{marginBottom:12}}/><div style={{fontSize:14,fontWeight:600,color:t.sub,marginBottom:16}}>No jobs in pipeline. Add jobs from Find Jobs.</div><Btn onClick={()=>setPage("search")} t={t}>Find Jobs</Btn></Card>}

    {active.length>0&&<><SectionLabel t={t}>Active ({active.length})</SectionLabel>
      {active.map(job=>(
        <Card key={job.id} t={t} style={{marginBottom:8,padding:"14px 18px"}}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{flex:1}}>
              <div style={{fontSize:14.5,fontWeight:700,color:t.tx}}>{job.role}</div>
              <div style={{fontSize:13,color:t.sub}}>{job.company}{job.location?` · ${job.location}`:""}</div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {job.match&&<span style={{fontSize:13,fontWeight:700,color:matchColor(job.match,t)}}>{job.match}%</span>}
              <StatusBadge status={job.verdict||"YELLOW"} t={t}/>
              <Btn size="sm" onClick={()=>{setCurrentJob(job);setPage("analyze");}} t={t}><BarChart2 size={12}/> Analyze</Btn>
              <Btn size="sm" variant="secondary" onClick={()=>{setCurrentJob(job);setPage("networking");}} t={t}><Users size={12}/> Network</Btn>
              <Btn size="sm" variant="red" onClick={()=>removePipeline(job.id)} t={t}><Trash2 size={12}/></Btn>
            </div>
          </div>
        </Card>
      ))}
    </>}
    {completed.length>0&&<><SectionLabel t={t}>Completed ({completed.length})</SectionLabel>
      {completed.slice(0,5).map(job=>(<Card key={job.id} t={t} style={{marginBottom:6,padding:"10px 18px",opacity:0.6}}><div style={{fontSize:13,color:t.sub}}><Check size={13} style={{display:"inline",verticalAlign:-2,marginRight:4}}/>{job.role} at {job.company}</div></Card>))}
    </>}
  </div>;
}

// ─── JOB ANALYSIS ────────────────────────────────────────────────────────────
function JobAnalysis({currentJob,updatePipelineJob,setPage,setCurrentJob,t}){
  const [co,setCo]=useState(currentJob?.company||"");const [role,setRole]=useState(currentJob?.role||"");
  const [loc,setLoc]=useState(currentJob?.location||"");const [link,setLink]=useState(currentJob?.link||"");
  const [jd,setJd]=useState(currentJob?.jd||"");const [res,setRes]=useState(null);
  const [loading,setLoading]=useState(false);const [result,setResult]=useState(currentJob?.analysisResult||"");
  const [verdict,setVerdict]=useState(currentJob?.verdict||"");const [err,setErr]=useState("");
  const [checks,setChecks]=useState(null);const [structured,setStructured]=useState(null);
  const [copied,setCopied]=useState("");const [fetchingJD,setFetchingJD]=useState(false);

  useEffect(()=>{if(currentJob){setCo(currentJob.company||"");setRole(currentJob.role||"");setLoc(currentJob.location||"");setLink(currentJob.link||"");setJd(currentJob.jd||"");setResult(currentJob.analysisResult||"");setVerdict(currentJob.verdict||"");}},[currentJob?.id]);
  useEffect(()=>{if(!co&&!jd)return;const c={};if(co){c.bl=isBlacklisted(co);c.m628=findCompany(co);}if(jd)c.itar=checkITAR(jd);c.ok=!c.bl&&(!c.itar||c.itar.length===0);setChecks(c);},[co,jd]);

  const fetchJD=async()=>{if(!link)return;setFetchingJD(true);try{const text=await callAI([{role:"user",content:`Fetch and extract the full job description from: ${link}\nReturn ONLY the job description text.`}],{useSearch:true,maxTokens:3000});setJd(text);}catch(e){setErr(e.message);}setFetchingJD(false);};

  const analyze=async()=>{
    setLoading(true);setErr("");setStructured(null);
    const resumeTag=res?`\nResume variant: ${res} (${RESUMES[res]?.name})`:"";
    try{
      const text=await callAI([{role:"user",content:`Analyze this JD for fit with Siddardth's background.${resumeTag}\nCompany: ${co}\nRole: ${role}\nLocation: ${loc}\n\nJD:\n${jd.slice(0,4000)}\n\nReturn analysis then a JSON block:\n<SCORES>{"overall":N,"skills":N,"experience":N,"education":N,"recommendedResume":"A|B|C|D","resumeScores":{"A":N,"B":N,"C":N,"D":N},"matchedSkills":["..."],"missingSkills":["..."],"keywords":[{"word":"...","count":N,"match":true/false}]}</SCORES>\n\nEnd with VERDICT: GREEN or YELLOW or RED on its own line.`}],{maxTokens:4000});
      setResult(text);
      const vm=text.match(/VERDICT:\s*(GREEN|YELLOW|RED)/i);if(vm)setVerdict(vm[1].toUpperCase());
      const sm=text.match(/<SCORES>([\s\S]*?)<\/SCORES>/);if(sm){try{setStructured(JSON.parse(sm[1].trim()));}catch{}}
      if(currentJob?.id){updatePipelineJob(currentJob.id,{analysisResult:text,verdict:vm?vm[1].toUpperCase():verdict,jd,company:co,role,location:loc,link});}
    }catch(e){setErr(e.message);}setLoading(false);
  };

  const copyText=(k,v)=>{robustCopy(v).then(()=>{setCopied(k);setTimeout(()=>setCopied(""),2000);}).catch(()=>{});};

  return <div>
    <div style={{marginBottom:24}}><h2 style={{margin:"0 0 4px",fontSize:24,fontWeight:700,color:t.tx}}>Job Analysis</h2><p style={{margin:0,fontSize:14,color:t.sub}}>AI-powered JD analysis and resume matching</p></div>

    {!currentJob?.role&&<Card t={t} style={{textAlign:"center",padding:"60px 24px"}}><BarChart2 size={32} color={t.muted} style={{marginBottom:12}}/><div style={{fontSize:14,fontWeight:600,color:t.sub,marginBottom:16}}>Select a job from Pipeline to analyze.</div><Btn onClick={()=>setPage("pipeline")} t={t}>Go to Pipeline</Btn></Card>}

    {(currentJob?.role||co)&&<Card t={t} style={{marginBottom:16}}>
      <SectionLabel t={t}>Job Details</SectionLabel>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12,marginBottom:12}}>
        <Input label="Company" value={co} onChange={e=>setCo(e.target.value)} t={t}/>
        <Input label="Role" value={role} onChange={e=>setRole(e.target.value)} t={t}/>
        <Input label="Location" value={loc} onChange={e=>setLoc(e.target.value)} t={t}/>
        <Input label="Link" value={link} onChange={e=>setLink(e.target.value)} t={t}/>
      </div>
      {link&&!jd&&<div style={{marginBottom:14,display:"flex",gap:10,alignItems:"center"}}><Btn variant="secondary" onClick={fetchJD} disabled={fetchingJD} t={t}>{fetchingJD?"Fetching JD...":"Fetch JD from URL"}</Btn><span style={{fontSize:12,color:t.muted}}>Or paste below</span></div>}
      <Input label="Full Job Description" value={jd} onChange={e=>setJd(e.target.value)} placeholder="Paste the complete job description here..." multiline rows={8} t={t}/>
      <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
        <Btn onClick={analyze} disabled={loading||!jd.trim()} t={t}>{loading?"Analyzing...":"Run Full Analysis"}</Btn>
        {["A","B","C","D"].map(k=><button key={k} onClick={()=>setRes(res===k?null:k)} style={{padding:"8px 14px",borderRadius:8,fontSize:12.5,fontWeight:700,cursor:"pointer",fontFamily:"inherit",background:res===k?t.pri+"18":"transparent",border:`1px solid ${res===k?t.pri:t.border}`,color:res===k?t.pri:t.sub}}>Resume {k}</button>)}
      </div>
    </Card>}

    {checks&&<Card t={t} style={{marginBottom:16,borderColor:checks.ok?t.greenBd:t.redBd}}>
      {checks.bl&&<div style={{color:t.red,fontSize:13,fontWeight:700,marginBottom:4}}>Blacklisted: {checks.bl}</div>}
      {checks.itar?.length>0&&<div style={{color:t.red,fontSize:13,fontWeight:700,marginBottom:4}}>ITAR keywords: {checks.itar.join(", ")}</div>}
      {checks.m628&&<div style={{color:t.green,fontSize:13,fontWeight:600,marginBottom:4}}>M628: {checks.m628.name} (T{checks.m628.tier} H-1B: {checks.m628.h1b} ITAR: {checks.m628.itar})</div>}
      {checks.ok&&<div style={{color:t.green,fontSize:13,fontWeight:600}}>No ITAR or blacklist flags</div>}
    </Card>}

    {loading&&<Spin t={t}/>}
    {err&&<Card t={t} style={{borderColor:t.redBd}}><div style={{color:t.red,fontSize:13,fontWeight:700}}>Error: {err}</div></Card>}

    {structured&&<div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
        <Card t={t}><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}><Target size={16} color={t.pri}/><span style={{fontSize:14,fontWeight:700,color:t.tx}}>Match Overview</span></div>
          <div style={{display:"flex",alignItems:"center",gap:20}}><div style={{fontSize:48,fontWeight:800,color:matchColor(structured.overall,t)}}>{structured.overall}%</div>
            <div style={{flex:1}}>{[["Skills",structured.skills],["Experience",structured.experience],["Education",structured.education||100]].map(([lbl,val])=>(<div key={lbl} style={{marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:12.5,color:t.sub}}>{lbl}</span><span style={{fontSize:12.5,fontWeight:700,color:t.tx}}>{val}%</span></div><ProgressBar value={val} max={100} color={matchColor(val,t)} t={t}/></div>))}</div>
          </div>
        </Card>
        <Card t={t}><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}><Zap size={16} color={t.pri}/><span style={{fontSize:14,fontWeight:700,color:t.tx}}>Skills</span></div>
          <div style={{marginBottom:10}}><div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{(structured.matchedSkills||[]).map(s=><span key={s} style={{fontSize:12,padding:"3px 10px",borderRadius:20,background:t.greenL,color:t.green,fontWeight:600}}>{s}</span>)}</div></div>
          {(structured.missingSkills||[]).length>0&&<div><div style={{fontSize:11,fontWeight:700,color:t.sub,marginBottom:6}}>Gaps</div><div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{structured.missingSkills.map(s=><span key={s} style={{fontSize:12,padding:"3px 10px",borderRadius:20,background:t.redL,color:t.red,fontWeight:600}}>{s}</span>)}</div></div>}
        </Card>
      </div>
      <Card t={t} style={{marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}><div style={{fontSize:14,fontWeight:700,color:t.tx}}>Full Analysis</div><Btn size="sm" variant="secondary" onClick={()=>copyText("full",result)} t={t}>{copied==="full"?<><Check size={12}/> Copied</>:<><Copy size={12}/> Copy</>}</Btn></div>
        <AIBlock text={result} t={t}/>
      </Card>
      <div style={{display:"flex",gap:10}}>
        <Btn onClick={()=>{setCurrentJob(prev=>({...prev,company:co,role,location:loc,link,jd,verdict,analysisResult:result}));setPage("networking");}} t={t}><Users size={14}/> Find Contacts</Btn>
        <Btn variant="ghost" onClick={()=>setStructured(null)} t={t}>Re-Analyze</Btn>
      </div>
    </div>}

    {result&&!structured&&<Card t={t}><div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}><div style={{fontSize:14,fontWeight:700,color:t.tx}}>Analysis</div><StatusBadge status={verdict||""} t={t}/></div><AIBlock text={result} t={t}/><div style={{marginTop:16,display:"flex",gap:10}}><Btn onClick={()=>{setCurrentJob(prev=>({...prev,company:co,role,location:loc,link,jd,verdict}));setPage("networking");}} t={t}>Find Contacts</Btn></div></Card>}
  </div>;
}

// ─── NETWORKING (Bug #4 — split into Find + Drafting pipeline) ───────────────
function Networking({currentJob,setCurrentJob,contactResults,setContactResults,outreachQueue,addToOutreach,markOutreachDone,addToTracker,onLogApp,setPage,t}){
  const [co,setCo]=useState(currentJob?.company||"");const [role,setRole]=useState(currentJob?.role||"");
  const [loc,setLoc]=useState(currentJob?.location||"");const [detail,setDetail]=useState("");
  const [loading,setLoading]=useState(false);const [err,setErr]=useState("");
  const [totalCount,setTotalCount]=useState(5);const [drafting,setDrafting]=useState(false);
  const [drafts,setDrafts]=useState({});const [copied,setCopied]=useState({});
  const [phase,setPhase]=useState("find"); // find | drafting
  const [selected,setSelected]=useState(null);

  useEffect(()=>{if(currentJob){setCo(currentJob.company||"");setRole(currentJob.role||"");setLoc(currentJob.location||"");}}, [currentJob?.id]);

  const allContacts=contactResults;
  const oqIds=new Set(outreachQueue.map(c=>c.id));

  const findContacts=async()=>{
    setLoading(true);setErr("");
    const m628c=findCompany(co);const h1bNote=m628c?`H-1B: ${m628c.h1b}. Industry: ${m628c.industry}.`:"";
    try{
      const text=await callAI([{role:"user",content:`Find ${totalCount} real LinkedIn contacts at "${co}" for networking about "${role}" role. ${h1bNote} ${detail?`Context: ${detail}`:""}\nReturn JSON:\n<CONTACTS>[{"id":"c1","name":"Full Name","title":"Their Title","type":"Hiring Manager|Recruiter|Peer Engineer|Senior Engineer|UIUC Alumni","company":"${co}","linkedinUrl":"https://linkedin.com/in/...","why":"Why reach out"}]</CONTACTS>`}],{useSearch:true,maxTokens:3000});
      const m=text.match(/<CONTACTS>([\s\S]*?)<\/CONTACTS>/);
      if(m){const arr=JSON.parse(m[1].trim());setContactResults(arr);setPhase("drafting");}
    }catch(e){setErr(e.message);}setLoading(false);
  };

  const draftFor=async c=>{
    setDrafting(true);setErr("");setSelected(c.id);
    const isEM=c.type==="Recruiter"||c.type==="Executive";
    try{
      const text=await callAI([{role:"user",content:`Draft outreach for Siddardth to ${c.name||c.type} (${c.type}) at ${co} for ${role}. ${detail}\nSTRICT: No dashes/em-dashes. Natural sentences. Mention SAMPE or Tata/GE composites.\n1. LinkedIn Note: HARD LIMIT 300 chars.\n2. Follow-up: 3-5 sentences, under 100 words.\n${isEM?`3. Cold Email: Subject under 60 chars. Body 4-6 sentences. Sign: Siddardth Gottapu, siddardth1524@gmail.com, (217) 255-0104`:""}\nReturn JSON:\n<DRAFTS>{"linkedin_note":"...","linkedin_followup":"..."${isEM?',"email_subject":"...","email_body":"..."':""}}</DRAFTS>`}],{maxTokens:2000});
      const m=text.match(/<DRAFTS>([\s\S]*?)<\/DRAFTS>/);
      if(m)setDrafts(p=>({...p,[c.id]:JSON.parse(m[1].trim())}));
    }catch(e){setErr(e.message);}setDrafting(false);
  };

  const copyText=(k,v)=>{robustCopy(v).then(()=>{setCopied(p=>({...p,[k]:true}));setTimeout(()=>setCopied(p=>({...p,[k]:false})),2000);}).catch(()=>{setCopied(p=>({...p,[k]:"failed"}));setTimeout(()=>setCopied(p=>({...p,[k]:false})),2000);});};

  const handleLogAndFinish=()=>{
    // Log application + move job to applied
    if(currentJob?.role){
      onLogApp({id:Date.now(),role:currentJob.role,company:currentJob.company||co,location:currentJob.location||loc,link:currentJob.link||"",match:currentJob.match||"",verdict:currentJob.verdict||"GREEN",status:"Applied",date:new Date().toLocaleDateString(),resumeVariant:""});
    }
    setPage("applied");
  };

  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
      <div><h2 style={{margin:"0 0 4px",fontSize:24,fontWeight:700,color:t.tx}}>Networking</h2><p style={{margin:0,fontSize:14,color:t.sub}}>{co?`Contacts at ${co}`:"Find contacts at target companies"}</p></div>
      <div style={{display:"flex",gap:8}}>
        <Chip active={phase==="find"} onClick={()=>setPhase("find")} t={t}>Find Contacts</Chip>
        <Chip active={phase==="drafting"} onClick={()=>setPhase("drafting")} t={t}>Drafting ({Object.keys(drafts).length})</Chip>
      </div>
    </div>

    {/* PHASE: Find Contacts (Bug #4 — separated) */}
    {phase==="find"&&<Card t={t} style={{marginBottom:20}}>
      <SectionLabel t={t}>Find Contacts</SectionLabel>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:12}}>
        <Input label="Company" value={co} onChange={e=>setCo(e.target.value)} t={t}/>
        <Input label="Role" value={role} onChange={e=>setRole(e.target.value)} t={t}/>
        <Input label="Location" value={loc} onChange={e=>setLoc(e.target.value)} t={t}/>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <span style={{fontSize:13.5,color:t.sub}}>Find</span>
        <input type="number" min={3} max={10} value={totalCount} onChange={e=>setTotalCount(Math.max(3,Math.min(10,+e.target.value)))} style={{width:50,background:t.bg,border:`1px solid ${t.border}`,borderRadius:7,padding:"7px 10px",color:t.tx,fontSize:14,fontWeight:700,textAlign:"center",fontFamily:"inherit",outline:"none"}}/>
        <span style={{fontSize:13.5,color:t.sub}}>contacts</span>
        <div style={{flex:1}}/>
        <Input label="" value={detail} onChange={e=>setDetail(e.target.value)} placeholder="Extra context..." t={t}/>
      </div>
      <Btn onClick={findContacts} disabled={loading||!co} t={t}>{loading?"Searching...":"Find Contacts"}</Btn>
      {loading&&<Spin t={t}/>}
      {err&&<div style={{color:t.red,fontSize:13,fontWeight:600,marginTop:12}}>{err}</div>}
    </Card>}

    {/* PHASE: Drafting Pipeline (Bug #4 — separated) */}
    {phase==="drafting"&&<div>
      {allContacts.length===0&&<Card t={t} style={{textAlign:"center",padding:"60px 24px"}}><Users size={32} color={t.muted} style={{marginBottom:12}}/><div style={{fontSize:14,fontWeight:600,color:t.sub,marginBottom:16}}>No contacts found yet.</div><Btn onClick={()=>setPhase("find")} t={t}>Find Contacts</Btn></Card>}

      {allContacts.map(c=>{
        const hasDraft=!!drafts[c.id];const isDone=outreachQueue.find(x=>x.id===c.id)?.status==="done";
        return <Card key={c.id} t={t} style={{marginBottom:10,borderColor:selected===c.id?t.pri:t.border}}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <Avatar name={c.name||c.type} size={42} t={t}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
                <span style={{fontSize:14.5,fontWeight:700,color:t.tx}}>{c.name||c.type}</span>
                {isDone&&<span style={{fontSize:10.5,fontWeight:700,padding:"2px 8px",borderRadius:10,background:t.greenL,color:t.green}}>Sent</span>}
                {hasDraft&&!isDone&&<span style={{fontSize:10.5,fontWeight:700,padding:"2px 8px",borderRadius:10,background:t.priL,color:t.pri}}>Drafted</span>}
              </div>
              <div style={{fontSize:13,color:t.muted}}>{c.title||c.type} at {c.company}</div>
            </div>
            <div style={{display:"flex",gap:6}}>
              {c.linkedinUrl&&<a href={c.linkedinUrl} target="_blank" rel="noreferrer" style={{width:32,height:32,borderRadius:8,border:`1px solid ${t.border}`,display:"flex",alignItems:"center",justifyContent:"center",color:t.sub}}><Linkedin size={14}/></a>}
              <Btn size="sm" onClick={()=>{if(!oqIds.has(c.id))addToOutreach(c);draftFor(c);}} disabled={drafting&&selected===c.id} t={t}>{hasDraft?"Redraft":"Draft"}</Btn>
              {isDone?null:hasDraft&&<Btn size="sm" variant="green" onClick={()=>{markOutreachDone(c.id);addToTracker(c);}} t={t}><Check size={12}/> Mark Sent</Btn>}
            </div>
          </div>

          {/* Expanded drafts */}
          {hasDraft&&drafts[c.id]&&<div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${t.border}`}}>
            {[
              {label:"LinkedIn Note",key:"linkedin_note",unit:"chars",limit:300},
              {label:"Follow-up",key:"linkedin_followup",unit:"words",limit:100},
              ...(drafts[c.id].email_subject?[{label:"Email Subject",key:"email_subject",unit:"chars",limit:60}]:[]),
              ...(drafts[c.id].email_body?[{label:"Cold Email",key:"email_body",unit:"words",limit:150}]:[]),
            ].filter(x=>drafts[c.id][x.key]).map(({label,key,unit,limit})=>{
              const content=drafts[c.id][key];
              const cnt=unit==="chars"?content.length:content.split(/\s+/).length;
              return <div key={key} style={{marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <span style={{fontSize:11,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:1}}>{label}</span>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <span style={{fontSize:11.5,fontWeight:700,color:cnt>limit?t.red:t.green}}>{cnt}/{limit} {unit}</span>
                    <Btn size="sm" variant="secondary" onClick={()=>copyText(`${c.id}-${key}`,content)} t={t}>{copied[`${c.id}-${key}`]===true?<><Check size={12}/> Copied</>:copied[`${c.id}-${key}`]==="failed"?"Failed":<><Copy size={12}/> Copy</>}</Btn>
                  </div>
                </div>
                <div style={{background:t.bg,border:`1px solid ${t.border}`,borderRadius:8,padding:"11px 14px",fontSize:13.5,lineHeight:1.85,color:t.tx,whiteSpace:"pre-wrap"}}>{content}</div>
              </div>;
            })}
          </div>}
        </Card>;
      })}

      {/* Log Application + Networking buttons */}
      {allContacts.length>0&&<div style={{marginTop:20,display:"flex",gap:10}}>
        <Btn onClick={handleLogAndFinish} variant="green" t={t}><CheckCircle size={14}/> Log Application & Networking</Btn>
        <Btn variant="secondary" onClick={()=>setPage("pipeline")} t={t}>Back to Pipeline</Btn>
      </div>}
    </div>}
  </div>;
}

// ─── APPLIED (Bug #3 — renamed from Applications) ───────────────────────────
function Applied({apps,setPage,t}){
  const [copied,setCopied]=useState(false);
  const copyTSV=()=>{const h="Role\tCompany\tLocation\tVerdict\tStatus\tDate\tLink";const rows=apps.map(a=>`${a.role}\t${a.company}\t${a.location||""}\t${a.verdict||""}\t${a.status||"Applied"}\t${a.date}\t${a.link||""}`);robustCopy([h,...rows].join("\n")).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);});};
  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
      <div><h2 style={{margin:"0 0 4px",fontSize:24,fontWeight:700,color:t.tx}}>Applied</h2><p style={{margin:0,fontSize:14,color:t.sub}}>All logged applications</p></div>
      {apps.length>0&&<Btn size="sm" variant="secondary" onClick={copyTSV} t={t}>{copied?<><Check size={12}/> Copied</>:<><Copy size={12}/> Export TSV</>}</Btn>}
    </div>
    {apps.length===0&&<Card t={t} style={{textAlign:"center",padding:"60px 24px"}}><Briefcase size={32} color={t.muted} style={{marginBottom:12}}/><div style={{fontSize:14,fontWeight:600,color:t.sub,marginBottom:16}}>No applications logged yet. Process jobs through the pipeline.</div><Btn onClick={()=>setPage("search")} t={t}>Find Jobs</Btn></Card>}
    {apps.map((a,i)=>(
      <Card key={a.id||i} t={t} style={{marginBottom:8,padding:"14px 18px"}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{flex:1}}><div style={{fontSize:14.5,fontWeight:700,color:t.tx}}>{a.role}</div><div style={{fontSize:13,color:t.sub}}>{a.company}{a.location?` · ${a.location}`:""} · {a.date}</div></div>
          <StatusBadge status={a.verdict||a.status||"Applied"} t={t}/>
          {a.link&&<a href={a.link} target="_blank" rel="noreferrer" style={{color:t.sub}}><ExternalLink size={14}/></a>}
        </div>
      </Card>
    ))}
  </div>;
}

// ─── COMPANY INTEL ───────────────────────────────────────────────────────────
function CompanyIntel({customCompanies,t}){
  const [query,setQuery]=useState("");const [tierFilter,setTierFilter]=useState("all");const [filterVisa,setFilterVisa]=useState(false);
  const allCos=[...M628];
  const filtered=allCos.filter(c=>{
    if(query.trim()&&!c.name.toLowerCase().includes(query.toLowerCase())&&!c.industry.toLowerCase().includes(query.toLowerCase()))return false;
    if(tierFilter!=="all"&&c.tier!==parseInt(tierFilter))return false;
    if(filterVisa&&c.h1b!=="YES")return false;
    return true;
  });
  return <div>
    <div style={{marginBottom:24}}><h2 style={{margin:"0 0 4px",fontSize:24,fontWeight:700,color:t.tx}}>Company Intelligence</h2><p style={{margin:0,fontSize:14,color:t.sub}}>{allCos.length} companies tracked{customCompanies.length>0?` (${customCompanies.length} custom added)`:""}</p></div>
    <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
      <div style={{position:"relative",flex:1,minWidth:200}}><Search size={15} color={t.muted} style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)"}}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search companies..." style={{width:"100%",background:t.card,border:`1px solid ${t.border}`,borderRadius:9,padding:"9px 14px 9px 36px",color:t.tx,fontSize:13.5,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/></div>
      <select value={tierFilter} onChange={e=>setTierFilter(e.target.value)} style={{background:t.card,border:`1px solid ${t.border}`,borderRadius:9,padding:"9px 14px",color:t.tx,fontSize:13.5,fontFamily:"inherit",outline:"none"}}><option value="all">All Tiers</option>{[1,2,3,4,5,6].map(n=><option key={n} value={n}>Tier {n}</option>)}</select>
      <Chip active={filterVisa} onClick={()=>setFilterVisa(!filterVisa)} t={t}>H-1B Sponsors</Chip>
      <span style={{fontSize:13,color:t.muted,alignSelf:"center"}}>{filtered.length} companies</span>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14}}>
      {filtered.slice(0,60).map(c=>{
        const isCustom=customCompanies.find(x=>x.name===c.name);
        return <Card key={c.name} t={t} style={{padding:"16px 18px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
            <div><div style={{fontSize:14.5,fontWeight:700,color:t.tx,marginBottom:2}}>{c.name}{isCustom&&<span style={{fontSize:10,fontWeight:700,marginLeft:6,padding:"2px 6px",borderRadius:10,background:t.priL,color:t.pri}}>Custom</span>}</div><div style={{fontSize:12.5,color:t.muted}}>{c.industry} · T{c.tier}</div></div>
            <div style={{display:"flex",gap:5}}><span style={{fontSize:10.5,fontWeight:700,padding:"3px 8px",borderRadius:5,background:c.h1b==="YES"?t.greenL:t.yellowL,color:c.h1b==="YES"?t.green:t.yellow}}>H-1B: {c.h1b}</span>{c.itar!=="NO"&&<span style={{fontSize:10.5,fontWeight:700,padding:"3px 8px",borderRadius:5,background:t.redL,color:t.red}}>ITAR</span>}</div>
          </div>
          {c.roles&&<div style={{fontSize:12,color:t.muted}}>{c.roles}</div>}
        </Card>;
      })}
    </div>
  </div>;
}

// ─── MAIN APP ────────────────────────────────────────────────────────────────
export default function JobAgent(){
  const [dark,setDark]=useState(false);const t=dark?DARK:LIGHT;
  const [page,setPageRaw]=useState("dashboard");const [loaded,setLoaded]=useState(false);
  const [apps,setApps]=useState([]);const [pipeline,setPipeline]=useState([]);
  const [searchResults,setSearchResults]=useState([]);const [contactResults,setContactResults]=useState([]);
  const [outreachQueue,setOutreachQueue]=useState([]);const [trackerContacts,setTrackerContacts]=useState([]);
  const [currentJob,setCurrentJob]=useState(null);const [customCompanies,setCustomCompanies]=useState([]);
  const [dailyLog,setDailyLog]=useState([]);

  useEffect(()=>{(async()=>{
    setApps(await sLoad("ja5-apps",[]));setPipeline(await sLoad("ja5-pipeline",[]));
    setSearchResults(await sLoad("ja5-search",[]));setContactResults(await sLoad("ja5-contacts",[]));
    setOutreachQueue(await sLoad("ja5-outreach",[]));setTrackerContacts(await sLoad("ja5-tracked",[]));
    setDark(await sLoad("ja5-dark",false));setCurrentJob(await sLoad("ja5-cur",null));
    setCustomCompanies(await sLoad("ja5-custom-cos",[]));setDailyLog(await sLoad("ja5-daily",[]));setLoaded(true);
  })();},[]);

  useEffect(()=>{if(loaded)sSave("ja5-apps",apps);},[apps,loaded]);
  useEffect(()=>{if(loaded)sSave("ja5-pipeline",pipeline);},[pipeline,loaded]);
  useEffect(()=>{if(loaded)sSave("ja5-search",searchResults);},[searchResults,loaded]);
  useEffect(()=>{if(loaded)sSave("ja5-contacts",contactResults);},[contactResults,loaded]);
  useEffect(()=>{if(loaded)sSave("ja5-outreach",outreachQueue);},[outreachQueue,loaded]);
  useEffect(()=>{if(loaded)sSave("ja5-tracked",trackerContacts);},[trackerContacts,loaded]);
  useEffect(()=>{if(loaded)sSave("ja5-dark",dark);},[dark,loaded]);
  useEffect(()=>{if(loaded)sSave("ja5-cur",currentJob);},[currentJob,loaded]);
  useEffect(()=>{if(loaded)sSave("ja5-custom-cos",customCompanies);},[customCompanies,loaded]);
  useEffect(()=>{if(loaded)sSave("ja5-daily",dailyLog);},[dailyLog,loaded]);
  // Track today's activity snapshot for the weekly chart
  useEffect(()=>{
    if(!loaded)return;
    const today=TODAY_STR;
    setDailyLog(prev=>{
      const entry={date:today,found:searchResults.length,applied:apps.length,outreach:outreachQueue.filter(c=>c.status==="done").length,pipeline:pipeline.filter(j=>j.status==="active").length,interviews:apps.filter(a=>a.status==="Interview").length};
      const idx=prev.findIndex(d=>d.date===today);
      if(idx>=0){const next=[...prev];next[idx]=entry;return next;}
      return [...prev,entry];
    });
  },[loaded,searchResults.length,apps.length,outreachQueue.length,pipeline.length]);

  const setPage=useCallback((pg,jobData)=>{if(jobData)setCurrentJob(prev=>({...prev,...jobData}));setPageRaw(pg);},[]);
  const addToPipeline=useCallback(job=>{setPipeline(p=>p.find(j=>j.id===job.id)?p:[...p,{...job,status:"active",addedAt:Date.now()}]);},[]);
  const removePipeline=useCallback(id=>{setPipeline(p=>p.filter(j=>j.id!==id));},[]);
  const completePipeline=useCallback(id=>{setPipeline(p=>p.map(j=>j.id===id?{...j,status:"completed"}:j));},[]);
  const updatePipelineJob=useCallback((id,u)=>{setPipeline(p=>p.map(j=>j.id===id?{...j,...u}:j));},[]);
  const addToOutreach=useCallback(c=>{setOutreachQueue(q=>q.find(x=>x.id===c.id)?q:[...q,{...c,status:"pending"}]);},[]);
  const markOutreachDone=useCallback(id=>{setOutreachQueue(q=>q.map(c=>c.id===id?{...c,status:"done"}:c));},[]);
  const addToTracker=useCallback(c=>{setTrackerContacts(tc=>[...tc,{...c,loggedAt:Date.now()}]);},[]);

  const pendingPipeline=pipeline.filter(j=>j.status==="active").length;
  const pendingOutreach=outreachQueue.filter(c=>c.status!=="done").length;

  const pages={
    dashboard:<Dashboard apps={apps} pipeline={pipeline} searchResults={searchResults} outreachQueue={outreachQueue} setPage={setPage} setCurrentJob={setCurrentJob} dailyLog={dailyLog} t={t}/>,
    search:<FindJobs searchResults={searchResults} setSearchResults={setSearchResults} pipeline={pipeline} addToPipeline={addToPipeline} setPage={setPage} customCompanies={customCompanies} setCustomCompanies={setCustomCompanies} t={t}/>,
    pipeline:<Pipeline pipeline={pipeline} removePipeline={removePipeline} setPage={setPage} setCurrentJob={setCurrentJob} t={t}/>,
    analyze:<JobAnalysis currentJob={currentJob} updatePipelineJob={updatePipelineJob} setPage={setPage} setCurrentJob={setCurrentJob} t={t}/>,
    networking:<Networking currentJob={currentJob} setCurrentJob={setCurrentJob} contactResults={contactResults} setContactResults={setContactResults} outreachQueue={outreachQueue} addToOutreach={addToOutreach} markOutreachDone={markOutreachDone} addToTracker={addToTracker} onLogApp={a=>setApps(p=>[...p,a])} setPage={setPage} t={t}/>,
    applied:<Applied apps={apps} setPage={setPage} t={t}/>,
    intel:<CompanyIntel customCompanies={customCompanies} t={t}/>,
  };

  return <div style={{display:"flex",height:"100vh",background:t.bg,color:t.tx,fontFamily:"'DM Sans','Inter',system-ui,sans-serif",overflow:"hidden"}}>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
      @keyframes lp-dot{0%,100%{transform:translateY(0);opacity:.25}50%{transform:translateY(-5px);opacity:1}}
      @keyframes lp-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
      ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${t.border};border-radius:5px}
      *{box-sizing:border-box}a{text-decoration:none}
      input::placeholder,textarea::placeholder{color:${t.muted}}
      button{transition:opacity .12s,background .12s,border-color .12s}
    `}</style>

    {/* SIDEBAR */}
    <div style={{width:240,background:t.sb,borderRight:`1px solid ${t.border}`,display:"flex",flexDirection:"column",flexShrink:0}}>
      <div style={{padding:"20px 20px 16px",borderBottom:`1px solid ${t.border}`,display:"flex",alignItems:"center",gap:12}}>
        <div style={{width:36,height:36,borderRadius:10,background:t.pri,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Zap size={18} color="#fff"/></div>
        <div><div style={{fontSize:15,fontWeight:800,color:t.tx}}>LaunchPad</div><div style={{fontSize:11,fontWeight:600,color:t.muted}}>Job Agent v5.0</div></div>
      </div>
      <div style={{padding:"16px 20px 8px",fontSize:10.5,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:2}}>Workflow</div>
      <nav style={{padding:"0 10px",flex:1,overflowY:"auto"}}>
        {NAV_ITEMS.map(({id,label,Icon})=>{
          const a=page===id;
          return <div key={id} onClick={()=>setPage(id)} style={{display:"flex",alignItems:"center",gap:11,padding:"10px 12px",borderRadius:9,marginBottom:2,cursor:"pointer",background:a?t.priL:"transparent",borderLeft:a?`3px solid ${t.pri}`:"3px solid transparent",paddingLeft:a?"9px":"12px",transition:"all .12s"}}
            onMouseEnter={e=>{if(!a)e.currentTarget.style.background=t.hover;}} onMouseLeave={e=>{if(!a)e.currentTarget.style.background="transparent";}}>
            <Icon size={16} color={a?t.pri:t.muted}/><span style={{fontSize:13.5,fontWeight:a?700:500,color:a?t.pri:t.sub}}>{label}</span>
            {id==="pipeline"&&pendingPipeline>0&&<span style={{marginLeft:"auto",fontSize:11,fontWeight:800,padding:"1px 7px",borderRadius:10,background:t.pri+"22",color:t.pri}}>{pendingPipeline}</span>}
            {id==="networking"&&pendingOutreach>0&&<span style={{marginLeft:"auto",fontSize:11,fontWeight:800,padding:"1px 7px",borderRadius:10,background:t.yellow+"22",color:t.yellow}}>{pendingOutreach}</span>}
          </div>;
        })}
      </nav>
      {currentJob?.role&&<div style={{margin:"0 10px 10px",padding:"11px 14px",background:t.priL,border:`1px solid ${t.priBd}`,borderRadius:10}}><div style={{fontSize:9.5,fontWeight:800,color:t.pri,textTransform:"uppercase",letterSpacing:2,marginBottom:5}}>Active</div><div style={{fontSize:13,fontWeight:700,color:t.tx,marginBottom:1}}>{currentJob.role}</div><div style={{fontSize:11.5,color:t.sub}}>{currentJob.company}</div></div>}
      <div style={{padding:"12px 10px",borderTop:`1px solid ${t.border}`}}>
        <div onClick={()=>setDark(!dark)} style={{display:"flex",alignItems:"center",gap:11,padding:"9px 12px",borderRadius:9,cursor:"pointer",color:t.sub}} onMouseEnter={e=>e.currentTarget.style.background=t.hover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
          {dark?<Sun size={16}/>:<Moon size={16}/>}<span style={{fontSize:13.5,fontWeight:500}}>Theme</span>
        </div>
      </div>
    </div>

    {/* MAIN */}
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{height:52,borderBottom:`1px solid ${t.border}`,display:"flex",alignItems:"center",padding:"0 28px",background:t.sb,flexShrink:0}}>
        <div style={{fontSize:13,fontWeight:600,color:t.sub}}>{NAV_ITEMS.find(n=>n.id===page)?.label||"Dashboard"}</div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"28px 32px"}}>{pages[page]||pages.dashboard}</div>
    </div>
  </div>;
}
