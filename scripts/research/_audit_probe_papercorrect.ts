import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

function q(label: string, sql: string, ...args: any[]) {
  try { console.log("== " + label + " =="); console.log(JSON.stringify(db.prepare(sql).all(...args), null, 0)); }
  catch (e) { console.log("ERR " + label + ": " + (e as Error).message); }
}

// schema of paper tables
for (const t of ["paper_positions","paper_trades","paper_wallet","paper_price_samples"]) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all() as any[];
    console.log(`SCHEMA ${t}: ` + cols.map(c=>c.name).join(","));
  } catch(e){ console.log("no table "+t); }
}

q("wallet", "SELECT * FROM paper_wallet");
q("pos_counts_by_status", "SELECT status, COUNT(*) n FROM paper_positions GROUP BY status");
q("trade_counts_by_side", "SELECT side, COUNT(*) n, ROUND(SUM(sol_amount),4) sol, ROUND(SUM(realized_pnl_sol),4) realized FROM paper_trades GROUP BY side");
q("realized_sum", "SELECT ROUND(SUM(realized_pnl_sol),5) realized_total FROM paper_trades");
