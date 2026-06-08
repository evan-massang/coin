import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
// join BUY signals to tokens; latency = signal.at - first_seen_at (and vs created_at)
const rows = db.prepare(`
  SELECT s.at AS sat, t.first_seen_at AS fs, t.created_at AS cr,
         s.max_gain_pct AS g, s.price_5m AS p5, s.price_at_alert AS pa
  FROM signals s JOIN tokens t ON t.mint = s.mint
  WHERE s.verdict IN ('BUY_SMALL','BUY_STRONG') AND s.max_gain_pct IS NOT NULL
`).all() as any[];
console.log("joined BUY rows:", rows.length);
function corr(xs:number[], ys:number[]){const n=xs.length;const mx=xs.reduce((a,b)=>a+b,0)/n;const my=ys.reduce((a,b)=>a+b,0)/n;let sxy=0,sxx=0,syy=0;for(let i=0;i<n;i++){const dx=xs[i]-mx,dy=ys[i]-my;sxy+=dx*dy;sxx+=dx*dx;syy+=dy*dy;}return sxy/Math.sqrt(sxx*syy);}
// latency vs first_seen
const fsRows = rows.filter(r=>r.fs!=null && r.sat!=null);
const latFs = fsRows.map(r=> (r.sat - r.fs)/1000); // seconds
console.log("latency-vs-first_seen available:", fsRows.length);
if(fsRows.length){
  const sl=[...latFs].sort((a,b)=>a-b);
  console.log("  latency sec: p10",sl[Math.floor(sl.length*.1)]?.toFixed(0),"median",sl[Math.floor(sl.length*.5)]?.toFixed(0),"p90",sl[Math.floor(sl.length*.9)]?.toFixed(0));
  console.log("  corr(latencyFS, max_gain):", corr(latFs, fsRows.map(r=>r.g)).toFixed(3));
}
// latency vs created_at (token birth)
const crRows = rows.filter(r=>r.cr!=null && r.sat!=null);
const latCr = crRows.map(r=> (r.sat - r.cr)/1000);
console.log("latency-vs-created available:", crRows.length);
if(crRows.length){
  const sl=[...latCr].sort((a,b)=>a-b);
  console.log("  birth-latency sec: p10",sl[Math.floor(sl.length*.1)]?.toFixed(0),"median",sl[Math.floor(sl.length*.5)]?.toFixed(0),"p90",sl[Math.floor(sl.length*.9)]?.toFixed(0));
  console.log("  corr(birthLatency, max_gain):", corr(latCr, crRows.map(r=>r.g)).toFixed(3));
}
// bucket analysis: does highest-latency bucket have worst outcome? (vs created_at)
if(crRows.length){
  const withL = crRows.map(r=>({l:(r.sat-r.cr)/1000, g:r.g})).sort((a,b)=>a.l-b.l);
  const q=Math.floor(withL.length/4);
  const buckets=[withL.slice(0,q),withL.slice(q,2*q),withL.slice(2*q,3*q),withL.slice(3*q)];
  buckets.forEach((b,i)=>{const mg=b.reduce((a,x)=>a+x.g,0)/b.length;const ml=b.reduce((a,x)=>a+x.l,0)/b.length;const winr=b.filter(x=>x.g>=100).length/b.length*100;console.log(`  birth-latency Q${i+1}: medLat~${ml.toFixed(0)}s avgGain=${mg.toFixed(0)}% pct>=100%=${winr.toFixed(0)}%`);});
}
db.close();
