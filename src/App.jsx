import { useState, useEffect, useCallback, useRef } from "react";
import {
  LayoutDashboard, Search, BarChart2, Briefcase, Users, Building2, Settings,
  Sun, Moon, Zap, Activity
} from "lucide-react";

import { M628, ITAR_KEYWORDS, BLACKLIST } from "./data/m628.js";
import * as Storage from "./lib/storage.js";
import { DEFAULT_TEMPLATES } from "./lib/templates.js";

import Dashboard from "./components/Dashboard.jsx";
import FindJobs from "./components/FindJobs.jsx";
import Pipeline from "./components/Pipeline.jsx";
import JobAnalysis from "./components/JobAnalysis.jsx";
import Networking from "./components/Networking.jsx";
import Applied from "./components/Applied.jsx";
import CompanyIntel from "./components/CompanyIntel.jsx";
import AppSettings from "./components/Settings.jsx";

// ─── THEME ────────────────────────────────────────────────────────────────────
const LIGHT = {
  bg:"#f8fafc", sb:"#ffffff", card:"#ffffff", border:"#e2e8f0",
  tx:"#0f172a", sub:"#64748b", muted:"#94a3b8", pri:"#0284c7", priL:"#e0f2fe", priBd:"#bae6fd",
  green:"#16a34a", greenL:"#dcfce7", greenBd:"#86efac",
  yellow:"#d97706", yellowL:"#fef3c7", yellowBd:"#fcd34d",
  red:"#dc2626", redL:"#fee2e2", redBd:"#fca5a5",
  hover:"#f1f5f9", shadow:"0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.04)"
};
const DARK = {
  bg:"#07080f", sb:"#0d0e1a", card:"#111222", border:"#1e2035",
  tx:"#e8eaf6", sub:"#7880a4", muted:"#3d4168", pri:"#3b82f6", priL:"#1e293b", priBd:"#2d3a5a",
  green:"#22c55e", greenL:"#14231a", greenBd:"#166534",
  yellow:"#f59e0b", yellowL:"#1c1a10", yellowBd:"#854d0e",
  red:"#ef4444", redL:"#1c1010", redBd:"#7f1d1d",
  hover:"#151628", shadow:"0 1px 3px rgba(0,0,0,.4)"
};

const NAV_ITEMS = [
  {id:"dashboard", label:"Dashboard", Icon:LayoutDashboard},
  {id:"search", label:"Find Jobs", Icon:Search},
  {id:"pipeline", label:"Pipeline", Icon:Activity},
  {id:"analyze", label:"Job Analysis", Icon:BarChart2},
  {id:"networking", label:"Networking", Icon:Users},
  {id:"applied", label:"Applied", Icon:Briefcase},
  {id:"intel", label:"Company Intel", Icon:Building2},
  {id:"settings", label:"API & Settings", Icon:Settings},
];

// ─── HELPER FUNCTIONS ─────────────────────────────────────────────────────────
function findCompany(co) {
  if (!co) return null;
  const l = co.toLowerCase().trim();
  return M628.find(c => l.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(l));
}

function isBlacklisted(co) {
  const l = co.toLowerCase();
  return BLACKLIST.find(b => l.includes(b.toLowerCase()));
}

function checkITAR(text) {
  const l = text.toLowerCase();
  return ITAR_KEYWORDS.filter(k => l.includes(k));
}

