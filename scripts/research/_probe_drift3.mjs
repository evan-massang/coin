// Timeline forensics for the worst phantom-sell offenders: every fill + every
// position row for the mint, interleaved chronologically.
import Database from "better-sqlite3";
const db = new Database("data/sniper.sqlite", { readonly: true });

const offenders = db.prepare(`
  SELECT mint,
    SUM(CASE WHEN side='buy' THEN token_amount ELSE 0 END) AS bought,
    SUM(CASE WHEN side='sell' THEN token_amount ELSE 0 END) AS sold
  FROM paper_trades GROUP BY mint
  HAVING bought > 0 AND sold/bought > 2.5 ORDER BY sold/bought DESC LIMIT 2`).all();

for (const o of offenders) {
  console.log(`\n═══ mint ${o.mint} (sold/bought=${(o.sold / o.bought).toFixed(2)}) ═══`);
  const fills = db.prepare("SELECT id, side, token_amount, sol_amount, realized_pnl_sol, remaining_token_amount, reason, at FROM paper_trades WHERE mint=? ORDER BY at ASC").all(o.mint);
  const poss = db.prepare("SELECT id, status, token_amount, sol_invested, entry_at_ms, closed_at_ms FROM paper_positions WHERE mint=?").all(o.mint);
  console.log(`position rows: ${poss.length}`);
  for (const p of poss) console.log(`  pos#${p.id} status=${p.status} tokens=${p.token_amount.toFixed(0)} inv=${p.sol_invested.toFixed(4)} entry=${new Date(p.entry_at_ms).toISOString().slice(11, 19)} closed=${p.closed_at_ms ? new Date(p.closed_at_ms).toISOString().slice(11, 19) : "-"}`);
  console.log(`fills:`);
  for (const f of fills) {
    console.log(`  ${new Date(f.at).toISOString().slice(11, 19)} ${f.side.padEnd(4)} tok=${f.token_amount.toFixed(0).padStart(12)} sol=${f.sol_amount.toFixed(4)} realized=${f.realized_pnl_sol.toFixed(4)} remaining=${f.remaining_token_amount.toFixed(0)} (${f.reason ?? ""})`);
  }
}

// How many mints have MULTIPLE position rows historically?
const multi = db.prepare("SELECT COUNT(*) n FROM (SELECT mint FROM paper_positions GROUP BY mint HAVING COUNT(*)>1)").get();
const totalPos = db.prepare("SELECT COUNT(*) n FROM paper_positions").get();
const totalBuyFills = db.prepare("SELECT COUNT(*) n FROM paper_trades WHERE side='buy'").get();
console.log(`\nposition rows total: ${totalPos.n} · buy fills: ${totalBuyFills.n} · mints with >1 position row: ${multi.n}`);
db.close();
