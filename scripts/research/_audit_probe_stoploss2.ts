import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

const total = db.prepare(`SELECT COUNT(*) c FROM paper_trades`).get() as { c: number };
console.log("paper_trades total rows:", total.c);
const bySide = db.prepare(`SELECT side, COUNT(*) c FROM paper_trades GROUP BY side`).all();
console.log("by side:", JSON.stringify(bySide));

const range = db.prepare(`SELECT MIN(at) mn, MAX(at) mx FROM paper_trades`).get() as { mn: number; mx: number };
console.log("at range:", new Date(range.mn).toISOString(), "->", new Date(range.mx).toISOString());

// signals table — exit_reason distribution and count (a larger historical record?)
const sigTotal = db.prepare(`SELECT COUNT(*) c FROM signals`).get() as { c: number };
console.log("\nsignals total:", sigTotal.c);
const exitReasons = db.prepare(
  `SELECT exit_reason, COUNT(*) c FROM signals WHERE exit_reason IS NOT NULL GROUP BY exit_reason ORDER BY c DESC`
).all();
console.log("signals exit_reason dist:", JSON.stringify(exitReasons));

// signals with stop-loss-like exit and their max_drawdown
const dd = db.prepare(
  `SELECT exit_reason, AVG(max_drawdown_pct) avgdd, COUNT(*) c FROM signals WHERE exit_reason IS NOT NULL GROUP BY exit_reason`
).all();
console.log("avg drawdown by exit_reason:", JSON.stringify(dd));

db.close();