function normalizeJob(j, idx) {
  const co = j.company || j.company_name || j.employer || j.organization || "Unknown";
  const role = j.role || j.job_title || j.title || j.position || j.name || "Unknown Role";
  const link = j.link || j.job_url || j.url || j.apply_url || j.apply_link || j.href || "";
  const loc = j.location || j.city || j.place || "";
  const posted = j.posted || j.posted_date || j.date || j.created || j.postedDate || "";
  const src = j.source || "imported";
  const dbCo = findCompany(co);
  return {
    id: j.id || `imp-${co}-${idx}`.replace(/\s+/g, "-"),
    role, company: co, location: loc, type: j.type || "Full-time",
    link, posted,
    itar_flag: j.itar_flag || false, itar_detail: j.itar_detail || "",
    tier: j.tier || j.ats_tier || (dbCo ? `Tier ${dbCo.tier}` : ""),
    h1b: j.h1b || (dbCo ? dbCo.h1b : "LIKELY"),
    industry: j.industry || (dbCo ? dbCo.industry : ""),
    reason: j.reason || `Imported (${src})`,
    match: j.match || j.relevance_score || (j.itar_flag ? 0 : Math.floor(70 + Math.random() * 25)),
    verdict: j.verdict || (j.itar_flag ? "RED" : "GREEN"),
    source: src, domain_verified: j.domain_verified || false,
  };
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function JobAgent() {
  const [dark, setDark] = useState(false);
  const t = dark ? DARK : LIGHT;
  const [syncStatus, setSyncStatus] = useState(""); // "saving"|"saved"|"error"|""
  const [loaded, setLoaded] = useState(false);
  const [page, setPageRaw] = useState("dashboard");

  const [apps, setApps] = useState([]);
  const [pipeline, setPipeline] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [contactResults, setContactResults] = useState([]);
  const [networkingLog, setNetworkingLog] = useState([]);
  const [currentJob, setCurrentJob] = useState(null);
  const [customCompanies, setCustomCompanies] = useState([]);
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);
  const [groqKey, setGroqKey] = useState("");
  const [serperKey, setSerperKey] = useState("");
  const [netlogMeta, setNetlogMeta] = useState({}); // {contactId: {status, followUpDate}}

  const saveTimer = useRef(null);
  const stateRef = useRef({});

  // Keep stateRef current
  useEffect(() => {
    stateRef.current = {apps, pipeline, searchResults, contactResults, networkingLog, dark, currentJob, customCompanies, templates};
  });

  // Load all data from Supabase on mount
  useEffect(() => {
    (async () => {
      try {
        const [dbApps, dbJobs, dbNetlog, dbTemplates, dbSettings, savedJob] = await Promise.all([
          Storage.fetchApplications(),
          Storage.fetchJobs(),
          Storage.fetchNetlog(),
          Storage.fetchTemplates(),
          Storage.fetchSettings(),
          Storage.loadCurrentJob(),
        ]);

        const pipelineJobs = dbJobs.filter(j => j.in_pipeline);
        const searchJobs = dbJobs.filter(j => !j.in_pipeline);

        setApps(dbApps);
        setPipeline(pipelineJobs.map(j => ({...j, status: j.status || 'active'})));
        setSearchResults(searchJobs);
        setNetworkingLog(dbNetlog);
        if (dbTemplates.length > 0) setTemplates(dbTemplates);
        if (dbSettings.dark) setDark(dbSettings.dark === 'true');
        if (dbSettings.groq_api_key) setGroqKey(dbSettings.groq_api_key);
        if (dbSettings.serper_api_key) setSerperKey(dbSettings.serper_api_key);
        if (dbSettings.netlog_meta) {
          try { setNetlogMeta(JSON.parse(dbSettings.netlog_meta)); } catch { /* ignore */ }
        }
        if (savedJob) setCurrentJob(savedJob);
      } catch(e) {
        console.warn('Supabase load error (will use local state):', e.message);
      }
      setLoaded(true);
    })();
  }, []);

  // Debounced save helper
  const debouncedSave = useCallback((saveFn) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSyncStatus("saving");
    saveTimer.current = setTimeout(async () => {
      try {
        await saveFn();
        setSyncStatus("saved");
        setTimeout(() => setSyncStatus(""), 3000);
      } catch(e) {
        setSyncStatus("error");
        console.error("Save error:", e);
      }
    }, 2000);
  }, []);

  // Auto-save currentJob to Supabase whenever it changes
  useEffect(() => {
    if (!loaded || !currentJob) return;
    const timer = setTimeout(() => {
      Storage.saveCurrentJob(currentJob).catch(e => console.warn('currentJob save error:', e));
    }, 1500);
    return () => clearTimeout(timer);
  }, [currentJob, loaded]);

  // ─── State handlers ───────────────────────────────────────────────────────
  const setPage = useCallback((pg, jobData) => {
    if (jobData) setCurrentJob(prev => ({...prev, ...jobData}));
    setPageRaw(pg);
  }, []);

  // Discrete pipeline mutations save immediately — do NOT use debouncedSave here.
  // debouncedSave uses a single shared timer: rapid successive adds cancel each
  // other so only the last job would persist. Direct saves ensure every job lands.
  const addToPipeline = useCallback((job) => {
    const newJob = {...job, status:"active", addedAt:Date.now(), in_pipeline: true};
    setPipeline(p => p.find(j => j.id === job.id) ? p : [...p, newJob]);
    setSyncStatus("saving");
    Storage.upsertJob(newJob)
      .then(() => { setSyncStatus("saved"); setTimeout(() => setSyncStatus(""), 3000); })
      .catch(e => { setSyncStatus("error"); console.error("addToPipeline save error:", e); });
  }, []);

  const removePipeline = useCallback((id) => {
    setPipeline(p => p.filter(j => j.id !== id));
    setSyncStatus("saving");
    Storage.deleteJob(id)
      .then(() => { setSyncStatus("saved"); setTimeout(() => setSyncStatus(""), 3000); })
      .catch(e => { setSyncStatus("error"); console.error("removePipeline save error:", e); });
  }, []);

  const completePipeline = useCallback((id) => {
    setPipeline(p => p.map(j => j.id === id ? {...j, status:"completed"} : j));
    const job = stateRef.current.pipeline.find(j => j.id === id);
    if (!job) return;
    setSyncStatus("saving");
    Storage.upsertJob({...job, status:"completed"})
      .then(() => { setSyncStatus("saved"); setTimeout(() => setSyncStatus(""), 3000); })
      .catch(e => { setSyncStatus("error"); console.error("completePipeline save error:", e); });
  }, []);

  const updatePipelineJob = useCallback((id, updates) => {
    setPipeline(p => p.map(j => j.id === id ? {...j, ...updates} : j));
    debouncedSave(() => {
      const job = stateRef.current.pipeline.find(j => j.id === id);
      if (job) return Storage.upsertJob({...job, ...updates});
    });
  }, [debouncedSave]);

  const updateNetlogMeta = useCallback((contactId, updates) => {
    setNetlogMeta(prev => {
      const next = {...prev, [contactId]: {...(prev[contactId]||{}), ...updates}};
      Storage.saveSetting('netlog_meta', JSON.stringify(next)).catch(e => console.warn('netlog_meta save error:', e));
      return next;
    });
  }, []);

  const addToNetworkingLog = useCallback((contact) => {
    setNetworkingLog(nl => nl.find(x => x.id === contact.id) ? nl : [...nl, contact]);
    debouncedSave(() => Storage.upsertNetlog(contact));
    // Auto-set Pending status + follow-up reminder 5 days out
    const followUpDate = new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0];
    setNetlogMeta(prev => {
      if (prev[contact.id]) return prev; // don't overwrite if already set
      const next = {...prev, [contact.id]: {status: 'Pending', followUpDate}};
      Storage.saveSetting('netlog_meta', JSON.stringify(next)).catch(e => console.warn('netlog_meta save error:', e));
      return next;
    });
  }, [debouncedSave]);

  const logApplication = useCallback((app) => {
    setApps(p => [...p, app]);
    debouncedSave(() => Storage.upsertApplication(app));
  }, [debouncedSave]);

  const setSearchResultsWithSave = useCallback((updater) => {
    setSearchResults(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      debouncedSave(() => Storage.upsertJobs(next.map(j => ({...j, in_pipeline: false}))));
      return next;
    });
  }, [debouncedSave]);

  const pendingPipeline = pipeline.filter(j => j.status === "active").length;

  const renderSyncStatus = () => {
    if (syncStatus === "saving") return <span style={{color:t.muted,fontWeight:700,fontSize:10.5}}>Saving...</span>;
    if (syncStatus === "error") return <span style={{color:t.red,fontWeight:700,fontSize:10.5}}>Sync error</span>;
    if (syncStatus === "saved") return (
      <span style={{display:"flex",alignItems:"center",gap:3,color:t.green,fontWeight:700,fontSize:10.5}}>
        <span style={{width:5,height:5,borderRadius:"50%",background:t.green,display:"inline-block"}}/>Saved
      </span>
    );
    return (
      <span style={{display:"flex",alignItems:"center",gap:3,color:t.green,fontWeight:700,fontSize:10.5}}>
        <span style={{width:5,height:5,borderRadius:"50%",background:t.green,display:"inline-block"}}/>Synced
      </span>
    );
  };

  const pages = {
    dashboard: (
      <Dashboard
        apps={apps} pipeline={pipeline} searchResults={searchResults}
        networkingLog={networkingLog} netlogMeta={netlogMeta} setPage={setPage} t={t}
      />
    ),
    search: (
      <FindJobs
        searchResults={searchResults} setSearchResults={setSearchResultsWithSave}
        pipeline={pipeline} addToPipeline={addToPipeline} setPage={setPage}
        findCompany={findCompany} normalizeJob={normalizeJob} isBlacklisted={isBlacklisted}
        checkITAR={checkITAR} customCompanies={customCompanies}
        setCustomCompanies={setCustomCompanies} t={t}
      />
    ),
    pipeline: (
      <Pipeline
        pipeline={pipeline} removePipeline={removePipeline}
        completePipeline={completePipeline} onLogApp={logApplication}
        setPage={setPage} setCurrentJob={setCurrentJob} apps={apps} t={t}
      />
    ),
    analyze: (
      <JobAnalysis
        key={currentJob?.id || 'no-job'}
        currentJob={currentJob} updatePipelineJob={updatePipelineJob}
        completePipeline={completePipeline} onLogApp={logApplication}
        setPage={setPage} setCurrentJob={setCurrentJob} apps={apps}
        findCompany={findCompany} isBlacklisted={isBlacklisted} checkITAR={checkITAR}
        groqKey={groqKey} t={t}
      />
    ),
    networking: (
      <Networking
        currentJob={currentJob} setCurrentJob={setCurrentJob}
        contactResults={contactResults} setContactResults={setContactResults}
        networkingLog={networkingLog} addToNetworkingLog={addToNetworkingLog}
        netlogMeta={netlogMeta} updateNetlogMeta={updateNetlogMeta}
        setPage={setPage} templates={templates} groqKey={groqKey} serperKey={serperKey} t={t}
      />
    ),
    applied: (
      <Applied apps={apps} networkingLog={networkingLog} setPage={setPage} t={t}/>
    ),
    intel: (
      <CompanyIntel
        customCompanies={customCompanies}
        setCustomCompanies={setCustomCompanies}
        onStartOutreach={(companyName) => {
          setCurrentJob(prev => ({...(prev||{}), company: companyName}));
          setPageRaw('networking');
        }}
        t={t}
      />
    ),
    settings: (
      <AppSettings templates={templates} setTemplates={setTemplates} groqKey={groqKey} setGroqKey={setGroqKey} serperKey={serperKey} setSerperKey={setSerperKey} t={t}/>
    ),
  };

  return (
    <div style={{display:"flex",height:"100vh",background:t.bg,color:t.tx,fontFamily:"'DM Sans','Inter',system-ui,sans-serif",overflow:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        @keyframes lp-dot{0%,100%{transform:translateY(0);opacity:.25}50%{transform:translateY(-5px);opacity:1}}
        @keyframes lp-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${t.border};border-radius:5px}
        *{box-sizing:border-box}a{text-decoration:none}
        input::placeholder,textarea::placeholder{color:${t.muted}}
        button{transition:opacity .12s,background .12s,border-color .12s}
      `}</style>

      {/* SIDEBAR */}
      <div style={{width:240,background:t.sb,borderRight:`1px solid ${t.border}`,display:"flex",flexDirection:"column",flexShrink:0}}>
        <div style={{padding:"20px 20px 16px",borderBottom:`1px solid ${t.border}`,display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:36,height:36,borderRadius:10,background:t.pri,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <Zap size={18} color="#fff"/>
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:15,fontWeight:800,color:t.tx}}>JobAgent</div>
            <div style={{fontSize:10.5,fontWeight:600,color:t.muted,display:"flex",alignItems:"center",gap:5}}>
              <span>v6.0 · Supabase</span>
              {loaded && renderSyncStatus()}
            </div>
          </div>
        </div>

        <div style={{padding:"16px 20px 8px",fontSize:10.5,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:2}}>Workflow</div>

        <nav style={{padding:"0 10px",flex:1,overflowY:"auto"}}>
          {NAV_ITEMS.map(({id, label, Icon}) => {
            const a = page === id;
            return (
              <div key={id} onClick={() => setPage(id)} style={{display:"flex",alignItems:"center",gap:11,padding:"10px 12px",borderRadius:9,marginBottom:2,cursor:"pointer",background:a?t.priL:"transparent",borderLeft:a?`3px solid ${t.pri}`:"3px solid transparent",paddingLeft:a?"9px":"12px",transition:"all .12s"}}
                onMouseEnter={e => { if(!a) e.currentTarget.style.background=t.hover; }}
                onMouseLeave={e => { if(!a) e.currentTarget.style.background="transparent"; }}>
                <Icon size={16} color={a?t.pri:t.muted}/>
                <span style={{fontSize:13.5,fontWeight:a?700:500,color:a?t.pri:t.sub}}>{label}</span>
                {id === "pipeline" && pendingPipeline > 0 && (
                  <span style={{marginLeft:"auto",fontSize:11,fontWeight:800,padding:"1px 7px",borderRadius:10,background:t.pri+"22",color:t.pri}}>{pendingPipeline}</span>
                )}
                {id === "networking" && networkingLog.length > 0 && (
                  <span style={{marginLeft:"auto",fontSize:11,fontWeight:800,padding:"1px 7px",borderRadius:10,background:t.green+"22",color:t.green}}>{networkingLog.length}</span>
                )}
              </div>
            );
          })}
        </nav>

        {currentJob?.role && (
          <div style={{margin:"0 10px 10px",padding:"11px 14px",background:t.priL,border:`1px solid ${t.priBd}`,borderRadius:10}}>
            <div style={{fontSize:9.5,fontWeight:800,color:t.pri,textTransform:"uppercase",letterSpacing:2,marginBottom:5}}>Active Job</div>
            <div style={{fontSize:13,fontWeight:700,color:t.tx,marginBottom:1}}>{currentJob.role}</div>
            <div style={{fontSize:11.5,color:t.sub}}>{currentJob.company}</div>
          </div>
        )}

        <div style={{padding:"12px 10px",borderTop:`1px solid ${t.border}`}}>
          <div onClick={() => setDark(!dark)} style={{display:"flex",alignItems:"center",gap:11,padding:"9px 12px",borderRadius:9,cursor:"pointer",color:t.sub}}
            onMouseEnter={e => e.currentTarget.style.background=t.hover}
            onMouseLeave={e => e.currentTarget.style.background="transparent"}>
            {dark ? <Sun size={16}/> : <Moon size={16}/>}
            <span style={{fontSize:13.5,fontWeight:500}}>{dark ? "Light Mode" : "Dark Mode"}</span>
          </div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{height:52,borderBottom:`1px solid ${t.border}`,display:"flex",alignItems:"center",padding:"0 28px",background:t.sb,flexShrink:0}}>
          <div style={{fontSize:13,fontWeight:600,color:t.sub}}>
            {NAV_ITEMS.find(n => n.id === page)?.label || "Dashboard"}
          </div>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"28px 32px"}}>
          {!loaded ? (
            <div style={{display:"flex",gap:6,alignItems:"center",justifyContent:"center",height:"100%"}}>
              {[0,1,2].map(i => <div key={i} style={{width:8,height:8,borderRadius:"50%",background:t.pri,animation:`lp-dot .8s ${i*.15}s ease-in-out infinite`,opacity:.3}}/>)}
            </div>
          ) : (
            pages[page] || pages.dashboard
          )}
        </div>
      </div>
    </div>
  );
}
