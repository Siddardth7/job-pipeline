import { useState } from 'react';
import { Briefcase, Users, Download, CheckCircle, ExternalLink, Linkedin } from 'lucide-react';

const TODAY_STR = new Date().toISOString().split("T")[0];

function Card({children, t, style, onClick}) {
  return <div onClick={onClick} style={{background:t.card,border:`1px solid ${t.border}`,borderRadius:12,padding:20,boxShadow:t.shadow,cursor:onClick?"pointer":"default",...style}}>{children}</div>;
}
function Btn({children, onClick, disabled, variant="primary", size="md", t, style:xs}) {
  const V={primary:{bg:t.pri,c:"#fff",b:"none"},secondary:{bg:"transparent",c:t.sub,b:`1px solid ${t.border}`},green:{bg:t.greenL,c:t.green,b:`1px solid ${t.greenBd}`}};
  const s=V[variant]||V.primary; const p=size==="sm"?"5px 14px":"10px 20px"; const fs=size==="sm"?12.5:13.5;
  return <button onClick={onClick} disabled={disabled} style={{background:s.bg,color:s.c,border:s.b,padding:p,borderRadius:8,fontSize:fs,fontWeight:600,cursor:disabled?"not-allowed":"pointer",opacity:disabled?.4:1,fontFamily:"inherit",whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:6,...xs}}>{children}</button>;
}
function StatusBadge({status, t}) {
  const map={Applied:{bg:t.greenL,c:t.green,Icon:CheckCircle},"In Progress":{bg:t.yellowL,c:t.yellow},Interview:{bg:t.priL,c:t.pri}};
  const s=map[status]||{bg:t.hover,c:t.sub};
  return <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"4px 10px",borderRadius:20,fontSize:11.5,fontWeight:700,background:s.bg,color:s.c}}>{s.Icon&&<s.Icon size={11}/>}{status}</span>;
}
const matchColor=(v,t)=>v>=90?t.green:v>=75?t.yellow:t.red;

function downloadCSV(rows, headers, filename) {
  const escape = v => { const s = String(v ?? ""); return (s.includes(",") || s.includes('"') || s.includes("\n")) ? `"${s.replace(/"/g,'""')}"` : s; };
  const csv = [headers.map(escape).join(","), ...rows.map(r => r.map(escape).join(","))].join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href=url; a.download=filename; a.click();
  URL.revokeObjectURL(url);
}

