// Read-only probe: sign convention + distribution of max_drawdown_pct /
// max_gain_pct on BUY signals — validates the spike_exit_sweep simulation.
import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

const r = db.prepare(`
  SELECT COUNT(*) n,
         MIN(max_drawdown_pct) dd_min, MAX(max_drawdown_pct) dd_max, AVG(max_drawdown_pct) dd_avg,
         SUM(CASE WHEN max_drawdown_pct > 0 THEN 1 ELSE 0 END) dd_pos,
         SUM(CASE WHEN max_drawdown_pct < 0 THEN 1 ELSE 0 END) dd_neg,
         SUM(CASE WHEN max_drawdown_pct <= -40 THEN 1 ELSE 0 END) dd_breach40,
         MIN(max_gain_pct) g_min, MAX(max_gain_pct) g_max, AVG(max_gain_pct) g_avg
  FROM signals WHERE verdict LIKE 'BUY%' AND max_drawdown_pct IS NOT NULL AND max_gain_pct IS NOT NULL
`).get();
console.log(JSON.stringify(r, null, 2));

// How many usable rows BOTH spiked >=1.3x and breached the -40% stop?
const both = db.prepare(`
  SELECT COUNT(*) n FROM signals
  WHERE verdict LIKE 'BUY%' AND price_at_alert > 0
    AND max_gain_pct >= 30 AND max_drawdown_pct <= -40
    AND COALESCE(price_1h, price_15m, price_5m) IS NOT NULL
`).get();
console.log("rows with spike>=1.3x AND breach<=-40%:", both.n);

// Sample rows to eyeball the convention
const sample = db.prepare(`
  SELECT mint, max_gain_pct, max_drawdown_pct, price_at_alert, price_5m, price_1h
  FROM signals WHERE verdict LIKE 'BUY%' AND max_drawdown_pct IS NOT NULL
  ORDER BY at DESC LIMIT 8
`).all();
console.table(sample.map((s) => ({ ...s, mint: s.mint.slice(0, 8) })));
