// V5.1 P0 forensic: per-fill ledger says realized −11.76 SOL; cash-derived says
// +43. Which is fiction? Read-only probe of the paper accounting tables.
import Database from "better-sqlite3";
const db = new Database("data/sniper.sqlite", { readonly: true });
const now = Date.now();
const w = db.prepare("SELECT * FROM paper_wallet WHERE id=1").get();
console.log(`wallet: start=${w.starting_balance_sol} balance=${w.balance_sol.toFixed(3)}`);

const ledger = db.prepare("SELECT COALESCE(SUM(realized_pnl_sol),0) s, COUNT(*) n FROM paper_trades").get();
console.log(`ledger: realized=${ledger.s.toFixed(3)} SOL over ${ledger.n} fills`);

const open = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(sol_invested),0) inv FROM paper_positions WHERE status!='CLOSED'").all()[0];
console.log(`open positions: n=${open.n} sol_invested=${open.inv.toFixed(3)}`);
console.log(`cash-derived realized = balance - start + invested_open = ${(w.balance_sol - w.starting_balance_sol + open.inv).toFixed(3)}`);

// Age + staleness of open positions
const rows = db.prepare(`
  SELECT p.id, p.mint, p.symbol, p.status, p.entry_at_ms, p.sol_invested, p.token_amount,
         p.entry_price_usd, p.last_price_usd, p.cost_basis_usd,
         (SELECT MAX(at) FROM paper_price_samples s WHERE s.position_id=p.id) AS last_sample_at
  FROM paper_positions p WHERE p.status!='CLOSED' ORDER BY p.entry_at_ms ASC`).all();
let staleCount = 0, staleInv = 0, nearEntryVal = 0;
const hr = (ms) => ms == null ? "never" : ((now - ms) / 3600_000).toFixed(1) + "h";
console.log(`\nopen positions detail (oldest first, max 25 shown):`);
for (const r of rows.slice(0, 25)) {
  const stale = r.last_sample_at == null || now - r.last_sample_at > 2 * 3600_000;
  if (stale) { staleCount++; staleInv += r.sol_invested; }
  const ratio = r.entry_price_usd > 0 && r.last_price_usd != null ? (r.last_price_usd / r.entry_price_usd).toFixed(2) : "?";
  console.log(`  #${r.id} ${String(r.symbol ?? "").padEnd(10)} age=${hr(r.entry_at_ms).padStart(7)} lastPriced=${hr(r.last_sample_at).padStart(7)} ago inv=${r.sol_invested.toFixed(3)} px/entry=${ratio}`);
}
for (const r of rows.slice(25)) {
  const stale = r.last_sample_at == null || now - r.last_sample_at > 2 * 3600_000;
  if (stale) { staleCount++; staleInv += r.sol_invested; }
}
console.log(`\nstale (>2h unpriced or never): ${staleCount}/${rows.length} positions, ${staleInv.toFixed(3)} SOL invested`);

// CLOSED-but-holding anomaly + fills without positions
const ghost = db.prepare("SELECT COUNT(*) n FROM paper_positions WHERE status='CLOSED' AND token_amount > 0").get();
console.log(`CLOSED positions still holding tokens: ${ghost.n}`);
const orphans = db.prepare("SELECT COUNT(DISTINCT t.mint) n FROM paper_trades t LEFT JOIN paper_positions p ON p.mint=t.mint WHERE p.id IS NULL").get();
console.log(`fill mints with NO position row: ${orphans.n}`);
const dupes = db.prepare("SELECT mint, COUNT(*) c FROM paper_positions WHERE status!='CLOSED' GROUP BY mint HAVING c>1").all();
console.log(`mints with MULTIPLE open positions: ${dupes.length}`);

// Sells whose realized pnl is exactly 0 (suspicious if price moved)
const zeroSells = db.prepare("SELECT COUNT(*) n FROM paper_trades WHERE side='sell' AND realized_pnl_sol=0").get();
const sells = db.prepare("SELECT COUNT(*) n FROM paper_trades WHERE side='sell'").get();
console.log(`sells with realized_pnl_sol = 0: ${zeroSells.n}/${sells.n}`);

// Buy cash-flow integrity: total bought vs total sold in SOL terms
const flows = db.prepare("SELECT side, COALESCE(SUM(sol_amount),0) s, COUNT(*) n FROM paper_trades GROUP BY side").all();
for (const f of flows) console.log(`${f.side}: ${f.n} fills, ${f.s.toFixed(3)} SOL`);
const buys = flows.find((f) => f.side === "buy")?.s ?? 0;
const sellsSol = flows.find((f) => f.side === "sell")?.s ?? 0;
console.log(`identity check: start - buys + sells = ${(w.starting_balance_sol - buys + sellsSol).toFixed(3)} vs balance ${w.balance_sol.toFixed(3)}`);
db.close();