export default function Applied({apps, networkingLog, setPage, t}) {
  const [activeTab, setActiveTab] = useState("apps");
  const [dateRange, setDateRange] = useState("all");

  const filterByDate = (items, dateField="date") => {
    if (dateRange === "all") return items;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let cutoff;
    if (dateRange === "today") cutoff = startOfDay;
    else if (dateRange === "week") cutoff = new Date(startOfDay.getTime() - 7*86400000);
    else if (dateRange === "month") cutoff = new Date(startOfDay.getTime() - 30*86400000);
    else return items;
    return items.filter(item => { try { return new Date(item[dateField]) >= cutoff; } catch { return true; } });
  };

  const DateRangeBar = () => (
    <div style={{display:"flex",gap:6,alignItems:"center",marginRight:12}}>
      <span style={{fontSize:11,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:1}}>Range:</span>
      {[{id:"all",label:"All"},{id:"today",label:"Today"},{id:"week",label:"This Week"},{id:"month",label:"This Month"}].map(({id,label}) => (
        <button key={id} onClick={() => setDateRange(id)} style={{padding:"5px 12px",borderRadius:6,fontSize:12,fontWeight:dateRange===id?700:500,cursor:"pointer",fontFamily:"inherit",background:dateRange===id?t.pri+"18":"transparent",border:`1px solid ${dateRange===id?t.pri:t.border}`,color:dateRange===id?t.pri:t.sub}}>{label}</button>
      ))}
    </div>
  );

  const filteredApps = filterByDate(apps);
  const filteredNet = filterByDate(networkingLog);

  const downloadAppCSV = () => {
    const headers = ["Date","Role","Status","Company","Company Link","Location","Apply Link","Match Score","Fit Level","Location Type","Employment Type","Salary","Resume Used"];
    const rows = filteredApps.map(a => [a.date||"",a.role||"",a.status||"Applied",a.company||"",a.companyLink||"",a.location||"",a.link||"",a.match||"",a.fitLevel||"",a.locationType||"Onsite",a.type||"Full-time",a.salary||"",a.resumeVariant?`Resume ${a.resumeVariant}`:""]);
    const suffix = dateRange !== "all" ? `_${dateRange}` : "";
    downloadCSV(rows, headers, `applications${suffix}_${TODAY_STR}.csv`);
  };

  const downloadNetCSV = () => {
    const headers = ["Networked Date","Name","Type","Company","Role","Email","LinkedIn URL"];
    const rows = filteredNet.map(c => [c.date||"",c.name||"",c.type||"",c.company||"",c.role||"",c.email||"NA",c.linkedinUrl||""]);
    const suffix = dateRange !== "all" ? `_${dateRange}` : "";
    downloadCSV(rows, headers, `networking${suffix}_${TODAY_STR}.csv`);
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
        <div>
          <h2 style={{margin:"0 0 4px",fontSize:24,fontWeight:700,color:t.tx}}>Applied</h2>
          <p style={{margin:0,fontSize:14,color:t.sub}}>All logged applications and networking</p>
        </div>
      </div>

      <div style={{display:"flex",gap:0,marginBottom:20,borderBottom:`2px solid ${t.border}`}}>
        <button onClick={() => setActiveTab("apps")} style={{padding:"10px 20px",fontSize:13.5,fontWeight:activeTab==="apps"?700:500,color:activeTab==="apps"?t.pri:t.sub,background:"transparent",border:"none",borderBottom:activeTab==="apps"?`2px solid ${t.pri}`:"2px solid transparent",cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:7,marginBottom:-2}}>
          <Briefcase size={15}/>Applications ({apps.length})
        </button>
        <button onClick={() => setActiveTab("networking")} style={{padding:"10px 20px",fontSize:13.5,fontWeight:activeTab==="networking"?700:500,color:activeTab==="networking"?t.pri:t.sub,background:"transparent",border:"none",borderBottom:activeTab==="networking"?`2px solid ${t.pri}`:"2px solid transparent",cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:7,marginBottom:-2}}>
          <Users size={15}/>Networking ({networkingLog.length})
        </button>
      </div>

      {activeTab === "apps" && (
        <div>
          {apps.length > 0 && (
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12,alignItems:"center",flexWrap:"wrap",gap:8}}>
              <DateRangeBar/>
              <Btn size="sm" variant="green" onClick={downloadAppCSV} disabled={filteredApps.length===0} t={t}>
                <Download size={13}/> Download CSV{dateRange!=="all"?` (${filteredApps.length})`:""}
              </Btn>
            </div>
          )}
          {apps.length === 0 && (
            <Card t={t} style={{textAlign:"center",padding:"60px 24px"}}>
              <Briefcase size={32} color={t.muted} style={{marginBottom:12}}/>
              <div style={{fontSize:14,fontWeight:600,color:t.sub,marginBottom:16}}>No applications logged yet.</div>
              <Btn onClick={() => setPage("search")} t={t}>Find Jobs</Btn>
            </Card>
          )}
          {apps.length > 0 && (
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5,borderSpacing:0}}>
                <thead>
                  <tr style={{borderBottom:`2px solid ${t.border}`}}>
                    {["Date","Role","Status","Company","Location","Match","Fit","Loc Type","Emp Type","Salary","Resume","Link"].map(h => (
                      <th key={h} style={{textAlign:"left",padding:"8px 10px",fontSize:10.5,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:.8,whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredApps.map((a,i) => (
                    <tr key={a.id||i} style={{borderBottom:`1px solid ${t.border}`}}>
                      <td style={{padding:"8px 10px",color:t.tx,whiteSpace:"nowrap"}}>{a.date}</td>
                      <td style={{padding:"8px 10px",color:t.tx,fontWeight:600,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.role}</td>
                      <td style={{padding:"8px 10px"}}><StatusBadge status={a.status||"Applied"} t={t}/></td>
                      <td style={{padding:"8px 10px",color:t.sub}}>
                        {a.company}
                        {a.companyLink && <a href={a.companyLink} target="_blank" rel="noreferrer" style={{marginLeft:4,color:t.muted}}><ExternalLink size={10}/></a>}
                      </td>
                      <td style={{padding:"8px 10px",color:t.sub,fontSize:12}}>{a.location}</td>
                      <td style={{padding:"8px 10px",fontWeight:700,color:a.match?matchColor(Number(a.match),t):t.muted}}>{a.match?`${a.match}%`:""}</td>
                      <td style={{padding:"8px 10px"}}>
                        {a.fitLevel && <span style={{fontSize:10.5,fontWeight:700,padding:"2px 7px",borderRadius:10,background:a.fitLevel==="Green"?t.greenL:a.fitLevel==="Yellow"?t.yellowL:t.redL,color:a.fitLevel==="Green"?t.green:a.fitLevel==="Yellow"?t.yellow:t.red}}>{a.fitLevel}</span>}
                      </td>
                      <td style={{padding:"8px 10px",color:t.muted,fontSize:11.5}}>{a.locationType||""}</td>
                      <td style={{padding:"8px 10px",color:t.muted,fontSize:11.5}}>{a.type||""}</td>
                      <td style={{padding:"8px 10px",color:t.muted,fontSize:11.5}}>{a.salary||""}</td>
                      <td style={{padding:"8px 10px"}}>
                        {a.resumeVariant && <span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:6,background:t.priL,color:t.pri}}>{a.resumeVariant}</span>}
                      </td>
                      <td style={{padding:"8px 10px"}}>
                        {a.link && <a href={a.link} target="_blank" rel="noreferrer" style={{color:t.pri}}><ExternalLink size={13}/></a>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "networking" && (
        <div>
          {networkingLog.length > 0 && (
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12,alignItems:"center",flexWrap:"wrap",gap:8}}>
              <DateRangeBar/>
              <Btn size="sm" variant="green" onClick={downloadNetCSV} disabled={filteredNet.length===0} t={t}>
                <Download size={13}/> Download Networking CSV{dateRange!=="all"?` (${filteredNet.length})`:""}
              </Btn>
            </div>
          )}
          {networkingLog.length === 0 && (
            <Card t={t} style={{textAlign:"center",padding:"60px 24px"}}>
              <Users size={32} color={t.muted} style={{marginBottom:12}}/>
              <div style={{fontSize:14,fontWeight:600,color:t.sub}}>No networking contacts logged yet.</div>
            </Card>
          )}
          {networkingLog.length > 0 && (
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5,borderSpacing:0}}>
                <thead>
                  <tr style={{borderBottom:`2px solid ${t.border}`}}>
                    {["Networked Date","Name","Type","Company","Role","Email","LinkedIn"].map(h => (
                      <th key={h} style={{textAlign:"left",padding:"8px 10px",fontSize:10.5,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:.8,whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredNet.map((c,i) => (
                    <tr key={c.id||i} style={{borderBottom:`1px solid ${t.border}`}}>
                      <td style={{padding:"8px 10px",color:t.tx,whiteSpace:"nowrap"}}>{c.date}</td>
                      <td style={{padding:"8px 10px",color:t.tx,fontWeight:600}}>{c.name}</td>
                      <td style={{padding:"8px 10px"}}><span style={{fontSize:10.5,fontWeight:700,padding:"2px 8px",borderRadius:10,background:t.priL,color:t.pri}}>{c.type}</span></td>
                      <td style={{padding:"8px 10px",color:t.sub}}>{c.company}</td>
                      <td style={{padding:"8px 10px",color:t.sub}}>{c.role}</td>
                      <td style={{padding:"8px 10px",color:t.sub,fontSize:12}}>{c.email||"NA"}</td>
                      <td style={{padding:"8px 10px"}}>
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
