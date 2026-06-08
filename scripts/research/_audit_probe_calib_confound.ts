import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const TRADED = "verdict IN ('BUY_SMALL','BUY_STRONG')";

type Row = { at: number; conviction: number; max_gain_pct: number | null; max_drawdown_pct: number | null; price_at_alert: number | null; price_1h: number | null };
const rows = db.prepare(`SELECT at, conviction, max_gain_pct, max_drawdown_pct, price_at_alert, price_1h FROM signals WHERE ${TRADED} AND conviction IS NOT NULL`).all() as Row[];

const lo = Math.min(...rows.map(r => r.at));
const hi = Math.max(...rows.map(r => r.at));
// median time position per bucket -> is high conviction concentrated late?
function band(c: number){ if(c>=55&&c<59)return "55-58"; if(c===59)return "59"; if(c>=60&&c<72)return "60-71"; if(c>=72)return "72+"; return "other"; }
const bands: Record<string, number[]> = {};
for(const r of rows){ const b=band(r.conviction); (bands[b]??=[]).push((r.at-lo)/(hi-lo)); }
console.log("Time-position (0=oldest,1=newest) by conviction band:");
for(const b of ["55-58","59","60-71","72+"]){ const xs=bands[b]??[]; if(!xs.length){console.log(`  ${b}: none`);continue;} const s=[...xs].sort((a,c)=>a-c); const med=s[Math.floor(s.length/2)]!; const mean=xs.reduce((a,c)=>a+c,0)/xs.length; console.log(`  ${b}: n=${xs.length} meanPos=${mean.toFixed(2)} medPos=${med.toFixed(2)}`); }

// Split timeline into 4 quartiles by time; within EACH time-quartile compare 72+ vs (59 or 60-71) fwd1h & DD
function fwd1h(r: Row){ if(r.price_at_alert==null||r.price_at_alert<=0||r.price_1h==null)return null; return (r.price_1h-r.price_at_alert)/r.price_at_alert; }
const sorted=[...rows].sort((a,b)=>a.at-b.at);
const q=Math.ceil(sorted.length/4);
console.log("\nWithin-time-quartile: high(72+) vs mid(60-71) vs peg(59) — meanFwd1h% / meanDD% / 2x%");
for(let i=0;i<4;i++){
  const seg=sorted.slice(i*q,(i+1)*q);
  console.log(` Q${i+1} (n=${seg.length}, ${new Date(seg[0]!.at).toISOString().slice(5,16)}..${new Date(seg[seg.length-1]!.at).toISOString().slice(5,16)}):`);
  for(const b of ["59","60-71","72+"]){
    const xs=seg.filter(r=>band(r.conviction)===b);
    if(!xs.length){console.log(`   ${b}: none`);continue;}
    const fwds=xs.map(fwd1h).filter((x):x is number=>x!=null);
    const mF=fwds.length?fwds.reduce((a,c)=>a+c,0)/fwds.length*100:NaN;
    const dds=xs.map(r=>r.max_drawdown_pct).filter((x):x is number=>x!=null);
    const mDD=dds.length?dds.reduce((a,c)=>a+c,0)/dds.length:NaN;
    const res=xs.filter(r=>r.max_gain_pct!=null);
    const tx=res.length?100*res.filter(r=>(r.max_gain_pct??0)>=100).length/res.length:NaN;
    console.log(`   ${b}: n=${xs.length} fwd1h=${isNaN(mF)?"n/a":mF.toFixed(1)} (nF=${fwds.length}) DD=${isNaN(mDD)?"n/a":mDD.toFixed(1)} 2x=${isNaN(tx)?"n/a":tx.toFixed(1)}`);
  }
}
db.close();
