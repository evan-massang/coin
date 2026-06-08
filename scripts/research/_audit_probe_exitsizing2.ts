import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

// ── Position sizing: distribution of buy sol_amount and per-position outcome ──
console.log("=== buy size distribution (sol_amount) ===");
console.log(db.prepare(`
  SELECT ROUND(MIN(sol_amount),4) min, ROUND(MAX(sol_amount),4) max,
         ROUND(AVG(sol_amount),4) avg, COUNT(*) n
  FROM paper_trades WHERE side='buy'`).get());

// Buy size by reason (verdict) — does BUY_STRONG actually size larger?
console.log("\n=== buy size by verdict (reason on buy row) ===");
console.table(db.prepare(`
  SELECT reason, COUNT(*) n, ROUND(AVG(sol_amount),4) avg_size,
         ROUND(MIN(sol_amount),4) min, ROUND(MAX(sol_amount),4) max
  FROM paper_trades WHERE side='buy' GROUP BY reason ORDER BY n DESC`).all());

// ── Per-position net realized PnL (sum of sells) keyed by position lifecycle ──
// A position = one mint's open->close cycle. Use paper_positions for entry context.
console.log("\n=== paper_positions: status distribution ===");
console.log(db.prepare("SELECT status, COUNT(*) n FROM paper_positions GROUP BY status").all());

// Net realized per closed position (join trades by mint within position window)
type Pos = {
  id: number; mint: string; symbol: string | null; status: string;
  entry_at_ms: number; closed_at_ms: number | null; sol_invested: number;
  realized_pnl_usd: number | null; entry_price_usd: number; peak_price_usd: number; last_price_usd: number;
};
const positions = db.prepare(`SELECT id,mint,symbol,status,entry_at_ms,closed_at_ms,sol_invested,realized_pnl_usd,entry_price_usd,peak_price_usd,last_price_usd FROM paper_positions`).all() as Pos[];

// For each position, gather its sell trades within [entry, closed||now]
const sellsByMint = db.prepare(`SELECT mint, side, sol_amount, realized_pnl_sol, reason, at FROM paper_trades WHERE side='sell' ORDER BY at`).all() as any[];

let netClosed = 0, nClosed = 0, nOpen = 0, winners = 0, losers = 0;
const perPos: { sym: string; net: number; peakMult: number; sol: number; status: string }[] = [];
for (const p of positions) {
  const end = p.closed_at_ms ?? Number.MAX_SAFE_INTEGER;
  const sells = sellsByMint.filter((s) => s.mint === p.mint && s.at >= p.entry_at_ms && s.at <= end);
  const net = sells.reduce((a, s) => a + (s.realized_pnl_sol ?? 0), 0);
  const peakMult = p.entry_price_usd > 0 ? p.peak_price_usd / p.entry_price_usd : 0;
  perPos.push({ sym: p.symbol ?? p.mint.slice(0, 6), net, peakMult, sol: p.sol_invested, status: p.status });
  if (p.status === "closed") {
    netClosed += net; nClosed++;
    if (net > 0) winners++; else losers++;
  } else nOpen++;
}
console.log(`\n=== per-position (closed) net realized SOL ===`);
console.log(`closed: ${nClosed}, open: ${nOpen}, net realized (closed): ${netClosed.toFixed(4)} SOL`);
console.log(`winners: ${winners}, losers: ${losers}, win-rate: ${((winners/nClosed)*100).toFixed(1)}%`);

// peak multiple reached vs outcome — how many positions EVER hit 2x (ladder rung 1)?
const hit2x = perPos.filter((p) => p.peakMult >= 2).length;
const hit3x = perPos.filter((p) => p.peakMult >= 3).length;
const hit5x = perPos.filter((p) => p.peakMult >= 5).length;
const hit15 = perPos.filter((p) => p.peakMult >= 1.5).length;
console.log(`\n=== peak multiple reached (all ${positions.length} positions) ===`);
console.log(`>=1.5x: ${hit15} (${((hit15/positions.length)*100).toFixed(1)}%)  >=2x: ${hit2x} (${((hit2x/positions.length)*100).toFixed(1)}%)  >=3x: ${hit3x}  >=5x: ${hit5x}`);

// Distribution of peak multiple buckets
const buckets = { "<1x (never green)": 0, "1-1.5x": 0, "1.5-2x": 0, "2-3x": 0, "3-5x": 0, ">=5x": 0 };
for (const p of perPos) {
  const m = p.peakMult;
  if (m < 1) buckets["<1x (never green)"]++;
  else if (m < 1.5) buckets["1-1.5x"]++;
  else if (m < 2) buckets["1.5-2x"]++;
  else if (m < 3) buckets["2-3x"]++;
  else if (m < 5) buckets["3-5x"]++;
  else buckets[">=5x"]++;
}
console.log("\n=== peak multiple buckets ===");
console.table(buckets);

db.close();
