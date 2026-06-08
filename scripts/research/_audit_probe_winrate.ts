import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

// 1) Paper panel win rate: closed paper positions with realized_pnl_usd > 0
const closed = db.prepare("SELECT realized_pnl_usd FROM paper_positions WHERE closed_at_ms IS NOT NULL").all() as { realized_pnl_usd: number }[];
const pwWins = closed.filter((p) => (p.realized_pnl_usd ?? 0) > 0).length;
console.log("PAPER closed positions:", closed.length, "wins(realized>0):", pwWins, "winRate%:", closed.length ? ((pwWins / closed.length) * 100).toFixed(1) : "n/a");

// distribution of realized_pnl_usd
const zeros = closed.filter((p) => (p.realized_pnl_usd ?? 0) === 0).length;
const negs = closed.filter((p) => (p.realized_pnl_usd ?? 0) < 0).length;
console.log("  breakdown -> >0:", pwWins, " ==0:", zeros, " <0:", negs);

// 2) buyStats win rate: resolved BUY signals (max_gain_pct not null), win = max_gain_pct >= 100 (>=2x)
const resolved = db.prepare("SELECT max_gain_pct FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct IS NOT NULL").all() as { max_gain_pct: number }[];
const bsWins = resolved.filter((r) => r.max_gain_pct >= 100).length;
console.log("BUYSTATS resolved BUY signals:", resolved.length, "wins(>=2x):", bsWins, "winRate%:", resolved.length ? ((bsWins / resolved.length) * 100).toFixed(1) : "n/a");

// Also: how many BUY signals total / resolved vs unresolved
const buyTotal = db.prepare("SELECT COUNT(*) c FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')").get() as { c: number };
console.log("BUY signals total (any resolution):", buyTotal.c);

// minWeatherSamples gate check: is buyStats samples >= 20?
console.log("buyStats samples >= 20 (panel reason shows)?", resolved.length >= 20);

db.close();
