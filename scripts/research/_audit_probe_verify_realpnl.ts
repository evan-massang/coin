import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

const totalSignals = (db.prepare("SELECT COUNT(*) c FROM signals").get() as any).c;

const cov = db.prepare(`
  SELECT
    COUNT(*) total,
    SUM(CASE WHEN max_gain_pct IS NOT NULL THEN 1 ELSE 0 END) max_gain,
    SUM(CASE WHEN real_pnl_sol IS NOT NULL THEN 1 ELSE 0 END) real_pnl,
    SUM(CASE WHEN hypothetical_pnl_sol IS NOT NULL THEN 1 ELSE 0 END) hyp_pnl,
    SUM(CASE WHEN exit_reason IS NOT NULL THEN 1 ELSE 0 END) exit_reason
  FROM signals
`).get() as any;
console.log("signals total:", totalSignals);
console.log("coverage:", JSON.stringify(cov));

// BUY-only
const buyCov = db.prepare(`
  SELECT COUNT(*) total,
    SUM(CASE WHEN real_pnl_sol IS NOT NULL THEN 1 ELSE 0 END) real_pnl,
    SUM(CASE WHEN max_gain_pct IS NOT NULL THEN 1 ELSE 0 END) max_gain
  FROM signals WHERE verdict LIKE 'BUY%'
`).get() as any;
console.log("BUY-only:", JSON.stringify(buyCov));

// learning_features coverage
try {
  const lf = db.prepare(`
    SELECT COUNT(*) total,
      SUM(CASE WHEN realized_pnl_sol IS NOT NULL THEN 1 ELSE 0 END) realized_pnl,
      SUM(CASE WHEN exit_price IS NOT NULL THEN 1 ELSE 0 END) exit_price,
      SUM(CASE WHEN exit_reason IS NOT NULL THEN 1 ELSE 0 END) exit_reason
    FROM learning_features
  `).get() as any;
  console.log("learning_features:", JSON.stringify(lf));
} catch (e: any) {
  console.log("learning_features err:", e.message);
}

// peak vs realized divergence for BUYs
const peakStats = db.prepare(`
  SELECT
    AVG(max_gain_pct) avg_max_gain,
    AVG(max_drawdown_pct) avg_max_dd,
    SUM(CASE WHEN max_gain_pct >= 100 THEN 1 ELSE 0 END) peak_ge_2x,
    COUNT(*) n
  FROM signals WHERE verdict LIKE 'BUY%' AND max_gain_pct IS NOT NULL
`).get() as any;
console.log("BUY peak stats:", JSON.stringify(peakStats));

// mint-join ambiguity: mints with >1 BUY signal
const ambig = db.prepare(`
  SELECT COUNT(*) c FROM (
    SELECT mint FROM signals WHERE verdict LIKE 'BUY%' GROUP BY mint HAVING COUNT(*) > 1
  )
`).get() as any;
console.log("mints with >1 BUY signal (ambiguous):", ambig.c);

// paper_positions: how many closed, and do they have realized pnl
try {
  const pp = db.prepare(`
    SELECT COUNT(*) total,
      SUM(CASE WHEN closed_at_ms IS NOT NULL THEN 1 ELSE 0 END) closed,
      SUM(CASE WHEN realized_pnl_usd IS NOT NULL THEN 1 ELSE 0 END) has_realized
    FROM paper_positions
  `).get() as any;
  console.log("paper_positions:", JSON.stringify(pp));
} catch (e: any) {
  console.log("paper_positions err:", e.message);
}

// paper_trades realized pnl present?
try {
  const pt = db.prepare(`
    SELECT COUNT(*) total,
      SUM(CASE WHEN side='sell' THEN 1 ELSE 0 END) sells,
      SUM(CASE WHEN realized_pnl_sol IS NOT NULL THEN 1 ELSE 0 END) has_pnl
    FROM paper_trades
  `).get() as any;
  console.log("paper_trades:", JSON.stringify(pt));
} catch (e: any) {
  console.log("paper_trades err:", e.message);
}

db.close();
