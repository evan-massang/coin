import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

const now = Date.now();
const H4 = 4 * 60 * 60 * 1000;

// 1) signals: BUY older than 70m, NULL price_15m / price_1h
const buyOld = db.prepare(`
  SELECT
    COUNT(*) AS n,
    SUM(CASE WHEN price_15m IS NULL THEN 1 ELSE 0 END) AS null15,
    SUM(CASE WHEN price_1h  IS NULL THEN 1 ELSE 0 END) AS null1h
  FROM signals
  WHERE verdict LIKE 'BUY%' AND at < ?
`).get(now - 70 * 60 * 1000) as any;
console.log("BUY signals >70m old:", buyOld);
if (buyOld.n > 0) {
  console.log("  null price_15m %:", (100 * buyOld.null15 / buyOld.n).toFixed(1));
  console.log("  null price_1h  %:", (100 * buyOld.null1h / buyOld.n).toFixed(1));
}

// 2) exit_reason population on BUY signals
const exitReason = db.prepare(`
  SELECT
    COUNT(*) AS n,
    SUM(CASE WHEN exit_reason IS NULL THEN 1 ELSE 0 END) AS nullReason
  FROM signals WHERE verdict LIKE 'BUY%'
`).get() as any;
console.log("BUY signals total / null exit_reason:", exitReason);

// distinct exit_reason values
const reasons = db.prepare(`SELECT exit_reason, COUNT(*) c FROM signals WHERE verdict LIKE 'BUY%' GROUP BY exit_reason`).all();
console.log("exit_reason distribution:", reasons);

// 3) SMOKING GUN: paper_positions still OPEN past 4h
const posCols = db.prepare(`PRAGMA table_info(paper_positions)`).all().map((c: any) => c.name);
console.log("paper_positions cols:", posCols.join(","));

const totalPos = db.prepare(`SELECT COUNT(*) n FROM paper_positions`).get() as any;
const openPos = db.prepare(`SELECT COUNT(*) n FROM paper_positions WHERE closed_at_ms IS NULL`).get() as any;
console.log("paper_positions total:", totalPos.n, "open:", openPos.n);

const openStale = db.prepare(`
  SELECT COUNT(*) n,
    MIN(entry_at_ms) oldest,
    MAX(entry_at_ms) newest
  FROM paper_positions
  WHERE closed_at_ms IS NULL AND entry_at_ms < ?
`).get(now - H4) as any;
console.log("OPEN positions older than 4h:", openStale.n);
if (openStale.n > 0) {
  console.log("  oldest open age (h):", ((now - openStale.oldest) / 3600000).toFixed(1));
  console.log("  newest stale age (h):", ((now - openStale.newest) / 3600000).toFixed(1));
}

// detail of the oldest open positions
const oldestOpen = db.prepare(`
  SELECT id, symbol, entry_at_ms, last_price_usd, entry_price_usd, sol_invested
  FROM paper_positions
  WHERE closed_at_ms IS NULL
  ORDER BY entry_at_ms ASC
  LIMIT 15
`).all() as any[];
console.log("oldest open positions:");
for (const p of oldestOpen) {
  const ageH = ((now - p.entry_at_ms) / 3600000).toFixed(1);
  const mult = p.entry_price_usd > 0 && p.last_price_usd ? (p.last_price_usd / p.entry_price_usd).toFixed(3) : "n/a";
  console.log(`  id=${p.id} ${p.symbol} age=${ageH}h mult=${mult} sol=${p.sol_invested}`);
}

// 4) when was the last price sample for the oldest open positions? (are they stale?)
const sampleStale = db.prepare(`
  SELECT p.id, p.symbol, ((? - p.entry_at_ms)/3600000.0) ageH,
    (SELECT MAX(at) FROM paper_price_samples s WHERE s.position_id = p.id) lastSample
  FROM paper_positions p
  WHERE p.closed_at_ms IS NULL AND p.entry_at_ms < ?
  ORDER BY p.entry_at_ms ASC
  LIMIT 15
`).all(now, now - H4) as any[];
console.log("stale-sample check (open >4h):");
for (const r of sampleStale) {
  const lastSampleAgo = r.lastSample ? ((now - r.lastSample) / 3600000).toFixed(1) + "h ago" : "NEVER";
  console.log(`  id=${r.id} ${r.symbol} age=${Number(r.ageH).toFixed(1)}h lastSample=${lastSampleAgo}`);
}

db.close();
