import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

console.log("=== CURRENT live counts ===");
for (const t of ["paper_trades", "paper_positions", "paper_price_samples", "signals"]) {
  console.log(`  ${t}: ${(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as any).n}`);
}

// ── STABLE EVIDENCE: signals table is append-only. Exit calibration on traded BUYs ──
// Each traded BUY records max_gain_pct (peak), max_drawdown_pct (from peak), exit_reason, hypothetical_pnl_sol.
console.log("\n=== signals: traded BUYs with resolved outcomes ===");
const tradedResolved = db.prepare(`
  SELECT COUNT(*) n,
         SUM(CASE WHEN max_gain_pct IS NOT NULL THEN 1 ELSE 0 END) has_gain,
         SUM(CASE WHEN hypothetical_pnl_sol IS NOT NULL THEN 1 ELSE 0 END) has_pnl,
         SUM(CASE WHEN exit_reason IS NOT NULL THEN 1 ELSE 0 END) has_exit
  FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')`).get();
console.log(tradedResolved);

// exit_reason distribution on traded BUYs + mean hypothetical PnL per exit reason
console.log("\n=== exit_reason buckets on traded BUYs (hypothetical_pnl_sol) ===");
const rows = db.prepare(`
  SELECT exit_reason, hypothetical_pnl_sol, max_gain_pct, max_drawdown_pct
  FROM signals
  WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND hypothetical_pnl_sol IS NOT NULL`).all() as any[];
const bucket = (r: string) => {
  const s = (r || "").toLowerCase();
  if (s.includes("stop loss") || s.includes("stop-loss")) return "stop_loss";
  if (s.includes("trailing")) return "trailing";
  if (s.includes("ladder")) return "ladder";
  if (s.includes("time")) return "time_stop";
  if (s.includes("hard")) return "hard_exit";
  if (!r) return "(null/open)";
  return `other:${r}`;
};
const agg: Record<string, { n: number; sum: number; w: number }> = {};
for (const r of rows) {
  const b = bucket(r.exit_reason);
  agg[b] ??= { n: 0, sum: 0, w: 0 };
  agg[b].n++; agg[b].sum += r.hypothetical_pnl_sol ?? 0; if ((r.hypothetical_pnl_sol ?? 0) > 0) agg[b].w++;
}
console.table(Object.entries(agg).map(([k, v]) => ({ bucket: k, n: v.n, sum_pnl: +v.sum.toFixed(4), avg_pnl: +(v.sum / v.n).toFixed(5), winRate: +((v.w / v.n) * 100).toFixed(1) })));
console.log("TOTAL hypothetical_pnl_sol (resolved traded):", db.prepare("SELECT ROUND(SUM(hypothetical_pnl_sol),4) s, COUNT(*) n FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND hypothetical_pnl_sol IS NOT NULL").get());

// ── CALIBRATION: of traded BUYs that hit the -45% stop region, how many RECOVERED to a winner? ──
// Drawdown semantics: max_drawdown_pct is magnitude from peak. We want trough vs entry.
// Use price horizons to estimate: did a coin that dipped below -45% (price_5m or price_15m) later reach >=2x peak?
console.log("\n=== STOP-LOSS CALIBRATION: dip-then-rip recovery test ===");
const calib = db.prepare(`
  SELECT price_at_alert, price_5m, price_15m, price_1h, max_gain_pct, max_drawdown_pct
  FROM signals
  WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND price_at_alert>0 AND max_gain_pct IS NOT NULL`).all() as any[];
let dipped45_5m = 0, dipped45_5m_recovered2x = 0, dipped45_5m_recovered15 = 0;
for (const r of calib) {
  const ret5 = r.price_5m != null ? (r.price_5m - r.price_at_alert) / r.price_at_alert : null;
  if (ret5 !== null && ret5 <= -0.45) {
    dipped45_5m++;
    if ((r.max_gain_pct ?? 0) >= 100) dipped45_5m_recovered2x++;
    if ((r.max_gain_pct ?? 0) >= 50) dipped45_5m_recovered15++;
  }
}
console.log(`traded BUYs with price_5m & max_gain: ${calib.length}`);
console.log(`dipped <=-45% by 5m: ${dipped45_5m}`);
console.log(`  of those, later peaked >=2x: ${dipped45_5m_recovered2x} (${dipped45_5m?((dipped45_5m_recovered2x/dipped45_5m)*100).toFixed(1):"-"}%)`);
console.log(`  of those, later peaked >=1.5x: ${dipped45_5m_recovered15} (${dipped45_5m?((dipped45_5m_recovered15/dipped45_5m)*100).toFixed(1):"-"}%)`);

db.close();
