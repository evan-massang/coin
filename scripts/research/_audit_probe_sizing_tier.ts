import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

function q(sql: string, ...args: any[]) {
  return db.prepare(sql).all(...args);
}

// 1. Verdict distribution + outcome stats on signals that have an outcome (max_gain_pct not null)
console.log("=== ALL signals by verdict ===");
console.log(q(`SELECT verdict, COUNT(*) n FROM signals GROUP BY verdict ORDER BY n DESC`));

console.log("\n=== Signals WITH outcome (max_gain_pct NOT NULL) by verdict ===");
console.log(q(`
  SELECT verdict,
         COUNT(*) n,
         ROUND(AVG(max_gain_pct),2) avg_peak,
         ROUND(100.0*SUM(CASE WHEN max_gain_pct>=100 THEN 1 ELSE 0 END)/COUNT(*),2) twox_rate,
         SUM(CASE WHEN max_gain_pct>=100 THEN 1 ELSE 0 END) twox_hits,
         ROUND(AVG(max_drawdown_pct),2) avg_dd
  FROM signals
  WHERE max_gain_pct IS NOT NULL
  GROUP BY verdict ORDER BY n DESC
`));

// 2. realized hypothetical pnl by verdict (this is the REAL expectancy signal)
console.log("\n=== hypothetical_pnl_sol by verdict (where not null) ===");
console.log(q(`
  SELECT verdict,
         COUNT(*) n,
         ROUND(AVG(hypothetical_pnl_sol),5) avg_pnl,
         ROUND(SUM(hypothetical_pnl_sol),4) sum_pnl,
         ROUND(100.0*SUM(CASE WHEN hypothetical_pnl_sol>0 THEN 1 ELSE 0 END)/COUNT(*),2) win_rate
  FROM signals
  WHERE hypothetical_pnl_sol IS NOT NULL
  GROUP BY verdict ORDER BY n DESC
`));

// 3. price-based realized return at exits: use price_at_alert vs price_5m/15m/1h
console.log("\n=== return at 5m/15m/1h by verdict (price-derived) ===");
console.log(q(`
  SELECT verdict, COUNT(*) n,
    ROUND(AVG(CASE WHEN price_at_alert>0 AND price_5m IS NOT NULL THEN 100.0*(price_5m-price_at_alert)/price_at_alert END),2) ret5m,
    ROUND(AVG(CASE WHEN price_at_alert>0 AND price_15m IS NOT NULL THEN 100.0*(price_15m-price_at_alert)/price_at_alert END),2) ret15m,
    ROUND(AVG(CASE WHEN price_at_alert>0 AND price_1h IS NOT NULL THEN 100.0*(price_1h-price_at_alert)/price_at_alert END),2) ret1h
  FROM signals
  WHERE verdict IN ('BUY_STRONG','BUY_SMALL')
  GROUP BY verdict
`));

// 4. paper buy sizes by reason (reason = verdict on buys)
console.log("\n=== paper_trades buys: avg sol_amount by reason ===");
console.log(q(`
  SELECT reason, COUNT(*) n,
         ROUND(AVG(sol_amount),5) avg_sol,
         ROUND(MIN(sol_amount),5) min_sol,
         ROUND(MAX(sol_amount),5) max_sol
  FROM paper_trades WHERE side='buy' GROUP BY reason ORDER BY n DESC
`));

// 5. realized pnl on closed paper positions by entry reason (join buy reason)
console.log("\n=== paper realized pnl on SELLS by reason ===");
console.log(q(`
  SELECT reason, COUNT(*) n, ROUND(SUM(realized_pnl_sol),4) sum_pnl, ROUND(AVG(realized_pnl_sol),5) avg_pnl
  FROM paper_trades WHERE side='sell' GROUP BY reason ORDER BY n DESC
`));

db.close();
