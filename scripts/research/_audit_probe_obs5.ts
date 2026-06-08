import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
function pct(arr:number[],p:number){const a=[...arr].sort((x,y)=>x-y);return a[Math.floor(p/100*(a.length-1))];}
function mean(a:number[]){return a.reduce((x,y)=>x+y,0)/(a.length||1);}

// Scanner funnel
const tokensSeen = (db.prepare("SELECT COUNT(*) n FROM tokens").get() as any).n;
const sigs = (db.prepare("SELECT COUNT(*) n FROM signals").get() as any).n;
// stage0 avoids: emptyScores => organic 0 (AVOID with scores all ~0)
const avoidStage0 = (db.prepare("SELECT COUNT(*) n FROM signals WHERE verdict='AVOID' AND json_extract(scores,'$.safety')=0").get() as any).n;
const avoidScored = (db.prepare("SELECT COUNT(*) n FROM signals WHERE verdict='AVOID' AND json_extract(scores,'$.safety')>0").get() as any).n;
console.log(`FUNNEL: tokens=${tokensSeen} signals=${sigs} | AVOID(stage0,safety=0)=${avoidStage0} AVOID(scored)=${avoidScored}`);

// Decision-time priceChange: snapshot.at within 15s of signal.at
const rows = db.prepare(`
  SELECT s.verdict, s.scores, t.last_snapshot snap, s.at sigat
  FROM signals s JOIN tokens t ON t.mint=s.mint
  WHERE t.last_snapshot IS NOT NULL AND s.verdict IN ('BUY_SMALL','BUY_STRONG','WATCH_ONLY')
`).all() as any[];
let near=0; const buyM5:number[]=[], buyH1:number[]=[], watchM5:number[]=[];
for(const r of rows){ let sn:any; try{sn=JSON.parse(r.snap);}catch{continue;}
  if(typeof sn.at!=="number" || Math.abs(sn.at - r.sigat)>15000) continue; near++;
  const m5=sn.priceChange?.m5, h1=sn.priceChange?.h1;
  if(r.verdict.startsWith("BUY")){ if(typeof m5==="number")buyM5.push(m5); if(typeof h1==="number")buyH1.push(h1); }
  else if(typeof m5==="number") watchM5.push(m5);
}
console.log(`Snapshots within 15s of signal: ${near}/${rows.length}`);
console.log(`BUY decision-time priceChange.m5: n=${buyM5.length} p25=${pct(buyM5,25)?.toFixed(1)} p50=${pct(buyM5,50)?.toFixed(1)} p75=${pct(buyM5,75)?.toFixed(1)} p90=${pct(buyM5,90)?.toFixed(1)} mean=${mean(buyM5).toFixed(1)} %>50%:${(100*buyM5.filter(x=>x>50).length/buyM5.length).toFixed(0)}%`);
console.log(`BUY decision-time priceChange.h1: n=${buyH1.length} p50=${pct(buyH1,50)?.toFixed(1)} p75=${pct(buyH1,75)?.toFixed(1)} p90=${pct(buyH1,90)?.toFixed(1)} %>100%:${(100*buyH1.filter(x=>x>100).length/buyH1.length).toFixed(0)}%`);

// Does decision-time m5 gain predict the 5m forward loss? bucket by m5-at-decision
const fwd = db.prepare(`
  SELECT s.scores, t.last_snapshot snap, s.at sigat, s.price_at_alert p0, s.price_5m p5
  FROM signals s JOIN tokens t ON t.mint=s.mint
  WHERE s.verdict LIKE 'BUY%' AND t.last_snapshot IS NOT NULL AND s.price_at_alert>0 AND s.price_5m>0
`).all() as any[];
const bk:Record<string,{n:number,sum:number,win:number}>={};
for(const r of fwd){ let sn:any; try{sn=JSON.parse(r.snap);}catch{continue;}
  if(typeof sn.at!=="number"||Math.abs(sn.at-r.sigat)>15000)continue;
  const m5=sn.priceChange?.m5; if(typeof m5!=="number")continue;
  const ret=(r.p5/r.p0-1)*100;
  const b=m5>=100?"m5>=100":m5>=30?"m5 30-99":m5>=0?"m5 0-29":"m5<0";
  (bk[b]??={n:0,sum:0,win:0}); bk[b].n++; bk[b].sum+=ret; if(ret>0)bk[b].win++; }
console.log("DECISION-TIME m5 gain -> forward 5m return:");
for(const [b,v] of Object.entries(bk)) console.log(`  ${b}: n=${v.n} fwd5m_mean=${(v.sum/v.n).toFixed(1)}% win=${(100*v.win/v.n).toFixed(0)}%`);
