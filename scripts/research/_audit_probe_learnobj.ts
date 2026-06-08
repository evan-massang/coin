import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const one = (sql: string, ...a: any[]) => db.prepare(sql).get(...a) as any;
const all = (sql: string, ...a: any[]) => db.prepare(sql).all(...a) as any[];

// ---- learning_features coverage ----
const lf = one("SELECT COUNT(*) n FROM learning_features");
console.log("learning_features total rows:", lf.n);

// What columns does learning_features actually have?
const cols = all("PRAGMA table_info(learning_features)").map((c) => c.name);
console.log("learning_features columns:", cols.join(", "));

const hasRealized = cols.includes("realized_pnl_sol");
if (hasRealized) {
  const cov = one("SELECT SUM(realized_pnl_sol IS NOT NULL) realpnl, SUM(max_gain_pct IS NOT NULL) gain FROM learning_features");
  console.log("coverage: realized_pnl NON-NULL =", cov.realpnl, " max_gain NON-NULL =", cov.gain);
} else {
  console.log("NOTE: learning_features has NO realized_pnl_sol column at all");
}

const lfbuy = one("SELECT COUNT(*) n FROM learning_features WHERE verdict IN ('BUY_SMALL','BUY_STRONG')");
console.log("learning_features BUY rows (analyzePerformance needs >=12):", lfbuy.n);

// ---- signals: outcome divergence for BUYs ----
const sig = one(`SELECT COUNT(*) n,
  SUM(max_gain_pct>=100) g2,
  SUM(max_gain_pct>=200) g3,
  SUM(max_gain_pct>=400) g5,
  AVG(max_gain_pct) avgGain,
  AVG(max_drawdown_pct) avgDD
  FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct IS NOT NULL`);
console.log("\nsignals BUYs with max_gain_pct resolved:", sig.n);
console.log("  peak>=2x (gain>=100):", sig.g2, `(${(100*sig.g2/sig.n).toFixed(1)}%)`);
console.log("  peak>=3x (gain>=200):", sig.g3);
console.log("  peak>=5x (gain>=400):", sig.g5);
console.log("  avgMaxGain%:", (sig.avgGain as number)?.toFixed(1), " avgMaxDrawdown%:", (sig.avgDD as number)?.toFixed(1));

// total BUY signals regardless of resolution
const allBuys = one("SELECT COUNT(*) n FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')");
console.log("  total BUY signals (any):", allBuys.n);

// ---- realized PnL available in paper tables only ----
const ptcov = one("SELECT COUNT(*) n, COUNT(realized_pnl_sol) nn FROM paper_trades WHERE side='sell'");
console.log("\npaper_trades sells:", ptcov.n, " with realized_pnl_sol:", ptcov.nn);

db.close();
