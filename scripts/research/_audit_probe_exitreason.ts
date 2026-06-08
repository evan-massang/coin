import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

const totalSells = db.prepare("SELECT COUNT(*) n FROM paper_trades WHERE side='sell'").get() as any;
console.log("total sell fills:", totalSells.n);

const totalBuys = db.prepare("SELECT COUNT(*) n FROM paper_trades WHERE side='buy'").get() as any;
console.log("total buy fills:", totalBuys.n);

console.log("\n-- raw reason buckets (sell) --");
const raw = db.prepare(
  "SELECT reason, COUNT(*) n, ROUND(SUM(COALESCE(realized_pnl_sol,0)),3) pnl FROM paper_trades WHERE side='sell' GROUP BY reason ORDER BY n DESC"
).all() as any[];
for (const r of raw) console.log(`  n=${r.n}  pnl=${r.pnl}  "${r.reason}"`);

console.log("\n-- collapsed by reason prefix --");
const prefix = db.prepare(`
  SELECT
    CASE
      WHEN reason LIKE 'Stop loss%' THEN 'Stop loss'
      WHEN reason LIKE 'Profit ladder%' THEN 'Profit ladder'
      WHEN reason LIKE 'Trailing%' THEN 'Trailing stop'
      WHEN reason LIKE 'Time%' THEN 'Time stop'
      ELSE COALESCE(reason,'<null>')
    END bucket,
    COUNT(*) n,
    ROUND(SUM(COALESCE(realized_pnl_sol,0)),3) pnl
  FROM paper_trades WHERE side='sell'
  GROUP BY bucket ORDER BY n DESC
`).all() as any[];
for (const r of prefix) console.log(`  ${r.bucket}: n=${r.n}  pnl=${r.pnl}`);

console.log("\n-- losing sells only, by bucket --");
const losers = db.prepare(`
  SELECT
    CASE
      WHEN reason LIKE 'Stop loss%' THEN 'Stop loss'
      WHEN reason LIKE 'Profit ladder%' THEN 'Profit ladder'
      WHEN reason LIKE 'Trailing%' THEN 'Trailing stop'
      WHEN reason LIKE 'Time%' THEN 'Time stop'
      ELSE COALESCE(reason,'<null>')
    END bucket,
    COUNT(*) n,
    ROUND(SUM(COALESCE(realized_pnl_sol,0)),3) pnl
  FROM paper_trades WHERE side='sell' AND COALESCE(realized_pnl_sol,0) < 0
  GROUP BY bucket ORDER BY n DESC
`).all() as any[];
for (const r of losers) console.log(`  ${r.bucket}: n=${r.n}  pnl=${r.pnl}`);

db.close();
