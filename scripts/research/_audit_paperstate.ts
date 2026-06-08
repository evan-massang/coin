/** READ-ONLY: why are BUY signals not becoming paper positions? Check wallet + caps.
 *   npx tsx scripts/research/_audit_paperstate.ts */
import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const tbls = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((x) => x.name);
const setting = (k: string) => { try { const r = db.prepare("SELECT value FROM settings WHERE key=?").get(k) as { value: string } | undefined; return r ? JSON.parse(r.value) : "(default)"; } catch { return "(err)"; } };
for (const k of ["paperEnabled", "paperStartingBalanceSol", "paperMaxPositionSol", "paperRiskPerTradePct", "maxLateEntryRisk"]) console.log(`setting ${k} = ${setting(k)}`);

if (tbls.includes("paper_positions")) {
  const open = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(sol_invested),0) s FROM paper_positions WHERE closed_at_ms IS NULL").get() as { n: number; s: number };
  console.log(`open positions: ${open.n}  SOL tied up: ${open.s.toFixed(3)}`);
  const rec = db.prepare("SELECT entry_at_ms FROM paper_positions ORDER BY entry_at_ms DESC LIMIT 5").all() as { entry_at_ms: number }[];
  console.log(`last 5 entries (UTC): ${rec.map((r) => new Date(r.entry_at_ms).toISOString().slice(11, 19)).join(", ")}`);
}
console.log(`paper-related tables: ${tbls.filter((t) => t.startsWith("paper")).join(", ")}`);
// Try to find a wallet/balance row
for (const t of tbls.filter((t) => t.startsWith("paper"))) {
  if (t === "paper_positions" || t === "paper_trades" || t === "paper_price_samples") continue;
  try { const rows = db.prepare(`SELECT * FROM ${t} LIMIT 3`).all(); console.log(`${t}: ${JSON.stringify(rows)}`); } catch { /* */ }
}
db.close();
