import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

const pageSize = (db.pragma("page_size", { simple: true }) as number);
const pageCount = (db.pragma("page_count", { simple: true }) as number);
const freelist = (db.pragma("freelist_count", { simple: true }) as number);
const userVersion = (db.pragma("user_version", { simple: true }) as number);
console.log("page_size", pageSize, "page_count", pageCount, "freelist", freelist, "user_version", userVersion);
console.log("logical_MB", ((pageSize * pageCount) / 1e6).toFixed(2));

const tables = [
  "signals", "tokens", "token_fingerprints", "learning_features",
  "replay_events", "creator_history", "council_opinions", "paper_price_samples",
  "paper_trades", "paper_positions",
];
for (const t of tables) {
  try {
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    console.log("rows", t, n);
  } catch (e) {
    console.log("rows", t, "ERR", (e as Error).message);
  }
}

// time span of signals
const span = db.prepare("SELECT MIN(at) AS lo, MAX(at) AS hi, COUNT(*) AS n FROM signals").get() as { lo: number; hi: number; n: number };
const hours = (span.hi - span.lo) / 3.6e6;
console.log("signals_span_hours", hours.toFixed(2), "rate_per_hr", (span.n / hours).toFixed(1));

// indexes on signals
const idx = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='signals'").all();
console.log("signals_indexes", JSON.stringify(idx));

// resolved row count (the scan in stats win-rate)
const resolved = (db.prepare("SELECT COUNT(*) AS n FROM signals WHERE max_gain_pct IS NOT NULL").get() as { n: number }).n;
console.log("resolved_max_gain_not_null", resolved);

// Microbenchmark stats() + buyStats() at current size
function bench(label: string, fn: () => void, iters = 200) {
  // warm
  for (let i = 0; i < 5; i++) fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) fn();
  const t1 = process.hrtime.bigint();
  const usPerCall = Number(t1 - t0) / iters / 1000;
  console.log(`bench ${label}: ${usPerCall.toFixed(1)} us/call (${iters} iters)`);
}

const statsStmt1 = db.prepare("SELECT COUNT(*) AS n FROM signals");
const statsStmt2 = db.prepare("SELECT verdict, COUNT(*) AS n FROM signals GROUP BY verdict");
const statsStmt3 = db.prepare("SELECT max_gain_pct, max_drawdown_pct FROM signals WHERE max_gain_pct IS NOT NULL");
const buyStmt = db.prepare("SELECT max_gain_pct FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct IS NOT NULL");

bench("stats()", () => { statsStmt1.get(); statsStmt2.all(); statsStmt3.all(); });
bench("buyStats()", () => { buyStmt.all(); });

db.close();
