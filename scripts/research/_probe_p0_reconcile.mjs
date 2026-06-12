// P0 verification probe (read-only): do all paper PnL views reconcile, and is
// the durable realized journal alive? Run any time:
//   node scripts/research/_probe_p0_reconcile.mjs
import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const EPS = 0.01; // SOL

const ver = db.pragma("user_version", { simple: true });
console.log(`schema user_version = ${ver} ${ver >= 15 ? "(v15 journal present)" : "(JOURNAL MISSING — engine not migrated)"}`);

const wallet = db.prepare("SELECT * FROM paper_wallet WHERE id=1").get();
if (!wallet) { console.log("no paper wallet"); process.exit(0); }

const open = db.prepare("SELECT * FROM paper_positions WHERE status!='CLOSED'").all();
let openCost = 0, openValue = 0;
for (const p of open) {
  openCost += p.sol_invested;
  const mult = p.last_price_usd && p.entry_price_usd > 0 ? p.last_price_usd / p.entry_price_usd : 1;
  openValue += p.sol_invested * mult;
}
const equity = wallet.balance_sol + openValue;
const statsRealized = wallet.balance_sol + openCost - wallet.starting_balance_sol; // cash-derived
const fillsRealized = db.prepare("SELECT COALESCE(SUM(realized_pnl_sol),0) s FROM paper_trades WHERE side='sell'").get().s;

console.log(`\nwallet: start=${wallet.starting_balance_sol} cash=${wallet.balance_sol.toFixed(3)} openCost=${openCost.toFixed(3)} openValue=${openValue.toFixed(3)} equity=${equity.toFixed(3)}`);
console.log(`IDENTITY equity = cash + openValue: holds by construction (${equity.toFixed(3)})`);

const d1 = statsRealized - fillsRealized;
console.log(`realized (cash-derived) = ${statsRealized.toFixed(3)} vs Σ fills = ${fillsRealized.toFixed(3)} → delta ${d1.toFixed(3)} SOL ${Math.abs(d1) <= EPS ? "RECONCILES" : "DRIFT"}`);

if (ver >= 15) {
  const lastReset = db.prepare("SELECT MAX(at) m FROM paper_resets").get().m ?? 0;
  const j = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(realized_pnl_sol),0) s, MIN(closed_at) f, MAX(closed_at) l FROM realized_trades WHERE closed_at >= ?").get(lastReset);
  const jAll = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(realized_pnl_sol),0) s FROM realized_trades").get();
  console.log(`\nJOURNAL: ${jAll.n} rows all-time (${jAll.s.toFixed(3)} SOL) · since last reset: ${j.n} rows (${j.s.toFixed(3)} SOL)`);
  if (j.f) console.log(`  ledger span: ${new Date(j.f).toISOString()} → ${new Date(j.l).toISOString()} (${((j.l - j.f) / 86_400_000).toFixed(2)} days of the 7-day gate)`);
  // EXACT identity check — only approx=0 rows (their fills all carry position_id;
  // approx rows reconstruct pre-v15 history and legitimately include unfagged fills).
  const exact = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(realized_pnl_sol),0) s FROM realized_trades WHERE approx=0").get();
  if (exact.n > 0) {
    const fillsExact = db.prepare(
      `SELECT COALESCE(SUM(t.realized_pnl_sol),0) s FROM paper_trades t
       WHERE t.side='sell' AND t.position_id IN (SELECT position_id FROM realized_trades WHERE approx=0)`
    ).get().s;
    const d2 = exact.s - fillsExact;
    console.log(`  EXACT class (approx=0, n=${exact.n}): journal Σ ${exact.s.toFixed(4)} vs fills Σ ${fillsExact.toFixed(4)} → delta ${d2.toFixed(4)} ${Math.abs(d2) <= EPS ? "RECONCILES" : "DRIFT"}`);
  } else {
    console.log(`  EXACT class (approx=0): no rows yet — every journaled close so far predates v15 fills (expected right after deploy)`);
  }
  const latest = db.prepare("SELECT mint, symbol, verdict, flags, realized_pnl_sol, realized_pnl_pct, exit_reason, dd_5m_pct, approx FROM realized_trades ORDER BY closed_at DESC LIMIT 5").all();
  console.table(latest.map((r) => ({ ...r, mint: r.mint.slice(0, 8), realized_pnl_sol: r.realized_pnl_sol?.toFixed(4), realized_pnl_pct: r.realized_pnl_pct?.toFixed(1) })));
  const resets = db.prepare("SELECT * FROM paper_resets ORDER BY at DESC LIMIT 3").all();
  console.log(`resets logged: ${resets.length}${resets[0] ? ` (latest ${new Date(resets[0].at).toISOString()} → ${resets[0].export_path})` : ""}`);
}
