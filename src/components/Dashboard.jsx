import { Search, BarChart2, CheckCircle, Users, Database, Briefcase, Shield, Activity, Building2, AlertTriangle, MessageSquare, Coffee } from 'lucide-react';
import { M628 } from '../data/m628.js';

const PERSONA_COLORS = {
  'Recruiter':      '#0284c7',
  'Hiring Manager': '#d97706',
  'Peer Engineer':  '#16a34a',
  'Executive':      '#7c3aed',
  'UIUC Alumni':    '#0891b2',
  'Senior Engineer':'#db2777',
};

function Card({children, t, style, onClick}) {
  return (
    <div onClick={onClick} style={{background:t.card,border:`1px solid ${t.border}`,borderRadius:12,padding:20,boxShadow:t.shadow,cursor:onClick?"pointer":"default",...style}}>
      {children}
    </div>
  );
}

function ProgressBar({value, max, color, t}) {
  return (
    <div style={{width:"100%",height:6,background:t.border,borderRadius:3,overflow:"hidden"}}>
      <div style={{width:`${Math.min(100,Math.round((value/Math.max(1,max))*100))}%`,height:"100%",background:color||t.pri,borderRadius:3,transition:"width .4s ease"}}/>
    </div>
  );
}

export default function Dashboard({apps, pipeline, searchResults, networkingLog, netlogMeta, setPage, t}) {
  const activeP = pipeline.filter(j => j.status === "active").length;
  const completedP = pipeline.filter(j => j.status === "completed").length;
  const totalImported = searchResults.length;
  const totalAnalyzed = pipeline.length;
  const totalApplied = apps.length;
  const totalNetworked = networkingLog.length;
  const h1bCount = M628.filter(c => c.h1b === "YES").length;
  const itarCount = M628.filter(c => c.itar === "YES").length;
  const eligible = searchResults.filter(j => !j.itar_flag).length;
  const greenJobs = searchResults.filter(j => j.verdict === "GREEN").length;
  const yellowJobs = searchResults.filter(j => j.verdict === "YELLOW").length;

  const piDist = [
    {label:"Saved", value:activeP, color:t.yellow},
    {label:"Analyzed", value:completedP, color:t.pri},
    {label:"Applied", value:totalApplied, color:t.green}
  ];
  const piTotal = Math.max(1, piDist.reduce((s,d) => s+d.value, 0));

  const indMap = {};
  searchResults.forEach(j => {
    const ind = j.industry || "Other";
    indMap[ind] = (indMap[ind] || 0) + 1;
  });
  const topIndustries = Object.entries(indMap).sort((a,b) => b[1]-a[1]).slice(0, 5);

  // Calendar week: resets every Monday at 00:00 local time
  const weekStart = (() => {
    const d = new Date();
    const day = d.getDay(); // 0=Sun, 1=Mon … 6=Sat
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    d.setHours(0, 0, 0, 0);
    return d;
  })();
  const weekLabel = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // Use created_at (timestamptz from Supabase) — avoids locale-string parsing bugs
  const recentApps = apps.filter(a => { try { return new Date(a.created_at || a.date) >= weekStart; } catch { return false; } }).length;
  const recentNet = networkingLog.filter(c => { try { return new Date(c.created_at || c.date) >= weekStart; } catch { return false; } }).length;

  // ── Networking analytics ──────────────────────────────────────────────────
  const todayStr = new Date().toISOString().split('T')[0];
  const statusCounts = {'Pending':0,'Replied':0,'Coffee Chat':0,'No Response':0};
  networkingLog.forEach(c => {
    const s = netlogMeta?.[c.id]?.status || 'Pending';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  });
  const responseRate = totalNetworked > 0
    ? Math.round(((statusCounts['Replied'] + statusCounts['Coffee Chat']) / totalNetworked) * 100)
    : 0;
  const overdueFollowUps = networkingLog.filter(c => {
    const meta = netlogMeta?.[c.id];
    return meta?.status === 'Pending' && meta?.followUpDate && meta.followUpDate < todayStr;
  }).length;
  const personaMap = {};
  networkingLog.forEach(c => {
    const p = c.type || 'Unknown';
    personaMap[p] = (personaMap[p] || 0) + 1;
  });
  const topPersonas = Object.entries(personaMap).sort((a,b) => b[1]-a[1]);

  return (
    <div>
      <div style={{marginBottom:28}}>
        <h2 style={{margin:"0 0 4px",fontSize:24,fontWeight:700,color:t.tx}}>Dashboard</h2>
        <p style={{margin:0,fontSize:14,color:t.sub}}>Your job search command center &nbsp;<span style={{fontWeight:600,color:t.muted}}>· Week of {weekLabel}</span></p>
      </div>

      {/* Weekly Goals */}
      {(() => {
        const APP_TARGET = 5, NET_TARGET = 10;
        const appPct = Math.min(100, Math.round((recentApps / APP_TARGET) * 100));
        const netPct = Math.min(100, Math.round((recentNet / NET_TARGET) * 100));
        return (
          <Card t={t} style={{marginBottom:20,padding:"16px 24px"}}>
            <div style={{display:"flex",alignItems:"center",gap:24,flexWrap:"wrap"}}>
              <div style={{fontSize:11,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:1.5,whiteSpace:"nowrap"}}>
                Week of {weekLabel}
              </div>
              {[
                {label:"Applications",cur:recentApps,target:APP_TARGET,pct:appPct,color:t.green},
                {label:"Contacts",cur:recentNet,target:NET_TARGET,pct:netPct,color:"#7c3aed"},
              ].map(({label,cur,target,pct,color}) => (
                <div key={label} style={{flex:1,minWidth:160}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                    <span style={{fontSize:12.5,fontWeight:600,color:t.sub}}>{label}</span>
                    <span style={{fontSize:12.5,fontWeight:700,color:pct>=100?color:t.tx}}>{cur} / {target}</span>
                  </div>
                  <div style={{height:6,background:t.border,borderRadius:3,overflow:"hidden"}}>
                    <div style={{width:`${pct}%`,height:"100%",background:color,borderRadius:3,transition:"width .4s ease"}}/>
                  </div>
                  {pct >= 100 && <div style={{fontSize:10.5,color,fontWeight:700,marginTop:3}}>Goal reached!</div>}
                </div>
              ))}
            </div>
          </Card>
        );
      })()}

      {/* Top metric cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:24}}>
        {[
          {label:"Jobs Imported",value:totalImported,Icon:Search,color:t.pri,sub:`${eligible} eligible, ${totalImported-eligible} ITAR flagged`},
          {label:"Jobs Analyzed",value:totalAnalyzed,Icon:BarChart2,color:t.yellow,sub:activeP>0?`${activeP} active in pipeline`:"Add jobs to pipeline"},
          {label:"Applications",value:totalApplied,Icon:CheckCircle,color:t.green,sub:recentApps>0?`${recentApps} this week`:"Start applying"},
          {label:"Contacts Reached",value:totalNetworked,Icon:Users,color:"#7c3aed",sub:recentNet>0?`${recentNet} this week`:`${totalNetworked} total`},
        ].map(({label,value,Icon,color,sub}) => (
          <Card key={label} t={t}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
              <div style={{fontSize:10.5,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:1.5}}>{label}</div>
              <div style={{width:34,height:34,borderRadius:8,background:color+"18",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <Icon size={16} color={color}/>
              </div>
            </div>
            <div style={{fontSize:34,fontWeight:800,color:t.tx,lineHeight:1,marginBottom:8}}>{value}</div>
            <div style={{fontSize:12,color:t.sub}}>{sub}</div>
          </Card>
        ))}
      </div>

      {/* Pipeline Distribution + Database Metrics */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24}}>
        <Card t={t}>
          <div style={{fontSize:11.5,fontWeight:700,color:t.tx,textTransform:"uppercase",letterSpacing:1.5,marginBottom:18}}>Pipeline Distribution</div>
          <div style={{display:"flex",height:28,borderRadius:6,overflow:"hidden",marginBottom:16,background:t.border}}>
            {piDist.map(d => d.value > 0 ? (
              <div key={d.label} title={`${d.label}: ${d.value}`} style={{width:`${(d.value/piTotal)*100}%`,background:d.color,transition:"width .4s ease"}}/>
            ) : null)}
          </div>
          <div style={{display:"flex",gap:20}}>
            {piDist.map(d => (
              <div key={d.label} style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{width:10,height:10,borderRadius:3,background:d.color}}/>
                <span style={{fontSize:12.5,color:t.sub}}>{d.label}</span>
                <span style={{fontSize:13,fontWeight:700,color:t.tx}}>{d.value}</span>
              </div>
            ))}
          </div>
          {searchResults.length > 0 && (
            <div style={{marginTop:18,paddingTop:16,borderTop:`1px solid ${t.border}`}}>
              <div style={{fontSize:11,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Job Verdicts</div>
              <div style={{display:"flex",gap:12}}>
                {[
                  {label:"GREEN",value:greenJobs,color:t.green},
                  {label:"YELLOW",value:yellowJobs,color:t.yellow},
                  {label:"ITAR Flagged",value:totalImported-eligible,color:t.red}
                ].map(d => (
                  <div key={d.label} style={{flex:1,padding:"10px 14px",background:d.color+"12",borderRadius:8,border:`1px solid ${d.color}30`}}>
                    <div style={{fontSize:18,fontWeight:800,color:d.color}}>{d.value}</div>
                    <div style={{fontSize:11,color:d.color,fontWeight:600}}>{d.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card t={t}>
          <div style={{fontSize:11.5,fontWeight:700,color:t.tx,textTransform:"uppercase",letterSpacing:1.5,marginBottom:18}}>Database Metrics</div>
          {[
            {label:"Master DB Size",value:M628.length,max:350,Icon:Database,color:t.pri,note:`${M628.length} companies tracked`},
            {label:"Visa Sponsoring",value:h1bCount,max:M628.length,Icon:Briefcase,color:t.green,note:"H-1B YES confirmed"},
            {label:"ITAR Restricted",value:itarCount,max:M628.length,Icon:Shield,color:t.yellow,note:"Full ITAR flag"},
          ].map(({label,value,max,Icon,color,note}) => (
            <div key={label} style={{marginBottom:16}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:28,height:28,borderRadius:7,background:color+"18",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <Icon size={13} color={color}/>
                  </div>
                  <div>
                    <div style={{fontSize:12.5,fontWeight:600,color:t.sub}}>{label}</div>
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

      {/* Industry Breakdown + Quick Actions */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
        {topIndustries.length > 0 && (
          <Card t={t}>
            <div style={{fontSize:11.5,fontWeight:700,color:t.tx,textTransform:"uppercase",letterSpacing:1.5,marginBottom:14}}>Top Industries (from jobs found)</div>
            {topIndustries.map(([ind, count]) => (
              <div key={ind} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <span style={{fontSize:12.5,fontWeight:600,color:t.tx}}>{ind}</span>
                    <span style={{fontSize:12,fontWeight:700,color:t.muted}}>{count}</span>
                  </div>
                  <ProgressBar value={count} max={topIndustries[0][1]} color={t.pri} t={t}/>
                </div>
              </div>
            ))}
          </Card>
        )}
        <Card t={t}>
          <div style={{fontSize:11.5,fontWeight:700,color:t.tx,textTransform:"uppercase",letterSpacing:1.5,marginBottom:14}}>Quick Actions</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {[
              {label:"Find Jobs",id:"search",Icon:Search},
              {label:"Pipeline",id:"pipeline",Icon:Activity},
              {label:"Network",id:"networking",Icon:Users},
              {label:"Company Intel",id:"intel",Icon:Building2}
            ].map(({label,id,Icon}) => (
              <div key={id} onClick={() => setPage(id)} style={{textAlign:"center",cursor:"pointer",padding:"18px 12px",borderRadius:10,background:t.hover,border:`1px solid ${t.border}`,transition:"all .12s"}}
                onMouseEnter={e => e.currentTarget.style.borderColor=t.pri}
                onMouseLeave={e => e.currentTarget.style.borderColor=t.border}>
                <div style={{width:34,height:34,borderRadius:8,background:t.priL,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 8px"}}>
                  <Icon size={16} color={t.pri}/>
                </div>
                <div style={{fontSize:12.5,fontWeight:700,color:t.tx}}>{label}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Networking Analysis */}
      {totalNetworked > 0 && (
        <Card t={t}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
            <div style={{fontSize:11.5,fontWeight:700,color:t.tx,textTransform:"uppercase",letterSpacing:1.5}}>Networking Analysis</div>
            <div style={{display:"flex",gap:16,alignItems:"center"}}>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:22,fontWeight:800,color:responseRate >= 30 ? t.green : responseRate >= 10 ? t.yellow : t.red}}>{responseRate}%</div>
                <div style={{fontSize:10.5,color:t.muted,fontWeight:600}}>Response Rate</div>
              </div>
              {overdueFollowUps > 0 && (
                <div style={{padding:"10px 16px",background:t.redL,border:`1px solid ${t.redBd}`,borderRadius:10,textAlign:"center"}}>
                  <div style={{display:"flex",alignItems:"center",gap:5,color:t.red}}>
                    <AlertTriangle size={14}/>
                    <span style={{fontSize:18,fontWeight:800}}>{overdueFollowUps}</span>
                  </div>
                  <div style={{fontSize:10.5,color:t.red,fontWeight:600,marginTop:2}}>Overdue Follow-ups</div>
                </div>
              )}
            </div>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24}}>
            {/* Status breakdown */}
            <div>
              <div style={{fontSize:10.5,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:1.5,marginBottom:12}}>Response Status</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
                {[
                  {label:'Pending',     color:t.yellow, bg:t.yellowL, bd:t.yellowBd, count:statusCounts['Pending'],     Icon:MessageSquare},
                  {label:'Replied',     color:t.green,  bg:t.greenL,  bd:t.greenBd,  count:statusCounts['Replied'],     Icon:CheckCircle},
                  {label:'Coffee Chat', color:'#7c3aed', bg:'#ede9fe', bd:'#c4b5fd',  count:statusCounts['Coffee Chat'], Icon:Coffee},
                  {label:'No Response', color:t.red,    bg:t.redL,    bd:t.redBd,    count:statusCounts['No Response'], Icon:Users},
                ].map(({label, color, bg, bd, count, Icon}) => (
                  <div key={label} style={{padding:"12px 14px",background:bg,borderRadius:9,border:`1px solid ${bd}`,display:"flex",alignItems:"center",gap:10}}>
                    <Icon size={16} color={color}/>
                    <div>
                      <div style={{fontSize:20,fontWeight:800,color,lineHeight:1}}>{count}</div>
                      <div style={{fontSize:10.5,color,fontWeight:600,marginTop:2}}>{label}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{paddingTop:12,borderTop:`1px solid ${t.border}`}}>
                <ProgressBar value={statusCounts['Replied'] + statusCounts['Coffee Chat']} max={Math.max(1,totalNetworked)} color={t.green} t={t}/>
                <div style={{display:"flex",justifyContent:"space-between",marginTop:5}}>
                  <span style={{fontSize:11.5,color:t.muted}}>Engaged ({statusCounts['Replied'] + statusCounts['Coffee Chat']} of {totalNetworked})</span>
                  <span style={{fontSize:11.5,fontWeight:700,color:t.green}}>{responseRate}% rate</span>
                </div>
              </div>
            </div>

            {/* Persona breakdown + recent activity */}
            <div>
              <div style={{fontSize:10.5,fontWeight:700,color:t.muted,textTransform:"uppercase",letterSpacing:1.5,marginBottom:12}}>By Persona Type</div>
              {topPersonas.map(([type, cnt]) => (
                <div key={type} style={{marginBottom:9}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                    <div style={{display:"flex",alignItems:"center",gap:7}}>
                      <div style={{width:8,height:8,borderRadius:2,background:PERSONA_COLORS[type]||t.pri}}/>
                      <span style={{fontSize:12.5,color:t.sub,fontWeight:500}}>{type}</span>
                    </div>
                    <span style={{fontSize:12,fontWeight:700,color:t.tx}}>{cnt}</span>
                  </div>
                  <ProgressBar value={cnt} max={Math.max(1,totalNetworked)} color={PERSONA_COLORS[type]||t.pri} t={t}/>
                </div>
              ))}
              <div style={{marginTop:14,paddingTop:12,borderTop:`1px solid ${t.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:12,color:t.muted}}>Since {weekLabel}</div>
                  <div style={{fontSize:17,fontWeight:800,color:t.tx}}>{recentNet} <span style={{fontSize:12,fontWeight:500,color:t.sub}}>contacts</span></div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:12,color:t.muted}}>Total outreach</div>
                  <div style={{fontSize:17,fontWeight:800,color:t.tx}}>{totalNetworked} <span style={{fontSize:12,fontWeight:500,color:t.sub}}>contacts</span></div>
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
