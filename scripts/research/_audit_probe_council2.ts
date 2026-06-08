import Database from "better-sqlite3";
import path from "path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const q = (s:string,...a:unknown[])=>db.prepare(s).all(...a) as Record<string,unknown>[];
const one = (s:string,...a:unknown[])=>db.prepare(s).get(...a) as Record<string,unknown>;

console.log("=== reconcile the '238' bought denominator ===");
console.log("paper_positions distinct mints:", one("SELECT COUNT(DISTINCT mint) c FROM paper_positions").c);
console.log("paper_trades distinct mints:", one("SELECT COUNT(DISTINCT mint) c FROM paper_trades").c);
console.log("paper_trades side breakdown:");
for (const r of q("SELECT side, COUNT(*) n, COUNT(DISTINCT mint) m FROM paper_trades GROUP BY side")) console.log(`  ${r.side}: rows=${r.n} mints=${r.m}`);

console.log("\n=== delay distribution (BUY signal -> first council opinion) ===");
const timing = q(`SELECT s.mint, MIN(s.at) sig_at, (SELECT MIN(co.at) FROM council_opinions co WHERE co.mint=s.mint) co_at
  FROM signals s WHERE s.verdict LIKE 'BUY%' AND s.mint IN (SELECT DISTINCT mint FROM council_opinions) GROUP BY s.mint`);
const delays = timing.map(r=>(Number(r.co_at)-Number(r.sig_at))/60000).sort((a,b)=>a-b);
let before=0; for (const d of delays) if (d<0) before++;
console.log(`pairs=${delays.length} BEFORE=${before} AT/AFTER=${delays.length-before}`);
if (delays.length) console.log(`delay min=${delays[0].toFixed(2)}m median=${delays[Math.floor(delays.length/2)].toFixed(2)}m max=${delays[delays.length-1].toFixed(2)}m`);

console.log("\n=== engine verdicts of DEBATED mints (distinct mint, by best verdict) ===");
// each debated mint -> its set of verdicts; count mints whose verdicts include a BUY
const debated = q("SELECT DISTINCT mint FROM council_opinions").map(r=>r.mint as string);
let everBuy=0, hasSignal=0, noSignal=0;
const vcount: Record<string,number> = {};
for (const m of debated) {
  const verds = q("SELECT DISTINCT verdict FROM signals WHERE mint=?", m).map(r=>r.verdict as string);
  if (verds.length===0){noSignal++;continue;}
  hasSignal++;
  if (verds.some(v=>v.startsWith("BUY"))) everBuy++;
  for (const v of verds) vcount[v]=(vcount[v]||0)+1;
}
console.log(`debated total=${debated.length} hasSignalRow=${hasSignal} noSignalRow=${noSignal}`);
console.log(`debated mints EVER buy-rated=${everBuy}/${hasSignal} (${(100*everBuy/hasSignal).toFixed(1)}%)`);
console.log("verdict membership counts (mint had >=1 row of that verdict):");
for (const [k,v] of Object.entries(vcount).sort((a,b)=>b[1]-a[1])) console.log(`  ${k}: ${v}`);
db.close();
