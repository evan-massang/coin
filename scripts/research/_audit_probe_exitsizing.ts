import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

function cols(t: string) {
  const c = db.prepare(`PRAGMA table_info(${t})`).all() as any[];
  console.log(`\n=== ${t} columns ===`);
  for (const x of c) console.log(`  ${x.name}\t${x.type}`);
}
cols("paper_trades");
cols("paper_positions");
cols("paper_price_samples");

const count = (t: string) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as any).n;
console.log("\n=== row counts ===");
for (const t of ["paper_trades", "paper_positions", "paper_price_samples", "signals"]) {
  console.log(`  ${t}: ${count(t)}`);
}

// ── paper_trades: realized PnL by side and reason ──
console.log("\n=== paper_trades: side distribution ===");
console.log(db.prepare("SELECT side, COUNT(*) n FROM paper_trades GROUP BY side").all());

console.log("\n=== paper_trades SELL: realized_pnl_sol by reason ===");
const byReason = db.prepare(`
  SELECT reason,
         COUNT(*) n,
         ROUND(SUM(realized_pnl_sol),4) sum_pnl,
         ROUND(AVG(realized_pnl_sol),5) avg_pnl,
         ROUND(MIN(realized_pnl_sol),4) min_pnl,
         ROUND(MAX(realized_pnl_sol),4) max_pnl
  FROM paper_trades
  WHERE side='sell'
  GROUP BY reason
  ORDER BY n DESC
`).all();
console.table(byReason);

console.log("\n=== TOTAL realized PnL (all sells) ===");
console.log(db.prepare("SELECT ROUND(SUM(realized_pnl_sol),4) total, COUNT(*) n FROM paper_trades WHERE side='sell'").get());

// Group exit reason into buckets (stop loss / trailing / ladder / time / hard)
console.log("\n=== exit reason buckets (sells) ===");
const sells = db.prepare("SELECT realized_pnl_sol, reason FROM paper_trades WHERE side='sell'").all() as any[];
const bucket = (r: string) => {
  const s = (r || "").toLowerCase();
  if (s.includes("stop loss") || s.includes("stop-loss")) return "stop_loss_45";
  if (s.includes("trailing")) return "trailing_stop";
  if (s.includes("profit ladder") || s.includes("ladder")) return "profit_ladder";
  if (s.includes("time stop")) return "time_stop";
  if (s.includes("hard exit")) return "hard_exit";
  return `other:${r}`;
};
const agg: Record<string, { n: number; sum: number; wins: number }> = {};
for (const s of sells) {
  const b = bucket(s.reason);
  agg[b] ??= { n: 0, sum: 0, wins: 0 };
  agg[b].n++;
  agg[b].sum += s.realized_pnl_sol ?? 0;
  if ((s.realized_pnl_sol ?? 0) > 0) agg[b].wins++;
}
console.table(
  Object.entries(agg).map(([k, v]) => ({
    bucket: k,
    n: v.n,
    sum_pnl: +v.sum.toFixed(4),
    avg_pnl: +(v.sum / v.n).toFixed(5),
    win_rate: +((v.wins / v.n) * 100).toFixed(1),
  })),
);

db.close();
