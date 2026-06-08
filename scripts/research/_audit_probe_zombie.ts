import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

// 1. Verify the signals NULL-price rates claimed in the finding.
const buys = db.prepare(
  `SELECT COUNT(*) n FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND price_at_alert IS NOT NULL`
).get() as any;
const null15 = db.prepare(
  `SELECT COUNT(*) n FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND price_at_alert IS NOT NULL AND price_15m IS NULL`
).get() as any;
const null1h = db.prepare(
  `SELECT COUNT(*) n FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND price_at_alert IS NOT NULL AND price_1h IS NULL`
).get() as any;
const have1h = db.prepare(
  `SELECT COUNT(*) n FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND price_at_alert IS NOT NULL AND price_1h IS NOT NULL`
).get() as any;

console.log("=== signals NULL-price rates (BUY signals, priced at alert) ===");
console.log("total BUY w/ price_at_alert:", buys.n);
console.log("price_15m NULL:", null15.n, `(${(100*null15.n/buys.n).toFixed(1)}%)`);
console.log("price_1h  NULL:", null1h.n, `(${(100*null1h.n/buys.n).toFixed(1)}%)`);
console.log("price_1h  present:", have1h.n, `(${(100*have1h.n/buys.n).toFixed(1)}%)`);

// 2. CRITICAL test: do zombie OPEN paper positions actually exist?
const maxHoldMin = 240; // finding says time-stop = 4h
const now = Date.now();
const openPos = db.prepare(
  `SELECT id, mint, symbol, entry_at_ms, last_price_usd, closed_at_ms FROM paper_positions WHERE closed_at_ms IS NULL`
).all() as any[];
console.log("\n=== OPEN paper positions ===");
console.log("open count:", openPos.length);
let stuck = 0;
for (const p of openPos) {
  const ageMin = (now - p.entry_at_ms) / 60000;
  if (ageMin > maxHoldMin) {
    stuck++;
    if (stuck <= 20) console.log(`  STUCK id=${p.id} ${p.symbol} age=${ageMin.toFixed(0)}min last_price=${p.last_price_usd}`);
  }
}
console.log(`positions older than ${maxHoldMin}min (4h) still OPEN:`, stuck, `of ${openPos.length}`);

// 3. Age distribution of open positions
if (openPos.length) {
  const ages = openPos.map(p => (now - p.entry_at_ms)/60000).sort((a,b)=>a-b);
  const q = (f:number)=>ages[Math.min(ages.length-1, Math.floor(f*ages.length))].toFixed(0);
  console.log(`open age min/med/p90/max (min): ${ages[0].toFixed(0)} / ${q(0.5)} / ${q(0.9)} / ${ages[ages.length-1].toFixed(0)}`);
}

// 4. Among CLOSED positions, how many exited by time-stop / stop-loss vs other?
const reasons = db.prepare(
  `SELECT reason, COUNT(*) n FROM paper_trades WHERE side='sell' GROUP BY reason ORDER BY n DESC`
).all() as any[];
console.log("\n=== paper sell reasons ===");
for (const r of reasons) console.log(`  ${r.reason}: ${r.n}`);

// 5. Total open SOL "locked" and last_price staleness check
const inv = db.prepare(
  `SELECT COALESCE(SUM(sol_invested),0) s, COUNT(*) n FROM paper_positions WHERE closed_at_ms IS NULL`
).get() as any;
console.log("\n=== capital locked in OPEN positions ===");
console.log("sol_invested sum (open):", inv.s, "across", inv.n, "positions");

db.close();
