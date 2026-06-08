/** READ-ONLY: reconcile paper accounting. Why does balance≠start+PnL?
 *   npx tsx scripts/research/_audit_paperacct.ts */
import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const w = db.prepare("SELECT starting_balance_sol AS start, balance_sol AS bal FROM paper_wallet WHERE id=1").get() as { start: number; bal: number };

const open = db.prepare("SELECT sol_invested, entry_price_usd, last_price_usd FROM paper_positions WHERE closed_at_ms IS NULL").all() as { sol_invested: number; entry_price_usd: number; last_price_usd: number | null }[];
let openCost = 0, openMtm = 0;
for (const p of open) {
  openCost += p.sol_invested;
  const mult = p.entry_price_usd > 0 && p.last_price_usd ? p.last_price_usd / p.entry_price_usd : 1;
  openMtm += p.sol_invested * mult;
}
const closed = db.prepare("SELECT realized_pnl_usd, sol_invested FROM paper_positions WHERE closed_at_ms IS NOT NULL").all() as { realized_pnl_usd: number; sol_invested: number }[];
const realizedTradesSol = (db.prepare("SELECT COALESCE(SUM(realized_pnl_sol),0) s FROM paper_trades WHERE side='sell'").get() as { s: number }).s;

const unrealized = openMtm - openCost;            // open positions MTM vs cost
const equity = w.bal + openMtm;                    // cash + open value
const pnlByEquity = equity - w.start;              // equity-based PnL
const pnlByLedger = realizedTradesSol + unrealized; // realized(closed sells) + unrealized(open)

console.log(`wallet: start ${w.start}  cash balance ${w.bal.toFixed(3)}`);
console.log(`open positions: ${open.length}  cost ${openCost.toFixed(3)} SOL  MTM ${openMtm.toFixed(3)} SOL  (unrealized ${unrealized.toFixed(3)})`);
console.log(`closed positions: ${closed.length}`);
console.log(`realized (Σ paper_trades.realized_pnl_sol): ${realizedTradesSol.toFixed(3)} SOL`);
console.log(`\n— two ways to compute total PnL —`);
console.log(`  equity-based  (cash + openMTM − start): ${pnlByEquity.toFixed(3)} SOL   [equity ${equity.toFixed(3)}]`);
console.log(`  ledger-based  (realized + unrealized) : ${pnlByLedger.toFixed(3)} SOL`);
console.log(`  RECONCILE? diff = ${(pnlByEquity - pnlByLedger).toFixed(3)} SOL  ${Math.abs(pnlByEquity - pnlByLedger) < 0.01 ? "OK ✓" : "MISMATCH ✗"}`);
console.log(`\nwhat the user sees: balance(cash) ${w.bal.toFixed(1)} < start ${w.start} because ${openCost.toFixed(1)} SOL is locked in ${open.length} open positions`);
db.close();
