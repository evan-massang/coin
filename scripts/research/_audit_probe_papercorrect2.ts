import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const one = (sql:string,...a:any[])=>db.prepare(sql).get(...a) as any;
const all = (sql:string,...a:any[])=>db.prepare(sql).all(...a) as any[];

// Reference "now" = latest activity timestamp in the DB
const tmax = one("SELECT MAX(m) m FROM (SELECT MAX(at) m FROM paper_trades UNION SELECT MAX(at) m FROM paper_price_samples UNION SELECT MAX(updated_at) m FROM paper_wallet)").m as number;
console.log("REF_NOW(ms)=", tmax, "=>", new Date(tmax).toISOString());

// Position age distribution (OPEN/PARTIAL only)
const ageRows = all("SELECT status, entry_at_ms, last_price_usd, entry_price_usd, peak_price_usd, sol_invested, token_amount, id FROM paper_positions WHERE status IN ('OPEN','PARTIAL')");
const ages = ageRows.map(r=>(tmax - r.entry_at_ms)/60000); // minutes
ages.sort((a,b)=>a-b);
const pct=(p:number)=>ages[Math.min(ages.length-1,Math.floor(p*ages.length))];
console.log("OPEN/PARTIAL count=",ages.length,"age(min) min/median/p90/max=", ages[0]?.toFixed(1), pct(0.5)?.toFixed(1), pct(0.9)?.toFixed(1), ages[ages.length-1]?.toFixed(1));

// max hold setting
const setRow = all("SELECT key,value FROM settings WHERE key IN ('maxHoldMinutes','stopLossPct','paperEnabled','paperStartingBalanceSol')");
console.log("SETTINGS:", JSON.stringify(setRow));

// OPEN/PARTIAL older than 240 min (4h) — should have hit time-stop but didn't
const stale4h = ageRows.filter(r=>(tmax-r.entry_at_ms)/60000 > 240);
console.log("OPEN/PARTIAL older than 240min (time-stop should have fired):", stale4h.length, "of", ageRows.length);

// Of OPEN/PARTIAL, how many have last_price_usd == entry_price_usd (never re-priced)
const neverPriced = ageRows.filter(r=> r.last_price_usd === r.entry_price_usd);
console.log("OPEN/PARTIAL never re-priced (last==entry):", neverPriced.length);
const peakEqEntry = ageRows.filter(r=> r.peak_price_usd === r.entry_price_usd);
console.log("OPEN/PARTIAL peak==entry (never went up):", peakEqEntry.length);

// price samples coverage for OPEN/PARTIAL positions
const ids = ageRows.map(r=>r.id);
const ph = ids.map(()=>"?").join(",");
const sampCounts = all(`SELECT position_id, COUNT(*) n, MAX(at) lastat, MIN(at) firstat FROM paper_price_samples WHERE position_id IN (${ph}) GROUP BY position_id`, ...ids);
const sampMap = new Map(sampCounts.map(s=>[s.position_id,s]));
const zeroSamp = ageRows.filter(r=>!sampMap.has(r.id));
console.log("OPEN/PARTIAL with ZERO price samples (never priced by exit engine):", zeroSamp.length);
// For positions WITH samples, when was the last sample vs ref_now (staleness)
const lastSampAges = sampCounts.map(s=>(tmax - s.lastat)/60000).sort((a,b)=>a-b);
if(lastSampAges.length) console.log("last-sample age(min) for sampled OPEN pos: min/median/max=", lastSampAges[0].toFixed(1), lastSampAges[Math.floor(lastSampAges.length/2)].toFixed(1), lastSampAges[lastSampAges.length-1].toFixed(1));

// How many OPEN/PARTIAL had their LAST sample > 4h ago but still open (price feed dropped them => stuck)
const stuckSampled = sampCounts.filter(s=>(tmax - s.lastat)/60000 > 60);
console.log("OPEN/PARTIAL whose last price sample is >60min stale (feed likely dropped them):", stuckSampled.length);
