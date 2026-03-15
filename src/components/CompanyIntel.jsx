import { useState } from 'react';
import { Search } from 'lucide-react';
import { M628 } from '../data/m628.js';

function Card({children, t, style, onClick}) {
  return <div onClick={onClick} style={{background:t.card,border:`1px solid ${t.border}`,borderRadius:12,padding:20,boxShadow:t.shadow,cursor:onClick?"pointer":"default",...style}}>{children}</div>;
}
function Chip({children, active, onClick, t}) {
  return <button onClick={onClick} style={{padding:"6px 16px",borderRadius:20,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",background:active?t.pri:t.card,border:`1px solid ${active?t.pri:t.border}`,color:active?"#fff":t.sub}}>{children}</button>;
}

export default function CompanyIntel({customCompanies, t}) {
  const [query, setQuery] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const [filterVisa, setFilterVisa] = useState(false);

  const allCos = [...M628, ...customCompanies.filter(c => !M628.find(m => m.name === c.name))];

  const filtered = allCos.filter(c => {
    if (query.trim() && !c.name.toLowerCase().includes(query.toLowerCase()) && !(c.industry||"").toLowerCase().includes(query.toLowerCase())) return false;
    if (tierFilter !== "all" && c.tier !== parseInt(tierFilter)) return false;
    if (filterVisa && c.h1b !== "YES") return false;
    return true;
  });

  return (
    <div>
      <div style={{marginBottom:24}}>
        <h2 style={{margin:"0 0 4px",fontSize:24,fontWeight:700,color:t.tx}}>Company Intelligence</h2>
        <p style={{margin:0,fontSize:14,color:t.sub}}>{allCos.length} companies tracked{customCompanies.length>0?` (${customCompanies.length} custom added)`:""}</p>
      </div>

      <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
        <div style={{position:"relative",flex:1,minWidth:200}}>
          <Search size={15} color={t.muted} style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)"}}/>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search companies..." style={{width:"100%",background:t.card,border:`1px solid ${t.border}`,borderRadius:9,padding:"9px 14px 9px 36px",color:t.tx,fontSize:13.5,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
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
          const isCustom = customCompanies.find(x => x.name === c.name);
          return (
            <Card key={c.name} t={t} style={{padding:"16px 18px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div>
                  <div style={{fontSize:14.5,fontWeight:700,color:t.tx,marginBottom:2}}>
                    {c.name}
                    {isCustom && <span style={{fontSize:10,fontWeight:700,marginLeft:6,padding:"2px 6px",borderRadius:10,background:t.priL,color:t.pri}}>Custom</span>}
                  </div>
                  <div style={{fontSize:12.5,color:t.muted}}>{c.industry} · T{c.tier}</div>
                </div>
                <div style={{display:"flex",gap:5,flexShrink:0}}>
                  <span style={{fontSize:10.5,fontWeight:700,padding:"3px 8px",borderRadius:5,background:c.h1b==="YES"?t.greenL:t.yellowL,color:c.h1b==="YES"?t.green:t.yellow}}>H-1B: {c.h1b}</span>
                  {c.itar === "YES" && <span style={{fontSize:10.5,fontWeight:700,padding:"3px 8px",borderRadius:5,background:t.redL,color:t.red}}>ITAR</span>}
                </div>
              </div>
              {c.roles && <div style={{fontSize:12,color:t.muted}}>{c.roles}</div>}
              {c.atsBoardUrl && (
                <div style={{marginTop:8}}>
                  <a href={c.atsBoardUrl} target="_blank" rel="noreferrer" style={{fontSize:12,color:t.pri,textDecoration:"none",fontWeight:600}}>
                    {c.atsPlatform !== "Unknown" ? `Apply via ${c.atsPlatform}` : "Job Board"}
                  </a>
                </div>
              )}
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
    </div>
  );
}
