import Database from "better-sqlite3";
import path from "path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

function q(sql: string, ...p: any[]) { return db.prepare(sql).all(...p); }
function one(sql: string, ...p: any[]) { return db.prepare(sql).get(...p) as any; }

// 1. resolved BUYs window
const buys = one(`SELECT COUNT(*) c, MIN(at) mn, MAX(at) mx
  FROM signals WHERE verdict LIKE 'BUY%' AND max_gain_pct IS NOT NULL`);
console.log("resolved BUYs:", buys.c, "min", new Date(buys.mn).toISOString(), "max", new Date(buys.mx).toISOString(),
  "span_h", ((buys.mx-buys.mn)/3.6e6).toFixed(2));

// per-day buys
console.log("per-day resolved BUYs:");
for (const r of q(`SELECT date(at/1000,'unixepoch') d, COUNT(*) c
  FROM signals WHERE verdict LIKE 'BUY%' AND max_gain_pct IS NOT NULL GROUP BY d ORDER BY d`)) {
  console.log("  ", (r as any).d, (r as any).c);
}

// full signals span
const allsig = one(`SELECT COUNT(*) c, MIN(at) mn, MAX(at) mx FROM signals`);
console.log("ALL signals:", allsig.c, "min", new Date(allsig.mn).toISOString(), "max", new Date(allsig.mx).toISOString());

// all verdict distinct days
console.log("distinct UTC days w/ any signal:",
  (one(`SELECT COUNT(DISTINCT date(at/1000,'unixepoch')) c FROM signals`) as any).c);

// backtest_runs
function tableCount(t: string) {
  try { return (one(`SELECT COUNT(*) c FROM ${t}`) as any).c; } catch(e:any){ return "NO TABLE: "+e.message; }
}
console.log("backtest_runs:", tableCount("backtest_runs"));
console.log("learning_suggestions:", tableCount("learning_suggestions"));
console.log("setting_change_log:", tableCount("setting_change_log"));

// list all tables
console.log("tables:", q(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).map((r:any)=>r.name).join(", "));
