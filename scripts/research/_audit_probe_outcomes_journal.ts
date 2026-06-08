import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

function one(sql: string): any {
  return db.prepare(sql).get();
}

console.log("=== signals totals ===");
console.log(one("SELECT COUNT(*) AS total FROM signals"));
console.log("=== outcome col nullness (overall) ===");
console.log(one(`SELECT
  SUM(exit_reason IS NOT NULL) AS exit_reason_nn,
  SUM(hypothetical_pnl_sol IS NOT NULL) AS hyp_pnl_nn,
  SUM(real_pnl_sol IS NOT NULL) AS real_pnl_nn,
  SUM(max_gain_pct IS NOT NULL) AS max_gain_nn,
  SUM(max_drawdown_pct IS NOT NULL) AS max_dd_nn,
  SUM(price_5m IS NOT NULL) AS p5m_nn,
  SUM(price_15m IS NOT NULL) AS p15m_nn,
  SUM(price_1h IS NOT NULL) AS p1h_nn,
  COUNT(*) AS total
  FROM signals`));

console.log("=== BUY-only (verdict LIKE BUY%) ===");
console.log(one(`SELECT
  COUNT(*) AS buy_total,
  SUM(exit_reason IS NOT NULL) AS exit_reason_nn,
  SUM(hypothetical_pnl_sol IS NOT NULL) AS hyp_pnl_nn,
  SUM(real_pnl_sol IS NOT NULL) AS real_pnl_nn,
  SUM(max_gain_pct IS NOT NULL) AS max_gain_nn,
  SUM(max_drawdown_pct IS NOT NULL) AS max_dd_nn
  FROM signals WHERE verdict LIKE 'BUY%'`));

console.log("=== verdict distribution ===");
for (const r of db.prepare("SELECT verdict, COUNT(*) AS n FROM signals GROUP BY verdict ORDER BY n DESC").all()) {
  console.log(r);
}

console.log("=== backtest_runs rows ===");
try { console.log(one("SELECT COUNT(*) AS n FROM backtest_runs")); } catch (e: any) { console.log("backtest_runs error:", e.message); }

console.log("=== paper_trades summary ===");
try {
  console.log(one("SELECT COUNT(*) AS n, COUNT(DISTINCT mint) AS mints FROM paper_trades"));
  console.log("distinct reasons:");
  for (const r of db.prepare("SELECT reason, COUNT(*) AS n FROM paper_trades GROUP BY reason ORDER BY n DESC").all()) console.log(r);
} catch (e: any) { console.log("paper_trades error:", e.message); }

console.log("=== paper_positions summary ===");
try {
  console.log(one("SELECT COUNT(*) AS total, SUM(closed_at_ms IS NOT NULL) AS closed FROM paper_positions"));
} catch (e: any) { console.log("paper_positions error:", e.message); }

// Reconciliation: BUY signals vs paper fills (by mint)
console.log("=== reconcile: BUY signal mints with/without a paper buy fill ===");
try {
  console.log(one(`SELECT
    (SELECT COUNT(DISTINCT mint) FROM signals WHERE verdict LIKE 'BUY%') AS buy_signal_mints,
    (SELECT COUNT(DISTINCT mint) FROM paper_trades WHERE side='buy') AS paper_buy_mints`));
} catch (e: any) { console.log("reconcile error:", e.message); }

db.close();
