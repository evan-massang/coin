import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const one = (sql:string,...a:any[])=>db.prepare(sql).get(...a) as any;
// Across ALL signals (not just BUY): are exit_reason / hypothetical_pnl_sol ever populated?
for (const col of ["exit_reason","hypothetical_pnl_sol","real_pnl_sol","max_gain_pct"]) {
  const r = one(`SELECT COUNT(*) tot, COUNT(${col}) nn FROM signals`);
  console.log(`${col}: non-null ${r.nn}/${r.tot}`);
}
// learning_features / backtest_runs presence (alt durable PnL store?)
for (const t of ["learning_features","backtest_runs","replay_events"]) {
  try { console.log(`${t} rows:`, one(`SELECT COUNT(*) n FROM ${t}`).n); } catch(e){ console.log(t,"missing"); }
}
