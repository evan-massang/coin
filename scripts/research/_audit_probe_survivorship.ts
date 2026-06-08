import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

// 1. Open vs closed positions
const posCounts = db.prepare(`
  SELECT CASE WHEN closed_at_ms IS NULL THEN 'OPEN' ELSE 'CLOSED' END AS state, COUNT(*) AS n
  FROM paper_positions GROUP BY state
`).all();
console.log("position states:", JSON.stringify(posCounts));

// 2. Realized PnL in SOL from paper_trades
const realized = db.prepare(`SELECT COALESCE(SUM(realized_pnl_sol),0) AS r FROM paper_trades`).get() as { r: number };
console.log("realized SOL (sum paper_trades.realized_pnl_sol):", realized.r);

// 3. Realized from closed positions (realized_pnl_usd) - need sol; compute pct-based
// Unrealized from open positions: (last_price/entry - 1) * sol_invested
const openPos = db.prepare(`
  SELECT entry_price_usd, last_price_usd, sol_invested, token_amount, initial_token_amount
  FROM paper_positions WHERE closed_at_ms IS NULL
`).all() as Array<{ entry_price_usd: number; last_price_usd: number; sol_invested: number; token_amount: number; initial_token_amount: number }>;

let unreal = 0;
let openDown50 = 0;
let openTotal = 0;
let nullPrice = 0;
for (const p of openPos) {
  openTotal++;
  if (p.last_price_usd && p.entry_price_usd > 0) {
    const mult = p.last_price_usd / p.entry_price_usd;
    // approximate: remaining token fraction value vs invested
    unreal += (mult - 1) * p.sol_invested;
    if (mult <= 0.5) openDown50++;
  } else {
    nullPrice++;
  }
}
console.log("open positions:", openTotal, "| unrealized SOL (rough, full sol_invested basis):", unreal.toFixed(4));
console.log("open down >50% (mult<=0.5):", openDown50, "| open with null/zero price:", nullPrice);

// 4. distribution of open position multiples
const buckets = { "<=0.5": 0, "0.5-0.8": 0, "0.8-1.0": 0, "1.0-1.5": 0, "1.5-3": 0, ">3": 0 };
for (const p of openPos) {
  if (!p.last_price_usd || !(p.entry_price_usd > 0)) continue;
  const m = p.last_price_usd / p.entry_price_usd;
  if (m <= 0.5) buckets["<=0.5"]++;
  else if (m <= 0.8) buckets["0.5-0.8"]++;
  else if (m <= 1.0) buckets["0.8-1.0"]++;
  else if (m <= 1.5) buckets["1.0-1.5"]++;
  else if (m <= 3) buckets["1.5-3"]++;
  else buckets[">3"]++;
}
console.log("open multiple buckets:", JSON.stringify(buckets));

// 5. closed positions realized_pnl_usd sign distribution (win rate basis)
const closedPos = db.prepare(`
  SELECT realized_pnl_usd, entry_price_usd, last_price_usd
  FROM paper_positions WHERE closed_at_ms IS NOT NULL
`).all() as Array<{ realized_pnl_usd: number; entry_price_usd: number; last_price_usd: number }>;
let cw = 0, cl = 0, cz = 0;
for (const p of closedPos) {
  if (p.realized_pnl_usd > 0) cw++;
  else if (p.realized_pnl_usd < 0) cl++;
  else cz++;
}
console.log("closed:", closedPos.length, "| realized>0:", cw, "| <0:", cl, "| ==0:", cz,
  "| winRate(closed):", closedPos.length ? (cw/closedPos.length).toFixed(3) : "n/a");

// 6. closed exit reasons
const reasons = db.prepare(`
  SELECT reason, COUNT(*) n FROM paper_trades WHERE side='sell' OR side='SELL' GROUP BY reason ORDER BY n DESC
`).all();
console.log("sell reasons:", JSON.stringify(reasons));

db.close();
