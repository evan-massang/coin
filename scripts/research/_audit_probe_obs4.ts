import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

// 1. Observe latency: token.first_seen_at vs created_at, and signal.at vs first_seen_at
const lat = db.prepare(`
  SELECT (s.at - t.first_seen_at)/1000.0 AS decLatSec,
         (t.first_seen_at - t.created_at)/1000.0 AS bornToSeenSec, s.verdict
  FROM signals s JOIN tokens t ON t.mint = s.mint
  WHERE t.first_seen_at IS NOT NULL AND s.verdict IN ('BUY_SMALL','BUY_STRONG','WATCH_ONLY')
`).all() as any[];
function pct(arr:number[],p:number){ const a=[...arr].sort((x,y)=>x-y); return a[Math.floor(p/100*(a.length-1))]; }
const decBuy = lat.filter(r=>r.verdict.startsWith("BUY")).map(r=>r.decLatSec).filter(x=>x>=0&&x<3600);
const decWatch = lat.filter(r=>r.verdict==="WATCH_ONLY").map(r=>r.decLatSec).filter(x=>x>=0&&x<3600);
console.log(`DECISION LATENCY (firstSeen->signal) sec  BUY: n=${decBuy.length} p25=${pct(decBuy,25)?.toFixed(0)} p50=${pct(decBuy,50)?.toFixed(0)} p75=${pct(decBuy,75)?.toFixed(0)} p95=${pct(decBuy,95)?.toFixed(0)}`);
console.log(`DECISION LATENCY WATCH: n=${decWatch.length} p50=${pct(decWatch,50)?.toFixed(0)} p95=${pct(decWatch,95)?.toFixed(0)}`);
const born = lat.map(r=>r.bornToSeenSec).filter(x=>x>=0&&x<86400);
console.log(`BORN->FIRSTSEEN sec: n=${born.length} p50=${pct(born,50)?.toFixed(0)} p95=${pct(born,95)?.toFixed(0)}  (negative/zero ratio: ${(100*lat.filter(r=>r.bornToSeenSec<=0).length/lat.length).toFixed(0)}%)`);

// 2. coverage column distribution
const cov = db.prepare("SELECT verdict, coverage FROM signals WHERE coverage IS NOT NULL").all() as any[];
const covBuy = cov.filter(r=>r.verdict.startsWith("BUY")).map(r=>r.coverage);
const covAll = cov.map(r=>r.coverage);
function mean(a:number[]){return a.reduce((x,y)=>x+y,0)/a.length;}
console.log(`COVERAGE column: BUY n=${covBuy.length} mean=${mean(covBuy).toFixed(3)} p50=${pct(covBuy,50)?.toFixed(3)} ; ALL mean=${mean(covAll).toFixed(3)}`);

// 3. Loser tail for BUYs: price_5m vs price_at_alert
const px = db.prepare(`SELECT scores, price_at_alert p0, price_5m p5, price_15m p15, price_1h p60, max_gain_pct mg, max_drawdown_pct md
  FROM signals WHERE verdict LIKE 'BUY%' AND price_at_alert IS NOT NULL`).all() as any[];
function ret(p0:number,p:number){ return p0>0 && p>0 ? (p/p0-1)*100 : null; }
const r5 = px.map(r=>ret(r.p0,r.p5)).filter(x=>x!==null) as number[];
const r60 = px.map(r=>ret(r.p0,r.p60)).filter(x=>x!==null) as number[];
console.log(`BUY 5m return: n=${r5.length} mean=${mean(r5).toFixed(1)}% p25=${pct(r5,25)?.toFixed(1)} p50=${pct(r5,50)?.toFixed(1)} p75=${pct(r5,75)?.toFixed(1)} winrate(>0)=${(100*r5.filter(x=>x>0).length/r5.length).toFixed(1)}%`);
console.log(`BUY 1h return: n=${r60.length} mean=${mean(r60).toFixed(1)}% p50=${pct(r60,50)?.toFixed(1)} winrate=${(100*r60.filter(x=>x>0).length/r60.length).toFixed(1)}%`);

// 4. momentum-bucketed 5m winrate (does momentum facet select winners?)
const buckets: Record<string,{n:number,win:number,sum:number}> = {};
for (const r of px){ const m=JSON.parse(r.scores).momentum; const ret5=ret(r.p0,r.p5); if(ret5===null)continue;
  const b = m>=85?"85+":m>=75?"75-84":m>=65?"65-74":"<65"; (buckets[b]??={n:0,win:0,sum:0}); buckets[b].n++; buckets[b].sum+=ret5; if(ret5>0)buckets[b].win++; }
console.log("MOMENTUM bucket -> 5m return:");
for (const [b,v] of Object.entries(buckets)) console.log(`  mom ${b}: n=${v.n} mean5m=${(v.sum/v.n).toFixed(1)}% win=${(100*v.win/v.n).toFixed(1)}%`);

// 5. snapshot priceChange/txns presence
const snaps = db.prepare("SELECT last_snapshot FROM tokens WHERE last_snapshot LIKE '%priceChange%' LIMIT 1").all() as any[];
console.log("snapshots with priceChange field:", (db.prepare("SELECT COUNT(*) n FROM tokens WHERE last_snapshot LIKE '%priceChange%'").get() as any).n);
console.log("snapshots with txns field:", (db.prepare("SELECT COUNT(*) n FROM tokens WHERE last_snapshot LIKE '%txns%'").get() as any).n);
console.log("total tokens w/ snapshot:", (db.prepare("SELECT COUNT(*) n FROM tokens WHERE last_snapshot IS NOT NULL").get() as any).n);
if(snaps[0]) console.log("priceChange snapshot:", String(snaps[0].last_snapshot).slice(0,500));
