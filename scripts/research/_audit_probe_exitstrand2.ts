import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const now = Date.now();

// closed positions: lifetime distribution
const closed = db.prepare(`
  SELECT id, symbol, entry_at_ms, closed_at_ms,
    (closed_at_ms - entry_at_ms)/60000.0 AS lifeMin,
    realized_pnl_usd, last_price_usd, entry_price_usd
  FROM paper_positions
  WHERE closed_at_ms IS NOT NULL
  ORDER BY (closed_at_ms - entry_at_ms) DESC
`).all() as any[];
console.log("closed positions:", closed.length);
console.log("longest-lived closed positions:");
for (const p of closed.slice(0, 12)) {
  console.log(`  id=${p.id} ${p.symbol} life=${p.lifeMin.toFixed(1)}min pnl_usd=${p.realized_pnl_usd}`);
}

// how many closed positions lived past 4h (240 min)?
const past4h = closed.filter((p) => p.lifeMin > 240);
console.log("closed positions that lived >4h:", past4h.length);

// paper_trades: reason distribution (this is where exit reasons actually live)
const tradeReasons = db.prepare(`
  SELECT side, reason, COUNT(*) c FROM paper_trades GROUP BY side, reason ORDER BY c DESC
`).all();
console.log("paper_trades side/reason distribution:");
for (const r of tradeReasons as any[]) console.log(`  ${r.side} | ${r.reason} | ${r.c}`);

// time span of DB activity
const span = db.prepare(`
  SELECT MIN(entry_at_ms) a, MAX(entry_at_ms) b FROM paper_positions
`).get() as any;
console.log("position entry span (h):", ((span.b - span.a)/3600000).toFixed(1),
  "| oldest entry age (h):", ((now - span.a)/3600000).toFixed(1));

// signals journal time span
const sigSpan = db.prepare(`SELECT MIN(at) a, MAX(at) b FROM signals WHERE verdict LIKE 'BUY%'`).get() as any;
console.log("BUY signals span (h):", ((sigSpan.b - sigSpan.a)/3600000).toFixed(1),
  "| newest BUY age (h):", ((now - sigSpan.b)/3600000).toFixed(1));

db.close();
